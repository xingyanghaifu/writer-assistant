/**
 * 百万字性能支撑（阶段 12）。
 *
 * 策略：
 *  1. 按需加载：章节列表只带元信息，正文点击时才取
 *  2. 倒排索引：正文字 -> 章节集合，支持快速全文检索
 *  3. 虚拟滚动：DOM 只渲染可视区条目
 *  4. Map 缓存：章节内容、索引、摘要常驻内存，避免重复 IPC
 *
 * 目标：100 万字作品下，检索 < 200ms，滚动 60fps。
 */

/** 章节元信息（不含正文，用于列表与虚拟滚动） */
export interface ChapterMeta {
  id: string
  title: string
  wordCount: number
  volumeId: string
  volumeTitle: string
  updatedAt: number
  hasSummary: boolean
  targetWordCount?: number
}

/** 倒排索引条目 */
interface Posting {
  chapterId: string
  /** 该词在本章出现次数 */
  count: number
}

/** 检索命中 */
export interface SearchHit {
  chapterId: string
  chapterTitle: string
  volumeTitle: string
  /** 命中次数 */
  count: number
  /** 上下文片段（含高亮标记 <<>>） */
  snippet: string
  /** 匹配位置（用于跳转） */
  offset: number
}

/** 检索结果 */
export interface SearchResult {
  query: string
  hits: SearchHit[]
  /** 命中的章节数 */
  chapterCount: number
  /** 总命中次数 */
  totalCount: number
  /** 耗时毫秒 */
  durationMs: number
  /** 是否被截断 */
  truncated: boolean
}

/**
 * 全文索引（倒排表）。
 *
 * 中文按 2-gram，英文按词。相比逐章 indexOf，
 * 多词查询（"玉佩 出现"）与高频词查询显著更快。
 */
export class TextIndex {
  /** 词 -> 倒排列表 */
  private postings = new Map<string, Posting[]>()
  /** 章节 id -> 元信息 */
  private chapterMeta = new Map<string, ChapterMeta>()
  /** 章节 id -> 正文（懒加载，用于取片段） */
  private contentCache = new Map<string, string>()
  /** 索引构建时间 */
  private builtAt = 0
  /** 已索引字数 */
  private indexedWords = 0

  /** 索引大小（词条数） */
  get termCount(): number {
    return this.postings.size
  }

  get builtAtMs(): number {
    return this.builtAt
  }

  get totalIndexedWords(): number {
    return this.indexedWords
  }

  get chapterCount(): number {
    return this.chapterMeta.size
  }

  /** 清空 */
  clear(): void {
    this.postings.clear()
    this.chapterMeta.clear()
    this.contentCache.clear()
    this.builtAt = 0
    this.indexedWords = 0
  }

  /** 建立索引（全量） */
  build(chapters: Array<{ id: string; title: string; content: string }>, metas: ChapterMeta[]): void {
    const started = Date.now()
    this.clear()

    const metaById = new Map(metas.map((m) => [m.id, m]))
    for (const m of metas) this.chapterMeta.set(m.id, m)

    for (const ch of chapters) {
      this.contentCache.set(ch.id, ch.content)
      this.indexedWords += ch.content.replace(/\s/g, '').length

      const freq = new Map<string, number>()
      for (const term of tokenize(ch.content)) {
        freq.set(term, (freq.get(term) ?? 0) + 1)
      }
      for (const [term, count] of freq) {
        const list = this.postings.get(term)
        if (list) list.push({ chapterId: ch.id, count })
        else this.postings.set(term, [{ chapterId: ch.id, count }])
      }
    }

    // 保证 meta 覆盖所有章节（未提供 meta 时补默认值）
    for (const ch of chapters) {
      if (!this.chapterMeta.has(ch.id)) {
        const meta = metaById.get(ch.id)
        this.chapterMeta.set(
          ch.id,
          meta ?? {
            id: ch.id,
            title: ch.title,
            wordCount: ch.content.replace(/\s/g, '').length,
            volumeId: '',
            volumeTitle: '',
            updatedAt: Date.now(),
            hasSummary: false
          }
        )
      }
    }

    this.builtAt = Date.now() - started
  }

