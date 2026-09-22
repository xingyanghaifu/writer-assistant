import { useEffect } from 'react'
import { TopToolbar } from './components/TopToolbar'
import { LibraryPanel } from './components/LibraryPanel'
import { PromptsLibraryTab } from './components/PromptsLibraryTab'
import { Workbench } from './components/Workbench'
import { ConsentGate } from './components/ConsentDialog'
import { RecoveryDialog } from './components/RecoveryDialog'
import { BackgroundWebview } from './components/BackgroundWebview'
import { SiteStatusWatcher } from './components/SiteStatusBadge'
import { LoginPrompt } from './components/LoginPrompt'
import { WritingPage } from './components/editor/WritingPage'
import { CardPanel } from './components/CardPanel'
import { ToastHost } from './components/ui'
import { JobProgressPanel } from './components/JobProgressPanel'
import { useUiStore } from './store/ui'
import { applyTheme } from './store/editor'

/** 主题应用到根元素（含跟随系统） */
function useTheme(): void {
  const theme = useUiStore((s) => s.theme)
  useEffect(() => {
    applyTheme(theme)
    // 跟随系统时监听系统主题变化
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

/** 全局 toast */
function Toast(): JSX.Element | null {
  const toast = useUiStore((s) => s.toast)
  const clearToast = useUiStore((s) => s.clearToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, 2600)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  if (!toast) return null
  const color =
    toast.kind === 'error' ? 'bg-red-600/90' : toast.kind === 'success' ? 'bg-emerald-600/90' : 'bg-ink-800/90'
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className={`wa-slide-up rounded px-3 py-2 text-xs text-white shadow-lg ${color}`}>{toast.text}</div>
    </div>
  )
}

/**
 * 应用外壳。
 *
 * 左：写作工作台（360px，可折叠）
 * 中：AI 网页 / 写作页（可切换）
 * 专注模式隐藏左栏。
 */
export default function App(): JSX.Element {
  useTheme()
  const focusMode = useUiStore((s) => s.focusMode)
  const setFocusMode = useUiStore((s) => s.setFocusMode)
  const homeView = useUiStore((s) => s.homeView)

  // 主进程命令（菜单/快捷键）
  useEffect(() => {
    const off = window.api.onCommand((cmd) => {
      const s = useUiStore.getState()
      if (cmd === 'toggle-sidebar') s.toggleSidebar()
      if (cmd === 'toggle-focus-mode') s.setFocusMode(!s.focusMode)
      if (cmd === 'toggle-theme') {
        const order = ['light', 'dark', 'parchment'] as const
        const i = order.indexOf(s.theme as (typeof order)[number])
        s.setTheme(order[(i + 1) % order.length])
      }
    })
    return off
  }, [])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {!focusMode && <TopToolbar />}

      <div className="flex min-h-0 flex-1">
        {homeView === 'library' && <LibraryPanel embedded />}
        {homeView === 'prompts' && (
          <div className="min-h-0 flex-1 overflow-hidden p-3 wa-panel">
            <PromptsLibraryTab />
          </div>
        )}
        {homeView === 'write' && (
          <>
            {!focusMode && <Workbench />}
            <WritingPage />
          </>
        )}
      </div>

      {/* 走向卡片：两种视图下都可查看（统一在此挂载，避免重复） */}
      <CardPanel />

      {/* 专注模式下提供退出入口 */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          className="absolute right-3 top-3 z-30 rounded bg-black/10 px-2 py-1 text-[11px] hover:bg-black/20"
        >
          退出专注（Ctrl+3）
        </button>
      )}

      <Toast />
      <ToastHost />
      <JobProgressPanel />
      <ConsentGate />
      <RecoveryDialog />
      <SiteStatusWatcher />
      <LoginPrompt />
      <BackgroundWebview />
    </div>
  )
}
