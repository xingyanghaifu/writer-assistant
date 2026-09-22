import { useState } from 'react'
import type { ImportPreview, ImportResult, ImportStrategy, ImportExportErrorCode } from '@shared/settings'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'

/** 错误码 -> 中文提示 */
const ERR_TEXT: Record<ImportExportErrorCode, string> = {
  E_TXT_TOO_LARGE: '文件过大（超过 20MB），请拆分后再导入',
  E_CHAPTERS_TOO_MANY: '章节数过多（超过 2000 章）',
  E_BACKUP_VERSION: '备份版本高于当前应用版本，请先升级应用',
  E_BACKUP_CORRUPTED: '备份文件已损坏（校验失败）',
  E_IO_BUSY: '文件被占用，请关闭其他程序后重试',
  E_ENCODING_FAILED: '编码识别失败，请另存为 UTF-8 后重试',
  E_EXPORT_TOO_LARGE: '导出内容过大',
  E_CANCELLED: '已取消',
  E_UNKNOWN: '未知错误'
}

/**
 * 导入对话框（阶段 6.5）。
 *
 * 流程：选文件 → 预览（编码/章节数/字数）→ 选策略（新建/合并）→ 执行
 * 文件读写全在主进程；渲染层只展示预览与发起指令。
 */
export function ImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const refreshWorks = useWorkStore((s) => s.init)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)

  const [filePath, setFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [strategy, setStrategy] = useState<ImportStrategy>('new')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(): Promise<void> {
    setError(null)
    setResult(null)
    const p = await window.api.io.pickImportFile()
    if (!p) return
    setFilePath(p)
    setBusy(true)
    try {
      const r = await window.api.io.analyzeImport(p)
      if (r.ok) {
        setPreview(r.data)
      } else {
        const code = (r.code ?? 'E_UNKNOWN') as ImportExportErrorCode
        setError(ERR_TEXT[code] ?? r.error)
        setPreview(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败')
    } finally {
      setBusy(false)
    }
  }

  async function run(): Promise<void> {
    if (!filePath) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.io.executeImport({
        filePath,
        strategy,
        targetWorkId: strategy === 'merge' ? currentWorkId ?? undefined : undefined
      })
      setResult(r)
      if (r.ok) {
        await refreshWorks()
        showToast(`已导入 ${r.chapterCount} 章`, 'success')
      } else {
        const code = (r.error ?? 'E_UNKNOWN') as ImportExportErrorCode
        setError(ERR_TEXT[code] ?? r.message ?? '导入失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">导入作品</h2>
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          {/* 选文件 */}
          <div className="flex items-center gap-2">
            <button onClick={() => void pick()} disabled={busy} className="rounded bg-ink-800 px-2.5 py-1 text-white disabled:opacity-50">
              选择文件
            </button>
            <span className="min-w-0 flex-1 truncate wa-muted" title={filePath ?? ''}>
              {fileName ?? '支持 .txt / .md / .docx / .epub / .pdf / .json（备份）'}
            </span>
          </div>

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2 text-red-700">{error}</div>
          )}

          {/* 预览 */}
          {preview && !result?.ok && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Info label="编码" value={preview.encoding} />
                <Info label="章节数" value={`${preview.chapterCount}`} />
                <Info label="总字数" value={preview.wordCount.toLocaleString()} />
              </div>

              {preview.prefaceLength > 0 && (
                <div className="wa-muted">检测到前言 {preview.prefaceLength} 字，将作为独立章节保留</div>
              )}

              {preview.warnings.length > 0 && (
                <ul className="space-y-0.5 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-800">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              )}

              {/* 章节预览 */}
              <div className="rounded border" style={{ borderColor: 'var(--wa-border)' }}>
                <div className="border-b px-2.5 py-1 font-medium" style={{ borderColor: 'var(--wa-border)' }}>
                  章节预览
                </div>
                <ul className="max-h-40 divide-y overflow-y-auto" style={{ borderColor: 'var(--wa-border)' }}>
                  {preview.chapters.slice(0, 50).map((c, i) => (
                    <li key={i} className="flex items-center justify-between px-2.5 py-1">
                      <span className="truncate">{c.title}</span>
                      <span className="shrink-0 wa-muted">{c.wordCount} 字</span>
                    </li>
                  ))}
                  {preview.chapters.length > 50 && (
                    <li className="px-2.5 py-1 wa-muted">…共 {preview.chapters.length} 章</li>
                  )}
                </ul>
              </div>

              {/* 策略 */}
              <div className="space-y-1">
                <div className="font-medium">导入方式</div>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    checked={strategy === 'new'}
                    onChange={() => setStrategy('new')}
                    className="mt-0.5"
                  />
                  <span>
                    新建作品
                    <span className="wa-muted">（以文件名为书名，创建独立作品）</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    checked={strategy === 'merge'}
                    onChange={() => setStrategy('merge')}
                    disabled={!currentWorkId}
                    className="mt-0.5"
                  />
                  <span>
                    合并到当前作品
                    <span className="wa-muted">
                      {currentWorkId ? '（同名章节自动重命名，不覆盖正文）' : '（当前无选中作品）'}
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}

          {/* 结果 */}
          {result?.ok && (
            <div className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-emerald-800">
              导入完成：新增 {result.chapterCount} 章
              {result.skipped > 0 && `，跳过 ${result.skipped} 章`}
              {result.renamed > 0 && `，重命名 ${result.renamed} 章`}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <button onClick={onClose} className="rounded px-3 py-1 text-xs hover:bg-black/5 wa-interactive">
            {result?.ok ? '完成' : '取消'}
          </button>
          <button
            onClick={() => void run()}
            disabled={!preview || busy || !!result?.ok}
            className="rounded bg-ink-800 px-3 py-1 text-xs text-white disabled:opacity-40"
          >
            {busy ? '处理中…' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="wa-muted text-[10px]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
