/**
 * 素材模块 IPC（大纲/角色/伏笔/地点/设定/便签/统计）。
 *
 * ⚠️ OWNER: 子智能体 C（阶段 5.5、5.6、6）
 *
 * 约定（与 CONTRACT §5 一致）：
 *  - 通道名一律取自 @shared/ipc 的 IPC 常量
 *  - 读操作**不写盘**：返回的是"视图"（例如角色提及次数由正文实时统计得到），
 *    只有显式写操作才落 electron-store，避免读接口产生意外的持久化副作用
 *  - 所有合并语义集中在 services/material.ts，本文件只负责取数与落盘
 */
import { IPC } from '@shared/ipc'
import type { Character, DailyStat, Foreshadowing, Location, Note, Outline, Setting } from '@shared/material'
import type { Res } from '@shared/ipc'
import type { Chapter, Work } from '@shared/work'
import { appStore } from '../store'
import { handleRaw } from './handle'
import {
  accumulateDailyStat,
  clampSummary,
  countMentions,
  normalizeName,
  normalizeOutlineTree,
  recentStats,
  removeCharacter,
  removeForeshadowing,
  removeNote,
  sortNotes,
  unionStrings,
  upsertCharacter,
  upsertForeshadowing,
  upsertNamedEntity,
  upsertNote,
  dedupeStrings
} from '../services/material'

// ---------------------------------------------------------------- 工具

/** 展平作品的全部章节 */
function allChapters(work: Work | undefined): Chapter[] {
  if (!work) return []
  return (work.volumes ?? []).flatMap((v) => v.chapters ?? [])
}

/** 读取作品（不存在或尚未实现作品模块时返回 undefined） */
function readWork(workId: string): Work | undefined {
  try {
    return appStore.getWork(workId)
  } catch {
    return undefined
  }
}

/** 全部章节正文拼接（超过 8MB 跳过，避免读接口过慢） */
function collectText(work: Work | undefined): string | null {
  const chapters = allChapters(work)
  let total = 0
  for (const c of chapters) total += (c.content ?? '').length
  if (total > 8 * 1024 * 1024) return null
  return chapters.map((c) => c.content ?? '').join('\n')
}

const okVoid: Res<void> = { ok: true, data: undefined }

// ---------------------------------------------------------------- 角色

/**
 * 角色列表视图。
 * 阶段 6 要求「自动统计提及次数」：这里用作品正文实时统计，
 * 与已存数据取较大值（不缩小已累加的提取结果），并补全出场章节。
 */
function characterView(workId: string): Character[] {
  const stored = appStore.getCharacters(workId)
  const work = readWork(workId)
  const text = collectText(work)
  if (text === null) return sortCharacters(stored)

  const chapters = allChapters(work)
  return sortCharacters(
    stored.map((c) => {
      const names = [c.name, ...(c.tags ?? [])].filter(Boolean)
      const counted = chapterMentions(chapters, names.length > 1 ? [c.name] : names)
      const appearanceIds = chapters
        .filter((ch) => countMentions(ch.content ?? '', c.name) > 0)
        .map((ch) => ch.id)
      return {
        ...c,
        mentions: Math.max(c.mentions ?? 0, counted),
        appearances: unionStrings(c.appearances, appearanceIds)
      }
    })
  )
}

/** 单名字跨章节提及总数 */
function chapterMentions(chapters: Chapter[], names: string[]): number {
  let total = 0
  for (const ch of chapters) {
    for (const n of names) total += countMentions(ch.content ?? '', n)
  }
  return total
}

/** 角色排序：提及次数倒序，其次最近更新 */
function sortCharacters(list: Character[]): Character[] {
  return [...list].sort((a, b) => b.mentions - a.mentions || b.lastUpdatedAt - a.lastUpdatedAt)
}

function handleCharacterUpsert(workId: string, patch: Partial<Character> & { name: string }): Res<Character> {
  const list = appStore.getCharacters(workId)
  const res = upsertCharacter(list, patch)
  appStore.setCharacters(workId, res.list)
  return { ok: true, data: res.item }
}

function handleCharacterDelete(workId: string, id: string): Res<void> {
  appStore.setCharacters(workId, removeCharacter(appStore.getCharacters(workId), id))
  return okVoid
}

// ---------------------------------------------------------------- 伏笔

function handleForeshadowingUpsert(
  workId: string,
  patch: Partial<Foreshadowing> & { content: string }
): Res<Foreshadowing> {
  const list = appStore.getForeshadowings(workId)
  const res = upsertForeshadowing(list, patch)
  appStore.setForeshadowings(workId, res.list)
  return { ok: true, data: res.item }
}

function handleForeshadowingDelete(workId: string, id: string): Res<void> {
  appStore.setForeshadowings(workId, removeForeshadowing(appStore.getForeshadowings(workId), id))
  return okVoid
}

// ---------------------------------------------------------------- 大纲

/**
 * 大纲树视图（总纲 → 分卷 → 章纲）。
 *
 * 读接口不落盘：
 *  - 已存大纲做规整（补 id / 重排 order / 去重）
 *  - 书里有、大纲里没有的章节 → 合成章纲节点（title 用章节标题），便于"点击跳转"
 *  - 章节已有 summary（阶段 5.5）而章纲没有摘要 → 用章节摘要补齐
 */
