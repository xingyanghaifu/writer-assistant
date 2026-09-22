/**
 * 作品库（参考「作家助手」的书架）。
 *
 * 定位：把"选作品"从草稿页里的小下拉，提升为一个独立的管理界面 ——
 * 卡片式展示每部作品的封面信息（标题/作者/简介/字数/章节数/更新时间），
 * 支持新建、切换、重命名、删除，并提供继续写作的入口。
 *
 * 设计取舍：
 *  - 封面用标题首字 + 稳定的渐变色（由 id 派生），避免引入图片资源；
 *  - 进度条按"目标总字数"估算完成度（目标取自设置 defaultTargetWordCount × 章节数，
 *    没有目标时退化为"已写字数"，不虚构数据）；
 *  - 所有写操作都走既有 work store / IPC，不新增数据通道。
 */
import { useEffect, useMemo, useState } from 'react'
import type { Work } from '@shared/work'
import { useWorkStore } from '../store/work'
import { useUiStore } from '../store/ui'
import { EmptyState, Button } from './ui'
import { CreateWorkDialog } from './CreateWorkDialog'

/** 由作品 id 派生一个稳定的封面渐变色，避免每次渲染变化 */
const COVER_GRADIENTS = [
  'linear-gradient(135deg,#5b7cfa,#8f6bff)',
  'linear-gradient(135deg,#e8734a,#f2b544)',
  'linear-gradient(135deg,#2fa8a0,#63c98c)',
  'linear-gradient(135deg,#c0518f,#f08cae)',
  'linear-gradient(135deg,#4a6fa5,#7ba7d7)',
  'linear-gradient(135deg,#8a6d3b,#c9a86a)'
]

function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length]
}

interface WorkStat {
  chapters: number
  words: number
  updatedAt: number
}

function statOfWork(w: Work): WorkStat {
  let chapters = 0
  let words = 0
  for (const v of w.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      chapters += 1
      words += Number(c.wordCount) || String(c.content ?? '').replace(/\s/g, '').length
    }
  }
  return { chapters, words, updatedAt: w.updatedAt ?? 0 }
}

