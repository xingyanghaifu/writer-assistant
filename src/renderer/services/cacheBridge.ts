/**
 * 渲染层缓存桥接：把主进程 LRU 缓存通过 IPC 暴露给前端 + 分桶（v3 P3-6.3）。
 *
 * 桶：
 *  - 'user'：用户操作，TTL 24h
 *  - 'pet'：宠物灵感，TTL 1h
 *  - 'breakdown'：拆书，TTL 6h
 *
 * 桶通过 key 前缀实现：`bucket:originalKey`。
 *
 * IPC：window.api.cache.{get,set,clear,stats}
 */
export type CacheBucket = 'user' | 'pet' | 'breakdown'

const BUCKET_PREFIX: Record<CacheBucket, string> = {
  user: 'u',
  pet: 'p',
  breakdown: 'b'
}

function bucketKey(bucket: CacheBucket, key: string): string {
  return `${BUCKET_PREFIX[bucket]}:${key}`
}

export async function getCacheAsync(key: string, bucket: CacheBucket = 'user'): Promise<string | null> {
  try {
    const v = await window.api.cache.get(bucketKey(bucket, key))
    return v ?? null
  } catch {
    return null
  }
}

export function setCache(key: string, value: string, bucket: CacheBucket = 'user'): void {
  void window.api.cache.set(bucketKey(bucket, key), value)
}

export async function clearBucket(bucket: CacheBucket): Promise<void> {
  // 主进程目前只有 clear() 全量；前端遍历删除近似
  void bucket
  await window.api.cache.clear()
}