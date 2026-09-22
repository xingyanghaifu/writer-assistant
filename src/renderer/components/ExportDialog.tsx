import { useEffect, useState } from 'react'
import type { ExportFormat } from '@shared/settings'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'

const FORMATS: Array<{ id: ExportFormat; label: string; desc: string }> = [
  { id: 'txt', label: 'TXT', desc: '纯文本，通用性最好' },
  { id: 'markdown', label: 'Markdown', desc: '带标题层级，适合二次编辑' },
  { id: 'html', label: 'HTML', desc: '含排版样式，可直接打印/转 PDF' },
  { id: 'json', label: 'JSON', desc: '完整数据备份，可再次导入' }
]

/**
 * 导出对话框（阶段 7）。
 *
 * 支持 TXT / Markdown / HTML / JSON；可选是否附带 AI 辅助创作声明。
 * JSON 导出用于长期存档，可被导入功能读回。
 */
export function ExportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const works = useWorkStore((s) => s.works)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const showToast = useUiStore((s) => s.showToast)

  const [workId, setWorkId] = useState(currentWorkId ?? works[0]?.id ?? '')
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [includeAiNotice, setIncludeAiNotice] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!workId && works.length) setWorkId(works[0].id)
  }, [works, workId])

  const work = works.find((w) => w.id === workId)
  const chapters = work?.volumes.flatMap((v) => v.chapters) ?? []
  const words = chapters.reduce((s, c) => s + c.wordCount, 0)

  async function run(): Promise<void> {
    if (!workId) return
    setBusy(true)
    try {
      const r = await window.api.io.export({ workId, format, includeAiNotice })
      if (r.ok) {
        showToast('导出成功', 'success')
        onClose()
      } else if (r.error === 'E_CANCELLED') {
        // 用户取消，不提示
      } else {
        showToast(r.error, 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">导出作品</h2>
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          {/* 选作品 */}
          <label className="block">
            <span className="mb-1 block wa-muted">选择作品</span>
            <select
              value={workId}
              onChange={(e) => setWorkId(e.target.value)}
              className="w-full rounded border px-2 py-1 outline-none"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              {works.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>

          {work && (
            <div className="wa-muted">
              共 {chapters.length} 章 · {words.toLocaleString()} 字
            </div>
          )}

          {/* 格式 */}
          <div>
            <div className="mb-1 wa-muted">导出格式</div>
            <div className="grid grid-cols-2 gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`rounded border px-2 py-1.5 text-left transition-colors ${
                    format === f.id ? 'border-ink-600 bg-ink-800/5 font-medium' : 'hover:bg-black/5'
                  }`}
                  style={format === f.id ? {} : { borderColor: 'var(--wa-border)' }}
                >
                  <div>{f.label}</div>
                  <div className="text-[10px] wa-muted">{f.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* AI 声明 */}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={includeAiNotice}
              onChange={(e) => setIncludeAiNotice(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              附带「AI 辅助创作」声明
              <span className="wa-muted">（投稿平台普遍要求标注，建议保留）</span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <button onClick={onClose} className="rounded px-3 py-1 text-xs hover:bg-black/5 wa-interactive">
            取消
          </button>
          <button
            onClick={() => void run()}
            disabled={!workId || busy}
            className="rounded bg-ink-800 px-3 py-1 text-xs text-white disabled:opacity-40"
          >
            {busy ? '导出中…' : '选择位置并导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
