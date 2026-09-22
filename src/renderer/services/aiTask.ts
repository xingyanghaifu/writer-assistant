/**
 * 统一 AI 任务抽象层（v3 P2-5.1，渲染层）。
 *
 * 设计：
 *  - 在渲染层组织任务优先级（user > pet > breakdown）
 *  - 同优先级 FIFO
 *  - 串行：等当前完成才派下一个；user 可抢占 pet/breakdown
 *  - 复用 window.api.bg.start 的现有缓存 / 风控 / 降级
 *  - pet 任务允许超时丢弃（用户已经停止编辑）
 *
 * 与 P2-5.2 事件总线配合：通过 'ai:task-progress' 通道广播。
 */

export type AITaskPriority = 'user' | 'pet' | 'breakdown'

export interface AITaskInput {
  id?: string
  prompt: string
  siteId?: string
  /** 任务类型（沿用 TaskType 字符串） */
  task: string
  /** 缓存 key（沿用 hashKey） */
  cacheKey: string
  priority: AITaskPriority
  /** 过期 ms；超过则丢弃（仅 pet 生效） */
  ttlMs?: number
}

export interface AITaskResult {
  text: string
  fromCache: boolean
  siteId: string
}

interface QueueItem {
  input: AITaskInput
  enqueuedAt: number
  resolve: (r: AITaskResult | null) => void
  reject: (e: Error) => void
}

const queues: Record<AITaskPriority, QueueItem[]> = {
  user: [],
  pet: [],
  breakdown: []
}

let running: { item: QueueItem; startedAt: number } | null = null
let stopped = false

function priorityWeight(p: AITaskPriority): number {
  return p === 'user' ? 0 : p === 'pet' ? 2 : 1
}

async function runOne(item: QueueItem): Promise<void> {
  // 过期判断（pet）
  if (item.input.priority === 'pet' && item.input.ttlMs) {
    if (Date.now() - item.enqueuedAt > item.input.ttlMs) {
      item.resolve(null)
      return
    }
  }
  const siteId = item.input.siteId ?? 'deepseek'
  // 复用 cache
  const cached = await window.api.cache.get(item.input.cacheKey)
  if (cached) {
    item.resolve({ text: cached, fromCache: true, siteId })
    return
  }
  // 走 bg.start（已带风控 / 降级 / 串行）
  // 注意：bg.start 内部会调 background.ts；如果 background 正在跑 user 任务则排队
  try {
    const r = await window.api.bg.start({
      task: item.input.task as never,
      prompt: item.input.prompt,
      siteId,
      skipCache: false,
      scripts: undefined as never
    }).catch(() => null)
    if (!r || !r.ok) {
      item.resolve(null)
      return
    }
    const text = r.data.text
    await window.api.cache.set(item.input.cacheKey, text)
    item.resolve({ text, fromCache: false, siteId })
  } catch (e) {
    item.reject(e as Error)
  }
}

async function pump(): Promise<void> {
  if (running) return
  // 取队首：按优先级排序
  const all: QueueItem[] = [...queues.user, ...queues.breakdown, ...queues.pet]
  if (all.length === 0) return
  // 取优先级最高（最小 weight）的第一个
  all.sort((a, b) => priorityWeight(a.input.priority) - priorityWeight(b.input.priority))
  const next = all[0]
  // 移除
  for (const k of Object.keys(queues) as AITaskPriority[]) {
    queues[k] = queues[k].filter((x) => x !== next)
  }
  running = { item: next, startedAt: Date.now() }
  await runOne(next)
  running = null
  if (!stopped) void pump()
}

export function enqueueAITask(input: AITaskInput): Promise<AITaskResult | null> {
  return new Promise<AITaskResult | null>((resolve, reject) => {
    queues[input.priority].push({ input, enqueuedAt: Date.now(), resolve, reject })
    void pump()
  })
}

export function cancelAITask(id: string): boolean {
  for (const k of Object.keys(queues) as AITaskPriority[]) {
    const idx = queues[k].findIndex((x) => x.input.id === id)
    if (idx >= 0) {
      const item = queues[k][idx]
      item.resolve(null)
      queues[k].splice(idx, 1)
      return true
    }
  }
  return false
}

export function getAIQueue(): { priority: AITaskPriority; id: string | undefined; enqueuedAt: number }[] {
  const all: { priority: AITaskPriority; id: string | undefined; enqueuedAt: number }[] = []
  for (const k of Object.keys(queues) as AITaskPriority[]) {
    for (const q of queues[k]) {
      all.push({ priority: q.input.priority, id: q.input.id, enqueuedAt: q.enqueuedAt })
    }
  }
  return all
}

/** 停止（测试用） */
export function stopAIQueue(): void {
  stopped = true
}
export function startAIQueue(): void {
  stopped = false
  void pump()
}