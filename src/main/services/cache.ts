/**
 * AI 回复缓存（阶段 12.5）。
 *
 * key = 草稿 hash + 站点 + 任务类型；24 小时有效；上限 500 条。
 * 手动"重新生成"时跳过缓存（skipCache=true）。
 */
import { createHash } from 'node:crypto'
import type { CacheEntry } from '@shared/suggestion'
import { appStore } from '../store'

/** 缓存有效期 24 小时 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** 缓存条数上限 */
export const CACHE_MAX = 500

export function hashKey(parts: Array<string | number | undefined>): string {
  const h = createHash('sha256')
  h.update(parts.map((p) => String(p ?? '')).join('\u0001'))
  return h.digest('hex').slice(0, 32)
}

/** 生成缓存 key：草稿 hash + 站点 + 任务类型（+ 附加因子） */
export function buildCacheKey(draft: string, siteId: string, task: string, extra?: string): string {
  return hashKey([draft, siteId, task, extra])
}

function isFresh(e: CacheEntry): boolean {
  return Date.now() - e.createdAt < CACHE_TTL_MS
}

/**
 * 读取缓存。过期条目视为未命中并顺手清理（不返回过期结果）。
 */
export function getCache(key: string): string | null {
  const list = appStore.getCache()
  const hit = list.find((e) => e.key === key)
  if (!hit) return null
  if (!isFresh(hit)) {
    appStore.setCache(list.filter((e) => e.key !== key))
    return null
  }
  hit.hits += 1
  appStore.setCache(list)
  return hit.value
}

/** 写入缓存（带上限与过期清理） */
export function setCache(key: string, value: string): void {
  const now = Date.now()
  let list = appStore.getCache().filter((e) => now - e.createdAt < CACHE_TTL_MS && e.key !== key)
  list.unshift({ key, value, createdAt: now, hits: 0 })
  if (list.length > CACHE_MAX) {
    // 优先淘汰命中次数少、且更旧的
    list.sort((a, b) => b.hits - a.hits || b.createdAt - a.createdAt)
    list = list.slice(0, CACHE_MAX)
  }
  appStore.setCache(list)
}

export function clearCache(): void {
  appStore.setCache([])
}

export function cacheStats(): { count: number; hits: number } {
  const list = appStore.getCache().filter(isFresh)
  return { count: list.length, hits: list.reduce((s, e) => s + e.hits, 0) }
}
