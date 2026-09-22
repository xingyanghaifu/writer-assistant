/**
 * 用户提示词库 IPC（v3 模块一）。
 */
import { IPC } from '@shared/ipc'
import { handleRaw } from './handle'
import * as svc from '../services/promptLibrary'
import { dialog, BrowserWindow } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'

export function registerPromptLibraryIpc(): void {
  handleRaw(IPC.promptLibraryList, () => svc.listLibrary())
  handleRaw(IPC.promptLibrarySave, (_e, item: unknown) => svc.saveLibrary(item as never))
  handleRaw(IPC.promptLibraryRemove, (_e, id: string) => svc.removeLibrary(id))
  handleRaw(IPC.promptLibraryDuplicate, (_e, id: string) => svc.duplicateLibrary(id))
  handleRaw(IPC.promptLibraryReorder, (_e, ids: string[]) => svc.reorderLibrary(ids))
  handleRaw(IPC.promptLibraryRender, (_e, id: string, vars: Record<string, string>) =>
    svc.renderLibrary(id, vars)
  )
  handleRaw(IPC.promptLibraryTouch, (_e, id: string) => svc.touchLibrary(id))
  handleRaw(IPC.promptLibraryRecordUsage, (_e, input: { promptId: string; action?: string; value: 'up' | 'down' | 'use'; note?: string; siteId?: string }) => {
    try { return { ok: true, data: svc.recordPromptUsage(input) } } catch (err) { return { ok: false, error: (err as Error).message } }
  })
  handleRaw(IPC.promptLibraryIteratePreview, (_e, id: string) => svc.previewIterate(id))
  handleRaw(IPC.promptLibraryIterate, (_e, id: string) => svc.iterateLibraryPrompt(id))
  handleRaw(IPC.promptLibraryIterationHistory, (_e, promptId?: string) => svc.listIterationHistory(promptId))
  handleRaw(IPC.promptLibraryAppendHistory, (_e, entry: import('@shared/bookBreakdown').PromptIterationHistoryEntry) => {
    svc.appendIterationHistory(entry)
    return { ok: true, data: undefined }
  })
  handleRaw(IPC.promptLibraryPreviewByInstruction, (_e, id: string, req: import('@shared/promptLibrary').PromptIterateRequest) => svc.previewByInstruction(id, req))
  handleRaw(IPC.promptLibraryIterateByInstruction, (_e, id: string, req: import('@shared/promptLibrary').PromptIterateRequest) => svc.iterateByInstruction(id, req))
  handleRaw(IPC.promptLibraryRestoreIteration, (_e, historyIndex: number) => svc.restoreIteration(historyIndex))

  handleRaw(IPC.promptLibraryImportText, (_e, text: string, category?: string) => svc.importFromText(text, category))

  handleRaw(IPC.promptLibraryExport, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showSaveDialog(win!, {
      title: '导出提示词库',
      defaultPath: 'prompt-library.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, error: '已取消' }
    try {
      await writeFile(r.filePath, svc.exportLibrary(), 'utf8')
      return { ok: true, data: r.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  handleRaw(IPC.promptLibraryImport, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: '导入提示词库',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, error: '已取消' }
    try {
      const json = await readFile(r.filePaths[0], 'utf8')
      return svc.importLibrary(json)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}