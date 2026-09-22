import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { createMainWindow, applyEmbeddedUserAgent } from './window'
import { registerIpc } from './ipc'
import { markCleanExit, markRunning, scanRecoveryCandidates } from './services/recovery'
import { isSmokeMode, attachConsoleCapture, runSmoke } from './smoke'

// 单实例：避免两个实例同时写同一份数据
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 异常退出检测（阶段 5.8）：启动写运行标记
    markRunning()
    void scanRecoveryCandidates()

    registerIpc()
    // 必须在创建窗口/加载 webview 前设置，否则首个请求会带 Electron UA
    applyEmbeddedUserAgent()
    const win = createMainWindow()

    if (isSmokeMode()) {
      // 验收模式：捕获渲染进程错误并跑结构化自检
      const errors: string[] = []
      attachConsoleCapture(win, errors)
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          void runSmoke(win, errors)
        }, 1200)
      })
      // 兜底超时，避免冒烟测试挂住
      setTimeout(() => {
        try {
          const out = process.env['WA_SMOKE_OUT']
          if (out) {
            writeFileSync(
              out,
              JSON.stringify(
                {
                  stage: process.env['WA_SMOKE_STAGE'],
                  total: 1,
                  passed: 0,
                  failed: 1,
                  checks: [{ name: '冒烟测试超时', pass: false }]
                },
                null,
                2
              )
            )
          }
        } catch {
          /* ignore */
        }
        app.exit(2)
      }, 90000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // 正常退出：删除运行标记
  app.on('before-quit', () => {
    markCleanExit()
  })
}