function outlineView(workId: string): Outline[] {
  const stored = normalizeOutlineTree(appStore.getOutlines(workId))
  const work = readWork(workId)
  const chapters = allChapters(work)
  if (!work || chapters.length === 0) return stored

  const seen = new Set<string>()
  const walk = (nodes: Outline[]): Outline[] =>
    nodes.map((n) => {
      if (n.chapterId) seen.add(n.chapterId)
      return { ...n, children: walk(n.children ?? []) }
    })
  walk(stored)

  // 补齐已有节点的标题与摘要
  const byChapter = new Map(chapters.map((c) => [c.id, c]))
  const enrich = (nodes: Outline[]): Outline[] =>
    nodes.map((n) => {
      const ch = n.chapterId ? byChapter.get(n.chapterId) : undefined
      const title = n.title && n.title !== '本章' ? n.title : ch?.title || n.title
      const summary = n.chapterSummary || (ch?.summary ? clampSummary(ch.summary) : undefined)
      return { ...n, title, chapterSummary: summary, children: enrich(n.children ?? []) }
    })

  const enriched = enrich(stored)

  // 合成缺失的章纲
  const missing = chapters.filter((c) => !seen.has(c.id))
  if (missing.length === 0) return enriched

  const nodes: Outline[] = missing.map((c) => ({
    id: `out_auto_${c.id}`,
    chapterId: c.id,
    level: 'chapter' as const,
    title: c.title || '未命名章节',
    chapterSummary: c.summary ? clampSummary(c.summary) : undefined,
    keyEvents: [],
    characters: [],
    children: [],
    order: 0,
    updatedAt: c.updatedAt || Date.now()
  }))

  if (enriched.length === 0) {
    // 空大纲：直接按作品结构合成为「总纲 → 分卷 → 章纲」
    const volumes = work.volumes ?? []
    if (volumes.length === 0) return nodes
    return [
      {
        id: `out_root_${work.id}`,
        level: 'master',
        title: work.title || '总纲',
        keyEvents: [],
        characters: [],
        order: 0,
        updatedAt: Date.now(),
        children: volumes.map((v, vi) => ({
          id: `out_vol_${v.id}`,
          level: 'volume' as const,
          title: v.title || `第 ${vi + 1} 卷`,
          keyEvents: [],
          characters: [],
          order: vi,
          updatedAt: v.updatedAt || Date.now(),
          children: (v.chapters ?? []).map((c, ci) => ({
            id: `out_auto_${c.id}`,
            chapterId: c.id,
            level: 'chapter' as const,
            title: c.title || `第 ${ci + 1} 章`,
            chapterSummary: c.summary ? clampSummary(c.summary) : undefined,
            keyEvents: [],
            characters: [],
            children: [],
            order: ci,
            updatedAt: c.updatedAt || Date.now()
          }))
        }))
      }
    ]
  }

  // 已有结构：追加到最后一个分卷下
  const tree = [...enriched]
  let lastVolume = -1
  tree.forEach((n, i) => {
    if (n.level === 'volume') lastVolume = i
  })
  if (lastVolume >= 0) {
    const vol = tree[lastVolume]
    tree[lastVolume] = {
      ...vol,
      children: [...vol.children, ...nodes.map((n, i) => ({ ...n, order: vol.children.length + i }))]
    }
  } else {
    tree.push(...nodes.map((n, i) => ({ ...n, order: tree.length + i })))
  }
  return tree
}

function handleOutlineSave(workId: string, nodes: Outline[]): Res<void> {
  const now = Date.now()
  const normalized = normalizeOutlineTree(nodes, now).map(function clean(n): Outline {
    return {
      ...n,
      // 摘要统一收敛到 100 字（阶段 5.5）
      chapterSummary: n.chapterSummary ? clampSummary(n.chapterSummary) : undefined,
      keyEvents: dedupeStrings(n.keyEvents ?? []),
      characters: dedupeStrings(n.characters ?? []),
      updatedAt: n.updatedAt || now,
      children: (n.children ?? []).map(clean)
    }
  })
  appStore.setOutlines(workId, normalized)
  return okVoid
}

// ---------------------------------------------------------------- 地点 / 设定

/**
 * 地点 / 设定视图。
 * 自动同步（阶段 5.6）由主进程服务写入；渲染进程侧目前只有只读通道。
 */
function locationView(workId: string): Location[] {
  return [...appStore.getLocations(workId)].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
}

function settingView(workId: string): Setting[] {
  return [...appStore.getSettingsList(workId)].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
}

function handleNamedEntityUpsert(
  workId: string,
  kind: 'location' | 'setting',
  patch: Partial<Location> & { name: string }
): Res<Location> {
  if (kind === 'location') {
    const list = appStore.getLocations(workId)
    const res = upsertNamedEntity(list, patch, 'location')
    appStore.setLocations(workId, res.list)
    return { ok: true, data: res.item }
  }
  const list = appStore.getSettingsList(workId)
  const res = upsertNamedEntity(list, patch, 'setting')
  appStore.setSettingsList(workId, res.list)
  return { ok: true, data: res.item as unknown as Location }
}