  /** 增量更新单章（避免整部重建） */
  updateChapter(chapter: { id: string; title: string; content: string }, meta?: ChapterMeta): void {
    // 先移除该章在所有词条中的记录
    for (const [term, list] of this.postings) {
      const filtered = list.filter((p) => p.chapterId !== chapter.id)
      if (filtered.length) this.postings.set(term, filtered)
      else this.postings.delete(term)
    }

    const prev = this.contentCache.get(chapter.id)
    if (prev) this.indexedWords -= prev.replace(/\s/g, '').length

    this.contentCache.set(chapter.id, chapter.content)
    this.indexedWords += chapter.content.replace(/\s/g, '').length

    const freq = new Map<string, number>()
    for (const term of tokenize(chapter.content)) {
      freq.set(term, (freq.get(term) ?? 0) + 1)
    }
    for (const [term, count] of freq) {
      const list = this.postings.get(term)
      if (list) list.push({ chapterId: chapter.id, count })
      else this.postings.set(term, [{ chapterId: chapter.id, count }])
    }

    if (meta) this.chapterMeta.set(chapter.id, meta)
  }

  /** 移除章节 */
  removeChapter(chapterId: string): void {
    for (const [term, list] of this.postings) {
      const filtered = list.filter((p) => p.chapterId !== chapterId)
      if (filtered.length) this.postings.set(term, filtered)
      else this.postings.delete(term)
    }
    const prev = this.contentCache.get(chapterId)
    if (prev) this.indexedWords -= prev.replace(/\s/g, '').length
    this.contentCache.delete(chapterId)
    this.chapterMeta.delete(chapterId)
  }

  /**
   * 检索。
   * 多词按 AND 取交集；单词直接取倒排表。
   */
  search(query: string, options: { limit?: number; snippetLength?: number } = {}): SearchResult {
    const started = Date.now()
    const limit = options.limit ?? 200
    const snippetLength = options.snippetLength ?? 40
    const q = query.trim()

    if (!q) {
      return { query: q, hits: [], chapterCount: 0, totalCount: 0, durationMs: 0, truncated: false }
    }

    const terms = tokenizeQuery(q)

    // 短查询（1 个汉字/字母）无法用 2-gram 索引，退化为逐章扫描
    if (terms.length === 0) {
      return this.scanSearch(q, limit, snippetLength, started)
    }

    // 取第一个词的倒排表作为候选，其余词做交集过滤
    let candidate: Map<string, number> | null = null
    for (const term of terms) {
      const list = this.postings.get(term)
      const map = new Map<string, number>()
      if (list) for (const p of list) map.set(p.chapterId, (map.get(p.chapterId) ?? 0) + p.count)
      if (candidate === null) {
        candidate = map
      } else {
        // AND 交集
        const next = new Map<string, number>()
        for (const [id, c] of candidate) {
          if (map.has(id)) next.set(id, c + (map.get(id) ?? 0))
        }
        candidate = next
      }
      if (candidate.size === 0) break
    }

    const hits: SearchHit[] = []
    let totalCount = 0
    if (candidate) {
      for (const [chapterId, count] of candidate) {
        const meta = this.chapterMeta.get(chapterId)
        if (!meta) continue
        totalCount += count
        const content = this.contentCache.get(chapterId) ?? ''
        // 片段以第一个词定位
        const anchor = content.indexOf(terms[0]) >= 0 ? content.indexOf(terms[0]) : content.indexOf(q)
        const offset = anchor >= 0 ? anchor : 0
        hits.push({
          chapterId,
          chapterTitle: meta.title,
          volumeTitle: meta.volumeTitle,
          count,
          snippet: makeSnippet(content, Math.max(0, offset), q, snippetLength),
          offset
        })
      }
    }

    hits.sort((a, b) => b.count - a.count)
    const truncated = hits.length > limit
    return {
      query: q,
      hits: hits.slice(0, limit),
      chapterCount: hits.length,
      totalCount,
      durationMs: Date.now() - started,
      truncated
    }
  }

