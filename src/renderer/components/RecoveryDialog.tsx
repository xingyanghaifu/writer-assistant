import { useEffect, useState } from 'react'
import type { RecoveryCandidate } from '@shared/work'
import { useWorkStore } from '../store/work'
import { useUiStore } from '../store/ui'

function fmt(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 崩溃恢复对话框（阶段 5.8）。
 * 启动时扫描 recovery 目录；若发现异常退出后的临时草稿，提示恢复。
 * 选项：恢复 / 忽略 / 查看。
 */
export function RecoveryDialog(): JSX.Element | null {
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([])
  const [uncleanExit, setUncleanExit] = useState(false)
  const [preview, setPreview] = useState<RecoveryCandidate | null>(null)
  const [previewText, setPreviewText] = useState('')
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.api.recovery.scan()
        if (cancelled) return
        setCandidates(r?.candidates ?? [])
        setUncleanExit(!!r?.uncleanExit)
      } catch {
        /* 恢复失败不阻塞启动 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (candidates.length === 0) return null

  async function onRecover(c: RecoveryCandidate): Promise<void> {
    try {
      const r = await window.api.recovery.apply(c)
      if (!r.ok) {
        showToast('恢复失败，请手动找回', 'error')
        return
      }
      await useWorkStore.getState().init()
      setCandidates((list) => list.filter((x) => x.chapterId !== c.chapterId))
      showToast('已恢复未保存的内容', 'success')
    } catch {
      showToast('恢复失败，请手动找回', 'error')
    }
  }

  async function onDiscard(c: RecoveryCandidate): Promise<void> {
    await window.api.recovery.discard(c.chapterId)
    setCandidates((list) => list.filter((x) => x.chapterId !== c.chapterId))
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-[520px] max-w-full rounded-lg bg-white p-5 shadow-2xl">
        <h2 className="mb-1 text-base font-semibold">检测到上次异常退出</h2>
        <p className="mb-3 text-xs wa-muted">
          {uncleanExit ? '应用未正常关闭。' : ''}发现未保存的草稿，是否恢复？
        </p>

        <div className="mb-4 max-h-56 space-y-2 overflow-y-auto">
          {candidates.map((c) => (
            <div key={c.chapterId} className="rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="text-sm font-medium">
                {c.workTitle} · {c.chapterTitle}
              </div>
              <div className="mb-1.5 text-xs wa-muted">
                {c.wordCount} 字 · {fmt(c.updatedAt)}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => void onRecover(c)}
                  className="rounded bg-ink-800 px-2 py-0.5 text-xs text-white hover:bg-ink-900"
                >
                  恢复
                </button>
                <button
                  onClick={() => {
                    setPreview(c)
                    setPreviewText(c.preview ?? '')
                  }}
                  className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
                >
                  查看
                </button>
                <button
                  onClick={() => void onDiscard(c)}
                  className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => setCandidates([])}
            className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
          >
            稍后处理
          </button>
        </div>
      </div>

      {preview && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[70vh] w-[600px] max-w-full flex-col rounded-lg bg-white p-4 shadow-2xl">
            <div className="mb-2 text-sm font-semibold">
              {preview.workTitle} · {preview.chapterTitle}（{preview.wordCount} 字）
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs leading-relaxed">
              {previewText || '（暂时无法预览，可直接恢复）'}
            </pre>
            <div className="mt-2 flex justify-end gap-1">
              <button
                onClick={() => setPreview(null)}
                className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  void onRecover(preview)
                  setPreview(null)
                }}
                className="rounded bg-ink-800 px-2 py-0.5 text-xs text-white hover:bg-ink-900"
              >
                恢复
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
