import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import { ImportDialog } from './ImportDialog'
import { ExportDialog } from './ExportDialog'
import { BackupPanel } from './BackupPanel'
import { SettingsDialog } from './SettingsDialog'
import { SearchPanel } from './SearchPanel'
import { LibraryPanel } from './LibraryPanel'
import { SiteManageDialog } from './SiteManageDialog'
import { PetSettingsDialog } from './PetSettingsDialog'
import { BookBreakdownPanel } from './BookBreakdownPanel'
import { AgentPanel } from './AgentPanel'

/** 顶部工具栏：应用名、站点切换、监听开关、检索、导入导出、备份、设置 */
function WindowControls(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    let off: (() => void) | undefined
    void (async () => {
      try {
        const plat = await window.api.app.platform()
        setIsMac(plat === 'darwin')
        if (plat === 'darwin') return
        const max = await window.api.app.isMaximized()
        setMaximized(max)
        off = window.api.app.onWindowState((s) => setMaximized(s.maximized))
      } catch {
        /* 旧 preload 无窗口控制时静默降级 */
      }
    })()
    return () => off?.()
  }, [])

  if (isMac) return null

  return (
    <div className="wa-win-controls">
      <button
        type="button"
        className="wa-win-btn"
        title="最小化"
        onClick={() => void window.api.app.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="wa-win-btn"
        title={maximized ? '还原' : '最大化'}
        onClick={() => void window.api.app.maximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5h5v5h-5z" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M3.5 1.5h5v5" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="wa-win-btn wa-win-close"
        title="关闭"
        onClick={() => void window.api.app.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}

export function TopToolbar(): JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const homeView = useUiStore((s) => s.homeView)
  const setHomeView = useUiStore((s) => s.setHomeView)

  /** 当前打开的对话框 */
  const [dialog, setDialogLocal] = useState<
    | 'import'
    | 'export'
    | 'backup'
    | 'settings'
    | 'search'
    | 'library'
    | 'site-manage'
    | 'pet'
    | 'breakdown'
    | 'agent'
    | null
  >(null)
  const toolbarDialog = useUiStore((s) => s.toolbarDialog)
  const setToolbarDialog = useUiStore((s) => s.setToolbarDialog)
  const toolbarSettingsTab = useUiStore((s) => s.toolbarSettingsTab)

  // 监听 store 触发（气泡菜单等组件可借此打开对话框）
  useEffect(() => {
    if (toolbarDialog) {
      setDialogLocal(toolbarDialog)
      // 立即清掉 store 端，避免重复触发
      setTimeout(() => setToolbarDialog(null), 0)
    }
  }, [toolbarDialog, setToolbarDialog])

  const setDialog = (d: typeof dialog): void => {
    setDialogLocal(d)
    if (d === null) setToolbarDialog(null, undefined)
  }

  return (
    <>
    <header className="wa-titlebar flex h-11 shrink-0 items-center gap-3 border-b px-3 wa-panel">
      <div className="flex items-center gap-0.5 rounded bg-black/5 p-0.5 text-[11px]">
        <button
          type="button"
          title="作品库主页"
          onClick={() => setHomeView('library')}
          className={`rounded px-2 py-1 ${homeView === 'library' ? 'bg-white font-medium shadow-sm' : 'wa-muted hover:bg-black/5'}`}
        >
          作品库
        </button>
        <button
          type="button"
          title="提示词库"
          onClick={() => setHomeView('prompts')}
          className={`rounded px-2 py-1 ${homeView === 'prompts' ? 'bg-white font-medium shadow-sm' : 'wa-muted hover:bg-black/5'}`}
        >
          提示词库
        </button>
      </div>

      {homeView === 'write' && (
        <button
          onClick={toggleSidebar}
          title={collapsed ? '展开工作台' : '折叠工作台'}
          className="rounded px-2 py-1 text-xs hover:bg-black/5 wa-interactive"
        >
          {collapsed ? '☰' : '⇤'}
        </button>
      )}



      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setDialog('settings')}
        className="rounded px-2 py-1 text-xs hover:bg-black/5 wa-interactive"
        title="设置"
      >
        设置
      </button>

      <WindowControls />
    </header>

      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'backup' && <BackupPanel onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <SettingsDialog
          onClose={() => setDialog(null)}
          initialTab={toolbarSettingsTab}
        />
      )}
      {dialog === 'site-manage' && <SiteManageDialog onClose={() => setDialog(null)} />}
      {dialog === 'pet' && <PetSettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'breakdown' && <BookBreakdownPanel onClose={() => setDialog(null)} />}
      {dialog === 'search' && <SearchPanel onClose={() => setDialog(null)} />}
      {dialog === 'library' && <LibraryPanel onClose={() => setDialog(null)} />}
      {dialog === 'agent' && <AgentPanel onClose={() => setDialog(null)} />}
    </>
  )
}
