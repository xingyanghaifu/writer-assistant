import { useEffect } from 'react'
import { useSiteStore, statusColor, statusLabel, type SiteStatus } from '../store/site'
import { useUiStore } from '../store/ui'
import { listSiteMeta } from '../adapters/registry'

/**
 * 站点状态徽章（紧凑 badge + 状态点 + tooltip）。
 *
 * 当状态不是「online」时高亮；hover 后展示原因 + 切换建议。
 *
 * v3 P2-6.2：迁移到 CSS 变量（去 hardcoded color），保留现有 5 状态语义。
 */
export function SiteStatusBadge(): JSX.Element {
  const siteId = useUiStore((s) => s.siteId)
  const site = useSiteStore((s) => s.sites[siteId])
  const meta = listSiteMeta().find((s) => s.id === siteId)
  const name = meta?.name ?? siteId
  const status: SiteStatus = site?.status ?? { kind: 'loading' }

  // 颜色映射用 CSS 变量 + color-mix，避免硬编码
  const klass =
    status.kind === 'online'
      ? 'bg-[color-mix(in_srgb,var(--wa-success)_14%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-success)_85%,black)] border-[color-mix(in_srgb,var(--wa-success)_30%,transparent)]'
      : status.kind === 'logged-out'
        ? 'bg-[color-mix(in_srgb,var(--wa-warning)_14%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-warning)_85%,black)] border-[color-mix(in_srgb,var(--wa-warning)_30%,transparent)]'
        : status.kind === 'risk'
          ? 'bg-[color-mix(in_srgb,var(--wa-danger)_14%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-danger)_85%,black)] border-[color-mix(in_srgb,var(--wa-danger)_30%,transparent)]'
          : status.kind === 'offline'
            ? 'bg-[color-mix(in_srgb,var(--wa-muted)_18%,var(--wa-panel))] text-[var(--wa-text)] border-[color-mix(in_srgb,var(--wa-muted)_40%,transparent)]'
            : 'bg-[color-mix(in_srgb,var(--wa-accent)_14%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-accent)_85%,black)] border-[color-mix(in_srgb,var(--wa-accent)_30%,transparent)]'

  return (
    <div
      title={tooltipFor(status, name)}
      aria-label={tooltipFor(status, name)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-[var(--wa-radius-full)] border px-2 py-0.5 text-[10px] wa-interactive ${klass}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(status)} ${
          status.kind === 'online' ? 'wa-pulse' : ''
        }`}
      />
      <span>{name}</span>
      <span className="opacity-70">· {statusLabel(status)}</span>
    </div>
  )
}

function tooltipFor(s: SiteStatus, name: string): string {
  switch (s.kind) {
    case 'online':
      return `${name} 在线：AI 调用就绪`
    case 'logged-out':
      return `${name} 未登录：到右侧 AI 网页完成登录`
    case 'risk':
      return `${name} 触发风控（${s.reason ?? '未知'}）：完成验证或切换站点`
    case 'offline':
      return `${name} 离线（${s.reason ?? '未知'}）：检查网络`
    case 'loading':
      return `正在加载 ${name} …`
    default:
      return `${name} 状态未知`
  }
}

/**
 * 全局监听：站点从 online 变为非 online 时自动 toast。
 * 组件挂载即订阅，卸载取消。
 */
export function SiteStatusWatcher(): null {
  const lastReason = useSiteStore((s) => s.lastReason)
  const clearLastReason = useSiteStore((s) => s.clearLastReason)
  const showToast = useUiStore((s) => s.showToast)
  const setSiteId = useUiStore((s) => s.setSiteId)

  useEffect(() => {
    if (!lastReason) return
    const meta = listSiteMeta().find((m) => m.id === lastReason.siteId)
    const name = meta?.name ?? lastReason.siteId
    const s = lastReason.status
    if (s.kind === 'logged-out') {
      showToast(`「${name}」已退出登录，请到右侧 AI 网页重新登录`, 'error')
    } else if (s.kind === 'risk') {
      showToast(`「${name}」触发风控（${s.reason ?? '未知'}），已暂停 AI 调用。可在顶栏切换站点`, 'error')
      // 提示自动切换到下一个可用站点
      const next = pickNextSite(lastReason.siteId)
      if (next) {
        setTimeout(() => {
          showToast(`已自动切换到「${next.name}」`, 'info')
          setSiteId(next.id)
        }, 300)
      }
    } else if (s.kind === 'offline') {
      showToast(`「${name}」离线（${s.reason ?? '未知'}）`, 'error')
    }
    clearLastReason()
  }, [lastReason, clearLastReason, showToast, setSiteId])

  return null
}

function pickNextSite(currentId: string): { id: string; name: string } | null {
  const all = listSiteMeta()
  const others = all.filter((s) => s.id !== currentId && s.available)
  return others.length > 0 ? { id: others[0].id, name: others[0].name } : null
}