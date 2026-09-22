/**
 * 拆书 AI 流水线（v3 模块三 — 阶段 7，渲染层驱动版）。
 *
 * 为什么放在渲染层：
 *  - 注入脚本由 renderer/adapters 编译，主进程不知道站点细节
 *  - 现有 BackgroundWebview 调用通过 `window.api.bg.start` IPC 入口
 *  - 让 AI 调用沿用同一份站点状态 / 风控 / 缓存路径
 *
 * 流水线：
 *  - 串行：从 fromChapter 起逐章
 *  - 块间隔 ≥ 600ms（合规）
 *  - 复用 hashKey + 缓存（沿用现有 LRU 24h）
 *  - 站点未登录 / 风控 / 离线 → 跳过该章并标记 failed，继续下一章
 *  - 失败不中断，按 project.status === 'paused' 检查暂停
 */
import { getAdapter } from '../adapters/registry'
import { toScripts } from '../adapters/scripts'
import type {
  BookBreakdownProject,
  BookBreakdownChapter,
  StyleReport,
  ChapterRhythm,
  BreakdownOutlineNode,
  ChapterBeatSheet,
  OutlineImitationResult,
  OutlineImitationRound
} from '@shared/bookBreakdown'
import { getCacheAsync, setCache } from '../services/cacheBridge'
import { useSiteStore } from '../store/site'
import { useUiStore } from '../store/ui'

const BLOCK_INTERVAL_MS = 600

/** 简单 hash：用于客户端缓存 key。主进程 hashKey 是私有的，这里复制语义 */
function hashKey(parts: Array<string | number | undefined>): string {
  return parts.map((p) => String(p ?? '')).join('|')
}

const SUMMARY_PROMPT = `你是长篇小说研究助手。请阅读以下章节，给出：

1. summary：≤300 字摘要，保留核心情节与冲突
2. keyEvents：≤5 条关键事件（数组）
3. characters：本章出现的角色名（数组，不含未出场）
4. turningPoint：本章转折点（如无则留空字符串）
5. endingHook：本章结尾钩子（如无则留空字符串）

严格按如下 JSON 格式输出（不要解释、不要 markdown）：
{"summary":"...","keyEvents":["..."],"characters":["..."],"turningPoint":"...","endingHook":"..."}

章节内容：
{content}`

interface ChapterSummary {
  summary: string
  keyEvents: string[]
  characters: string[]
  turningPoint?: string
  endingHook?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function safeParse(raw: string): ChapterSummary | null {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    return JSON.parse(raw.slice(start, end + 1)) as ChapterSummary
  } catch {
    return null
  }
}

async function callAi(prompt: string, siteId: string, retries = 2): Promise<string | null> {
  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await window.api.bg.start({
        task: 'ask',
        prompt,
        siteId,
        skipCache: false,
        scripts: scripts as never
      })
      if (r.ok && r.data.text && r.data.text.trim()) return r.data.text
    } catch {
      /* 继续重试 */
    }
    if (attempt < retries) await sleep(1200 * (attempt + 1))
  }
  return null
}

/**
 * 单章 AI 摘要：返回 ChapterSummary 或 null（失败）。
 * 副作用：写缓存、写状态、推 progress。
 */
