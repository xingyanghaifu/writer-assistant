/**
 * 适配器注册表（阶段 2 + 阶段 10 四站点）。
 *
 * ⚠️ 新增站点只改本文件与对应的 adapter 文件，其他代码不受影响。
 * 站点改版时只需更新对应 adapter 中的选择器常量。
 */
import type { SiteAdapter, AdapterRegistry } from '@shared/adapter'
import { deepseekAdapter } from './deepseek'
import { chatgptAdapter } from './chatgpt'
import { claudeAdapter } from './claude'
import { geminiAdapter } from './gemini'

/** 已实现的适配器 */
const adapters: SiteAdapter[] = [deepseekAdapter, chatgptAdapter, claudeAdapter, geminiAdapter]

export const registry: AdapterRegistry = {
  list: () => adapters,
  get: (id: string) => adapters.find((a) => a.id === id),
  getByUrl: (url: string) => adapters.find((a) => a.matchPatterns.some((p) => url.includes(p)))
}

export function getAdapter(id: string): SiteAdapter | undefined {
  return registry.get(id)
}

export function listAdapters(): SiteAdapter[] {
  return registry.list()
}

/** 注册新适配器（覆盖同 id） */
export function registerAdapter(a: SiteAdapter): void {
  const i = adapters.findIndex((x) => x.id === a.id)
  if (i >= 0) adapters[i] = a
  else adapters.push(a)
}

/** 站点元数据（顶部下拉用） */
export interface SiteMeta {
  id: string
  name: string
  url: string
  available: boolean
}

/** 全部站点：available 由是否注册了适配器决定 */
export function listSiteMeta(): SiteMeta[] {
  const all = [
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com' },
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com' },
    { id: 'claude', name: 'Claude', url: 'https://claude.ai' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com' }
  ]
  return all.map((s) => ({ ...s, available: adapters.some((a) => a.id === s.id) }))
}

/** 站点 URL（主/后台 webview 共用） */
export function siteUrl(id: string): string {
  return getAdapter(id)?.url ?? listSiteMeta().find((s) => s.id === id)?.url ?? 'https://chat.deepseek.com'
}

export { deepseekAdapter, chatgptAdapter, claudeAdapter, geminiAdapter }
