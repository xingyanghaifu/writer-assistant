import { useState } from 'react'
import { useUiStore, type WorkbenchTab } from '../store/ui'
import { DraftTab } from './workbench/DraftTab'
import { OutlineTab } from './workbench/OutlineTab'
import { CharacterTab } from './workbench/CharacterTab'
import { ForeshadowTab } from './workbench/ForeshadowTab'
import { NoteTab } from './workbench/NoteTab'
import { StatTab } from './workbench/StatTab'
import { InspirationPanel } from './InspirationPanel'
import { SyncConfirmDialog } from './SyncConfirmDialog'
import { ErrorBoundary } from './ErrorBoundary'


const TOOLS: Array<{ id: 'search' | 'import' | 'export' | 'backup' | 'breakdown' | 'pet' | 'site-manage' | 'agent'; label: string; icon: string; hint: string }> = [
  { id: 'search', label: '搜索', icon: '🔎', hint: '全文检索' },
  { id: 'import', label: '导入', icon: '📥', hint: '导入 TXT / MD / DOCX / EPUB / PDF' },
  { id: 'export', label: '导出', icon: '📤', hint: '导出 TXT / Markdown / HTML / JSON' },
  { id: 'backup', label: '备份', icon: '💾', hint: '备份与恢复' },
  { id: 'breakdown', label: '拆书', icon: '📖', hint: '拆书工作台' },
  { id: 'pet', label: '宠物', icon: '🐾', hint: '桌面宠物' },
  { id: 'site-manage', label: '站点', icon: '🌐', hint: 'AI 站点登录态与缓存' },
  { id: 'agent', label: 'Agent', icon: '🤖', hint: '自选站点与提示词的写作 Agent' }
]

const TABS: Array<{ id: WorkbenchTab; label: string; icon: string; hint: string }> = [
  { id: 'draft', label: '草稿', icon: '📝', hint: '正文写作与章节管理' },
  { id: 'outline', label: '大纲', icon: '🗂', hint: '总纲 / 分卷 / 章纲' },
  { id: 'character', label: '角色', icon: '🧑', hint: '人物设定与关系' },
  { id: 'foreshadow', label: '伏笔', icon: '🎯', hint: '埋设与回收追踪' },
  { id: 'note', label: '便签', icon: '💡', hint: '灵感碎片速记' },
  { id: 'stat', label: '统计', icon: '📊', hint: '字数 / 趋势 / 可视化' }
]

/**
 * 左侧写作工作台。
 *
 * 布局：**竖向侧边导航栏 + 内容区**（作家助手一类的产品形态），
 * 替代早期的横向六标签。导航项仍是规范要求的六个模块，未新增模块，
 * 「灵感库」作为便签模块内的功能入口（overlay），不占用第 7 个导航位。
 *
 * 可折叠：折叠后仅保留 48px 图标栏。
 */
