/**
 * 导入导出 IPC（阶段 6.5 / 7）。
 * 文件读写全在主进程；渲染进程只发指令。
 */
import { dialog, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { ImportExecuteParams, ExportParams } from '@shared/ipc'
import type { ExportFormat } from '@shared/settings'
import { join } from 'node:path'
import { handleRaw } from './handle'
import { analyzeImport, executeImport } from '../services/importer'
import { executeExport, extForFormat, suggestFileName } from '../services/exporter'
import { markExported } from '../services/backup'
import { appStore } from '../store'

/** 取父窗口（可能为 null） */
function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

export function registerIoIpc(): void {
  /** 选择导入文件 */
  handleRaw(IPC.ioPickImportFile, async () => {
    const win = parentWindow()
    const opts = {
      title: '选择要导入的文件',
      properties: ['openFile' as const],
      filters: [
        { name: '文本/文档', extensions: ['txt', 'md', 'markdown', 'docx', 'epub', 'pdf'] },
        { name: 'JSON 备份', extensions: ['json'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })

  /** 选择目录 */
  handleRaw(IPC.ioPickDirectory, async () => {
    const win = parentWindow()
    const opts = { title: '选择目录', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })

  /** 分析导入文件（预览） */
  handleRaw(IPC.ioAnalyzeImport, async (_e, filePath: string) => {
    try {
      const preview = await analyzeImport(filePath)
      return { ok: true, data: preview }
    } catch (err) {
      const code = (err as Error).message
      return { ok: false, error: code, code }
    }
  })

  /** 执行导入 */
  handleRaw(IPC.ioExecuteImport, async (_e, params: ImportExecuteParams) => {
    const result = await executeImport({
      filePath: params.filePath,
      strategy: params.strategy,
      targetWorkId: params.targetWorkId
    })
    return result
  })

  /** 导出 */
  handleRaw(IPC.ioExport, async (_e, params: ExportParams) => {
    const work = appStore.getWork(params.workId)
    if (!work) return { ok: false, error: '作品不存在' }

    let outputPath = params.outputPath
    if (!outputPath) {
      const win = parentWindow()
      const opts = {
        title: '导出作品',
        defaultPath: join(appStore.userDataPath, suggestFileName(work.title, params.format)),
        filters: [{ name: params.format.toUpperCase(), extensions: [extForFormat(params.format)] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { ok: false, error: 'E_CANCELLED' }
      outputPath = r.filePath
    }

    const res = executeExport({
      workId: params.workId,
      format: params.format as ExportFormat,
      includeAiNotice: params.includeAiNotice,
      outputPath
    })
    if (res.ok) markExported()
    return res.ok ? { ok: true, data: res.path! } : { ok: false, error: res.error ?? 'E_UNKNOWN' }
  })

  handleRaw(IPC.ioCancel, () => ({ ok: true }))
}
