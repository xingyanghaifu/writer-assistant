import { app, shell, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { handleRaw } from './handle'

export function registerAppIpc(): void {
  handleRaw<[], string>(IPC.appVersion, () => app.getVersion())
  handleRaw<[string], { ok: boolean }>(IPC.appOpenExternal, async (_e, url) => {
    // 仅允许 http/https，避免 file:// 等协议滥用
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false }
    }
    await shell.openExternal(url)
    return { ok: true }
  })

  const senderWin = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)

  handleRaw<[], NodeJS.Platform>(IPC.appPlatform, () => process.platform)

  handleRaw<[], void>(IPC.appMinimize, (e) => {
    senderWin(e)?.minimize()
  })

  handleRaw<[], boolean>(IPC.appMaximize, (e) => {
    const win = senderWin(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  handleRaw<[], void>(IPC.appClose, (e) => {
    senderWin(e)?.close()
  })

  handleRaw<[], boolean>(IPC.appIsMaximized, (e) => senderWin(e)?.isMaximized() ?? false)

  // 主窗口最大化状态变化推给渲染层，按钮图标才能跟着变
  const pushState = (win: BrowserWindow): void => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.appWindowState, { maximized: win.isMaximized() })
  }
  app.on('browser-window-created', (_e, win) => {
    win.on('maximize', () => pushState(win))
    win.on('unmaximize', () => pushState(win))
  })
  for (const win of BrowserWindow.getAllWindows()) {
    win.on('maximize', () => pushState(win))
    win.on('unmaximize', () => pushState(win))
  }
}