// ---------------------------------------------------------------- 便签

function handleNoteUpsert(workId: string, patch: Partial<Note> & { content: string }): Res<Note> {
  const res = upsertNote(appStore.getNotes(workId), patch)
  appStore.setNotes(workId, sortNotes(res.list))
  return { ok: true, data: res.item }
}

function handleNoteDelete(workId: string, id: string): Res<void> {
  appStore.setNotes(workId, removeNote(appStore.getNotes(workId), id))
  return okVoid
}

// ---------------------------------------------------------------- 统计

/**
 * 码字统计。
 * - 传 days（>0）：返回最近 days 天、缺失日期补 0 的连续序列（供柱状图）
 * - 不传：返回全部历史（供总时长 / 总字数汇总）
 */
function handleStatList(workId: string, days?: number): DailyStat[] {
  const all = appStore.getStats(workId)
  if (typeof days === 'number' && days > 0) return recentStats(all, Math.min(days, 400))
  return [...all].sort((a, b) => a.date.localeCompare(b.date))
}

function handleStatAdd(workId: string, words: number, durationMs: number): Res<void> {
  const next = accumulateDailyStat(appStore.getStats(workId), Number(words) || 0, Number(durationMs) || 0)
  appStore.setStats(workId, next)
  return okVoid
}

// ---------------------------------------------------------------- 注册

export function registerMaterialIpc(): void {
  // ---- 角色 ----
  handleRaw<[string], Character[]>(IPC.characterList, (_e, workId) => characterView(String(workId)))
  handleRaw<[string, Partial<Character> & { name: string }], Res<Character>>(IPC.characterUpsert, (_e, workId, c) =>
    handleCharacterUpsert(String(workId), c ?? ({ name: '' } as Partial<Character> & { name: string }))
  )
  handleRaw<[string, string], Res<void>>(IPC.characterDelete, (_e, workId, id) =>
    handleCharacterDelete(String(workId), String(id))
  )

  // ---- 伏笔 ----
  handleRaw<[string], Foreshadowing[]>(IPC.foreshadowingList, (_e, workId) =>
    [...appStore.getForeshadowings(String(workId))].sort((a, b) => b.updatedAt - a.updatedAt)
  )
  handleRaw<[string, Partial<Foreshadowing> & { content: string }], Res<Foreshadowing>>(
    IPC.foreshadowingUpsert,
    (_e, workId, f) =>
      handleForeshadowingUpsert(
        String(workId),
        f ?? ({ content: '' } as Partial<Foreshadowing> & { content: string })
      )
  )
  handleRaw<[string, string], Res<void>>(IPC.foreshadowingDelete, (_e, workId, id) =>
    handleForeshadowingDelete(String(workId), String(id))
  )

  // ---- 大纲 ----
  handleRaw<[string], Outline[]>(IPC.outlineGet, (_e, workId) => outlineView(String(workId)))
  handleRaw<[string, Outline[]], Res<void>>(IPC.outlineSave, (_e, workId, nodes) =>
    handleOutlineSave(String(workId), Array.isArray(nodes) ? nodes : [])
  )

  // ---- 地点 / 设定（只读通道；写入由主进程同步服务完成）----
  handleRaw<[string], Location[]>(IPC.locationList, (_e, workId) => locationView(String(workId)))
  handleRaw<[string], Setting[]>(IPC.settingList, (_e, workId) => settingView(String(workId)))

  // ---- 便签 ----
  handleRaw<[string], Note[]>(IPC.noteList, (_e, workId) => sortNotes(appStore.getNotes(String(workId))))
  handleRaw<[string, Partial<Note> & { content: string }], Res<Note>>(IPC.noteUpsert, (_e, workId, n) =>
    handleNoteUpsert(String(workId), n ?? ({ content: '' } as Partial<Note> & { content: string }))
  )
  handleRaw<[string, string], Res<void>>(IPC.noteDelete, (_e, workId, id) => handleNoteDelete(String(workId), String(id)))

  // ---- 统计 ----
  handleRaw<[string, number | undefined], DailyStat[]>(IPC.statList, (_e, workId, days) =>
    handleStatList(String(workId), days)
  )
  handleRaw<[string, number, number], Res<void>>(IPC.statAdd, (_e, workId, words, durationMs) =>
    handleStatAdd(String(workId), words, durationMs)
  )
}

/** 供主进程内部（自动同步服务）复用的写入口 */
export const materialWriter = {
  upsertCharacter: handleCharacterUpsert,
  removeCharacter: handleCharacterDelete,
  upsertForeshadowing: handleForeshadowingUpsert,
  removeForeshadowing: handleForeshadowingDelete,
  upsertNamedEntity: handleNamedEntityUpsert,
  saveOutline: handleOutlineSave,
  outlineView,
  characterView,
  locationView,
  settingView,
  statAdd: handleStatAdd,
  /** 归一化名称（供同步服务做同名判定） */
  normalizeName
}
