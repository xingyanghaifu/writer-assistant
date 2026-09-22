import { useMemo, useState } from 'react'
import { useWorkStore } from '../store/work'
import { useUiStore } from '../store/ui'
import type { ChapterVersion } from '@shared/work'

const SOURCE_LABEL: Record<string, string> = {
  manual: '手动保存',
  autosave: '自动保存',
  'ai-insert': 'AI 插入',
  import: '导入',
  'chapter-complete': '章节完成',
  recovery: '崩溃恢复'
}

function fmt(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 版本历史面板（阶段 5.7）。
 * 版本列表 + 内容预览 + 并排 diff（增绿删红，显示字数变化）。
 */
export function VersionHistoryPanel(): JSX.Element {
  const versions = useWorkStore((s) => s.versions)
  const draft = useWorkStore((s) => s.draft)
  const showToast = useUiStore((s) => s.showToast)
  const [selected, setSelected] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)

  const selectedVersion = versions.find((v) => v.id === selected) ?? versions[0]

  async function onRestore(v: ChapterVersion): Promise<void> {
    if (!window.confirm(`回滚到 ${fmt(v.createdAt)} 的版本（${v.wordCount} 字）？\n当前内容会先存为一个版本，可撤销。`)) return
    await useWorkStore.getState().restoreVersion(v.id)
    showToast('已回滚到所选版本', 'success')
  }

  async function onDelete(v: ChapterVersion): Promise<void> {
    if (!window.confirm('确定删除该版本？')) return
    await useWorkStore.getState().removeVersion(v.id)
    showToast('版本已删除')
  }

  async function onExport(v: ChapterVersion): Promise<void> {
    const s = useWorkStore.getState()
    if (!s.currentWorkId || !s.currentChapterId) return
    const r = await window.api.version.exportTxt(s.currentWorkId, s.currentChapterId, v.id)
    if (!r.ok) {
      showToast('导出失败', 'error')
      return
    }
    // 导出到剪贴板（避免额外文件选择流程）
    try {
      await navigator.clipboard.writeText(r.data)
      showToast('版本内容已复制到剪贴板', 'success')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-30 flex flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs font-semibold">历史版本（{versions.length}）</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCompare((c) => !c)}
            className={`rounded px-1.5 py-0.5 text-xs ${compare ? 'bg-black/10' : 'hover:bg-black/5'}`}
            title="与当前内容并排对比"
          >
            {compare ? '隐藏对比' : '并排对比'}
          </button>
          <button
            onClick={() => useWorkStore.getState().closeHistory()}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5 wa-interactive"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 版本列表 */}
        <div className="w-32 shrink-0 overflow-y-auto border-r">
          {versions.length === 0 && <div className="p-2 text-xs wa-muted">暂无版本</div>}
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelected(v.id)}
              className={`block w-full border-b px-1.5 py-1 text-left text-[11px] hover:bg-black/5 ${
                selectedVersion?.id === v.id ? 'bg-black/10' : ''
              }`}
            >
              <div className="flex items-center gap-1">
                {v.important && <span title="已标记重要">⭐</span>}
                <span className="truncate">{fmt(v.createdAt)}</span>
              </div>
              <div className="wa-muted">
                {SOURCE_LABEL[v.source] ?? v.source} · {v.wordCount}字
              </div>
            </button>
          ))}
        </div>

        {/* 预览 / 对比 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedVersion ? (
            <>
              {compare ? (
                <DiffView oldText={selectedVersion.content} newText={draft} />
              ) : (
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-xs leading-relaxed">
                  {selectedVersion.content || '（空）'}
                </pre>
              )}
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1.5">
                <button
                  onClick={() => void onRestore(selectedVersion)}
                  className="rounded bg-ink-800 px-2 py-0.5 text-xs text-white hover:bg-ink-900"
                >
                  回滚到此版本
                </button>
                <button
                  onClick={() =>
                    void useWorkStore
                      .getState()
                      .markVersion(selectedVersion.id, !selectedVersion.important)
                  }
                  className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
                >
                  {selectedVersion.important ? '取消重要' : '标记重要'}
                </button>
                <button
                  onClick={() => void onExport(selectedVersion)}
                  className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
                >
                  导出 TXT
                </button>
                <button
                  onClick={() => void onDelete(selectedVersion)}
                  className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs wa-muted">选择左侧版本查看</div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 并排 diff：左=旧版本，右=当前内容。逐行增绿删红。 */
function DiffView({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const { rows, added, removed } = useMemo(() => buildDiff(oldText, newText), [oldText, newText])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b bg-black/[0.03] px-2 py-1 text-[11px]">
        字数变化：{oldText.replace(/\s/g, '').length} → {newText.replace(/\s/g, '').length}
        <span className="ml-2 text-emerald-600">+{added}</span>
        <span className="ml-1 text-red-600">-{removed}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
        <div className="overflow-auto border-r">
          <div className="sticky top-0 bg-black/[0.05] px-2 py-0.5 text-[11px] wa-muted">旧版本</div>
          {rows.map((r, i) => (
            <div
              key={`o${i}`}
              className={`whitespace-pre-wrap px-2 text-xs ${
                r.kind === 'del' ? 'bg-red-100 text-red-900' : r.kind === 'add' ? 'opacity-0' : ''
              }`}
            >
              {r.kind === 'add' ? '' : r.old || ' '}
            </div>
          ))}
        </div>
        <div className="overflow-auto">
          <div className="sticky top-0 bg-black/[0.05] px-2 py-0.5 text-[11px] wa-muted">当前内容</div>
          {rows.map((r, i) => (
            <div
              key={`n${i}`}
              className={`whitespace-pre-wrap px-2 text-xs ${
                r.kind === 'add' ? 'bg-emerald-100 text-emerald-900' : r.kind === 'del' ? 'opacity-0' : ''
              }`}
            >
              {r.kind === 'del' ? '' : r.new || ' '}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface DiffRow {
  kind: 'same' | 'add' | 'del'
  old: string
  new: string
}

/** 行级 diff（LCS），不引入 diff 库 */
function buildDiff(oldText: string, newText: string): { rows: DiffRow[]; added: number; removed: number } {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // 大文本保护
  if (n * m > 4_000_000) {
    const rows: DiffRow[] = [
      ...a.map((t) => ({ kind: 'del' as const, old: t, new: '' })),
      ...b.map((t) => ({ kind: 'add' as const, old: '', new: t }))
    ]
    return {
      rows,
      added: b.reduce((s, t) => s + t.replace(/\s/g, '').length, 0),
      removed: a.reduce((s, t) => s + t.replace(/\s/g, '').length, 0)
    }
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', old: a[i], new: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', old: a[i], new: '' })
      removed += a[i].replace(/\s/g, '').length
      i++
    } else {
      rows.push({ kind: 'add', old: '', new: b[j] })
      added += b[j].replace(/\s/g, '').length
      j++
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', old: a[i], new: '' })
    removed += a[i].replace(/\s/g, '').length
    i++
  }
  while (j < m) {
    rows.push({ kind: 'add', old: '', new: b[j] })
    added += b[j].replace(/\s/g, '').length
    j++
  }
  return { rows, added, removed }
}
