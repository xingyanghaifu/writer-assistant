import { create } from 'zustand'
import type { AppSettings, ThemeMode } from '@shared/settings'
import type { SuggestionBatch } from '@shared/suggestion'

/** 左侧工作台标签页 */
export type WorkbenchTab = 'draft' | 'outline' | 'character' | 'foreshadow' | 'note' | 'stat'
export type HomeView = 'library' | 'prompts' | 'write'

/**
 * 站点选项类型。
 *
 * 站点清单的**唯一来源**是 adapters/registry.ts 的 listSiteMeta()；
 * 这里不再维护第二份列表，避免注册表与 UI 漂移。
 */
export interface SiteOption {
  id: string
  name: string
  url: string
  /** 是否已实现适配器 */
  available: boolean
}

/** UI 状态（阶段 1 + 后续各阶段共享） */
interface UiState {
  /** 左侧工作台是否折叠 */
  sidebarCollapsed: boolean
  /** 顶层页面：作品库主页 / 提示词库 / 写作台 */
  homeView: HomeView
  /** 专注模式 */
  focusMode: boolean
  /** 当前标签页 */
  activeTab: WorkbenchTab
  /** 当前站点 */
  siteId: string
  /** 请求状态 */
  requestStatus: 'idle' | 'running' | 'failed'
  /** 主题 */
  theme: ThemeMode
  /** 设置 */
  settings: AppSettings | null
  /** 建议批次（阶段 4.5 保留最近 5 个） */
  batches: SuggestionBatch[]
  /** 卡片面板是否打开 */
  cardPanelOpen: boolean
  /** toast 消息 */
  toast: { id: number; text: string; kind: 'info' | 'error' | 'success' } | null
  /** 顶栏弹窗（让其它组件也可触发：例如气泡菜单点「设置→提示词」直接打开） */
  toolbarDialog:
    | null
    | 'library'
    | 'search'
    | 'import'
    | 'export'
    | 'backup'
    | 'settings'
    | 'site-manage'
    | 'pet'
    | 'breakdown'
    | 'agent'
  /** 进入设置后想直达某个 tab */
  toolbarSettingsTab?: 'editor' | 'prompts' | 'advanced' | 'data' | 'diagnose' | 'about'

  setHomeView: (v: HomeView) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setFocusMode: (v: boolean) => void
  setActiveTab: (t: WorkbenchTab) => void
  setSiteId: (id: string) => void
  setRequestStatus: (s: 'idle' | 'running' | 'failed') => void
  setTheme: (t: ThemeMode) => void
  setSettings: (s: AppSettings) => void
  pushBatch: (b: SuggestionBatch) => void
  clearBatches: () => void
  toggleBatchCollapsed: (id: string) => void
  removeBatch: (id: string) => void
  setCardPanelOpen: (v: boolean) => void
  showToast: (text: string, kind?: 'info' | 'error' | 'success') => void
  clearToast: () => void
  setToolbarDialog: (
    d: UiState['toolbarDialog'],
    settingsTab?: UiState['toolbarSettingsTab']
  ) => void
}

/** 建议批次最多保留数量（阶段 4.5） */
export const MAX_BATCHES = 5

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  homeView: 'library',
  focusMode: false,
  activeTab: 'draft',
  siteId: 'deepseek',
  requestStatus: 'idle',
  theme: 'light',
  settings: null,
  batches: [],
  cardPanelOpen: false,
  toast: null,
  toolbarDialog: null,
  toolbarSettingsTab: undefined,

  setHomeView: (v) => set({ homeView: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setFocusMode: (v) => set({ focusMode: v, sidebarCollapsed: v ? true : false }),
  setActiveTab: (t) => set({ activeTab: t }),
  setSiteId: (id) => set({ siteId: id }),
  setRequestStatus: (s) => set({ requestStatus: s }),
  setTheme: (t) => set({ theme: t }),
  setSettings: (s) => set({ settings: s, theme: s.theme }),

  pushBatch: (b) =>
    set((s) => {
      const next = [b, ...s.batches]
      // 保留最近 MAX_BATCHES 个批次
      return { batches: next.slice(0, MAX_BATCHES), cardPanelOpen: true }
    }),
  clearBatches: () => set({ batches: [], cardPanelOpen: false }),
  toggleBatchCollapsed: (id) =>
    set((s) => ({
      batches: s.batches.map((b) => (b.id === id ? { ...b, collapsed: !b.collapsed } : b))
    })),
  removeBatch: (id) => set((s) => ({ batches: s.batches.filter((b) => b.id !== id) })),
  setCardPanelOpen: (v) => set({ cardPanelOpen: v }),

  showToast: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),
  clearToast: () => set({ toast: null }),
  setToolbarDialog: (d, tab) => set({ toolbarDialog: d, toolbarSettingsTab: tab })
}))