export async function summarizeChapter(
  project: BookBreakdownProject,
  chapter: BookBreakdownChapter
): Promise<{ ok: boolean; reason?: string; data?: ChapterSummary; fromCache?: boolean }> {
  // 缓存
  const key = hashKey([chapter.content, project.chunkSize ?? 3000, 'breakdown-summarize'])
  const cached = await getCacheAsync(key, 'breakdown')
  if (cached) {
    const parsed = safeParse(cached)
    if (parsed) return { ok: true, data: parsed, fromCache: true }
  }

  // 站点前置拦截
  const status = useSiteStore.getState().sites[project.id] ?? useSiteStore.getState().sites[useUiStore.getState().siteId]
  void status // 主站点的状态由 useUiStore.siteId 决定
  const siteId = useUiStore.getState().siteId
  const siteState = useSiteStore.getState().sites[siteId]
  if (siteState?.status.kind === 'logged-out') return { ok: false, reason: '站点未登录' }
  if (siteState?.status.kind === 'risk') return { ok: false, reason: '站点风控' }

  // 截取正文
  const maxLen = project.chunkSize ?? 3000
  const content = chapter.content.length > maxLen ? chapter.content.slice(0, maxLen) : chapter.content
  const finalPrompt = SUMMARY_PROMPT.replace('{content}', content)

  const raw = await callAi(finalPrompt, siteId)
  if (!raw) return { ok: false, reason: 'AI 返回空' }
  const parsed = safeParse(raw)
  if (!parsed) return { ok: false, reason: 'AI 返回不含合法 JSON' }

  setCache(key, JSON.stringify(parsed), 'breakdown')
  return { ok: true, data: parsed }
}

/**
 * 串行启动流水线：渲染层事件驱动。
 *
 * 进度通过 onProgress 推送给渲染层；本函数只是循环协调器。
 * 返回 stats：{ processed, failed, cached }。
 */
export async function runPipeline(
  project: BookBreakdownProject,
  fromChapter = 0,
  hooks?: {
    onChapter?: (ch: BookBreakdownChapter, index: number, total: number, ok: boolean, fromCache?: boolean) => void
  }
): Promise<{ processed: number; failed: number; cached: number }> {
  let processed = 0
  let failed = 0
  let cached = 0

  for (let i = fromChapter; i < project.chapters.length; i++) {
    const ch = project.chapters[i]
    const live = await window.api.bookBreakdown.get(project.id)
    if (!live || (live as BookBreakdownProject).status === 'paused') break

    const result = await summarizeChapter(live as BookBreakdownProject, ch)
    if (result.ok) {
      processed++
      if (result.fromCache) cached++
    } else {
      failed++
    }
    hooks?.onChapter?.(ch, i, project.chapters.length, result.ok, result.fromCache)

    if (i < project.chapters.length - 1) await sleep(BLOCK_INTERVAL_MS)
  }

  // P3-6.2：完成后建议上层释放 chapter.content（占位文档，UI 自行 GC）
  return { processed, failed, cached }
}

/* ============================================================
 * v3 P0-3.3 进阶分析：风格 / 节奏 / 大纲 / 仿写提示词
 * ============================================================ */

const STYLE_PROMPT = `你是小说风格分析助手。基于以下章节摘要和抽样正文，给出风格报告。
JSON 格式：
{"sentenceLengthDist":[{"range":"0-20","count":N},{"range":"21-40","count":N},...],"topWords":[{"word":"...","count":N},...],"styleTags":["..."],"pov":"first|third|omniscient|mixed|unknown"}

抽样正文：
{text}`

const RHYTHM_PROMPT = `你是节奏评分助手。给本章打 3 个 1-10 分：
- tension：紧张度（动作/冲突密度）
- emotion：情绪（1=悲，10=欢）
- hook：钩子强度（结尾是否吸引人继续读）
JSON：{"tension":N,"emotion":N,"hook":N}

本章摘要：{summary}`

const OUTLINE_PROMPT = `你是大纲生成助手。基于以下章节列表（标题+摘要），生成层级大纲（章 → 卷 → 书）。
JSON 格式：
{"outline":[{"id":"...","title":"...","summary":"...","children":[{"id":"...","title":"...","summary":"...","children":[]}]}]}

章节列表：
{list}`

const REWRITE_PROMPT = `你是仿写提示词生成助手。基于以下拆书结果（结构、节奏、人物功能），生成一个仿写模板，提示词供作者向 AI 学习此书的"骨架"。

要求：
- 不复制原文；只学结构、节奏、人物功能
- 模板变量：{outline}、{characters}、{tone}、{length}
- 不写带版权风险的具体情节或人物名

JSON 格式：
{"name":"...","category":"灵感","content":"..."}

结构摘要：{outlineSample}
人物功能：{charactersSample}
风格标签：{styleTags}`

