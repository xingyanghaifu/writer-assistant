import { create } from 'zustand'
import type { Work, Chapter, Volume, ChapterVersion } from '@shared/work'

/** 展平的章节项，便于章节树渲染 */
export interface ChapterItem {
  chapter: Chapter
  volumeId: string
}

interface WorkState {
  works: Work[]
  currentWorkId: string | null
  currentChapterId: string | null
  /** 当前编辑内容（受控） */
  draft: string
  loading: boolean
  saving: boolean
  /** 上次保存时间 */
  lastSavedAt: number | null
  /** 未保存标记 */
  dirty: boolean
  /** 版本历史面板 */
  historyOpen: boolean
  versions: ChapterVersion[]

  init: () => Promise<void>
  loadWorks: () => Promise<void>
  selectWork: (id: string) => Promise<void>
  createWork: (input: { title: string; author?: string; intro?: string; coverUrl?: string }) => Promise<void>
  removeWork: (id: string) => Promise<void>
  selectChapter: (chapterId: string) => Promise<void>
  createChapter: (volumeId: string, title: string) => Promise<void>
  removeChapter: (chapterId: string) => Promise<void>
  renameChapter: (chapterId: string, title: string) => Promise<void>
  createVolume: (title: string) => Promise<void>
  setDraft: (text: string) => void
  save: (source?: string) => Promise<void>
  refreshWorks: () => Promise<void>

  openHistory: () => Promise<void>
  closeHistory: () => void
  restoreVersion: (versionId: string) => Promise<void>
  markVersion: (versionId: string, important: boolean) => Promise<void>
  removeVersion: (versionId: string) => Promise<void>
  loadVersions: () => Promise<void>
}

function currentWork(s: WorkState): Work | undefined {
  return s.works.find((w) => w.id === s.currentWorkId)
}

function findChapterIn(work: Work | undefined, chapterId: string | null): Chapter | undefined {
  if (!work || !chapterId) return undefined
  for (const v of work.volumes) {
    const c = v.chapters.find((x) => x.id === chapterId)
    if (c) return c
  }
  return undefined
}

/** 取作品的第一章 */
function firstChapter(work: Work | undefined): Chapter | undefined {
  return work?.volumes[0]?.chapters[0]
}

