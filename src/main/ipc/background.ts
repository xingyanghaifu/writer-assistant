/**
 * 后台建议会话 IPC（阶段 3 / 11.5）。
 * 业务逻辑见 src/main/services/background.ts。
 */
import { IPC } from '@shared/ipc'
import type { BgRequestParams } from '@shared/ipc'
import { handleRaw } from './handle'
import { startRequest, cancelRequest, isRunning } from '../services/background'

export function registerBackgroundIpc(): void {
  /** 发起请求：单请求串行、超时、取消、登录预检、缓存，全部在服务层完成 */
  handleRaw(IPC.bgRequestStart, async (_e, params: BgRequestParams) => {
    if (!params || typeof params.prompt !== 'string') {
      return { ok: false, error: '无效请求参数' }
    }
    try {
      const data = await startRequest(params)
      return { ok: true, data }
    } catch (err) {
      // 把可读错误信息回传渲染进程（例如"请先在右侧登录"）
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handleRaw(IPC.bgRequestCancel, (_e, requestId: string) => {
    const ok = cancelRequest(requestId)
    return ok ? { ok: true } : { ok: false, error: '没有正在进行的该请求' }
  })

  handleRaw('bg:is-running' as never, () => isRunning())
}