/** P0-3.3 ① 风格分析：输入项目，输出 StyleReport */
export async function analyzeStyle(projectId: string): Promise<StyleReport | null> {
  const proj = (await window.api.bookBreakdown.get(projectId)) as BookBreakdownProject | null
  if (!proj) return null

  // 抽样：取已分析章节的 summary + 头 1000 字
  // 脱敏模式：只发 summary，不发 content
  const sample: string[] = []
  for (const ch of proj.chapters) {
    if (ch.summary) sample.push(`[${ch.title}] ${ch.summary}`)
    if (!proj.anonymized && ch.content) sample.push(ch.content.slice(0, 1000))
    if (sample.join('').length > 6000) break
  }
  const text = sample.join('\n').slice(0, 6000)
  if (text.length < 200) return null

  const cacheKey = `bd-style:${projectId}:${text.length}:${text.slice(0, 100).length}`
  const cached = await getCacheAsync(cacheKey, 'breakdown')
  if (cached) {
    try {
      return JSON.parse(cached) as StyleReport
    } catch {
      /* fallthrough */
    }
  }

  const siteId = useUiStore.getState().siteId
  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)
  try {
    const r = await window.api.bg.start({
      task: 'inspiration',
      prompt: STYLE_PROMPT.replace('{text}', text),
      siteId,
      scripts: scripts as never
    })
    if (!r.ok) return null
    const raw = r.data.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(raw.slice(start, end + 1)) as StyleReport
    setCache(cacheKey, JSON.stringify(parsed), 'breakdown')
    // 写回项目（轻量 setChapterStatus 调用方式走 IPC，但 extras 没暴露 IPC；用进度事件占位）
    void pushProgressEvent(projectId, 'style done')
    return parsed
  } catch {
    return null
  }
}

/** P0-3.3 ② 节奏曲线：分析全部已摘要章节的 tension/emotion/hook */
export async function analyzeRhythm(projectId: string): Promise<Array<ChapterRhythm & { chapterId: string; chapterIndex: number }> | null> {
  const proj = (await window.api.bookBreakdown.get(projectId)) as BookBreakdownProject | null
  if (!proj) return null
  const doneChapters = proj.chapters.filter((c) => c.analysisStatus === 'done' && c.summary)
  if (doneChapters.length === 0) return null

  const siteId = useUiStore.getState().siteId
  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)
  const out: Array<ChapterRhythm & { chapterId: string; chapterIndex: number }> = []

  for (let i = 0; i < doneChapters.length; i++) {
    const ch = doneChapters[i]
    if (ch.rhythm) {
      out.push({ chapterId: ch.id, chapterIndex: ch.index, ...ch.rhythm })
      continue
    }
    const cacheKey = `bd-rhythm:${projectId}:${ch.id}`
    const cached = await getCacheAsync(cacheKey, 'breakdown')
    if (cached) {
      try {
        const r = JSON.parse(cached) as ChapterRhythm
        out.push({ chapterId: ch.id, chapterIndex: ch.index, ...r })
        continue
      } catch {
        /* fallthrough */
      }
    }
    try {
      const res = await window.api.bg.start({
        task: 'consistency-check',
        // 脱敏模式：不发 content
        prompt: (proj.anonymized
          ? RHYTHM_PROMPT.replace('{summary}', ch.summary ?? '')
          : `${RHYTHM_PROMPT.replace('{summary}', ch.summary ?? '')}\n\n参考段落：\n${ch.content?.slice(0, 800) ?? ''}`
        ),
        siteId,
        scripts: scripts as never
      })
      if (!res.ok) continue
      const raw = res.data.text
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end < 0) continue
      const parsed = JSON.parse(raw.slice(start, end + 1)) as ChapterRhythm
      out.push({ chapterId: ch.id, chapterIndex: ch.index, ...parsed })
      setCache(cacheKey, JSON.stringify(parsed), 'breakdown')
    } catch {
      /* 跳过 */
    }
    if (i < doneChapters.length - 1) await sleep(BLOCK_INTERVAL_MS)
  }
  return out
}

