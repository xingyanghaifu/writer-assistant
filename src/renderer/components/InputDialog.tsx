import { useEffect, useRef, useState } from 'react'

/**
 * 应用内输入对话框，用于替代 `window.prompt`。
 *
 * ⚠️ 为什么必须自己实现：
 * Electron **不支持 `window.prompt`**，调用会直接抛出
 * `Error: prompt() is not supported.`（实测确认）。
 * 这会导致「问 AI」「标记伏笔」这类需要用户输入的功能完全失效。
 * （`window.confirm` / `window.alert` 是支持的，无需替换。）
 */
export interface InputDialogProps {
  open: boolean
  title: string
  /** 输入框初始值 */
  defaultValue?: string
  placeholder?: string
  /** 确认按钮文案 */
  confirmLabel?: string
  /** 多行输入（如伏笔描述较长时） */
  multiline?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function InputDialog({
  open,
  title,
  defaultValue = '',
  placeholder,
  confirmLabel = '确定',
  multiline = false,
  onConfirm,
  onCancel
}: InputDialogProps): JSX.Element | null {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // 每次打开重置为默认值并聚焦
  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    const t = setTimeout(() => {
      inputRef.current?.focus()
      if (inputRef.current && 'select' in inputRef.current) inputRef.current.select()
    }, 30)
    return () => clearTimeout(t)
  }, [open, defaultValue])

  // Esc 取消
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  function submit(): void {
    const v = value.trim()
    if (!v) return
    onConfirm(v)
  }

  const commonProps = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    className:
      'w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-ink-600',
    style: { borderColor: 'var(--wa-border)' } as React.CSSProperties
  }

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/30 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="wa-modal w-full max-w-sm rounded-lg bg-white p-3 shadow-2xl">
        <div className="mb-2 text-xs font-semibold">{title}</div>

        {multiline ? (
          <textarea ref={inputRef as React.Ref<HTMLTextAreaElement>} rows={3} {...commonProps} className={commonProps.className + ' resize-none'} />
        ) : (
          <input ref={inputRef as React.Ref<HTMLInputElement>} {...commonProps} />
        )}

        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          <span className="flex-1 text-[10px] wa-muted">Enter 确定 · Esc 取消</span>
          <button
            onClick={onCancel}
            className="rounded px-2.5 py-1 text-xs hover:bg-black/5 wa-interactive"
            style={{ border: '1px solid var(--wa-border)' }}
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
