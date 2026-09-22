import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editor'
import { useUiStore } from '../store/ui'
import { WebviewPanel } from './WebviewPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { RewriteHistoryPanel } from './RewriteHistoryPanel'
import { useRewriteHistoryStore } from '../store/rewrite'
import { SiteStatusBadge, SiteStatusWatcher } from './SiteStatusBadge'

/** 侧边栏最小/最大宽度（与 store 中保持一致） */
const MIN_W = 320
const MAX_W = 900
/** WritingPage 自身的固定列宽（章节树 + 辅助面板），用于计算写作区最低需求 */
const WRITING_FIXED = 280 + 320
/** 编辑器正文可接受的最小宽度 */
const EDITOR_MIN = 320
/** 左侧工作台宽度 */
const WORKBENCH_W = 360

/**
 * 写作页 + AI 侧边栏（"套壳"模式）。
 *
 * ⚠️ 空间预算：工作台 360 + AI 侧边栏 + 章节树 280 + 辅助面板 320 + 编辑器正文。
 * 1200px 窗口下若侧边栏取默认 460，右侧辅助面板会被挤出可视区（实测现象：
 * 右栏与底部状态栏被裁掉）。因此这里按实际窗口宽度**动态压缩侧边栏**，
 * 必要时临时隐藏右辅助面板，保证编辑器正文始终可用。
 */
export function SplitWorkspace({ children }: { children: React.ReactNode }): JSX.Element {
  const width = useEditorStore((s) => s.aiSidebarWidth)
  const collapsed = useEditorStore((s) => s.aiSidebarCollapsed)
  const setWidth = useEditorStore((s) => s.setAiSidebarWidth)
  const toggle = useEditorStore((s) => s.toggleAiSidebar)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const auxPanelOpen = useEditorStore((s) => s.auxPanelOpen)
  const toggleAuxPanel = useEditorStore((s) => s.toggleAuxPanel)

  const [viewportW, setViewportW] = useState(() => window.innerWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  // 跟踪窗口宽度，用于空间预算
  useEffect(() => {
    const onResize = (): void => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 可用给 AI 侧边栏的最大宽度（扣掉工作台与写作区刚性需求）
  const workbenchW = sidebarCollapsed ? 40 : WORKBENCH_W
  const budget = viewportW - workbenchW - EDITOR_MIN
  // 空间足够时才保留辅助面板，否则为编辑器让路
  const auxFits = budget - width >= WRITING_FIXED
  const effectiveAux = auxPanelOpen && auxFits
  const fixedForWriting = 280 + (effectiveAux ? 320 : 0)
  const maxAllowed = Math.max(MIN_W, Math.min(MAX_W, budget - fixedForWriting))
  const effWidth = Math.max(MIN_W, Math.min(width, maxAllowed))
  /** 空间严重不足：连最小侧边栏都放不下，提示用户 */
  const tooNarrow = budget - fixedForWriting < MIN_W

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true
      startX.current = e.clientX
      startW.current = effWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.body.dataset.waDragging = '1'
      e.preventDefault()
    },
    [effWidth]
  )

  useEffect(() => {
    if (collapsed) return
    function onMove(e: MouseEvent): void {
      if (!dragging.current) return
      // 分隔条在左侧，因此鼠标左移（delta 为负）时宽度增加
      const delta = e.clientX - startX.current
      setWidth(startW.current - delta)
    }
    function onUp(): void {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      delete document.body.dataset.waDragging
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [collapsed, setWidth])

  if (collapsed) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <ErrorBoundary scope="写作区">{children}</ErrorBoundary>
        <button
          onClick={toggle}
          title="展开 AI 侧边栏"
          className="flex w-7 shrink-0 items-center justify-center border-l text-[11px] hover:bg-black/5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <span className="[writing-mode:vertical-rl]">◀ AI 助手</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* AI 侧边栏（宽度按窗口空间动态压缩） */}
      <div
        className="flex min-h-0 shrink-0 flex-col border-r transition-[width] duration-200 ease-out"
        style={{ width: effWidth, borderColor: 'var(--wa-border)' }}
      >
        {/* 侧边栏头部：tab 切换 + 折叠按钮 */}
        <div
          className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <SidePanelTabs />
          <SiteStatusBadge />
          {effWidth < width && (
            <span className="text-[10px] text-amber-600" title={`已压缩到 ${effWidth}px`}>·</span>
          )}
          <div className="flex-1" />
          <button
            onClick={toggle}
            title="收起 AI 侧边栏（Ctrl+2）"
            className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
          >
            ▶ 收起
          </button>
        </div>
        {/* 内容：webview 或 改写记录 */}
        <div className="min-h-0 flex-1">
          <SidePanelContent />
        </div>
      </div>

      {/* 分隔条 */}
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => setWidth(460)}
        title="拖动调整宽度，双击恢复默认"
        className="group relative w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400/40"
        style={{ borderLeft: '1px solid var(--wa-border)' }}
      >
        {/* 加宽拖拽热区（视觉上仍是一条细线） */}
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      {/* 写作区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tooNarrow && (
          <div className="shrink-0 border-b bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
            窗口较窄，界面已自动精简。建议最大化窗口，或点上方「收起」隐藏 AI 面板。
            {auxPanelOpen && !auxFits && (
              <button onClick={toggleAuxPanel} className="ml-2 underline hover:no-underline">
                隐藏右辅助面板
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** AI 侧栏头部的「AI 网页 / 改写记录」tab */
function SidePanelTabs(): JSX.Element {
  const tab = useRewriteHistoryStore((s) => s.sidePanelTab)
  const setTab = useRewriteHistoryStore((s) => s.setSidePanelTab)
  const reload = useRewriteHistoryStore((s) => s.reload)
  const count = useRewriteHistoryStore((s) => s.entries.length)
  function activate(next: 'web' | 'history'): void {
    if (next === 'history') reload() // 进入时拉取最新
    setTab(next)
  }
  return (
    <div className="flex items-center gap-1 rounded border bg-black/[0.03] p-0.5" style={{ borderColor: 'var(--wa-border)' }}>
      <TabBtn active={tab === 'web'} onClick={() => activate('web')}>AI 网页</TabBtn>
      <TabBtn active={tab === 'history'} onClick={() => activate('history')}>
        改写记录{count > 0 && <span className="ml-1 rounded bg-ink-800 px-1 text-[9px] text-white">{count}</span>}
      </TabBtn>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[11px] transition-colors wa-interactive ${
        active ? 'bg-white shadow-sm' : 'text-[color:var(--wa-muted)] hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  )
}

/** AI 侧栏内容（按 tab 切换） */
function SidePanelContent(): JSX.Element {
  const tab = useRewriteHistoryStore((s) => s.sidePanelTab)
  if (tab === 'history') return <RewriteHistoryPanel />
  return <WebviewPanel compact />
}