export const useWorkStore = create<WorkState>((set, get) => ({
  works: [],
  currentWorkId: null,
  currentChapterId: null,
  draft: '',
  loading: false,
  saving: false,
  lastSavedAt: null,
  dirty: false,
  historyOpen: false,
  versions: [],

  /** 启动：恢复上次作品与章节 */
  init: async () => {
    set({ loading: true })
    try {
      const [works, settings] = await Promise.all([window.api.work.list(), window.api.settings.get()])
      const workId =
        settings.currentWorkId && works.some((w) => w.id === settings.currentWorkId)
          ? settings.currentWorkId
          : (works[0]?.id ?? null)
      const work = works.find((w) => w.id === workId)
      const ch = firstChapter(work)
      set({
        works,
        currentWorkId: workId,
        currentChapterId: ch?.id ?? null,
        draft: ch?.content ?? '',
        dirty: false,
        loading: false
      })
    } catch (err) {
      console.error('[work] init 失败', err)
      set({ loading: false })
    }
  },

  loadWorks: async () => {
    const works = await window.api.work.list()
    set({ works })
  },

  refreshWorks: async () => {
    const works = await window.api.work.list()
    const s = get()
    const ch = findChapterIn(
      works.find((w) => w.id === s.currentWorkId),
      s.currentChapterId
    )
    set({ works, draft: ch?.content ?? s.draft })
  },

  selectWork: async (id) => {
    const { works, save } = get()
    await save('manual')
    const work = works.find((w) => w.id === id)
    const ch = firstChapter(work)
    set({
      currentWorkId: id,
      currentChapterId: ch?.id ?? null,
      draft: ch?.content ?? '',
      dirty: false,
      lastSavedAt: null
    })
    await window.api.work.setCurrent(id)
  },

  createWork: async (input) => {
    const work = await window.api.work.create(input)
    const works = await window.api.work.list()
    const ch = firstChapter(work)
    set({
      works,
      currentWorkId: work.id,
      currentChapterId: ch?.id ?? null,
      draft: ch?.content ?? '',
      dirty: false
    })
  },

  removeWork: async (id) => {
    await window.api.work.remove(id)
    const works = await window.api.work.list()
    const work = works[0]
    const ch = firstChapter(work)
    set({
      works,
      currentWorkId: work?.id ?? null,
      currentChapterId: ch?.id ?? null,
      draft: ch?.content ?? '',
      dirty: false
    })
  },

  selectChapter: async (chapterId) => {
    const s = get()
    // 切换章节前先保存当前章节
    await s.save('manual')
    const work = currentWork(get())
    const ch = findChapterIn(work, chapterId)
    set({
      currentChapterId: chapterId,
      draft: ch?.content ?? '',
      dirty: false,
      lastSavedAt: null
    })
  },

  createChapter: async (volumeId, title) => {
    const s = get()
    if (!s.currentWorkId) return
    const r = await window.api.chapter.create(s.currentWorkId, volumeId, title)
    if (!r.ok) return
    await get().refreshWorks()
    set({ currentChapterId: r.data.id, draft: r.data.content, dirty: false })
  },

  removeChapter: async (chapterId) => {
    const s = get()
    if (!s.currentWorkId) return
    const r = await window.api.chapter.remove(s.currentWorkId, chapterId)
    if (!r.ok) return
    const works = await window.api.work.list()
    const work = works.find((w) => w.id === s.currentWorkId)
    const ch = firstChapter(work)
    set({
      works,
      currentChapterId: ch?.id ?? null,
      draft: ch?.content ?? '',
      dirty: false
    })
  },

  renameChapter: async (chapterId, title) => {
    const s = get()
    if (!s.currentWorkId) return
    await window.api.chapter.rename(s.currentWorkId, chapterId, title)
    await get().refreshWorks()
  },

  createVolume: async (title) => {
    const s = get()
    if (!s.currentWorkId) return
    await window.api.volume.create(s.currentWorkId, title)
    await get().refreshWorks()
  },

  setDraft: (text) => set({ draft: text, dirty: true }),

  save: async (source = 'manual') => {
    const s = get()
    if (!s.currentWorkId || !s.currentChapterId) return
    if (!s.dirty && source === 'autosave') return
    set({ saving: true })
    try {
      const r = await window.api.chapter.save(s.currentWorkId, s.currentChapterId, s.draft, source)
      if (r.ok) {
        set({ dirty: false, lastSavedAt: Date.now() })
        // 同步内存中的字数
        await get().refreshWorks()
      }
    } catch (err) {
      console.error('[work] 保存失败', err)
    } finally {
      set({ saving: false })
    }
  },

  loadVersions: async () => {
    const s = get()
    if (!s.currentWorkId || !s.currentChapterId) return
    const versions = await window.api.version.list(s.currentWorkId, s.currentChapterId)
    set({ versions })
  },

  openHistory: async () => {
    await get().save('manual')
    await get().loadVersions()
    set({ historyOpen: true })
  },

  closeHistory: () => set({ historyOpen: false }),

  restoreVersion: async (versionId) => {
    const s = get()
    if (!s.currentWorkId || !s.currentChapterId) return
    const r = await window.api.version.restore(s.currentWorkId, s.currentChapterId, versionId)
    if (r.ok) {
      set({ draft: r.data.content, dirty: false })
      await get().refreshWorks()
      await get().loadVersions()
    }
  },

  markVersion: async (versionId, important) => {
    const s = get()
    if (!s.currentWorkId || !s.currentChapterId) return
    await window.api.version.markImportant(s.currentWorkId, s.currentChapterId, versionId, important)
    await get().loadVersions()
  },

  removeVersion: async (versionId) => {
    const s = get()
    if (!s.currentWorkId || !s.currentChapterId) return
    await window.api.version.remove(s.currentWorkId, s.currentChapterId, versionId)
    await get().loadVersions()
  }
}))

/** 展平卷章，便于渲染 */
export function flattenChapters(work: Work | undefined): Array<{ volume: Volume; chapters: Chapter[] }> {
  if (!work) return []
  return work.volumes.map((v) => ({ volume: v, chapters: v.chapters }))
}
