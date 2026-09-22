import { create } from 'zustand'
import type { EditorSettings, ThemeMode } from '@shared/settings'

/**
 * 编辑器状态（阶段 9 / 9.5）。
 * 排版设置与主题；持久化到 settings（由 settings.set 落库）。
 */
interface EditorState {
  /**
   * 中间区域视图（阶段 9 三栏 + 侧边栏模式）：
   * - 'ai'    仅 AI 网页（全宽）
   * - 'write' 仅写作页（全宽）
   * - 'split' 写作页 + 右侧 AI 侧边栏（推荐：边写边看 AI）
   */
  centerView: 'ai' | 'write' | 'split'
  /** 侧边栏模式下 AI 面板的宽度 */
  aiSidebarWidth: number
  /** 侧边栏是否收起（收起后只留一条把手） */
  aiSidebarCollapsed: boolean
  /**
   * 注意：专注模式（focusMode）的唯一来源是 ui store（useUiStore），
   * 因为它同时需要收起左侧工作台，避免两处状态不同步。
   */
  /** 三栏中的右辅助面板是否显示 */
  auxPanelOpen: boolean
  /** 左栏章节树是否显示 */
  chapterTreeOpen: boolean
  /** 右侧辅助面板宽度 */
  auxPanelWidth: number
  /** 查找替换面板 */
  findOpen: boolean
  findQuery: string
  replaceQuery: string
  /** 选中文字气泡菜单（阶段 9.5） */
  bubble: { visible: boolean; x: number; y: number; text: string; from: number; to: number } | null
  /** 实时打字速度（字/分钟） */
  typingSpeed: number
  /** 本次写作开始时间 */
  sessionStart: number
  /** 各章节标题搜索索引就绪 */
  perfReady: boolean

  setCenterView: (v: 'ai' | 'write' | 'split') => void
  setAiSidebarWidth: (w: number) => void
  toggleAiSidebar: () => void
  toggleAuxPanel: () => void
  toggleChapterTree: () => void
  setFindOpen: (v: boolean) => void
  setFindQuery: (v: string) => void
  setReplaceQuery: (v: string) => void
  showBubble: (b: { x: number; y: number; text: string; from: number; to: number }) => void
  hideBubble: () => void
  setTypingSpeed: (v: number) => void
  setPerfReady: (v: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  centerView: 'write',
  aiSidebarWidth: 460,
  aiSidebarCollapsed: false,
  auxPanelOpen: true,
  chapterTreeOpen: true,
  auxPanelWidth: 320,
  findOpen: false,
  findQuery: '',
  replaceQuery: '',
  bubble: null,
  typingSpeed: 0,
  sessionStart: Date.now(),
  perfReady: false,

  setCenterView: (v) => set({ centerView: v }),
  setAiSidebarWidth: (w) => set({ aiSidebarWidth: Math.min(900, Math.max(320, w)) }),
  toggleAiSidebar: () => set((s) => ({ aiSidebarCollapsed: !s.aiSidebarCollapsed })),
  toggleAuxPanel: () => set((s) => ({ auxPanelOpen: !s.auxPanelOpen })),
  toggleChapterTree: () => set((s) => ({ chapterTreeOpen: !s.chapterTreeOpen })),
  setFindOpen: (v) => set({ findOpen: v }),
  setFindQuery: (v) => set({ findQuery: v }),
  setReplaceQuery: (v) => set({ replaceQuery: v }),
  showBubble: (b) => set({ bubble: { ...b, visible: true } }),
  hideBubble: () => set({ bubble: null }),
  setTypingSpeed: (v) => set({ typingSpeed: v }),
  setPerfReady: (v) => set({ perfReady: v })
}))

/** 主题 -> 根元素 class + data-theme（阶段 9 + v3 P2-6.1） */
export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-parchment')
  let effective = theme
  if (theme === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  if (effective === 'dark') root.classList.add('theme-dark')
  if (effective === 'parchment') root.classList.add('theme-parchment')
  // v3 P2-6.1：同时写 data-theme，使新 token 体系生效（兼容旧 class 检测）
  root.setAttribute('data-theme', effective)
}

/** 字体族映射（阶段 9：中文宋体/楷体，英文 Lora） */
export function fontStack(family: EditorSettings['fontFamily']): string {
  switch (family) {
    case 'kai':
      return '"KaiTi", "Kaiti SC", "STKaiti", "Noto Serif SC", serif'
    case 'lora':
      return '"Lora", Georgia, "Times New Roman", serif'
    case 'song':
    default:
      return '"SimSun", "Songti SC", "Noto Serif SC", serif'
  }
}
