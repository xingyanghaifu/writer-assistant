/**
 * 备份 IPC（阶段 7.5）。
 */
import { dialog, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { BackupRestoreParams } from '@shared/ipc'
import { handleRaw } from './handle'
import {
  getBackupStatus,
  runBackup,
  verifyBackup,
  restoreBackup,
  snapshotChapter,
  listBackups
} from '../services/backup'
import { findChapter } from '../services/work'

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

export function registerBackupIpc(): void {
  handleRaw(IPC.backupStatus, () => getBackupStatus())

  handleRaw(IPC.backupRunNow, () => {
    try {
      return { ok: true, data: runBackup() }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  handleRaw(IPC.backupVerify, (_e, filePath: string) => {
    try {
      return { ok: true, data: verifyBackup(filePath) }
    } catch (err) {
      const code = (err as Error).message
      return { ok: false, error: code, code }
    }
  })

  handleRaw(IPC.backupRestore, (_e, params: BackupRestoreParams) => {
    try {
      const work = restoreBackup(params.filePath, params.strategy)
      return { ok: true, data: work.id }
    } catch (err) {
      const code = (err as Error).message
      return { ok: false, error: code, code }
    }
  })

  handleRaw(IPC.backupSnapshot, (_e, workId: string, chapterId: string) => {
    const found = findChapter(workId, chapterId)
    if (!found) return { ok: false, error: '章节不存在' }
    snapshotChapter(workId, chapterId, found.chapter.content)
    return { ok: true }
  })

  handleRaw(IPC.backupList, () => listBackups())

  /** 选择备份文件（恢复流程第一步） */
  handleRaw('backup:pick-file' as never, async () => {
    const win = parentWindow()
    const opts = {
      title: '选择备份文件',
      properties: ['openFile' as const],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })
}