/** P0-3.3 ③ 大纲生成：从章节列表生成层级大纲 */
export async function generateOutline(projectId: string): Promise<BreakdownOutlineNode[] | null> {
  const proj = (await window.api.bookBreakdown.get(projectId)) as BookBreakdownProject | null
  if (!proj) return null
  const doneChapters = proj.chapters.filter((c) => c.analysisStatus === 'done' && c.summary)
  if (doneChapters.length === 0) return null

  const list = doneChapters
    .slice(0, 200) // 上限保护
    .map((c, i) => `${i + 1}. ${c.title}: ${c.summary ?? ''}`)
    .join('\n')

  const cacheKey = `bd-outline:${projectId}:${doneChapters.length}`
  const cached = await getCacheAsync(cacheKey, 'breakdown')
  if (cached) {
    try {
      return JSON.parse(cached) as BreakdownOutlineNode[]
    } catch {
      /* fallthrough */
    }
  }

  const siteId = useUiStore.getState().siteId
  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)
  try {
    const res = await window.api.bg.start({
      task: 'outline-gen',
      prompt: OUTLINE_PROMPT.replace('{list}', list),
      siteId,
      scripts: scripts as never
    })
    if (!res.ok) return null
    const raw = res.data.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { outline: BreakdownOutlineNode[] }
    setCache(cacheKey, JSON.stringify(parsed.outline), 'breakdown')
    return parsed.outline
  } catch {
    return null
  }
}

/** P0-3.3 ④ 仿写提示词生成：写一条模板到提示词库 */
export async function generateRewritePrompt(projectId: string): Promise<{ id: string; content: string } | null> {
  const proj = (await window.api.bookBreakdown.get(projectId)) as BookBreakdownProject | null
  if (!proj) return null

  const outlineSample = proj.extras?.outline?.slice(0, 3).map((o) => o.title).join(' / ') ?? proj.title
  const charactersSample = (proj.extras?.style?.topWords ?? []).slice(0, 5).map((w) => w.word).join(', ')
  const styleTags = (proj.extras?.style?.styleTags ?? []).join(', ') || '（未分析）'

  const cacheKey = `bd-rewrite:${projectId}`
  const cached = await getCacheAsync(cacheKey, 'breakdown')
  if (cached) {
    try {
      return JSON.parse(cached) as { id: string; content: string }
    } catch {
      /* fallthrough */
    }
  }

  const siteId = useUiStore.getState().siteId
  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)
  try {
    const res = await window.api.bg.start({
      task: 'inspiration',
      prompt: REWRITE_PROMPT.replace('{outlineSample}', outlineSample)
        .replace('{charactersSample}', charactersSample)
        .replace('{styleTags}', styleTags),
      siteId,
      scripts: scripts as never
    })
    if (!res.ok) return null
    const raw = res.data.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { name: string; content: string }
    const id = `bd_rw_${Date.now().toString(36)}`
    setCache(cacheKey, JSON.stringify({ id, ...parsed }), 'breakdown')
    return { id, ...parsed }
  } catch {
    return null
  }
}

function pushProgressEvent(projectId: string, message: string): void {
  // 渲染层进度事件：通过现有 breakdown.onProgress 通路
  // 这里只是占位；上层 UI 通常用回调
  void projectId
  void message
}

