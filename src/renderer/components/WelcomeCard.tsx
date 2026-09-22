import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import { listSiteMeta } from '../adapters/registry'
import { useSiteStore } from '../store/site'

const STORAGE_KEY = 'wa.welcomeDismissed.v1'

/**
 * 首启动引导卡。
 *
 * 出现时机：
 *  - 本地未设置「已关闭」标志
 *  - 当前站点不是 online（未登录或未知）
 *
 * 引导步骤：
 *  1. 选择站点
 *  2. 在右侧 AI 网页登录
 *  3. 回到工作台点 AI 写作
 *
 * 关闭后写入 localStorage，不再打扰。
 */
export function WelcomeCard(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  const sites = useSiteStore((s) => s.sites)
  const currentSite = useUiStore((s) => s.siteId)
  const setSiteId = useUiStore((s) => s.setSiteId)
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    try {
      const was = localStorage.getItem(STORAGE_KEY)
      if (was === '1') setDismissed(true)
    } catch {
      /* 忽略 */
    }
  }, [])

  if (dismissed) return null

  // 仅在当前站点不是 online 时显示
  const cur = sites[currentSite]
  const online = cur?.status?.kind === 'online'
  if (online) return null

  const meta = listSiteMeta()
  const current = meta.find((m) => m.id === currentSite)

  function close(): void {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* 忽略 */
    }
    setDismissed(true)
  }

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="wa-modal w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <h2 className="mb-1 text-base font-semibold">欢迎使用写作副驾</h2>
        <p className="mb-3 text-[12px] wa-muted">3 步启用 AI 写作</p>

        <ol className="space-y-2 text-[12px]">
          <li className="flex gap-2">
            <span className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded-full bg-ink-800 text-center text-[11px] leading-5 text-white">1</span>
            <div>
              <div className="font-medium">选择 AI 站点</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {meta.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSiteId(m.id)
                      showToast(`已切换到 ${m.name}`, 'info')
                    }}
                    className={`rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive ${
                      m.id === currentSite ? 'border-ink-800 bg-black/5' : ''
                    }`}
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded-full bg-ink-800 text-center text-[11px] leading-5 text-white">2</span>
            <div>
              <div className="font-medium">在右侧 AI 网页完成登录</div>
              <div className="text-[11px] wa-muted">
                已为你打开 <strong>{current?.name ?? currentSite}</strong>。
                登录后状态会自动显示在侧栏头部（绿点 = 在线）。
              </div>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded-full bg-ink-800 text-center text-[11px] leading-5 text-white">3</span>
            <div>
              <div className="font-medium">回到工作台开始写作</div>
              <div className="text-[11px] wa-muted">
                选中正文段落，使用气泡菜单的润色/扩写/缩写/改写，或直接按 Ctrl+Shift+R。
              </div>
            </div>
          </li>
        </ol>

        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-1 text-[11px] wa-muted">
            <input
              type="checkbox"
              onChange={(e) => {
                if (e.target.checked) close()
              }}
            />
            不再提示
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // 直接打开设置 → 数据 → 清缓存
                useUiStore.getState().setToolbarDialog('settings', 'data')
              }}
              className="rounded border px-2 py-1 text-[11px] hover:bg-black/5 wa-interactive"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              清缓存
            </button>
            <button
              onClick={close}
              className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 wa-interactive"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}