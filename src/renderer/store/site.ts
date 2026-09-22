import { create } from 'zustand'

/**
 * 单个 AI 站点的运行时状态。
 *
 * 设计目标：
 *  - 区分「未登录」「风控中」「在线」「离线」「未知」五种状态；
 *  - 让 UI 显式表达（badge / 状态点 / toast），避免「我点了为什么没反应」的体感；
 *  - 让后台任务（bg.start）能感知风控，主动降级到下一个站点。
 *
 * ⚠️ 关键：**只在页面加载完 + 检测脚本完成后**才更新状态。
 * 加载中（ready=false）保留上一份状态，避免「未登录」红色 badge 闪烁。
 */
export type SiteStatus =
  | { kind: 'loading' }
  | { kind: 'logged-out' }
  | { kind: 'risk'; reason?: string }
  | { kind: 'online' }
  | { kind: 'offline'; reason?: string }
  | { kind: 'unknown' }

export interface SiteState {
  status: SiteStatus
  /** 最近一次更新时间（ms） */
  updatedAt: number
  /** 检测到的 URL（用于诊断） */
  url?: string
}

interface SiteStore {
  sites: Record<string, SiteState>
  /** 当状态从「在线」跳到「风控/未登录」时记录原因，供 toast 使用 */
  lastReason: { siteId: string; status: SiteStatus; at: number } | null
  set: (siteId: string, state: SiteState) => void
  reset: (siteId: string) => void
  clearLastReason: () => void
}

export const useSiteStore = create<SiteStore>((set) => ({
  sites: {},
  lastReason: null,
  set: (siteId, state) =>
    set((s) => {
      const prev = s.sites[siteId]
      const next = { ...s.sites, [siteId]: state }
      // 检测「在线 → 非在线」跃迁，用于触发 toast
      let lastReason = s.lastReason
      if (
        prev &&
        prev.status.kind === 'online' &&
        state.status.kind !== 'online' &&
        state.status.kind !== 'loading'
      ) {
        lastReason = { siteId, status: state.status, at: Date.now() }
      }
      return { sites: next, lastReason }
    }),
  reset: (siteId) =>
    set((s) => ({
      sites: { ...s.sites, [siteId]: { status: { kind: 'loading' }, updatedAt: Date.now() } }
    })),
  clearLastReason: () => set({ lastReason: null })
}))

/** 风险/未登录 URL 模式（与适配器 common.ts 的 buildLoginScript 同步） */
export const RISK_URL_PATTERNS = [
  /[/?#]risk[_\-]?(control|verify|check)/i,
  /[/?#]challenge/i,
  /[/?#]captcha/i,
  /[/?#]verify[_\-]?human/i,
  /[/?#]forbidden/i,
  /[/?#]banned/i
]

/** 判定 URL 是否命中风控 */
export function isRiskUrl(url: string): boolean {
  return RISK_URL_PATTERNS.some((re) => re.test(url))
}

/** 站点状态点颜色（用于 badge / dot） */
export function statusColor(s: SiteStatus): string {
  switch (s.kind) {
    case 'online':
      return 'bg-emerald-500'
    case 'logged-out':
      return 'bg-amber-500'
    case 'risk':
      return 'bg-rose-500'
    case 'offline':
      return 'bg-zinc-400'
    case 'loading':
      return 'bg-blue-400 animate-pulse'
    default:
      return 'bg-zinc-300'
  }
}

/** 站点状态中文描述 */
export function statusLabel(s: SiteStatus): string {
  switch (s.kind) {
    case 'online':
      return '在线'
    case 'logged-out':
      return '未登录'
    case 'risk':
      return '风控'
    case 'offline':
      return '离线'
    case 'loading':
      return '加载中'
    default:
      return '未知'
  }
}