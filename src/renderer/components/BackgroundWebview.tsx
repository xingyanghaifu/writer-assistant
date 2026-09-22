import { useEffect, useRef } from 'react'
import { useUiStore } from '../store/ui'
import { siteUrl } from '../adapters/registry'
import { EMBEDDED_UA } from './WebviewPanel'

/**
 * 隐藏的后台建议会话 webview（阶段 3 / 10）。
 *
 * 与主 webview 使用同一 partition（persist:writer-assistant）以共享登录态。
 * 站点切换时与主 webview 同步切换（key 触发重新挂载）。
 *
 * ⚠️ 关键：**不能用 `display:none` 隐藏**。
 * Chromium 不会加载/渲染 display:none 的元素，webview 因此永远不触发
 * dom-ready，webContentsId 注册不上，所有后台请求都会卡在
 * "后台会话未就绪"（实测踩过：灵感/建议一直显示"生成中…"）。
 * 正确做法是把它渲染在可视区外（保留布局与渲染），并禁用交互。
 */
export function BackgroundWebview(): JSX.Element {
  const siteId = useUiStore((s) => s.siteId)
  const ref = useRef<HTMLElement & { getWebContentsId?: () => number }>(null)
  const url = siteUrl(siteId)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onReady = (): void => {
      try {
        const id = el.getWebContentsId?.()
        if (typeof id === 'number') void window.api.webview.register(id, 'background')
      } catch (err) {
        console.error('[bg-webview] 注册失败', err)
      }
    }
    el.addEventListener('dom-ready', onReady)
    return () => el.removeEventListener('dom-ready', onReady)
  }, [siteId])

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        // 放在视口外但仍参与渲染（不能 display:none / visibility:hidden）
        left: '-10000px',
        top: 0,
        width: '1200px',
        height: '800px',
        // 不参与指针交互，避免抢焦点
        pointerEvents: 'none',
        zIndex: -1,
        overflow: 'hidden'
      }}
    >
      <webview
        key={siteId}
        ref={ref as never}
        src={url}
        useragent={EMBEDDED_UA}
        partition="persist:writer-assistant"
        className="h-full w-full"
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      />
    </div>
  )
}