export function Workbench(): JSX.Element {
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setToolbarDialog = useUiStore((s) => s.setToolbarDialog)
  const [inspirationOpen, setInspirationOpen] = useState(false)

  const active = TABS.find((t) => t.id === activeTab)

  if (collapsed) {
    // 折叠态：仅图标竖条
    return (
      <nav className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r py-2 wa-panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            title={`${t.label} — ${t.hint}`}
            onClick={() => {
              setActiveTab(t.id)
              toggleSidebar()
            }}
            className={`flex h-10 w-10 items-center justify-center rounded-md text-lg transition-colors hover:bg-black/5 ${
              activeTab === t.id ? 'bg-black/10' : ''
            }`}
          >
            {t.icon}
          </button>
        ))}
        <div className="my-1 h-px w-6 bg-[var(--wa-border)]" />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            onClick={() => setToolbarDialog(t.id)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors hover:bg-black/5"
          >
            {t.icon}
          </button>
        ))}
      </nav>
    )
  }

  return (
    <section className="flex w-[360px] shrink-0 border-r wa-panel">
      {/* 竖向导航栏 */}
      <nav className="flex w-[132px] shrink-0 flex-col gap-0.5 overflow-hidden border-r py-2" style={{ borderColor: 'var(--wa-border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            aria-label={`${t.label} — ${t.hint}`}
            onClick={() => setActiveTab(t.id)}
            className={`group relative mx-1 flex items-center gap-2 rounded-[var(--wa-radius-md)] px-2 py-1.5 text-left wa-interactive ${
              activeTab === t.id
                ? 'bg-[var(--wa-accent)] text-white shadow-[var(--wa-shadow-sm)]'
                : 'wa-muted hover:bg-[color-mix(in_srgb,var(--wa-border)_30%,var(--wa-panel))] hover:text-[var(--wa-text)]'
            }`}
          >
            <span className="text-sm leading-none">{t.icon}</span>
            <span className="text-[12px] leading-tight">{t.label}</span>
            {/* 选中态左侧色条（aria-hidden） */}
            {activeTab === t.id && (
              <span aria-hidden className="absolute -left-1 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded bg-[var(--wa-accent-hover)]" />
            )}
          </button>
        ))}

        {/* 灵感库快捷入口 */}
        <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--wa-border)' }} />
        <button
          title="灵感库：多分类创意生成"
          aria-label="打开灵感库"
          onClick={() => setInspirationOpen(true)}
          className="mx-1 flex items-center gap-2 rounded-[var(--wa-radius-md)] px-2 py-1.5 text-left text-[var(--wa-warning)] wa-interactive hover:bg-[color-mix(in_srgb,var(--wa-warning)_12%,var(--wa-panel))]"
        >
          <span className="text-sm leading-none">✨</span>
          <span className="text-[12px] leading-tight">灵感库</span>
        </button>
        <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--wa-border)' }} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.hint}
              aria-label={t.hint}
              onClick={() => setToolbarDialog(t.id)}
              className="mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[var(--wa-radius-md)] px-2 py-1.5 text-left wa-muted hover:bg-[color-mix(in_srgb,var(--wa-border)_30%,var(--wa-panel))] hover:text-[var(--wa-text)] wa-interactive"
            >
              <span className="text-sm leading-none">{t.icon}</span>
              <span className="text-[12px] leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* 内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-1.5 border-b px-2.5 py-1.5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <span className="text-xs font-semibold">
            {active?.icon} {active?.label}
          </span>
          <div className="flex-1" />
          <button
            onClick={toggleSidebar}
            title="折叠侧栏"
            className="rounded px-1 text-[11px] wa-muted hover:bg-black/5"
          >
            «
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={activeTab} className="wa-tab-content h-full">
            <ErrorBoundary scope={`页签「${activeTab}」`}>
              <TabBody tab={activeTab} onOpenInspiration={() => setInspirationOpen(true)} />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {inspirationOpen && <InspirationPanel onClose={() => setInspirationOpen(false)} />}

      {/* ⚠️ 必须挂在这里：同步分析完成后要把计划交给用户勾选，
          此前 SyncConfirmDialog 只被定义、从未渲染，导致
          "分析完成"后结果被静默丢弃（实测 toasts 显示 0.0s 完成但没有清单）。 */}
      <SyncConfirmDialog />
    </section>
  )
}

function TabBody({
  tab,
  onOpenInspiration
}: {
  tab: WorkbenchTab
  onOpenInspiration: () => void
}): JSX.Element {
  switch (tab) {
    case 'draft':
      return <DraftTab />
    case 'outline':
      return <OutlineTab />
    case 'character':
      return <CharacterTab />
    case 'foreshadow':
      return <ForeshadowTab />
    case 'note':
      return <NoteTab onOpenInspiration={onOpenInspiration} />
    case 'stat':
      return <StatTab />
    default:
      return <div className="p-4 text-xs wa-muted">未知标签页</div>
  }
}