const BEAT_PROMPT = `你是拆书助手。只根据本章原文抽出可执行细纲，禁止扩写、禁止评价。
JSON：
{"title":"...","pov":"first|third|unknown","tone":"...","beats":[{"order":1,"scene":"地点/人物在场","conflict":"要解决的具体问题","turn":"本节拍结束时局面如何变化","hook":"下一拍必须接住的具体动作或信息","constraint":"能力/时间/伤势等限制，可空"}]}
要求：3-8 个节拍；scene/conflict/turn/hook 都要具体，不要空话。
章节：
{content}`

const IMITATE_PROMPT = `你是小说仿写助手。只根据细纲写成正文，不要解释。
硬性：
- 用细纲的场景、冲突、转折、钩子依次推进
- 不发明细纲没有的人物、能力、地点
- 每拍只完成一个推进
- 文风贴近：{styleHint}

细纲 JSON：
{beats}

提示词（学习骨架，不要复述这段话）：
{prompt}

直接输出正文。`

const JUDGE_PROMPT = `比较「细纲仿写稿」和「原文」的结构接近度，不要因为文采打分。
JSON：{"score":0-100,"gaps":["具体缺了哪一拍/哪条钩子/哪条约束"],"keep":["已经学到的写法"]}
评分：节拍顺序、冲突、转折、钩子、限制是否都被写到。不要因为用词不同扣分。

细纲：
{beats}

仿写稿：
{draft}

原文（仅结构对照，不要抄）：
{original}`

const cancelledKeys = new Set<string>()

export function markImitationCancelled(projectId: string, chapterId: string): void {
  cancelledKeys.add(projectId + ':' + chapterId)
}
export function clearImitationCancelled(projectId: string, chapterId: string): void {
  cancelledKeys.delete(projectId + ':' + chapterId)
}
function imitationCancelled(projectId: string, chapterId: string): boolean {
  return cancelledKeys.has(projectId + ':' + chapterId)
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) as T } catch { return null }
}

function localStructureScore(original: string, draft: string): number {
  const a = original.replace(/\s/g, '')
  const b = draft.replace(/\s/g, '')
  if (!b) return 0
  const lenScore = Math.max(0, 40 - Math.abs(a.length - b.length) / Math.max(a.length, 1) * 40)
  return Math.round(Math.min(40, lenScore))
}

/**
 * 把长章节按段落边界切成若干块。
 * 不硬切字符，尽量落在换行处，避免把一句话劈开。
 */
