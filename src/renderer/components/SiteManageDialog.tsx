import { useUiStore } from '../store/ui'
import { useSiteStore, statusLabel } from '../store/site'
import { refreshSiteStatus } from '../services/aiError'

/**
 * AI 站点管理面板（弹窗）。
 *
 * 包含：
 *  - 站点列表 + 状态 + 切换
 *  - 当前站点：登录态刷新、清缓存（仅会话/彻底）、重新加载网页
 */
export function SiteManageDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const sites = useSiteStore((s) => s.sites)
  const setSiteId = useUiStore((s) => s.setSiteId)
  const currentSite = useUiStore((s) => s.siteId)
  const showToast = useUiStore((s) => s.showToast)

  async function refreshAll(): Promise<void> {
    showToast('正在刷新登录态…', 'info')
    await refreshSiteStatus(currentSite)
    showToast('登录态已刷新', 'success')
  }

  async function clearCache(mode: 'session' | 'full'): Promise<void> {
    const desc = mode === 'session' ? '仅会话（保留 IndexedDB/磁盘缓存）' : '彻底清空（cookies/localStorage/缓存/IndexedDB）'
    if (!window.confirm(`清空 AI 网页 ${desc}？\n\n仅影响 AI 站点的浏览器级数据，不会影响你的作品。`)) return
    const r = await window.api.webview.clearStorage(mode)
    if (r.ok) {
      showToast('已清空。正在重新加载…', 'success')
      // 重置状态 + 刷新
      useSiteStore.getState().reset(currentSite)
      await refreshSiteStatus(currentSite)
    } else {
      showToast('清空失败：' + r.error, 'error')
    }
  }

  function reloadWebview(): void {
    // 触发 webview 重载：直接通知主进程 reload 主 webview
    // 由于 webview ref 不在这里，我们通过执行 navigate 来刷新
    void window.api.webview
      .execute('main', 'location.reload()')
      .then(() => {
        showToast('AI 网页已重新加载', 'success')
        useSiteStore.getState().reset(currentSite)
      })
  }

  const currentState = sites[currentSite]

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wa-modal flex max-h-[92vh] w-[min(32rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">AI 站点管理</h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive">✕</button>
        </div>

        <div className="px-4 py-3 text-[12px]">
          <p className="mb-2 wa-muted">
            当前站点 <strong>{currentSite}</strong>
            {currentState && <>：<span className="ml-1">{statusLabel(currentState.status)}</span></>}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={refreshAll}
              className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              🔄 重新检测登录态
            </button>
            <button
              onClick={reloadWebview}
              className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              ↻ 重新加载 AI 网页
            </button>
          </div>

          <h3 className="mt-3 mb-1 text-[11px] font-medium">清缓存</h3>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => clearCache('session')}
              className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100 wa-interactive"
            >
              仅清会话（cookies）
            </button>
            <button
              onClick={() => clearCache('full')}
              className="rounded border border-rose-400 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-900 hover:bg-rose-100 wa-interactive"
            >
              彻底清空（重登）
            </button>
          </div>

          <h3 className="mt-3 mb-1 text-[11px] font-medium">所有站点状态</h3>
          <ul className="space-y-1 text-[11px]">
            {Object.entries(sites).map(([id, s]) => (
              <li key={id} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-black/5">
                <span className="font-medium">{id}</span>
                <span className="wa-muted">·</span>
                <span>{statusLabel(s.status)}</span>
                <div className="flex-1" />
                {id !== currentSite && (
                  <button
                    onClick={() => {
                      setSiteId(id)
                      showToast(`已切换到 ${id}`, 'success')
                    }}
                    className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    切到此
                  </button>
                )}
                {id === currentSite && <span className="rounded bg-ink-800 px-1.5 text-[10px] text-white">当前</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <button onClick={onClose} className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 wa-interactive">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}