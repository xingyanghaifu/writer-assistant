/**
 * 事件总线（v3 P2-5.2，渲染层）。
 *
 * 替代部分 IPC 广播：渲染层订阅一次 `app:event`，主进程推各类事件。
 * 当前阶段：先在渲染层内部使用，统一事件通道（pet / breakdown / ai-task）。
 */
export type AppEvent =
  | { type: 'site-status'; payload: { siteId: string; status: unknown } }
  | { type: 'pet-inspiration'; payload: unknown }
  | { type: 'breakdown-progress'; payload: unknown }
  | { type: 'ai-task-progress'; payload: { id?: string; priority: string; status: string } }
  | { type: 'cache-stats'; payload: { count: number; hits: number } }

type Listener = (e: AppEvent) => void
const listeners: Set<Listener> = new Set()

export function subscribeAppEvent(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function publishAppEvent(e: AppEvent): void {
  for (const l of listeners) {
    try {
      l(e)
    } catch {
      /* ignore */
    }
  }
}

// 主进程推送口（preload 已暴露）
export function bindAppEventBus(): () => void {
  const handler = (raw: unknown): void => {
    publishAppEvent(raw as AppEvent)
  }
  // 复用 ipcRenderer.on('app:event', ...) — 这里占位，预留给 preload 暴露
  return () => {
    /* cleanup */
  }
}