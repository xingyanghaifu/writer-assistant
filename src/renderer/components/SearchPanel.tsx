import { useEffect, useMemo, useRef, useState } from 'react'
import { TextIndex, visibleRange, type SearchResult, type ChapterMeta } from '../services/perf'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'

const ITEM_HEIGHT = 62

/**
 * 全文检索面板（阶段 12）。
 *
 * 百万字优化：
 *  - 倒排索引（2-gram）常驻内存，避免每次逐章扫描
 *  - 虚拟滚动，只渲染可视区结果
 *  - 点击结果跳转到对应章节并定位
 */
export function SearchPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const selectWork = useWorkStore((s) => s.selectWork)
  const showToast = useUiStore((s) => s.showToast)

  const indexRef = useRef<TextIndex>(new TextIndex())
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [building, setBuilding] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const [indexStats, setIndexStats] = useState({ chapters: 0, terms: 0, words: 0, ms: 0 })

  // 构建索引（按作品）
  useEffect(() => {
    if (!currentWorkId) return
    let cancelled = false
    setBuilding(true)
    setReady(false)

    void (async () => {
      try {
        const work = await window.api.work.get(currentWorkId)
        if (!work || cancelled) return

        const chapters: Array<{ id: string; title: string; content: string }> = []
        const metas: ChapterMeta[] = []
        for (const v of work.volumes) {
          for (const c of v.chapters) {
            chapters.push({ id: c.id, title: c.title, content: c.content })
            metas.push({
              id: c.id,
              title: c.title,
              wordCount: c.wordCount,
              volumeId: v.id,
              volumeTitle: v.title,
              updatedAt: c.updatedAt,
              hasSummary: !!c.summary,
              targetWordCount: c.targetWordCount
            })
          }
        }

        const idx = indexRef.current
        idx.build(chapters, metas)
        if (cancelled) return
        setIndexStats({
          chapters: idx.chapterCount,
          terms: idx.termCount,
          words: idx.totalIndexedWords,
          ms: idx.builtAtMs
        })
        setReady(true)
      } catch (err) {
        if (!cancelled) showToast(err instanceof Error ? err.message : '索引构建失败', 'error')
      } finally {
        if (!cancelled) setBuilding(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentWorkId, showToast])

  // 测量可视高度
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  // 防抖检索
  useEffect(() => {
    if (!ready || !query.trim()) {
      setResult(null)
      return
    }
    const t = setTimeout(() => {
      setResult(indexRef.current.search(query))
    }, 180)
    return () => clearTimeout(t)
  }, [query, ready])

  const hits = result?.hits ?? []
  const range = useMemo(
    () =>
      visibleRange({
        scrollTop,
        viewportHeight: viewportH,
        itemHeight: ITEM_HEIGHT,
        total: hits.length
      }),
    [scrollTop, viewportH, hits.length]
  )

  const visible = hits.slice(range.start, range.end)

  async function jump(hit: { chapterId: string; offset: number }): Promise<void> {
    if (!currentWorkId) return
    const workStore = useWorkStore.getState()
    // 索引就是当前作品构建的，无需重复 selectWork（否则会先跳到首章再跳回）
    if (workStore.currentWorkId !== currentWorkId) {
      await selectWork(currentWorkId)
    }
    await useWorkStore.getState().selectChapter(hit.chapterId)
    // 正文在草稿编辑器里，稍后定位到命中位置
    setTimeout(() => {
      const ta = document.querySelector('textarea')
      if (ta) {
        ta.focus()
        ta.setSelectionRange(hit.offset, hit.offset)
        ta.scrollTop = (hit.offset / Math.max(1, ta.value.length)) * ta.scrollHeight
      }
    }, 220)
    onClose()
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 p-10">
      <div className="wa-modal flex max-h-[85vh] w-[min(48rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="全文检索（支持多词，空格分隔）"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="border-b px-3 py-1 text-[11px] wa-muted">
          {building ? (
            '正在构建索引…'
          ) : ready ? (
            <>
              已索引 {indexStats.chapters} 章 / {indexStats.words.toLocaleString()} 字 /{' '}
              {indexStats.terms.toLocaleString()} 词条（{indexStats.ms}ms）
              {result && (
                <>
                  {' · '}命中 {result.chapterCount} 章 / {result.totalCount} 处（{result.durationMs}ms）
                  {result.truncated && ' · 结果已截断'}
                </>
              )}
            </>
          ) : (
            '请先选择作品'
          )}
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {!query.trim() ? (
            <div className="p-6 text-center text-xs wa-muted">
              输入关键词开始检索。中文按 2 字词组索引，多词为「同时包含」。
            </div>
          ) : hits.length === 0 ? (
            <div className="p-6 text-center text-xs wa-muted">未找到匹配内容</div>
          ) : (
            /* 虚拟滚动：外层撑高，内层只渲染可视条目 */
            <div style={{ height: range.totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${range.offsetY}px)` }}>
                {visible.map((h) => (
                  <div
                    key={h.chapterId}
                    style={{ height: ITEM_HEIGHT }}
                    className="cursor-pointer border-b px-3 py-1.5 text-xs $& wa-interactive"
                    onClick={() => void jump(h)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium">
                        {h.volumeTitle && <span className="wa-muted">{h.volumeTitle} · </span>}
                        {h.chapterTitle}
                      </span>
                      <span className="shrink-0 wa-muted">{h.count} 处</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 leading-snug wa-muted">
                      {renderSnippet(h.snippet)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 渲染含 <<>> 高亮标记的片段 */
function renderSnippet(snippet: string): JSX.Element {
  const parts = snippet.split(/(<<[^>]*>>)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('<<') && p.endsWith('>>') ? (
          <mark key={i} className="bg-yellow-200 text-inherit">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}
