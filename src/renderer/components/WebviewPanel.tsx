import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/ui'
import { getAdapter, siteUrl } from '../adapters/registry'
import { toScripts } from '../adapters/scripts'
import { useSiteStore, isRiskUrl } from '../store/site'

/**
 * 内嵌 AI 站点使用的 Chrome UA（与主进程 applyEmbeddedUserAgent 保持一致）。
 */
export const EMBEDDED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/**
 * 右侧 AI 网页面板（阶段 1 / 10）。
 *
 * 安全约束：webview 使用 persist:writer-assistant partition 以共享登录态；
 * 不向被嵌入页面暴露任何 Node API。
 * 切换站点时主 webview 与后台 webview 同步切换（阶段 10）。
 *
 * 新增：站点状态上报 + URL 风控检测 + 加载失败的细分原因。
 */
export function WebviewPanel({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const siteId = useUiStore((s) => s.siteId)
  const ref = useRef<HTMLElement & { getWebContentsId?: () => number; getURL?: () => string; reload?: () => void }>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const setSiteState = useSiteStore((s) => s.set)
  const resetSite = useSiteStore((s) => s.reset)

  const adapter = getAdapter(siteId)
  const siteName = adapter?.name ?? siteId
  const url = siteUrl(siteId)

  // 切换站点：状态立刻设为 loading，让 badge 反映"正在切换"
  useEffect(() => {
    resetSite(siteId)
    setReady(false)
    setFailed(null)
  }, [siteId, resetSite])

  // 注册 webContentsId + 监听事件
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false

    const onReady = (): void => {
      if (cancelled) return
      setReady(true)
      setFailed(null)
      try {
        const id = el.getWebContentsId?.()
        if (typeof id === 'number') {
          void window.api.webview.register(id, 'main')
        }
      } catch (err) {
        console.error('[webview] 注册失败', err)
      }
      // 检测登录态 + 风控
      void runDetection(el, siteId, setSiteState)
    }

    const onFail = (e: Event): void => {
      const detail = (e as unknown as { errorDescription?: string }).errorDescription
      setFailed(detail ?? '页面加载失败，请检查网络或站点可用性')
      setSiteState(siteId, {
        status: { kind: 'offline', reason: detail },
        updatedAt: Date.now()
      })
    }

    const onNavigate = (e: Event): void => {
      const dest = (e as unknown as { url?: string }).url ?? ''
      if (isRiskUrl(dest)) {
        setSiteState(siteId, {
          status: { kind: 'risk', reason: '检测到风控页面' },
          updatedAt: Date.now(),
          url: dest
        })
        return
      }
      void runDetection(el, siteId, setSiteState)
    }

    // 登录后状态经常不触发导航（站内 SPA 直接切换），
    // 只测一次会一直停在"未登录"。这里加轻量轮询 + 点击后复检。
    let pollTimer: number | undefined
    const startPolling = (): void => {
      if (pollTimer !== undefined) return
      pollTimer = window.setInterval(() => {
        if (cancelled) return
        void runDetection(el, siteId, setSiteState)
      }, 8000)
    }
    const stopPolling = (): void => {
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer)
        pollTimer = undefined
      }
    }

    const onDomReady = (): void => {
      onReady()
      startPolling()
    }

    const onClick = (): void => {
      // 用户点过页面（可能在登录）→ 1 秒后复检
      window.setTimeout(() => {
        if (!cancelled) void runDetection(el, siteId, setSiteState)
      }, 1000)
    }

    el.addEventListener('dom-ready', onDomReady)
    el.addEventListener('did-fail-load', onFail as EventListener)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('dom-ready', () => {
      // webview 内部点击监听（点登录按钮后尽快刷新状态）
      try {
        const wv = el as unknown as {
          addEventListener?: (t: string, cb: () => void) => void
        }
        wv.addEventListener?.('ipc-message', onClick)
      } catch {
        /* ignore */
      }
    })
    return () => {
      cancelled = true
      stopPolling()
      el.removeEventListener('dom-ready', onDomReady)
      el.removeEventListener('did-fail-load', onFail as EventListener)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [siteId, setSiteState])

  return (
    <div
      className={`relative overflow-hidden bg-white ${compact ? 'h-full w-full' : 'flex-1'}`}
    >
      {!ready && !failed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm wa-muted">
          正在加载 {siteName} …
        </div>
      )}
      {failed && (
        <div className="absolute left-0 right-0 top-0 z-10 border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {failed}
          <button
            onClick={() => {
              setFailed(null)
              setReady(false)
              const el = ref.current
              if (el?.reload) el.reload()
            }}
            className="ml-2 underline hover:no-underline"
          >
            重试
          </button>
          <span className="ml-2 wa-muted">（或切换其它站点）</span>
        </div>
      )}
      <webview
        key={siteId}
        ref={ref as never}
        src={url}
        partition="persist:writer-assistant"
        className="h-full w-full"
        useragent={EMBEDDED_UA}
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      />
    </div>
  )
}

/**
 * 登录态/风控检测：在 webview 中跑检测脚本，结果回写到 store。
 */
function executeInWebview(el: HTMLElement, script: string): Promise<unknown> {
  const wv = el as HTMLElement & { executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown> }
  if (typeof wv.executeJavaScript === 'function') return wv.executeJavaScript(script, false)
  return Promise.reject(new Error('no executeJavaScript'))
}

async function runDetection(
  el: HTMLElement & { getURL?: () => string },
  siteId: string,
  setSiteState: (id: string, s: import('../store/site').SiteState) => void
): Promise<void> {
  try {
    const adapter = getAdapter(siteId)
    const url = el.getURL?.() ?? ''
    if (url && isRiskUrl(url)) {
      setSiteState(siteId, { status: { kind: 'risk', reason: '风控页面' }, updatedAt: Date.now(), url })
      return
    }
    if (!adapter) {
      setSiteState(siteId, { status: { kind: 'unknown' }, updatedAt: Date.now(), url })
      return
    }
    const scripts = toScripts(adapter)
    let status = 'unknown'
    try {
      const local = await executeInWebview(el, scripts.loginState)
      if (typeof local === 'string' && local) status = local
    } catch {
      status = await window.api.webview.loginState('main')
    }
    if (status === 'unknown' && /deepseek\.com\/(a\/chat|chat)/i.test(url) && !/sign[_-]?in/i.test(url)) {
      status = 'logged-in'
    }
    if (status === 'logged-in') {
      setSiteState(siteId, { status: { kind: 'online' }, updatedAt: Date.now(), url })
    } else if (status === 'logged-out') {
      setSiteState(siteId, { status: { kind: 'logged-out' }, updatedAt: Date.now(), url })
    } else {
      setSiteState(siteId, { status: { kind: 'unknown' }, updatedAt: Date.now(), url })
    }
  } catch {
    setSiteState(siteId, { status: { kind: 'unknown' }, updatedAt: Date.now() })
  }
}