import { useMemo } from 'react'
import { useRewriteHistoryStore, type RewriteEntry } from '../store/rewrite'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'
import { diffChars, summarizeDiff } from '../services/diff'

/**
 * 右侧「改写记录」面板（与 AI 网页共享侧栏空间）。
 *
 * 核心交互：
 *  - 默认按章节分组、按时间倒序；
 *  - 单条展开后展示「原文 / 结果」对比视图（diff 高亮）；
 *  - 「应用到正文」：替换选区（需先在编辑器选中原文位置——见 transferBack 逻辑）；
 *  - 「复制结果」：一键复制到剪贴板（不污染选区）。
 *
 * 历史数据来源：`useRewriteHistoryStore`，localStorage 持久化。
 */
export function RewriteHistoryPanel(): JSX.Element {
  const entries = useRewriteHistoryStore((s) => s.entries)
  const expanded = useRewriteHistoryStore((s) => s.expanded)
  const toggle = useRewriteHistoryStore((s) => s.toggleExpanded)
  const remove = useRewriteHistoryStore((s) => s.remove)
  const clear = useRewriteHistoryStore((s) => s.clear)
  const markApplied = useRewriteHistoryStore((s) => s.markApplied)
  const showToast = useUiStore((s) => s.showToast)
  const works = useWorkStore((s) => s.works)

  // 按章节分组（无章节归到"未关联"组）
  const groups = useMemo(() => {
    const m = new Map<string, RewriteEntry[]>()
    for (const e of entries) {
      const k = e.chapterId ?? '__none__'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return Array.from(m.entries())
  }, [entries])

  function chapterLabel(chapterId: string | null): string {
    if (!chapterId) return '未关联章节'
    for (const w of works) {
      for (const v of w.volumes) {
        const ch = v.chapters.find((c) => c.id === chapterId)
        if (ch) return `${w.title} · ${ch.title}`
      }
    }
    return chapterId
  }

  function copy(text: string): void {
    void navigator.clipboard.writeText(text).then(
      () => showToast('已复制', 'success'),
      () => showToast('复制失败', 'error')
    )
  }

  function applyToEditor(entry: RewriteEntry): void {
    // 把 output 推到系统剪贴板；用户在编辑区选回原文 + Ctrl+V 即可完成替换。
    // 不强行改写正文：避免越权（用户可能正在浏览其它章节）。
    void navigator.clipboard.writeText(entry.output)
    showToast('结果已复制到剪贴板。可选中原文后 Ctrl+V 替换', 'info')
    markApplied(entry.id, 'replace')
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: 'var(--wa-border)' }}
      >
        <span className="text-[11px] font-medium wa-muted">改写记录 · {entries.length}</span>
        <div className="flex-1" />
        {entries.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm('清空所有改写记录？此操作不可撤销。')) clear()
            }}
            className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
            title="清空记录"
          >
            清空
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-[11px] wa-muted">
            <span className="text-2xl">✨</span>
            <span className="mt-1">还没有改写记录</span>
            <span className="mt-0.5 text-[10px] opacity-70">
              选中文本后点气泡菜单的润色/扩写/缩写/改写，结果会自动出现在这里。
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map(([chapterId, list]) => (
              <section key={chapterId}>
                <h4 className="mb-1 truncate text-[10px] font-medium wa-muted">{chapterLabel(chapterId === '__none__' ? null : chapterId)}</h4>
                <ul className="space-y-1.5">
                  {list.map((e) => (
                    <HistoryRow
                      key={e.id}
                      entry={e}
                      open={!!expanded[e.id]}
                      onToggle={() => toggle(e.id)}
                      onRemove={() => remove(e.id)}
                      onApply={() => applyToEditor(e)}
                      onCopy={() => copy(e.output)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const KIND_LABEL: Record<RewriteEntry['kind'], { label: string; icon: string }> = {
  polish: { label: '润色', icon: '✨' },
  expand: { label: '扩写', icon: '➕' },
  condense: { label: '缩写', icon: '➖' },
  rewrite: { label: '改写', icon: '🔄' },
  ask: { label: '问 AI', icon: '💬' }
}

function HistoryRow({
  entry,
  open,
  onToggle,
  onRemove,
  onApply,
  onCopy
}: {
  entry: RewriteEntry
  open: boolean
  onToggle: () => void
  onRemove: () => void
  onApply: () => void
  onCopy: () => void
}): JSX.Element {
  const meta = KIND_LABEL[entry.kind]
  const summary = useMemo(() => summarizeDiff(diffChars(entry.source, entry.output)), [entry.source, entry.output])
  const dt = new Date(entry.createdAt)
  const time = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`

  return (
    <li className="rounded border bg-white" style={{ borderColor: 'var(--wa-border)' }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-black/5 wa-interactive"
      >
        <span>{meta.icon}</span>
        <span className="font-medium">{meta.label}</span>
        <span className="ml-1 truncate text-[10px] wa-muted" title={entry.source}>
          {entry.source.slice(0, 28) || '(空)'}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] wa-muted">{time}</span>
        {entry.applied && (
          <span className="rounded bg-emerald-100 px-1 text-[9px] text-emerald-700">已应用</span>
        )}
        <span className="text-[10px] wa-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--wa-border)' }}>
          {entry.question && (
            <div className="mb-1 rounded bg-blue-50 px-1.5 py-1 text-[10px] text-blue-900">
              <span className="font-medium">问题：</span>
              {entry.question}
            </div>
          )}

          {/* diff 对比 */}
          <div className="mb-1 max-h-72 overflow-y-auto rounded border bg-white p-1.5 leading-relaxed" style={{ borderColor: 'var(--wa-border)' }}>
            <DiffView source={entry.source} output={entry.output} />
          </div>

          {/* 摘要 */}
          <div className="mb-1.5 flex items-center gap-2 text-[10px] wa-muted">
            <span className="rounded bg-emerald-100 px-1 text-emerald-700">+{summary.added}</span>
            <span className="rounded bg-rose-100 px-1 text-rose-700">-{summary.deleted}</span>
            <span>改动 {Math.round(summary.changeRatio * 100)}%</span>
            <div className="flex-1" />
            <details className="cursor-pointer">
              <summary className="text-[10px]">提示词</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1 text-[10px]">{entry.promptPreview}</pre>
            </details>
          </div>

          <div className="flex gap-1">
            <button onClick={onApply} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }}>
              复制并替换
            </button>
            <button onClick={onCopy} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }}>
              仅复制结果
            </button>
            <div className="flex-1" />
            <button onClick={onRemove} className="rounded px-1.5 py-0.5 text-[10px] text-rose-700 hover:bg-rose-50 wa-interactive">
              删除
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** diff 渲染：把原文的删除字符划线淡红，结果的添加字符浅绿底 */
export function DiffView({ source, output }: { source: string; output: string }): JSX.Element {
  const segs = useMemo(() => diffChars(source, output), [source, output])
  return (
    <span>
      {segs.map((s, i) => {
        if (s.kind === 'same') {
          return <span key={i}>{s.text}</span>
        }
        if (s.kind === 'add') {
          return (
            <span key={i} className="rounded-sm bg-emerald-100/70 px-0.5 text-emerald-900">
              {s.text}
            </span>
          )
        }
        return (
          <span key={i} className="bg-rose-100/60 text-rose-700 line-through">
            {s.text}
          </span>
        )
      })}
    </span>
  )
}