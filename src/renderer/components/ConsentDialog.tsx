import { useEffect, useState } from 'react'
import { COMPLIANCE_TEXT, acceptConsent, type ConsentKind } from '../services/compliance'
import { useUiStore } from '../store/ui'

/**
 * 通用声明对话框（阶段 8 / 8.5）。
 * 用于：首次启动合规须知、隐私说明、首次使用 AI 功能的版权说明。
 */
export function ConsentDialog({
  kind,
  onDone
}: {
  kind: ConsentKind
  onDone: () => void
}): JSX.Element {
  const text = COMPLIANCE_TEXT[kind]
  const showToast = useUiStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)

  async function accept(): Promise<void> {
    setBusy(true)
    try {
      const patch = acceptConsent(kind)
      const next = await window.api.settings.set({ consent: { ...useUiStore.getState().settings!.consent, ...patch } })
      useUiStore.getState().setSettings(next)
      onDone()
    } catch {
      showToast('保存确认状态失败', 'error')
      setBusy(false)
    }
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-[560px] max-w-full rounded-lg bg-white p-5 shadow-2xl">
        <h2 className="mb-3 text-base font-semibold">{text.title}</h2>
        <ul className="mb-5 space-y-2">
          {text.body.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-800">
              <span className="wa-muted">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button
            onClick={() => void accept()}
            disabled={busy}
            className="rounded bg-ink-800 px-4 py-1.5 text-sm text-white hover:bg-ink-900 disabled:opacity-50"
          >
            我已阅读并同意
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 启动声明门禁：依次显示未确认的声明（合规 → 隐私）。
 */
export function ConsentGate(): JSX.Element | null {
  const settings = useUiStore((s) => s.settings)
  const [queue, setQueue] = useState<ConsentKind[]>([])

  useEffect(() => {
    if (!settings) return
    const pending: ConsentKind[] = []
    if (!settings.consent.complianceAccepted) pending.push('compliance')
    if (!settings.consent.privacyAccepted) pending.push('privacy')
    setQueue(pending)
  }, [settings])

  if (queue.length === 0) return null
  const current = queue[0]
  return (
    <ConsentDialog
      kind={current}
      onDone={() => {
        // 重新读取设置，继续下一个
        void window.api.settings.get().then((s) => useUiStore.getState().setSettings(s))
      }}
    />
  )
}
