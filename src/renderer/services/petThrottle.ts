/**
 * 编辑器节流（v3 P0-3.1）。
 *
 * 不阻塞主输入；用 setTimeout 把评估推到下一个 tick；
 * 在 requestIdleCallback 可用时优先使用，否则退到 setTimeout。
 */

/** 在空闲时执行；如无 requestIdleCallback 退到 setTimeout(fn, 0) */
export function runWhenIdle(cb: () => void, timeout = 500): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => cb(), { timeout })
    return
  }
  setTimeout(cb, 0)
}

/**
 * 节流器：满足条件（停顿 ≥ idleMs 且新增 ≥ minChars）才触发评估。
 * 同时保证两次评估间隔 ≥ cooldownMs（防刷屏）。
 */
export class CharThrottle {
  private lastEvalAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastText = ''
  private lastSnapshot = ''

  constructor(
    private readonly idleMs: number,
    private readonly minChars: number,
    private readonly cooldownMs: number
  ) {}

  /**
   * 输入：当前全文；输出：是否应当触发评估。
   * 调用方应负责在 setState / idle 中跑规则评估，不在 throttle 内执行重活。
   */
  feed(text: string): boolean {
    if (this.timer) clearTimeout(this.timer)
    if (text === this.lastText) return false
    const snapshot = text.length > 500 ? text.slice(-500) : text
    const snapshotChanged = snapshot !== this.lastSnapshot
    this.lastText = text
    if (!snapshotChanged) return false
    const now = Date.now()
    if (now - this.lastEvalAt < this.cooldownMs) return false
    // 启动一个新的去抖；停 idleMs 后再次确认（值小于当前末尾字符数）
    this.timer = setTimeout(() => {
      const cur = this.lastText
      if (cur.length - this.lastSnapshot.length >= this.minChars || this.lastSnapshot.length === 0) {
        this.lastSnapshot = cur.length > 500 ? cur.slice(-500) : cur
        this.lastEvalAt = Date.now()
        this.onTrigger?.(this.lastSnapshot, cur)
      }
    }, this.idleMs)
    return false
  }

  /** 外部订阅：触发时调 */
  onTrigger: ((snapshot: string, full: string) => void) | null = null

  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lastEvalAt = 0
    this.lastText = ''
    this.lastSnapshot = ''
  }
}