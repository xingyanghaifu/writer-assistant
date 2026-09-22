/**
 * webview 脚本注入 IPC（阶段 2）。
 */
import { session } from 'electron'
import { IPC } from '@shared/ipc'
import { handleRaw } from './handle'
import { registerWebview, unregisterWebview, executeScript, detectLoginState } from '../services/inject'

export function registerWebviewIpc(): void {
  /** 渲染进程注册 webview 的 webContentsId */
  handleRaw(IPC.webviewRegister, (_e, id: number, kind: 'main' | 'background') => {
    if (typeof id !== 'number') return { ok: false, error: 'invalid id' }
    if (kind === 'main' || kind === 'background') registerWebview(id, kind)
    return { ok: true }
  })

  /** 在指定 webview 执行脚本 */
  handleRaw(IPC.webviewExecute, async (_e, target: 'main' | 'background', script: string) => {
    if (typeof script !== 'string' || !script) return { ok: false, error: 'empty script' }
    return executeScript(target === 'background' ? 'background' : 'main', script)
  })

  /** 登录态检测 */
  handleRaw(IPC.webviewLoginState, async (_e, target: 'main' | 'background', script: string) =>
    detectLoginState(target === 'background' ? 'background' : 'main', script)
  )

  // 清理：webview 销毁时移除注册（由渲染进程在卸载时调用 unregister 更可靠）
  handleRaw('webview:unregister' as never, (_e, kind: 'main' | 'background') => {
    unregisterWebview(kind)
    return { ok: true }
  })

  /**
   * 清除 AI webview 的存储。
   *
   * mode：
   *  - 'session'：清掉 cookies/sessionStorage（保留 IndexedDB、磁盘缓存），
   *    用于"刚登录错账号想换"或"想清掉残留会话"等场景
   *  - 'full'：全部清空（cookies + localStorage + cache + IndexedDB），
   *    退登后用；用户必须重新登录
   *
   * ⚠️ 严格遵守：不删除用户的作品数据（那些在主进程 appStore.userData 下），
   * 只清 AI 站点（chat.deepseek.com 等）的浏览器级数据。
   */
  handleRaw('webview:clear-storage' as never, async (_e, mode: 'session' | 'full') => {
    try {
      const ses = session.fromPartition('persist:writer-assistant')
      const dataTypes = mode === 'session'
        ? ['cookies', 'sessionstorage']
        : ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'filesystem']
      await ses.clearStorageData({ storages: dataTypes as never })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