  /** 退化路径：逐章 indexOf（用于单字查询或索引未覆盖的词） */
  private scanSearch(
    q: string,
    limit: number,
    snippetLength: number,
    started: number
  ): SearchResult {
    const hits: SearchHit[] = []
    let totalCount = 0
    for (const [chapterId, content] of this.contentCache) {
      const meta = this.chapterMeta.get(chapterId)
      if (!meta) continue
      let count = 0
      let first = -1
      let from = 0
      for (;;) {
        const idx = content.indexOf(q, from)
        if (idx < 0) break
        if (first < 0) first = idx
        count++
        from = idx + q.length
      }
      if (count > 0) {
        totalCount += count
        hits.push({
          chapterId,
          chapterTitle: meta.title,
          volumeTitle: meta.volumeTitle,
          count,
          snippet: makeSnippet(content, Math.max(0, first), q, snippetLength),
          offset: first
        })
      }
    }
    hits.sort((a, b) => b.count - a.count)
    return {
      query: q,
      hits: hits.slice(0, limit),
      chapterCount: hits.length,
      totalCount,
      durationMs: Date.now() - started,
      truncated: hits.length > limit
    }
  }

  /** 取章节正文（优先缓存） */
  getContent(chapterId: string): string | undefined {
    return this.contentCache.get(chapterId)
  }

  /** 章节元信息列表 */
  listMeta(): ChapterMeta[] {
    return Array.from(this.chapterMeta.values())
  }
}

/** 正文分词：中文 2-gram + 英文词 */
function tokenize(text: string): string[] {
  const out: string[] = []
  const eng = text.match(/[A-Za-z]{2,}/g)
  if (eng) out.push(...eng.map((w) => w.toLowerCase()))
  const runs = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/**
 * 查询分词：与正文一致；单字查询返回空数组（走退化路径）。
 *
 * ⚠️ 必须先按空白切分再分词，否则"屋里 桌上"会被拼成"屋里桌上"，
 * 2-gram 产生跨词边界的伪词组（"里桌"），导致 AND 交集恒为空。
 */
function tokenizeQuery(q: string): string[] {
  const parts = q.trim().split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (const part of parts) {
    // 纯英文按整词
    if (/^[A-Za-z]+$/.test(part)) {
      if (part.length >= 2) out.add(part.toLowerCase())
      continue
    }
    // 中文（或中英混合）按 2-gram；单字查询交由调用方走退化路径
    if (part.length < 2) continue
    for (const term of tokenize(part)) out.add(term)
  }
  return Array.from(out)
}

/** 生成含高亮的上下文片段 */
function makeSnippet(content: string, offset: number, query: string, len: number): string {
  const from = Math.max(0, offset - len)
  const to = Math.min(content.length, offset + query.length + len)
  const raw = content.slice(from, to).replace(/\n+/g, ' ')
  const marked = raw.replace(
    new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    (m) => `<<${m}>>`
  )
  return `${from > 0 ? '…' : ''}${marked}${to < content.length ? '…' : ''}`
}

/** 虚拟滚动：计算可视区应渲染的区间 */
export function visibleRange(params: {
  scrollTop: number
  viewportHeight: number
  itemHeight: number
  total: number
  overscan?: number
}): { start: number; end: number; offsetY: number; totalHeight: number } {
  const { scrollTop, viewportHeight, itemHeight, total } = params
  const overscan = params.overscan ?? 6
  const totalHeight = total * itemHeight
  const rawStart = Math.floor(scrollTop / itemHeight)
  const start = Math.max(0, rawStart - overscan)
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + 1
  const end = Math.min(total, rawStart + visibleCount + overscan)
  return { start, end, offsetY: start * itemHeight, totalHeight }
}

/** 按需加载：章节正文缓存（LRU 风格，限制常驻章数） */
export class ContentCache {
  private map = new Map<string, string>()

  constructor(private maxEntries = 8) {}

  get(id: string): string | undefined {
    const v = this.map.get(id)
    if (v === undefined) return undefined
    // 命中后移到队尾（最近使用）
    this.map.delete(id)
    this.map.set(id, v)
    return v
  }

  set(id: string, content: string): void {
    if (this.map.has(id)) this.map.delete(id)
    this.map.set(id, content)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  has(id: string): boolean {
    return this.map.has(id)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
