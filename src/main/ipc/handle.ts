import { ipcMain, type IpcMainInvokeEvent } from 'electron'

/**
 * 统一的 IPC 处理器注册包装。
 * - 自动 try/catch，异常以 { ok:false, error } 返回，绝不把主进程异常抛给渲染进程
 * - 通道名统一来自 @shared/ipc 的 IPC 常量
 */
type Handler<A extends unknown[], R> = (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>

export function handle<A extends unknown[], R>(channel: string, fn: Handler<A, R>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as A))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 统一失败信封，避免渲染进程收到未捕获异常
      return { ok: false, error: message }
    }
  })
}

/** 注册一个返回原始值（非信封）的通道 */
export function handleRaw<A extends unknown[], R>(channel: string, fn: Handler<A, R>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as A))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc:${channel}]`, message)
      // 原始通道失败时返回 null，调用方需自行判空
      return null
    }
  })
}
