import { getAdapter } from '../adapters/registry'
import { useSiteStore, isRiskUrl, type SiteState } from '../store/site'

/**
 * 在 AI 调用前后或失败后重新检测登录态。
 *
 * 流程：
 *  1. 在主 webview 中执行登录态检测脚本
 *  2. 同时读 URL 判定风控
 *  3. 把结果写回 site store
 *  4. 返回当前站点状态（方便调用方做降级/提示）
 */
export async function refreshSiteStatus(siteId: string): Promise<SiteState | null> {
  const set = useSiteStore.getState().set
  try {
    const adapter = getAdapter(siteId)
    if (!adapter) {
      set(siteId, { status: { kind: 'unknown' }, updatedAt: Date.now() })
      return useSiteStore.getState().sites[siteId] ?? null
    }
    const status = await window.api.webview.loginState('main')
    const urlRes = await window.api.webview.execute('main', 'location.href')
    const url = urlRes.ok ? String(urlRes.value ?? '') : ''
    if (url && isRiskUrl(url)) {
      set(siteId, { status: { kind: 'risk', reason: '风控页面' }, updatedAt: Date.now(), url })
    } else if (status === 'logged-in') {
      set(siteId, { status: { kind: 'online' }, updatedAt: Date.now(), url })
    } else if (status === 'logged-out') {
      set(siteId, { status: { kind: 'logged-out' }, updatedAt: Date.now(), url })
    } else {
      set(siteId, { status: { kind: 'unknown' }, updatedAt: Date.now(), url })
    }
    return useSiteStore.getState().sites[siteId] ?? null
  } catch {
    return null
  }
}

/**
 * 在 AI 调用失败后调用，根据错误信息给出更可操作的提示。
 *
 * 错误关键词 → 中文提示 + 引导动作（去登录 / 切站点 / 重新加载）
 */
export function interpretAiError(err: string): {
  toast: string
  hint?: string
  suggest?: 'login' | 'switch-site' | 'reload'
} {
  const e = err.toLowerCase()
  if (e.includes('未登录') || e.includes('login') || e.includes('not signed in')) {
    return {
      toast: 'AI 调用失败：站点未登录',
      hint: '请到右侧 AI 网页完成登录后重试',
      suggest: 'login'
    }
  }
  if (e.includes('风控') || e.includes('risk') || e.includes('captcha') || e.includes('verif')) {
    return {
      toast: 'AI 调用失败：站点触发风控',
      hint: '请到右侧完成验证，或切换到其它站点',
      suggest: 'switch-site'
    }
  }
  if (e.includes('network') || e.includes('timeout') || e.includes('超时') || e.includes('enotfound')) {
    return {
      toast: 'AI 调用失败：网络问题',
      hint: '请检查网络连接',
      suggest: 'reload'
    }
  }
  if (e.includes('输入框') || e.includes('发送按钮') || e.includes('改版')) {
    return {
      toast: 'AI 调用失败：站点结构可能已改版',
      hint: '已记录到日志。可切换站点继续使用',
      suggest: 'switch-site'
    }
  }
  return { toast: `AI 调用失败：${err}` }
}