import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import { useSiteStore } from '../store/site'
import { listSiteMeta } from '../adapters/registry'
import { WebviewPanel } from './WebviewPanel'

const SKIP_KEY = 'wa.loginPromptSkipped.v1'

/**
 * 启动时若 DeepSeek（当前站点）未登录，弹出登录窗。
 * 登录态走 persist:writer-assistant，与后台 webview 共享。
 */
export function LoginPrompt(): JSX.Element | null {
  const settings = useUiStore((s) => s.settings)
  const siteId = useUiStore((s) => s.siteId)
  const setSiteId = useUiStore((s) => s.setSiteId)
  const sites = useSiteStore((s) => s.sites)
  const showToast = useUiStore((s) => s.showToast)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 600)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!settings?.consent.complianceAccepted || !settings.consent.privacyAccepted) return
    try {
      if (sessionStorage.getItem(SKIP_KEY) === '1') {
        setOpen(false)
        return
      }
    } catch {
      /* ignore */
    }
    const kind = sites[siteId]?.status?.kind
    if (kind === 'online') {
      setOpen(false)
      return
    }
    if (kind === 'logged-out' || kind === 'offline' || kind === 'risk' || !kind) {
      setOpen(true)
    }
  }, [ready, siteId, sites, settings])

  useEffect(() => {
    const kind = sites[siteId]?.status?.kind
    if (kind === 'online' && open) {
      showToast('DeepSeek 已登录', 'success')
      setOpen(false)
    }
  }, [sites, siteId, open, showToast])

  if (!open) return null

  const meta = listSiteMeta()
  const current = meta.find((m) => m.id === siteId)
  const status = sites[siteId]?.status?.kind ?? 'loading'

  function skip(): void {
    try {
      sessionStorage.setItem(SKIP_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4">
      <div
        className="flex h-[min(720px,90vh)] w-[min(56rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border shadow-2xl wa-panel"
        style={{ borderColor: 'var(--wa-border)' }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--wa-border)' }}>
          <div>
            <h2 className="text-sm font-semibold">登录 {current?.name ?? 'DeepSeek'}</h2>
            <p className="text-[11px] wa-muted">进入写作前先登录，润色/扩写才能用。账号只保存在本机网页里。</p>
          </div>
          <div className="flex-1" />
          <span className="text-[11px] wa-muted">
            {status === 'online' ? '已登录' : status === 'loading' ? '检测中…' : '未登录'}
          </span>
        </header>

        <div className="flex shrink-0 flex-wrap gap-1 border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          {meta.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSiteId(m.id)}
              className={`rounded border px-2 py-0.5 text-[11px] ${m.id === siteId ? 'border-ink-800 bg-black/5 font-medium' : 'hover:bg-black/5'}`}
              style={{ borderColor: 'var(--wa-border)' }}
            >
              {m.name}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 bg-white">
          <WebviewPanel compact />
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <span className="text-[11px] wa-muted">不会保存密码；登录 Cookie 由内置网页自己保管。</span>
          <div className="flex gap-2">
            <button type="button" onClick={skip} className="rounded px-3 py-1 text-xs hover:bg-black/5">
              稍后登录
            </button>
            <button
              type="button"
              onClick={() => {
                try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* ignore */ }
                setOpen(false)
                if (status === 'online') showToast('已登录，可以开始写作', 'success')
                else showToast('已关闭登录窗。可稍后在站点管理里再登', 'info')
              }}
              className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900"
            >
              {status === 'online' ? '开始写作' : '我已登录'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
