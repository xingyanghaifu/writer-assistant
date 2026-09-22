/**
 * 数据存储位置 IPC。
 *
 * 设计要点：
 * - 切换目录只在**下次启动**生效（写入引导文件），避免运行中数据错乱
 * - 支持"迁移"与"全新开始"两种模式；迁移时目标已有数据则不覆盖
 * - 所有路径校验在主进程完成，渲染进程只传字符串
 */
import { app, dialog, shell, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { handleRaw, handle } from './handle'
import { appStore } from '../store'

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

export function registerStorageIpc(): void {
  /** 当前数据目录状态 */
  handleRaw(IPC.storageStatus, async () => appStore.getStorageStatus())

  /** 选择目录 */
  handleRaw(IPC.storagePickDir, async () => {
    const win = parentWindow()
    const opts = {
      title: '选择数据存储目录',
      properties: ['openDirectory' as const, 'createDirectory' as const],
      buttonLabel: '使用此目录'
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })

  /** 设置数据目录 */
  handle(IPC.storageSetDir, async (_e, dir: string, migrateMode: 'migrate' | 'fresh') => {
    const r = appStore.setStorageDir(dir, migrateMode === 'fresh' ? 'fresh' : 'migrate')
    if (!r.ok) throw new Error(r.error)
    return { needsRestart: true, migrated: r.migrated }
  })

  /** 恢复默认目录 */
  handle(IPC.storageResetDir, async () => {
    const r = appStore.resetStorageDir('migrate')
    return { needsRestart: true, migrated: r.migrated }
  })

  /** 在系统文件管理器中打开目录 */
  handle(IPC.storageOpenDir, async (_e, dir?: string) => {
    const target = dir || appStore.getStorageStatus().currentDir
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })

  /**
   * 重启应用。
   * 用 relaunch + exit 而不是 app.quit()，确保引导文件已落盘后干净重启。
   */
  handle(IPC.storageRestart, async () => {
    app.relaunch()
    setTimeout(() => app.exit(0), 200)
  })
}
