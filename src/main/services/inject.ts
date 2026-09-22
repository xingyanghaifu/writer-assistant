/**
 * webview 脚本注入服务（阶段 2）。
 *
 * 主进程只负责"在某个 webContents 上执行脚本"，
 * 不理解任何站点细节 —— 脚本由渲染进程的 adapters 生成并下发。
 * 这样站点改版只需改 renderer/adapters/*.ts。
 */
import { webContents, type WebContents } from 'electron'
import type { ScriptResult } from '@shared/adapter'

/** 已注册的 webview webContents，按用途区分 */
export const webviewRegistry = new Map<'main' | 'background', number>()

export function registerWebview(id: number, kind: 'main' | 'background'): void {
  webviewRegistry.set(kind, id)
}

export function unregisterWebview(kind: 'main' | 'background'): void {
  webviewRegistry.delete(kind)
}

export function getWebContents(kind: 'main' | 'background'): WebContents | null {
  const id = webviewRegistry.get(kind)
  if (typeof id !== 'number') return null
  const wc = webContents.fromId(id)
  // 已销毁的 webContents 视为不存在
  if (!wc || wc.isDestroyed()) return null
  return wc
}

/**
 * 执行脚本并返回结果。
 * 容错：webview 未注册/已销毁/脚本抛异常都返回 { ok:false }，不抛给调用方。
 */
export async function executeScript<T = unknown>(kind: 'main' | 'background', script: string): Promise<ScriptResult<T>> {
  const wc = getWebContents(kind)
  if (!wc) return { ok: false, error: 'webview-not-ready' }
  try {
    const value = (await wc.executeJavaScript(script, true)) as T
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 执行脚本并忽略结果（用于写入/点击等副作用） */
export async function executeVoid(kind: 'main' | 'background', script: string): Promise<void> {
  await executeScript(kind, script)
}

/** 读取登录态 */
export async function detectLoginState(kind: 'main' | 'background', script: string): Promise<'logged-in' | 'logged-out' | 'unknown'> {
  const r = await executeScript<string>(kind, script)
  if (!r.ok) return 'unknown'
  const v = r.value
  if (v === 'logged-in' || v === 'logged-out' || v === 'unknown') return v
  return 'unknown'
}

/** 等待 webview 就绪（用于请求前确保页面可用） */
export async function waitForWebview(kind: 'main' | 'background', timeoutMs = 10000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const wc = getWebContents(kind)
    if (wc && !wc.isLoading()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return getWebContents(kind) !== null
}