/** 相对时间，降低认知成本 */
function relTime(ts: number): string {
  if (!ts) return '未知'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = Math.floor(diff / 86_400_000)
  if (d < 30) return `${d} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function LibraryPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }): JSX.Element {
  const works = useWorkStore((s) => s.works)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const showToast = useUiStore((s) => s.showToast)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updated' | 'words' | 'title'>('updated')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    void useWorkStore.getState().loadWorks()
  }, [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = works
      .map((w) => ({ work: w, stat: statOfWork(w) }))
      .filter(({ work }) => {
        if (!q) return true
        return (
          work.title.toLowerCase().includes(q) ||
          (work.author ?? '').toLowerCase().includes(q) ||
          (work.intro ?? '').toLowerCase().includes(q)
        )
      })
    list.sort((a, b) => {
      if (sort === 'words') return b.stat.words - a.stat.words
      if (sort === 'title') return a.work.title.localeCompare(b.work.title, 'zh-CN')
      return b.stat.updatedAt - a.stat.updatedAt
    })
    return list
  }, [works, query, sort])

  const totalWords = useMemo(() => works.reduce((s, w) => s + statOfWork(w).words, 0), [works])

  async function open(id: string): Promise<void> {
    if (id === currentWorkId) {
      if (embedded) useUiStore.getState().setHomeView('write')
      else onClose?.()
      return
    }
    setBusy(true)
    try {
      await useWorkStore.getState().selectWork(id)
      showToast('已切换作品', 'success')
      if (embedded) useUiStore.getState().setHomeView('write')
      else onClose?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '切换失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveRename(id: string): Promise<void> {
    const title = renameValue.trim()
    if (!title) {
      setRenamingId(null)
      return
    }
    try {
      // work.update 返回 Res<Work> 信封，失败要显式处理，不能当成功
      const res = await window.api.work.update(id, { title })
      if (!res.ok) {
        showToast(res.error || '重命名失败', 'error')
        return
      }
      await useWorkStore.getState().refreshWorks()
      showToast('已重命名', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重命名失败', 'error')
    } finally {
      setRenamingId(null)
    }
  }

  async function remove(w: Work): Promise<void> {
    if (!window.confirm(`确定删除《${w.title}》？该操作会连同其全部章节一起删除，且不可恢复。`)) return
    try {
      await useWorkStore.getState().removeWork(w.id)
      showToast(`已删除《${w.title}》`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  const body = (
      <div
        className={embedded
          ? 'flex h-full min-h-0 w-full flex-col overflow-hidden'
          : 'wa-modal mx-auto mt-4 flex h-[min(860px,calc(100vh-2rem))] w-[min(1000px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-2xl wa-panel'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <span className="text-sm font-semibold">📚 作品库</span>
          <span className="text-[11px] wa-muted">
            {works.length} 部作品 · 共 {totalWords.toLocaleString()} 字
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900"
          >
            {creating ? '取消' : '+ 新建作品'}
          </button>
{!embedded && (
            <button onClick={() => onClose?.()} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
              ✕
            </button>
          )}
        </header>

        {/* 新建表单 */}
        {creating && (
          <CreateWorkDialog
            onClose={() => {
              setCreating(false)
            }}
            onCreated={() => {
              setCreating(false)
              if (embedded) useUiStore.getState().setHomeView('write')
            }}
          />
        )}
        {/* 重复作品检测（导入/同步可能产生同名作品，合并即可） */}
        {(() => {
          const groups = new Map<string, typeof works>()
          for (const w of works) {
            const k = (w.title || '').trim()
            if (!groups.has(k)) groups.set(k, [])
            groups.get(k)!.push(w)
          }
          const dupes = Array.from(groups.entries()).filter(([, list]) => list.length >= 2)
          if (dupes.length === 0) return null
          return (
            <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1 flex items-center gap-1.5">
                <span>⚠️ 检测到 <strong>{dupes.reduce((s, [, l]) => s + l.length, 0)}</strong> 部同名作品，合并后可避免一致性检查等工具看到重复条目。</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dupes.map(([title, list]) => (
                  <button
                    key={title}
                    disabled={busy}
                    onClick={async () => {
                      // 取最早创建的那个当目标，其它按创建时间升序逐个合并进去
                      const sorted = list.slice().sort((a, b) => a.createdAt - b.createdAt)
                      const dst = sorted[0]
                      for (let i = 1; i < sorted.length; i++) {
                        if (!window.confirm(`把《${sorted[i].title}》（${statOfWork(sorted[i]).chapters} 章）合并进《${dst.title}》（${statOfWork(dst).chapters} 章）？源作品会被删除。`)) continue
                        setBusy(true)
                        try {
                          const r = await window.api.work.merge(sorted[i].id, dst.id)
                          if (r.ok) showToast(`已合并，迁入 ${r.data.mergedChapters} 章`, 'success')
                          else showToast(`合并失败：${r.error}`, 'error')
                        } finally { setBusy(false) }
                      }
                      await useWorkStore.getState().loadWorks()
                    }}
                    className="rounded border border-amber-400 bg-white px-2 py-0.5 wa-interactive"
                  >
                    合并《{title}》（{list.length} 部）
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* 工具条 */}
        <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名 / 作者 / 简介"
            className="min-w-0 flex-1 rounded border px-2 py-0.5 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded border px-1 py-0.5 text-[11px]"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            <option value="updated">最近更新</option>
            <option value="words">字数最多</option>
            <option value="title">按书名</option>
          </select>
        </div>

        {/* 书架 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {rows.length === 0 ? (
            works.length === 0 ? (
              <EmptyState
                icon="📖"
                title="还没有作品"
                description="点上方「+ 新建作品」开始你的长篇创作"
                action={{ label: '+ 新建作品', onClick: () => setCreating(true) }}
              />
            ) : (
              <EmptyState icon="🔍" title="没有匹配的作品" description="试试调整搜索关键词或筛选条件" />
            )
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {rows.map(({ work, stat }, idx) => {
                const isCurrent = work.id === currentWorkId
                return (
                  <div
                    key={work.id}
                    className={`group wa-card-enter flex gap-2.5 rounded-lg border p-2.5 transition-colors ${
                      isCurrent ? 'border-ink-800 bg-black/[0.04]' : 'hover:bg-black/[0.03]'
                    }`}
                    style={{ borderColor: isCurrent ? undefined : 'var(--wa-border)', '--wa-enter-delay': Math.min(idx, 8) * 30 + 'ms' } as React.CSSProperties}
                  >
                    {/* 封面 */}
                    <div
                      className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded text-lg font-semibold text-white shadow-sm"
                      style={{ background: work.coverUrl ? undefined : gradientFor(work.id) }}
                    >
                      {work.coverUrl ? (
                        <img src={work.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (work.title || '无').slice(0, 1)
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      {renamingId === work.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void saveRename(work.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename(work.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          className="min-w-0 rounded border px-1 text-xs outline-none"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs font-semibold">{work.title || '未命名作品'}</span>
                          {isCurrent && (
                            <span className="shrink-0 rounded bg-ink-800 px-1 text-[9px] text-white">当前</span>
                          )}
                        </div>
                      )}

                      <span className="mt-0.5 truncate text-[10px] wa-muted">
                        {work.author ? `作者：${work.author}` : '未填作者'} · {relTime(stat.updatedAt)}
                      </span>

                      <span className="mt-0.5 text-[10px] wa-muted">
                        {stat.chapters} 章 · {stat.words.toLocaleString()} 字
                      </span>

                      {work.intro && (
                        <span className="mt-0.5 line-clamp-2 text-[10px] wa-muted">{work.intro}</span>
                      )}

                      <div className="mt-auto flex items-center gap-1 pt-1.5">
                        <button
                          onClick={() => void open(work.id)}
                          className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-white hover:bg-ink-900"
                        >
                          {isCurrent ? '继续写作' : '打开'}
                        </button>
                        <button
                          onClick={() => {
                            setRenamingId(work.id)
                            setRenameValue(work.title)
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-black/5 wa-interactive"
                        >
                          重命名
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={() => void remove(work)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t px-3 py-1.5 text-[10px] wa-muted" style={{ borderColor: 'var(--wa-border)' }}>
          提示：打开作品会进入写作台；切换作品会自动保存当前章节。删除不可恢复，建议先备份。
        </footer>
      </div>
    )

    if (embedded) {
      return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden wa-panel">
          {body}
        </div>
      )
    }

    return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/35 wa-modal-backdrop" onClick={() => onClose?.()}>
      {body}
    </div>
    )
}