export function splitForBeats(content: string, chunkSize = 3000): string[] {
  const text = content.trim()
  if (text.length <= chunkSize) return [text]
  const chunks: string[] = []
  let cursor = 0
  while (cursor < text.length && chunks.length < 6) {
    let end = Math.min(text.length, cursor + chunkSize)
    if (end < text.length) {
      const window = text.slice(cursor, end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'))
      if (cut > chunkSize * 0.5) end = cursor + cut + 1
    }
    chunks.push(text.slice(cursor, end).trim())
    cursor = end
  }
  return chunks.filter(Boolean)
}

/**
 * 抽细纲：长章节分块抽取后再合并节拍，避免只学到前半段。
 * 分块数 > 1 时按块顺序重编号 order。
 */
export async function extractBeatSheet(
  chapter: { id: string; title: string; content: string },
  chunkSize = 3000
): Promise<ChapterBeatSheet | null> {
  const siteId = useUiStore.getState().siteId
  const chunks = splitForBeats(chapter.content, chunkSize)
  if (chunks.length === 0) return null

  const collected: ChapterBeatSheet[] = []
  for (let i = 0; i < chunks.length; i++) {
    const raw = await callAi(BEAT_PROMPT.replace('{content}', chunks[i]), siteId)
    const parsed = parseJson<ChapterBeatSheet>(raw)
    if (parsed && Array.isArray(parsed.beats) && parsed.beats.length > 0) collected.push(parsed)
    if (i < chunks.length - 1) await sleep(BLOCK_INTERVAL_MS)
  }
  if (collected.length === 0) return null

  const first = collected[0]
  const beats = collected
    .flatMap((c) => c.beats)
    .map((b, idx) => ({ ...b, order: idx + 1 }))
    .slice(0, 12)

  return {
    chapterId: chapter.id,
    title: first.title || chapter.title,
    pov: first.pov,
    tone: first.tone,
    beats
  }
}

export async function runOutlineImitationLoop(input: {
  projectId: string
  chapterId: string
  promptId?: string
  maxRounds?: number
  targetScore?: number
  /** 每轮对照的章节数（1-3），默认 1；>1 时取多章平均分 */
  evalChapters?: number
  onRound?: (r: OutlineImitationRound) => void
}): Promise<OutlineImitationResult> {
  const maxRounds = Math.min(6, Math.max(1, input.maxRounds ?? 4))
  const targetScore = input.targetScore ?? 78
  const proj = (await window.api.bookBreakdown.get(input.projectId)) as BookBreakdownProject | null
  if (!proj) {
    return { projectId: input.projectId, chapterId: input.chapterId, targetScore, bestScore: 0, rounds: [], stoppedReason: 'ai-failed' }
  }
  const ch = proj.chapters.find((c) => c.id === input.chapterId) ?? proj.chapters[0]
  if (!ch) {
    return { projectId: input.projectId, chapterId: input.chapterId, targetScore, bestScore: 0, rounds: [], stoppedReason: 'ai-failed' }
  }

  const siteId = useUiStore.getState().siteId
  input.onRound?.({
    round: 0,
    score: 0,
    promptId: input.promptId || '',
    promptVersion: 0,
    changelog: [],
    gaps: ['正在从原文抽细纲'],
    at: Date.now()
  })
  clearImitationCancelled(proj.id, ch.id)
  const beatSheet = await extractBeatSheet(ch, proj.chunkSize ?? 3000)
  if (!beatSheet) {
    return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: 0, rounds: [], stoppedReason: 'ai-failed' }
  }

  let promptId = input.promptId
  if (!promptId) {
    const created = await generateRewritePrompt(proj.id)
    if (created) {
      const item = {
        id: created.id,
        name: `仿写迭代：${proj.title}`,
        category: '灵感' as const,
        description: '由原文细纲仿写循环自动维护',
        content: created.content,
        variables: ['outline', 'characters', 'tone', 'length'],
        tags: ['拆书生成', '自迭代'],
        favorite: false,
        enabled: true,
        order: 0,
        actionType: 'inspiration' as const,
        siteScope: [] as string[],
        version: 1,
        custom: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        useCount: 0
      }
      const saved = await window.api.promptLibrary.save(item)
      if (saved.ok) promptId = saved.data.id
      else promptId = created.id
    }
  }
  if (!promptId) {
    return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: 0, rounds: [], beatSheet, stoppedReason: 'ai-failed' }
  }

  const rounds: OutlineImitationRound[] = []
  let best = 0
  // 多章对照：主章 + 同项目其它已分析章节，减少单章偶然性
  const evalSet = [ch, ...proj.chapters.filter((c) => c.id !== ch.id && c.content.trim().length > 200)].slice(0, Math.max(1, Math.min(3, input.evalChapters ?? 1)))
  for (let round = 1; round <= maxRounds; round++) {
    if (imitationCancelled(proj.id, ch.id)) {
      return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: best, rounds, beatSheet, stoppedReason: 'cancelled' }
    }
    const live = await window.api.bookBreakdown.get(proj.id)
    if (live && (live as BookBreakdownProject).status === 'paused') {
      return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: best, rounds, beatSheet, stoppedReason: 'cancelled' }
    }
    const lib = await window.api.promptLibrary.list()
    const promptItem = lib.find((x) => x.id === promptId)
    const promptText = promptItem?.content ?? ''
    const perChapter: Array<{ score: number; gaps: string[]; sample: string }> = []
    for (let ei = 0; ei < evalSet.length; ei++) {
      const target = ei === 0 ? { ch, beatSheet } : { ch: evalSet[ei], beatSheet: await extractBeatSheet(evalSet[ei], proj.chunkSize ?? 3000) }
      if (!target.beatSheet) continue
      const imitatePrompt = IMITATE_PROMPT
        .replace('{styleHint}', (proj.extras?.style?.styleTags ?? []).join('、') || '贴近原作节奏')
        .replace('{beats}', JSON.stringify(target.beatSheet, null, 2))
        .replace('{prompt}', promptText.slice(0, 1800))
      const im = await callAi(imitatePrompt, siteId)
      if (!im) continue
      const jr = await callAi(
        JUDGE_PROMPT
          .replace('{beats}', JSON.stringify(target.beatSheet.beats, null, 2))
          .replace('{draft}', im.slice(0, 3500))
          .replace('{original}', target.ch.content.slice(0, 3500)),
        siteId
      )
      const jj = parseJson<{ score: number; gaps: string[]; keep: string[] }>(jr)
      const loc = localStructureScore(target.ch.content, im)
      perChapter.push({
        score: Math.max(0, Math.min(100, Math.round(((jj?.score ?? 50) * 0.75) + loc * 0.25))),
        gaps: jj?.gaps?.slice(0, 6) ?? [],
        sample: im
      })
      if (ei < evalSet.length - 1) await sleep(BLOCK_INTERVAL_MS)
    }
    if (perChapter.length === 0) {
      return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: best, rounds, beatSheet, stoppedReason: 'ai-failed' }
    }
    await window.api.promptLibrary.recordUsage({ promptId, action: 'imitate', value: 'use', siteId })
    const draft = perChapter[0].sample
    const score = Math.round(perChapter.reduce((sum, x) => sum + x.score, 0) / perChapter.length)
    const gapSet: string[] = []
    for (const pc of perChapter) for (const g of pc.gaps) if (!gapSet.includes(g)) gapSet.push(g)
    const gaps = gapSet.slice(0, 6)
    if (score >= 70) await window.api.promptLibrary.recordUsage({ promptId, action: 'imitate', value: 'up', note: gaps.join('；'), siteId })
    else await window.api.promptLibrary.recordUsage({ promptId, action: 'imitate', value: 'down', note: gaps.join('；'), siteId })

    let changelog: string[] = []
    if (score < targetScore) {
      const it = await window.api.promptLibrary.iterate(promptId)
      if (it.ok) {
        promptId = it.data.item.id
        changelog = it.data.changelog
        if (gaps.length) {
          const extra = `\n【对照缺口】${gaps.join('；')}。下一稿必须补上这些节拍，仍不要抄原文。`
          const patched = { ...it.data.item, content: it.data.item.content + extra, updatedAt: Date.now() }
          await window.api.promptLibrary.save(patched)
        }
      }
    }
    const latestLib = await window.api.promptLibrary.list()
    const latestItem = latestLib.find((x) => x.id === promptId)
    const rec: OutlineImitationRound = {
      round,
      score,
      promptId,
      promptVersion: latestItem?.version ?? promptItem?.version ?? round,
      changelog,
      gaps,
      sample: draft.slice(0, 400),
      at: Date.now()
    }
    rounds.push(rec)
    void window.api.promptLibrary.appendHistory({
      promptId,
      promptName: latestItem?.name ?? promptItem?.name ?? '仿写提示词',
      version: rec.promptVersion,
      reason: 'imitate-gap',
      changelog: changelog.length ? changelog : ['本轮未改动提示词'],
      gaps,
      score,
      at: Date.now()
    })
    input.onRound?.(rec)
    best = Math.max(best, score)
    if (score >= targetScore) {
      return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: best, rounds, beatSheet, stoppedReason: 'reached' }
    }
    await sleep(BLOCK_INTERVAL_MS)
  }
  return { projectId: proj.id, chapterId: ch.id, targetScore, bestScore: best, rounds, beatSheet, stoppedReason: 'max-rounds' }
}
