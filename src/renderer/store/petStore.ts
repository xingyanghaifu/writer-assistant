/**
 * 宠物本地状态（v3 P0-3.1）。
 *
 * 不持久化（灵感只是临时气泡）；窗口由主进程控制开关；
 * 这里存的是渲染层需要的本地视图。
 */
import { create } from 'zustand'
import type { InspirationItem, PetSettings } from '@shared/pet'

interface PetState {
  /** 最近 5 条灵感（用于 UI 显示） */
  recent: InspirationItem[]
  /** 当前气泡显示的灵感 */
  bubble: InspirationItem | null
  /** 宠物规则开关覆盖（key=ruleId, value=boolean） */
  ruleOverrides: Record<string, boolean>
  /** 缓存的设置快照（用于 hook 快速读） */
  settings: PetSettings | null
  pushRecent: (item: InspirationItem) => void
  setBubble: (item: InspirationItem | null) => void
  setRuleOverride: (id: string, on: boolean) => void
  setSettings: (s: PetSettings) => void
  clear: () => void
}

export const usePetStore = create<PetState>((set) => ({
  recent: [],
  bubble: null,
  ruleOverrides: {},
  settings: null,
  pushRecent: (item) =>
    set((s) => ({
      recent: [item, ...s.recent].slice(0, 5),
      bubble: item
    })),
  setBubble: (item) => set({ bubble: item }),
  setRuleOverride: (id, on) =>
    set((s) => ({ ruleOverrides: { ...s.ruleOverrides, [id]: on } })),
  setSettings: (s) => set({ settings: s }),
  clear: () => set({ recent: [], bubble: null })
}))