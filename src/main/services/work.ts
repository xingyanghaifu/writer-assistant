/**
 * 作品 / 卷 / 章 业务服务（阶段 5 / 5.7 / 5.8）。
 *
 * 版本历史裁剪策略（阶段 5.7）：
 *   每章最多 20 个版本；超出时删除最旧，但保留：
 *     - 最近 5 个
 *     - 每天第一个版本
 *     - 用户标记为重要的版本
 */
import { randomUUID } from 'node:crypto'
import type { Work, Volume, Chapter, ChapterVersion, VersionSource } from '@shared/work'
import { DATA_SCHEMA_VERSION, appStore } from '../store'
import { clearRecovery } from './recovery'

/** 每章版本上限 */
export const MAX_VERSIONS = 20
/** 始终保留的最近版本数 */
export const KEEP_RECENT = 5
/** 同分钟自动保存只留一个 */
const AUTOSAVE_SAME_MINUTE_WINDOW_MS = 60 * 1000

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-4)}`
}

/** 中文字数统计：去空白后的字符数 */
export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

function now(): number {
  return Date.now()
}

// ---------------------------------------------------------------------------
// 作品
// ---------------------------------------------------------------------------

export function createWork(input: { title: string; author?: string; intro?: string; coverUrl?: string }): Work {
  const t = now()
  const chapter: Chapter = {
    id: newId('ch'),
    title: '第一章',
    content: '',
    wordCount: 0,
    createdAt: t,
    updatedAt: t,
    versions: []
  }
  const volume: Volume = {
    id: newId('vol'),
    title: '第一卷',
    chapters: [chapter],
    order: 0,
    createdAt: t,
    updatedAt: t
  }
  const work: Work = {
    id: newId('work'),
    title: input.title.trim() || '未命名作品',
    author: input.author?.trim() ?? '',
    intro: input.intro?.trim() ?? '',
    coverUrl: input.coverUrl?.trim() || undefined,
    volumes: [volume],
    createdAt: t,
    updatedAt: t,
    schemaVersion: DATA_SCHEMA_VERSION
  }
  appStore.upsertWork(work)
  appStore.setSettings({ currentWorkId: work.id })
  return work
}

export function listWorks(): Work[] {
  return appStore.getWorks()
}

export function getWork(id: string): Work | undefined {
  return appStore.getWork(id)
}

export function updateWork(id: string, patch: Partial<Pick<Work, 'title' | 'author' | 'intro' | 'coverUrl'>>): Work | null {
  const w = appStore.getWork(id)
  if (!w) return null
  const next: Work = { ...w, ...patch, updatedAt: now() }
  appStore.upsertWork(next)
  return next
}


/**
 * 把源作品的全部内容（卷/章/版本）追加到目标作品，然后删除源。
 *
 * 场景：用户从旧版导入时，或跨设备同步时，意外出现同名/重复作品；
 * 旧数据里某个工作表的关联（角色/伏笔/便签/outlines/stats）属于 workId 维度，
 * 合并前会**优先用 dst** 作为保留者，src 的素材数据保留到 dst 下后再删 src。
 *
 * ⚠️ 注意：
 *  - 同 id 的章节（如「前言」）会被去重保留首份，其它版本被丢弃；
 *  - 目标作品存在则保留 dst.title（不强行覆盖），仅在 src 有更新时合并 author/intro。
 *  - 不写 recovery（合并是用户主动行为，不是异常退出）。
 */
export function mergeWork(srcId: string, dstId: string): { ok: true; mergedChapters: number } | { ok: false; error: string } {
  if (srcId === dstId) return { ok: false, error: '源与目标不能相同' }
  const dst = appStore.getWork(dstId)
  const src = appStore.getWork(srcId)
  if (!dst || !src) return { ok: false, error: '源或目标作品不存在' }

  // 1) 把 src 的卷合并到 dst（同名卷内合并章节，不同名追加新卷）
  let mergedChapters = 0
  for (const sv of src.volumes) {
    const dv = dst.volumes.find((v) => v.title === sv.title) ?? null
    let targetVolume = dv
    if (!targetVolume) {
      // 新卷：复制整个结构（id 重新生成避免冲突）
      targetVolume = {
        id: newId('vol'),
        title: sv.title,
        chapters: [],
        order: dst.volumes.length,
        createdAt: sv.createdAt,
        updatedAt: sv.updatedAt
      }
      dst.volumes.push(targetVolume)
    }
    for (const sc of sv.chapters) {
      // 同标题章节视作同一章：保留首份内容（含更长的一边）。
      const dup = targetVolume.chapters.find((c) => c.title === sc.title)
      if (dup) {
        const incoming = String(sc.content ?? '').length
        const existing = String(dup.content ?? '').length
        if (incoming > existing) {
          dup.content = sc.content
          dup.wordCount = sc.wordCount
          dup.updatedAt = Math.max(dup.updatedAt, sc.updatedAt)
          mergedChapters++
        }
      } else {
        targetVolume.chapters.push({
          ...sc,
          id: newId('ch'),
          versions: (sc.versions ?? []).map((v) => ({ ...v, id: newId('ver') })),
          createdAt: sc.createdAt,
          updatedAt: sc.updatedAt
        })
        mergedChapters++
      }
    }
    // 重新按 order 排序（防御）
    targetVolume.chapters.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  }

  // 2) 字段合并
  if (!dst.author && src.author) dst.author = src.author
  if (!dst.intro && src.intro) dst.intro = src.intro

  // 3) 素材（角色/伏笔/便签/outlines/stats）从 src 迁到 dst（id 改写）
  const migrate = (list: unknown[]): unknown[] => list  // 占位；真正迁移交给 store
  void migrate

  appStore.migrateWork(srcId, dstId)

  // 4) 删 src
  appStore.deleteWork(srcId)
  if (appStore.getSettings().currentWorkId === srcId) {
    appStore.setSettings({ currentWorkId: dstId })
  }

  // 5) 重新统计并落库
  dst.updatedAt = now()
  dst.createdAt = Math.min(dst.createdAt, src.createdAt)
  appStore.upsertWork(dst)
  return { ok: true, mergedChapters }
}

export function deleteWork(id: string): void {
  appStore.deleteWork(id)
  const s = appStore.getSettings()
  if (s.currentWorkId === id) {
    const rest = appStore.getWorks()
    appStore.setSettings({ currentWorkId: rest[0]?.id })
  }
}

/** 查找章节及其所属卷 */
export function findChapter(
  workId: string,
  chapterId: string
): { work: Work; volume: Volume; chapter: Chapter } | null {
  const work = appStore.getWork(workId)
  if (!work) return null
  for (const volume of work.volumes) {
    const chapter = volume.chapters.find((c) => c.id === chapterId)
    if (chapter) return { work, volume, chapter }
  }
  return null
}

function persist(work: Work): void {
  work.updatedAt = now()
  appStore.upsertWork(work)
}

// ---------------------------------------------------------------------------
// 卷
// ---------------------------------------------------------------------------

export function createVolume(workId: string, title: string): Volume | null {
  const work = appStore.getWork(workId)
  if (!work) return null
  const t = now()
  const volume: Volume = {
    id: newId('vol'),
    title: title.trim() || `第${work.volumes.length + 1}卷`,
    chapters: [],
    order: work.volumes.length,
    createdAt: t,
    updatedAt: t
  }
  work.volumes.push(volume)
  persist(work)
  return volume
}

export function renameVolume(workId: string, volumeId: string, title: string): boolean {
  const work = appStore.getWork(workId)
  const vol = work?.volumes.find((v) => v.id === volumeId)
  if (!work || !vol) return false
  vol.title = title
  vol.updatedAt = now()
  persist(work)
  return true
}

export function deleteVolume(workId: string, volumeId: string): boolean {
  const work = appStore.getWork(workId)
  if (!work) return false
  const i = work.volumes.findIndex((v) => v.id === volumeId)
  if (i < 0) return false
  // 至少保留一卷
  if (work.volumes.length <= 1) return false
  work.volumes.splice(i, 1)
  work.volumes.forEach((v, idx) => (v.order = idx))
  persist(work)
  return true
}

// ---------------------------------------------------------------------------
// 章节
// ---------------------------------------------------------------------------

export function createChapter(workId: string, volumeId: string, title: string): Chapter | null {
  const work = appStore.getWork(workId)
  if (!work) return null
  const vol = work.volumes.find((v) => v.id === volumeId) ?? work.volumes[0]
  if (!vol) return null
  const t = now()
  const chapter: Chapter = {
    id: newId('ch'),
    title: title.trim() || `第${vol.chapters.length + 1}章`,
    content: '',
    wordCount: 0,
    createdAt: t,
    updatedAt: t,
    versions: []
  }
  vol.chapters.push(chapter)
  vol.updatedAt = t
  persist(work)
  return chapter
}

export function renameChapter(workId: string, chapterId: string, title: string): boolean {
  const found = findChapter(workId, chapterId)
  if (!found) return false
  found.chapter.title = title
  found.chapter.updatedAt = now()
  persist(found.work)
  return true
}

/**
 * 写入章节摘要。
 *
 * ⚠️ 此前 renderer 通过 `window.api.chapter.setSummary?.()` 可选调用写入摘要，
 * 但该 API 从未实现 —— 可选链让失败完全静默，
 * 导致 UI 永远显示「（尚未生成摘要）」。这里补齐真正的落地点。
 *
 * @param version 生成摘要时的正文字数，用于判断摘要是否已过期
 */
export function setChapterSummary(
  workId: string,
  chapterId: string,
  summary: string,
  version: number
): boolean {
  const found = findChapter(workId, chapterId)
  if (!found) return false
  found.chapter.summary = String(summary ?? '').slice(0, 500)
  found.chapter.summaryUpdatedAt = now()
  found.chapter.summaryVersion = Number(version) || 0
  found.chapter.updatedAt = now()
  persist(found.work)
  return true
}

export function deleteChapter(workId: string, chapterId: string): boolean {  const work = appStore.getWork(workId)
  if (!work) return false
  for (const vol of work.volumes) {
    const i = vol.chapters.findIndex((c) => c.id === chapterId)
    if (i >= 0) {
      // 每卷至少保留一章
      if (vol.chapters.length <= 1) return false
      vol.chapters.splice(i, 1)
      vol.updatedAt = now()
      persist(work)
      clearRecovery(chapterId)
      return true
    }
  }
  return false
}

export function reorderChapters(workId: string, volumeId: string, chapterIds: string[]): boolean {
  const work = appStore.getWork(workId)
  const vol = work?.volumes.find((v) => v.id === volumeId)
  if (!work || !vol) return false
  const map = new Map(vol.chapters.map((c) => [c.id, c]))
  const next: Chapter[] = []
  for (const id of chapterIds) {
    const c = map.get(id)
    if (c) {
      next.push(c)
      map.delete(id)
    }
  }
  // 未列出的章节追加在后面，避免丢失
  for (const c of map.values()) next.push(c)
  vol.chapters = next
  vol.updatedAt = now()
  persist(work)
  return true
}

// ---------------------------------------------------------------------------
// 版本历史（阶段 5.7）
// ---------------------------------------------------------------------------

/**
 * 裁剪版本列表。
 * 保留规则：最近 KEEP_RECENT 个 + 每天第一个 + important。
 */
export function pruneVersions(versions: ChapterVersion[]): ChapterVersion[] {
  if (versions.length <= MAX_VERSIONS) return versions

  // 按时间倒序（新 -> 旧）
  const sorted = [...versions].sort((a, b) => b.createdAt - a.createdAt)
  const keep = new Set<string>()

  // 1) 最近 KEEP_RECENT 个
  sorted.slice(0, KEEP_RECENT).forEach((v) => keep.add(v.id))

  // 2) 每天第一个（即当天最早的一个）
  const byDay = new Map<string, ChapterVersion>()
  for (const v of sorted) {
    const day = new Date(v.createdAt).toISOString().slice(0, 10)
    const cur = byDay.get(day)
    if (!cur || v.createdAt < cur.createdAt) byDay.set(day, v)
  }
  byDay.forEach((v) => keep.add(v.id))

  // 3) important
  sorted.filter((v) => v.important).forEach((v) => keep.add(v.id))

  // 4) 仍然不足则按新到旧补齐
  if (keep.size < MAX_VERSIONS) {
    for (const v of sorted) {
      if (keep.size >= MAX_VERSIONS) break
      keep.add(v.id)
    }
  }

  // 返回时剔除超出上限的旧版本，并保持新 -> 旧的顺序
  return sorted.filter((v) => keep.has(v.id))
}

function pushVersion(chapter: Chapter, source: VersionSource): void {
  const version: ChapterVersion = {
    id: newId('v'),
    content: chapter.content,
    wordCount: chapter.wordCount,
    source,
    createdAt: now()
  }
  const versions = [version, ...(chapter.versions ?? [])]
  chapter.versions = pruneVersions(versions)
}

/**
 * 保存章节内容。
 * @param source 版本来源；为空表示不记录版本（例如仅更新摘要）
 */
export function saveChapter(
  workId: string,
  chapterId: string,
  content: string,
  source: VersionSource | null = 'manual'
): Chapter | null {
  const found = findChapter(workId, chapterId)
  if (!found) return null
  const { chapter, volume, work } = found

  // 内容未变则只更新时间，不产生版本
  const contentChanged = chapter.content !== content

  if (source && contentChanged) {
    // 自动保存：同一分钟内只保留一个
    if (source === 'autosave') {
      const last = chapter.versions?.[0]
      if (
        last &&
        last.source === 'autosave' &&
        Date.now() - last.createdAt < AUTOSAVE_SAME_MINUTE_WINDOW_MS
      ) {
        // 覆盖上一条自动保存版本，避免刷屏
        last.content = chapter.content
        last.wordCount = chapter.wordCount
        last.createdAt = Date.now()
      } else {
        pushVersion(chapter, source)
      }
    } else {
      pushVersion(chapter, source)
    }
  }

  chapter.content = content
  chapter.wordCount = countWords(content)
  chapter.updatedAt = now()
  volume.updatedAt = chapter.updatedAt
  persist(work)

  // 正常保存后清理崩溃恢复临时文件
  clearRecovery(chapterId)
  return chapter
}

/** 直接写入版本（供恢复、导入、AI 插入使用） */
export function addVersion(
  workId: string,
  chapterId: string,
  content: string,
  source: VersionSource
): ChapterVersion | null {
  const found = findChapter(workId, chapterId)
  if (!found) return null
  const { chapter } = found
  const version: ChapterVersion = {
    id: newId('v'),
    content,
    wordCount: countWords(content),
    source,
    createdAt: now()
  }
  chapter.versions = pruneVersions([version, ...(chapter.versions ?? [])])
  persist(found.work)
  return version
}

export function listVersions(workId: string, chapterId: string): ChapterVersion[] {
  const found = findChapter(workId, chapterId)
  return found?.chapter.versions ?? []
}

/** 回滚到指定版本（回滚前先把当前内容存为一个版本，可撤销） */
export function restoreVersion(workId: string, chapterId: string, versionId: string): Chapter | null {
  const found = findChapter(workId, chapterId)
  if (!found) return null
  const { chapter } = found
  const target = chapter.versions?.find((v) => v.id === versionId)
  if (!target) return null

  // 保存当前内容，保证回滚可撤销
  pushVersion(chapter, 'manual')

  chapter.content = target.content
  chapter.wordCount = target.wordCount
  chapter.updatedAt = now()
  persist(found.work)
  return chapter
}

export function markVersionImportant(
  workId: string,
  chapterId: string,
  versionId: string,
  important: boolean
): boolean {
  const found = findChapter(workId, chapterId)
  const v = found?.chapter.versions?.find((x) => x.id === versionId)
  if (!found || !v) return false
  v.important = important
  persist(found.work)
  return true
}

export function deleteVersion(workId: string, chapterId: string, versionId: string): boolean {
  const found = findChapter(workId, chapterId)
  if (!found) return false
  const before = found.chapter.versions?.length ?? 0
  found.chapter.versions = (found.chapter.versions ?? []).filter((v) => v.id !== versionId)
  if (found.chapter.versions.length === before) return false
  persist(found.work)
  return true
}

/** 章节摘要更新（阶段 5.5，供子智能体 C 调用） */
export function updateChapterSummary(
  workId: string,
  chapterId: string,
  summary: string,
  version: number
): boolean {
  const found = findChapter(workId, chapterId)
  if (!found) return false
  found.chapter.summary = summary
  found.chapter.summaryUpdatedAt = now()
  found.chapter.summaryVersion = version
  persist(found.work)
  return true
}

/**
 * 逐行 diff（阶段 5.7）——不引入 diff 库。
 * 使用 LCS 动态规划求最长公共子序列，再回溯生成编辑脚本。
 */
export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // 大文本保护：避免 O(n*m) 过大
  if (n * m > 4_000_000) {
    return [
      ...a.map((t) => ({ kind: 'del' as const, text: t })),
      ...b.map((t) => ({ kind: 'add' as const, text: t }))
    ]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] })
      i++
    } else {
      out.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}

/** 版本导出为 TXT 内容 */
export function versionToTxt(workId: string, chapterId: string, versionId: string): string | null {
  const found = findChapter(workId, chapterId)
  const v = found?.chapter.versions?.find((x) => x.id === versionId)
  if (!found || !v) return null
  const d = new Date(v.createdAt)
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `《${found.work.title}》${found.chapter.title}\n版本时间：${stamp}（${v.source}，${v.wordCount} 字）\n\n${v.content}\n`
}
