/**
 * 作品 / 卷 / 章 / 版本历史 IPC（阶段 5、5.7）。
 * 业务逻辑在 src/main/services/work.ts。
 */
import { IPC } from '@shared/ipc'
import type { VersionSource } from '@shared/work'
import { handleRaw } from './handle'
import * as workSvc from '../services/work'
import { appStore } from '../store'

export function registerWorkIpc(): void {
  // ---- 作品 ----
  handleRaw(IPC.workList, () => workSvc.listWorks())
  handleRaw(IPC.workGet, (_e, id: string) => workSvc.getWork(id) ?? null)
  handleRaw(IPC.workCreate, (_e, input: { title: string; author?: string; intro?: string; coverUrl?: string }) =>
    workSvc.createWork(input ?? { title: '' })
  )
  handleRaw(IPC.workUpdate, (_e, id: string, patch: Partial<{ title: string; author: string; intro: string; coverUrl: string }>) => {
    const r = workSvc.updateWork(id, patch ?? {})
    return r ? { ok: true, data: r } : { ok: false, error: '作品不存在' }
  })
  handleRaw(IPC.workDelete, (_e, id: string) => {
    workSvc.deleteWork(id)
    return { ok: true }
  })
  handleRaw(IPC.workMerge, (_e, srcId: string, dstId: string) => {
    const r = workSvc.mergeWork(String(srcId), String(dstId))
    return r
  })
  handleRaw(IPC.workSetCurrent, (_e, id: string) => {
    appStore.setSettings({ currentWorkId: id })
    return { ok: true }
  })

  // ---- 章节 ----
  handleRaw(IPC.chapterGet, (_e, workId: string, chapterId: string) => {
    const found = workSvc.findChapter(workId, chapterId)
    return found ? found.chapter : null
  })
  handleRaw(
    IPC.chapterSave,
    (_e, workId: string, chapterId: string, content: string, source?: VersionSource) => {
      const ch = workSvc.saveChapter(workId, chapterId, content ?? '', (source as VersionSource) ?? 'manual')
      return ch ? { ok: true, data: ch } : { ok: false, error: '章节不存在' }
    }
  )
  handleRaw(IPC.chapterCreate, (_e, workId: string, volumeId: string, title: string) => {
    const ch = workSvc.createChapter(workId, volumeId, title)
    return ch ? { ok: true, data: ch } : { ok: false, error: '卷不存在' }
  })
  handleRaw(IPC.chapterRename, (_e, workId: string, chapterId: string, title: string) => {
    const ok = workSvc.renameChapter(workId, chapterId, title)
    return ok ? { ok: true } : { ok: false, error: '章节不存在' }
  })
  handleRaw(IPC.chapterDelete, (_e, workId: string, chapterId: string) => {
    const ok = workSvc.deleteChapter(workId, chapterId)
    return ok ? { ok: true } : { ok: false, error: '每卷至少保留一章' }
  })
  handleRaw(IPC.chapterReorder, (_e, workId: string, volumeId: string, chapterIds: string[]) => {
    const ok = workSvc.reorderChapters(workId, volumeId, chapterIds ?? [])
    return ok ? { ok: true } : { ok: false, error: '卷不存在' }
  })
  // 章节摘要落地（AI 摘要 / 一键生成章纲共用）
  handleRaw(
    IPC.chapterSetSummary,
    (_e, workId: string, chapterId: string, summary: string, version: number) => {
      const ok = workSvc.setChapterSummary(workId, chapterId, summary ?? '', version ?? 0)
      return ok ? { ok: true } : { ok: false, error: '章节不存在' }
    }
  )

  // ---- 卷 ----
  handleRaw(IPC.volumeCreate, (_e, workId: string, title: string) => {
    const v = workSvc.createVolume(workId, title)
    return v ? { ok: true, data: v } : { ok: false, error: '作品不存在' }
  })
  handleRaw(IPC.volumeRename, (_e, workId: string, volumeId: string, title: string) => {
    const ok = workSvc.renameVolume(workId, volumeId, title)
    return ok ? { ok: true } : { ok: false, error: '卷不存在' }
  })
  handleRaw(IPC.volumeDelete, (_e, workId: string, volumeId: string) => {
    const ok = workSvc.deleteVolume(workId, volumeId)
    return ok ? { ok: true } : { ok: false, error: '至少保留一卷' }
  })

  // ---- 版本历史（阶段 5.7）----
  handleRaw(IPC.versionList, (_e, workId: string, chapterId: string) =>
    workSvc.listVersions(workId, chapterId)
  )
  handleRaw(IPC.versionRestore, (_e, workId: string, chapterId: string, versionId: string) => {
    const ch = workSvc.restoreVersion(workId, chapterId, versionId)
    return ch ? { ok: true, data: ch } : { ok: false, error: '版本不存在' }
  })
  handleRaw(IPC.versionMarkImportant, (_e, workId: string, chapterId: string, versionId: string, important: boolean) => {
    const ok = workSvc.markVersionImportant(workId, chapterId, versionId, !!important)
    return ok ? { ok: true } : { ok: false, error: '版本不存在' }
  })
  handleRaw(IPC.versionDelete, (_e, workId: string, chapterId: string, versionId: string) => {
    const ok = workSvc.deleteVersion(workId, chapterId, versionId)
    return ok ? { ok: true } : { ok: false, error: '版本不存在' }
  })
  handleRaw(IPC.versionExport, (_e, workId: string, chapterId: string, versionId: string) => {
    const txt = workSvc.versionToTxt(workId, chapterId, versionId)
    return txt ? { ok: true, data: txt } : { ok: false, error: '版本不存在' }
  })
}
