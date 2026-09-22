/**
 * 拆书工作台 IPC（v3 模块三）。
 */
import { BrowserWindow, dialog } from 'electron'
import { extractTextFromFile, BREAKDOWN_IMPORT_FILTERS } from '../services/documentExtract'
import { handleRaw } from './handle'
import {
  listProjects,
  getProject,
  deleteProject,
  createProjectFromText,
  pauseProject,
  resumeProject,
  setChapterStatus,
  onProgress,
  pushProgress,
  patchProject
} from '../services/bookBreakdown'
import { appStore } from '../store'
import type { Character, Foreshadowing } from '@shared/material'

export function registerBookBreakdownIpc(): void {
  handleRaw('breakdown:list' as never, () => listProjects())
  handleRaw('breakdown:get' as never, (_e, id: string) => getProject(id))
  handleRaw('breakdown:remove' as never, (_e, id: string) => deleteProject(id))
  handleRaw('breakdown:pause' as never, (_e, id: string) => pauseProject(id))
  handleRaw('breakdown:resume' as never, (_e, id: string) => resumeProject(id))
  handleRaw('breakdown:patch' as never, (_e, id: string, patch: { anonymized?: boolean; chunkSize?: number; title?: string; author?: string }) => patchProject(id, patch))
    handleRaw('breakdown:create' as never, async (_e, input: { title: string; author?: string; text?: string; sourceFile?: string }) => {
    if (!input.text) {
      const win = BrowserWindow.getFocusedWindow()
      const opts = {
        title: '选择要拆书的文件',
        filters: [...BREAKDOWN_IMPORT_FILTERS],
        properties: ['openFile' as const]
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || r.filePaths.length === 0) return { ok: false, error: '已取消' }
      const fp = r.filePaths[0]
      try {
        const extracted = await extractTextFromFile(fp)
        if (!extracted.text.trim()) {
          return { ok: false, error: '未提取到正文（PDF 扫描版或空文档）' }
        }
        const created = createProjectFromText({
          title: input.title || extracted.titleHint,
          author: input.author,
          text: extracted.text,
          sourceFile: fp
        })
        if (created.ok && extracted.warnings.length > 0) {
          return { ...created, warning: extracted.warnings.slice(0, 3).join('；') }
        }
        return created
      } catch (err) {
        const msg = (err as Error).message || '读取失败'
        if (msg === 'E_TXT_TOO_LARGE') return { ok: false, error: '文件超过 20MB，请拆分后再导入' }
        if (msg === 'E_IO_BUSY') return { ok: false, error: '文件不存在或被占用' }
        if (msg === 'E_ENCODING_FAILED') return { ok: false, error: '编码识别失败，请另存为 UTF-8 后重试' }
        return { ok: false, error: '读取失败：' + msg }
      }
    }
    return createProjectFromText({
      title: input.title,
      author: input.author,
      text: input.text,
      sourceFile: input.sourceFile
    })
  })

  handleRaw('breakdown:start' as never, (_e, id: string, _opts?: { fromChapter?: number }) => {
    // 流水线在渲染层执行（依赖站点适配器脚本）；主进程只更新 status
    const p = getProject(id)
    if (!p) return { ok: false, error: '项目不存在' }
    if (p.status === 'paused') resumeProject(id)
    pushProgress({
      projectId: id,
      chapterIndex: -1,
      status: 'running',
      message: '流水线启动（渲染层驱动）',
      progress: p.progress,
      at: Date.now()
    })
    return { ok: true }
  })

  handleRaw('breakdown:export-json' as never, (_e, id: string) => {
    const p = getProject(id)
    if (!p) return { ok: false, error: '项目不存在' }
    const json = JSON.stringify(
      {
        projectId: p.id,
        title: p.title,
        chapters: p.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          summary: c.summary,
          keyEvents: c.keyEvents,
          characters: c.characters,
          turningPoint: c.turningPoint,
          endingHook: c.endingHook
        })),
        createdAt: p.createdAt
      },
      null,
      2
    )
    return { ok: true, data: json }
  })

  handleRaw('breakdown:import-to-materials' as never, (_e, id: string, workId: string) => {
    const proj = getProject(id)
    if (!proj) return { ok: false, error: '项目不存在' }
    const works = appStore.getWorks()
    if (!works.find((w) => w.id === workId)) return { ok: false, error: '目标作品不存在' }

    let added = 0
    const charMap = new Map<string, Character>()
    const foreMap = new Map<string, Foreshadowing>()

    for (const ch of proj.chapters) {
      for (const name of ch.characters ?? []) {
        if (!charMap.has(name)) {
          charMap.set(name, {
            id: `bd_char_${Date.now()}_${charMap.size}`,
            name,
            intro: `由拆书项目「${proj.title}」第 ${ch.index} 章提取`,
            tags: ['拆书导入'],
            appearances: [],
            mentions: 0,
            supplements: [],
            createdAt: Date.now(),
            lastUpdatedAt: Date.now()
          })
        }
      }
      // 把每个章节的关键事件转成一条伏笔（首条作 placeholder）
      if (ch.keyEvents && ch.keyEvents.length > 0) {
        const first = ch.keyEvents[0]
        if (!foreMap.has(first)) {
          foreMap.set(first, {
            id: `bd_fore_${Date.now()}_${foreMap.size}`,
            content: first,
            type: 'event',
            status: 'planted',
            chapterId: ch.id,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
        }
      }
    }

    // 写入素材库
    const existing = appStore.getCharacters(workId)
    const existingFore = appStore.getForeshadowings(workId)
    const merged = new Set(existing.map((c: Character) => c.name))
    const mergedFore = new Set(existingFore.map((f: Foreshadowing) => f.content))

    for (const c of charMap.values()) {
      if (!merged.has(c.name)) {
        appStore.addMaterial(workId, 'characters', c)
        added++
      }
    }
    for (const f of foreMap.values()) {
      if (!mergedFore.has(f.content)) {
        appStore.addMaterial(workId, 'foreshadowings', f)
        added++
      }
    }

    return { ok: true, data: { added } }
  })

  handleRaw('breakdown:generate-prompt' as never, (_e, _id: string, _kind: string) => {
    return { ok: false, error: '提示词生成在阶段 8 实现' }
  })

  handleRaw('breakdown:set-chapter-status' as never, (_e, id: string, chId: string, patch: unknown) =>
    setChapterStatus(id, chId, (patch ?? {}) as never)
  )

  // 把 onProgress 事件转发到所有 webContents（渲染层通过 ipcRenderer.on 订阅）
  onProgress((payload) => {
    const { BrowserWindow } = require('electron') as typeof import('electron')
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      w.webContents.send('breakdown:progress', payload)
    }
  })

  // 暴露 setChapterStatus / pauseProject / resumeProject 给内部使用
  void setChapterStatus
  void pauseProject
  void resumeProject
}