/**
 * 素材 store（阶段 5.5 / 5.6 / 6）。
 *
 * ⚠️ OWNER: 子智能体 C
 *
 * 职责：
 *  - 按 workId 加载与缓存角色 / 伏笔 / 大纲 / 地点 / 设定 / 便签 / 统计
 *  - 阶段 5.5 章节摘要：手动、自动（≥500 字且停输 30s、切换章节）、批量；>3000 字分段摘要后合并
 *  - 阶段 5.6 自动同步：调用后台会话提取 → 生成确认清单 → 确认/自动/手动三种模式落地，自动模式 30s 内可撤销
 *  - 阶段 6：大纲树拖拽排序、角色提及统计、伏笔回收关联、便签置顶、码字统计
 *
 * 设计要点：
 *  - **不阻塞编辑**：所有 AI 调用都是"发起后立即返回"，进度通过 store 状态驱动 UI
 *  - **不覆盖正文**：摘要与同步只写素材与章纲，绝不调用 chapter.save
 *  - **降级不阻塞**：后台未登录/失败只提示，可重试；<200 字跳过
 *  - 合并语义的唯一权威在 `src/main/services/material.ts`，本 store 只做「预览用的轻量 diff」，
 *    真正的写回一律走既有的 window.api.material.* 通道（不新增 IPC 通道）
 */
import { create } from 'zustand'
import type {
  Character,
  DailyStat,
  Foreshadowing,
  ForeshadowingType,
  Location,
  Note,
  Outline,
  Setting,
  SyncExtraction,
  SyncMode
} from '@shared/material'
import type { Chapter, Work } from '@shared/work'
import { getAdapter } from '../adapters/registry'
import { toScripts } from '../adapters/scripts'
import { useUiStore } from './ui'
import { useSiteStore } from './site'
import { refreshSiteStatus } from '../services/aiError'
import { useWorkStore } from './work'

// ---------------------------------------------------------------- 常量

/** 少于该字数跳过摘要（阶段 5.5 降级） */
export const SUMMARY_MIN_CHARS = 200
/** 超过该字数先分段摘要再合并（阶段 5.5） */
export const SUMMARY_SEGMENT_CHARS = 3000
/** 摘要上限字数 */
export const SUMMARY_MAX_CHARS = 100
/** 自动摘要：停输防抖（30 秒） */
export const AUTO_SUMMARY_DEBOUNCE_MS = 30_000
/** 自动摘要触发的最低章节字数 */
export const AUTO_SUMMARY_MIN_CHARS = 500
/** 自动同步后允许撤销的时间窗（30 秒） */
export const SYNC_UNDO_WINDOW_MS = 30_000
/** 自动同步的最低章节字数 */
export const SYNC_MIN_CHARS = 200

// ---------------------------------------------------------------- 本地工具

/** 名称归一化，用于同名判定 */
export function normalizeName(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s\u3000·・.,，。:：;；、"'“”‘’（）()【】[\]!！?？-]/g, '')
    .toLowerCase()
}

/** 数组去重（忽略大小写） */
export function dedupe(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** 摘要清洗 + 截断 */
export function clampSummary(text: string, max: number = SUMMARY_MAX_CHARS): string {
  let s = String(text ?? '')
    .replace(/```[a-z]*/gi, '')
    .replace(/^\s*(摘要|概括|总结)\s*[:：]\s*/, '')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/(以上|希望|如需|注)[^。！？]*$/, '').trim()
  if (s.length > max) s = s.slice(0, max).replace(/[，,、；;：:]$/, '')
  return s
}

/** 二元组集合，用于伏笔模糊匹配 */
function bigrams(value: string): Set<string> {
  const s = normalizeName(value)
  const out = new Set<string>()
  if (!s) return out
  if (s.length <= 2) {
    out.add(s)
    return out
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** Dice 相似度 0-1 */
export function similarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

/** 伏笔匹配评分 */
export function foreshadowingScore(existing: Foreshadowing, content: string, relatedTo?: string): number {
  const a = normalizeName(existing.content)
  const b = normalizeName(content)
  if (!a || !b) return 0
  if (a === b) return 1
  let score = similarity(existing.content, content)
  if (a.includes(b) || b.includes(a)) score += 0.25
  const ra = normalizeName(existing.relatedTo)
  const rb = normalizeName(relatedTo)
  if (ra && rb && ra === rb) score += 0.35
  return score
}

/** 本地日期键 YYYY-MM-DD */
export function dateKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 非空白字符数（与主进程 countWords 一致） */
export function countWords(text: string): number {
  return String(text ?? '').replace(/\s/g, '').length
}

/**
 * 按段落边界切段（阶段 5.5：>3000 字分段摘要后合并）。
 * 段落超长时硬切。
 */
export function splitForSummary(content: string, max: number = SUMMARY_SEGMENT_CHARS): string[] {
  const text = String(content ?? '').trim()
  if (!text) return []
  if (text.length <= max) return [text]
  const paragraphs = text.split(/\n+/)
  const segments: string[] = []
  let buf = ''
  const flush = (): void => {
    if (buf.trim()) segments.push(buf.trim())
    buf = ''
  }
  for (const para of paragraphs) {
    const p = para.trim()
    if (!p) continue
    if (p.length > max) {
      flush()
      for (let i = 0; i < p.length; i += max) segments.push(p.slice(i, i + max))
      continue
    }
    if (buf.length + p.length + 1 > max) flush()
    buf = buf ? `${buf}\n${p}` : p
  }
  flush()
  return segments.length > 0 ? segments : [text]
}

// ---------------------------------------------------------------- 提示词

/** 摘要提示词（与 @shared/prompts 的 summarize 模板一致） */
export function buildSummaryPrompt(content: string): string {
  return `请为以下小说章节生成 100 字以内的摘要，概括主要剧情、出场角色和关键转折。只输出摘要：\n\n${String(
    content ?? ''
  ).trim()}`
}

/** 分段摘要合并提示词 */
export function buildSummaryMergePrompt(segments: string[]): string {
  return `以下是同一章的分段摘要，请合并为一段 100 字以内的完整摘要，概括主要剧情、出场角色和关键转折。只输出摘要：\n\n${segments
    .map((s, i) => `【第 ${i + 1} 段摘要】${s}`)
    .join('\n')}`
}

/** 同步提取提示词（严格 JSON） */
export function buildSyncPrompt(content: string): string {
  return `请阅读以下小说章节，提取结构化信息。严格按以下 JSON 输出，不要输出任何其他内容：
{"characters":[{"name":"角色名","isNew":true,"intro":"简介","tags":["标签"],"appearances":1}],
 "outline":{"chapterSummary":"本章摘要","keyEvents":["关键事件"],"endingHook":"结尾钩子"},
 "foreshadowing":[{"content":"伏笔内容","type":"plant","relatedTo":"关联对象"}],
 "locations":[{"name":"地点名","isNew":true,"description":"描述"}],
 "settings":[{"name":"设定名","isNew":true,"description":"描述"}]}

章节正文：
${String(content ?? '').trim()}`
}

// ---------------------------------------------------------------- 解析

const FORESHADOWING_TYPES: ForeshadowingType[] = ['plant', 'recover', 'item', 'identity', 'event', 'other']

function normalizeForeshadowingType(value: unknown): ForeshadowingType {
  const v = String(value ?? '').trim().toLowerCase() as ForeshadowingType
  return FORESHADOWING_TYPES.includes(v) ? v : 'other'
}

/** 去 ``` 围栏 */
function stripFence(text: string): string {
  return String(text ?? '')
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
}

/** 提取第一个平衡的 JSON 对象（容错模型附加说明文字） */
export function extractJsonObject(text: string): string | null {
  const s = stripFence(text)
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return dedupe(value.map((v) => asString(v)))
}

/** 把任意解析结果规整为 SyncExtraction */
export function validateExtraction(raw: unknown): SyncExtraction {
  const obj = (raw ?? {}) as Record<string, unknown>
  const outline = (obj['outline'] ?? {}) as Record<string, unknown>

  const characters = (Array.isArray(obj['characters']) ? obj['characters'] : [])
    .map((c) => c as Record<string, unknown>)
    .filter((c) => c && typeof c === 'object' && asString(c['name']))
    .map((c) => ({
      name: asString(c['name']),
      isNew: Boolean(c['isNew']),
      intro: asString(c['intro']),
      tags: asStringArray(c['tags']),
      appearances: Number.isFinite(Number(c['appearances'])) ? Math.max(1, Math.trunc(Number(c['appearances']))) : 1
    }))

  const foreshadowing = (Array.isArray(obj['foreshadowing']) ? obj['foreshadowing'] : [])
    .map((f) => f as Record<string, unknown>)
    .filter((f) => f && typeof f === 'object' && asString(f['content']))
    .map((f) => ({
      content: asString(f['content']),
      type: normalizeForeshadowingType(f['type']),
      relatedTo: asString(f['relatedTo']) || undefined
    }))

  const locations = (Array.isArray(obj['locations']) ? obj['locations'] : [])
    .map((l) => l as Record<string, unknown>)
    .filter((l) => l && typeof l === 'object' && asString(l['name']))
    .map((l) => ({ name: asString(l['name']), isNew: Boolean(l['isNew']), description: asString(l['description']) }))

  const settings = (Array.isArray(obj['settings']) ? obj['settings'] : [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => s && typeof s === 'object' && asString(s['name']))
    .map((s) => ({ name: asString(s['name']), isNew: Boolean(s['isNew']), description: asString(s['description']) }))

  return {
    characters,
    outline: {
      chapterSummary: asString(outline['chapterSummary']),
      keyEvents: asStringArray(outline['keyEvents']),
      endingHook: asString(outline['endingHook'])
    },
    foreshadowing,
    locations,
    settings
  }
}

/** 解析同步提取回复 */
export function parseExtraction(text: string): { ok: true; data: SyncExtraction } | { ok: false; error: string } {
  const json = extractJsonObject(text)
  if (!json) return { ok: false, error: '回复中未找到 JSON' }
  try {
    const data = validateExtraction(JSON.parse(json) as unknown)
    const empty =
      data.characters.length === 0 &&
      data.foreshadowing.length === 0 &&
      data.locations.length === 0 &&
      data.settings.length === 0 &&
      !data.outline.chapterSummary &&
      data.outline.keyEvents.length === 0
    return empty ? { ok: false, error: '提取结果为空' } : { ok: true, data }
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${(err as Error).message}` }
  }
}

// ---------------------------------------------------------------- 后台调用

/** 后台会话调用封装（降级：返回错误而非抛出，调用方提示但不阻塞） */
async function callBackground(
  task: 'summarize' | 'sync-extract' | 'outline-gen',
  prompt: string
): Promise<{ ok: true; text: string; fromCache: boolean } | { ok: false; error: string }> {
  const siteId = useUiStore.getState().siteId || 'deepseek'
  const adapter = getAdapter(siteId)
  if (!adapter) return { ok: false, error: `站点「${siteId}」暂无适配器` }

  // 前置检查：站点当前状态
  const siteState = useSiteStore.getState().sites[siteId]
  if (siteState?.status.kind === 'logged-out') {
    return { ok: false, error: '站点未登录：请到右侧 AI 网页登录后重试' }
  }
  if (siteState?.status.kind === 'risk') {
    return { ok: false, error: '站点触发风控：请到右侧完成验证或切换站点' }
  }
  if (siteState?.status.kind === 'offline') {
    return { ok: false, error: '站点离线：请检查网络' }
  }

  try {
    const res = await window.api.bg.start({
      task,
      prompt,
      siteId,
      scripts: toScripts(adapter),
      cacheKeyExtra: prompt.slice(0, 400)
    })
    if (!res.ok) {
      // 失败后重新探测站点状态
      void refreshSiteStatus(siteId)
      return { ok: false, error: res.error || '后台请求失败' }
    }
    const text = String(res.data.text ?? '').trim()
    if (!text) {
      void refreshSiteStatus(siteId)
      return { ok: false, error: '后台返回为空（可能未登录）' }
    }
    return { ok: true, text, fromCache: res.data.fromCache === true }
  } catch (err) {
    void refreshSiteStatus(siteId)
    return { ok: false, error: (err as Error).message || '后台请求异常' }
  }
}

// ---------------------------------------------------------------- 同步计划（预览用）

export type SyncDomain = 'character' | 'foreshadowing' | 'location' | 'setting' | 'outline'

/** 一条可勾选变更（确认模式 UI 的数据源） */
export interface SyncChangeItem {
  id: string
  domain: SyncDomain
  action: 'create' | 'update' | 'conflict'
  label: string
  detail: string
  /** 命中的已有实体 id */
  targetId?: string
  /** 冲突候选，供手动关联/合并 */
  candidates: Array<{ id: string; label: string }>
  conflictMessage?: string
  defaultChecked: boolean
  checked: boolean
  isNew: boolean
  /** 落地数据（写入既有通道时使用） */
  payload: Character | Foreshadowing | Location | Setting | Outline
}

/** 同步计划 */
export interface SyncPlan {
  workId: string
  chapterId: string
  chapterTitle: string
  changes: SyncChangeItem[]
  counts: { create: number; update: number; conflict: number; total: number }
  createdAt: number
}

/** 撤销记录 */
interface UndoRecord {
  workId: string
  chapterId: string
  expiresAt: number
  characters: Character[]
  foreshadowings: Foreshadowing[]
  locations: Location[]
  settingsList: Setting[]
  outlines: Outline[]
  label: string
}

/** 批量进度 */
export interface BatchProgress {
  kind: 'summary' | 'sync'
  current: number
  total: number
  label: string
}

interface MaterialState {
  workId: string | null
  loading: boolean
  loadedWorkId: string | null

  characters: Character[]
  foreshadowings: Foreshadowing[]
  outlines: Outline[]
  locations: Location[]
  settingsList: Setting[]
  notes: Note[]
  /** 最近 7 天（补零） */
  weekStats: DailyStat[]
  /** 全部历史 */
  allStats: DailyStat[]
  /** 作品与章节（用于跳转 / 摘要视图） */
  chapters: Chapter[]

  // ---- 阶段 5.5 ----
  /** 正在生成摘要的章节 */
  summaryBusy: string[]
  /** 批量进度（null 表示无批量任务） */
  batchProgress: BatchProgress | null

  // ---- 阶段 5.6 ----
  syncPlan: SyncPlan | null
  syncDialogOpen: boolean
  syncBusy: boolean

  // ---- 阶段 6 交互状态 ----
  /** 展开的大纲节点 id */
  expandedOutline: string[]
  /** 角色详情（出现章节）面板 */
  activeCharacterId: string | null
  /** 便签拖拽中 */
  draggingNoteId: string | null

  // ---- actions ----
  setWork: (workId: string | null) => Promise<void>
  refresh: () => Promise<void>
  refreshChapters: () => Promise<void>

  saveCharacter: (patch: Partial<Character> & { name: string }) => Promise<Character | null>
  deleteCharacter: (id: string) => Promise<void>

  saveForeshadowing: (patch: Partial<Foreshadowing> & { content: string }) => Promise<Foreshadowing | null>
  deleteForeshadowing: (id: string) => Promise<void>
  recoverForeshadowing: (id: string, chapterId?: string) => Promise<void>
  linkForeshadowing: (id: string, targetId: string) => Promise<void>

  saveOutline: (nodes: Outline[]) => Promise<void>
  addOutlineNode: (level: Outline['level'], parentId: string | null) => Promise<void>
  updateOutlineNode: (id: string, patch: Partial<Outline>) => Promise<void>
  removeOutlineNode: (id: string) => Promise<void>
  /** 原生 HTML5 拖拽排序：把 dragId 移动到 targetId 之前/之后 */
  moveOutlineNode: (dragId: string, targetId: string, position: 'before' | 'after' | 'inside') => Promise<void>
  toggleOutlineExpanded: (id: string) => void

  addNote: (content: string) => Promise<void>
  updateNote: (id: string, patch: Partial<Note>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  toggleNotePinned: (id: string) => Promise<void>
  setDraggingNote: (id: string | null) => void
  /** 把便签内容拖入草稿（由 DraftTab 消费；这里只做内容搬运，不写正文） */
  consumeDragNoteText: () => string | null

  loadStats: () => Promise<void>
  addStat: (words: number, durationMs: number) => Promise<void>

  generateSummary: (chapterId: string, opts?: { skipCache?: boolean; silent?: boolean }) => Promise<boolean>
  generateSummaryBatch: (chapterIds: string[]) => Promise<{ ok: number; failed: number; skipped: number }>
  scheduleAutoSummary: (chapterId: string, text: string) => void
  cancelAutoSummary: () => void

  analyzeChapter: (chapterId: string, opts?: { silent?: boolean }) => Promise<SyncPlan | null>
  /** 按当前设置的模式执行同步：确认 / 自动（可撤销）/ 手动 */
  runSync: (chapterId: string, opts?: { silent?: boolean }) => Promise<SyncPlan | null>
  /** 批量同步（逐章串行，显示进度） */
  runSyncBatch: (chapterIds: string[]) => Promise<{ ok: number; failed: number }>
  /** AI 自动建立人物画像（全作品扫描并合并进角色表） */
  buildCharacterProfiles: (opts?: {
    maxChars?: number
    onlyEmpty?: boolean
  }) => Promise<{ created: number; updated: number; failed: number }>
  /** 一键生成章纲（写入 Outline + Chapter.summary） */
  generateChapterOutline: (chapterId: string) => Promise<Outline | null>
  toggleSyncChange: (id: string) => void
  setSyncChangeChecked: (ids: string[], checked: boolean) => void
  applySyncPlan: (plan: SyncPlan) => Promise<{ applied: number; undoable: boolean }>
  closeSyncDialog: () => void
  undoLastSync: () => Promise<boolean>
  canUndo: () => boolean
  setActiveCharacter: (id: string | null) => void

  /** 同步模式（来自设置） */
  syncMode: () => SyncMode
}

/** 从作品里展平章节 */
function flatten(work: Work | undefined): Chapter[] {
  if (!work) return []
  const out: Chapter[] = []
  for (const v of work.volumes ?? []) for (const c of v.chapters ?? []) out.push(c)
  return out
}

/** 撤销记录（模块级，不进入 React 状态，避免无谓渲染） */
let undoRecord: UndoRecord | null = null
/** 自动摘要定时器 */
let autoSummaryTimer: ReturnType<typeof setTimeout> | null = null
/** 拖拽便签文本暂存 */
let dragNoteText: string | null = null

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 深拷贝大纲树（避免 store 状态被就地修改） */
function cloneOutline(nodes: Outline[]): Outline[] {
  return nodes.map((n) => ({ ...n, keyEvents: [...n.keyEvents], characters: [...n.characters], children: cloneOutline(n.children ?? []) }))
}

/** 在大纲树中替换 / 删除 / 插入节点 */
function mapOutline(nodes: Outline[], fn: (n: Outline) => Outline | null): Outline[] {
  const out: Outline[] = []
  for (const n of nodes) {
    const next = fn(n)
    if (!next) continue
    out.push({ ...next, children: mapOutline(n.children ?? [], fn) })
  }
  return out
}

/** 深度优先展平 */
export function flattenOutline(nodes: Outline[]): Outline[] {
  const out: Outline[] = []
  const walk = (list: Outline[]): void => {
    for (const n of list) {
      out.push(n)
      walk(n.children ?? [])
    }
  }
  walk(nodes ?? [])
  return out
}

/** 判断 outline 是否包含某 id */
function containsId(nodes: Outline[], id: string): boolean {
  return flattenOutline(nodes).some((n) => n.id === id)
}

export const useMaterialStore = create<MaterialState>((set, get) => ({
  workId: null,
  loading: false,
  loadedWorkId: null,

  characters: [],
  foreshadowings: [],
  outlines: [],
  locations: [],
  settingsList: [],
  notes: [],
  weekStats: [],
  allStats: [],
  chapters: [],

  summaryBusy: [],
  batchProgress: null,

  syncPlan: null,
  syncDialogOpen: false,
  syncBusy: false,

  expandedOutline: [],
  activeCharacterId: null,
  draggingNoteId: null,

  // ------------------------------------------------------------ 加载

  setWork: async (workId) => {
    set({ workId })
    await get().refresh()
  },

  refresh: async () => {
    const workId = get().workId
    if (!workId) {
      set({
        characters: [],
        foreshadowings: [],
        outlines: [],
        locations: [],
        settingsList: [],
        notes: [],
        weekStats: [],
        allStats: [],
        chapters: [],
        loadedWorkId: null
      })
      return
    }
    set({ loading: true })
    // 任一来源失败都按缺失处理，不阻塞其他模块加载
    const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await p
      } catch {
        return fallback
      }
    }
    const [works, characters, foreshadowings, outlines, locations, settingsList, notes, weekStats, allStats] =
      await Promise.all([
        safe(window.api.work.list(), [] as Work[]),
        safe(window.api.material.characters(workId), [] as Character[]),
        safe(window.api.material.foreshadowings(workId), [] as Foreshadowing[]),
        safe(window.api.material.outline(workId), [] as Outline[]),
        safe(window.api.material.locations(workId), [] as Location[]),
        safe(window.api.material.settings(workId), [] as Setting[]),
        safe(window.api.material.notes(workId), [] as Note[]),
        safe(window.api.material.stats(workId, 7), [] as DailyStat[]),
        safe(window.api.material.stats(workId), [] as DailyStat[])
      ])
    const work = works.find((w) => w.id === workId)
    set({
      characters,
      foreshadowings,
      outlines,
      locations,
      settingsList,
      notes,
      weekStats,
      allStats,
      chapters: flatten(work),
      loading: false,
      loadedWorkId: workId
    })
  },

  refreshChapters: async () => {
    const workId = get().workId
    if (!workId) return
    try {
      const works = await window.api.work.list()
      const work = works.find((w) => w.id === workId)
      set({ chapters: flatten(work) })
    } catch {
      /* 忽略：章节刷新失败不影响素材模块 */
    }
  },

  // ------------------------------------------------------------ 角色

  saveCharacter: async (patch) => {
    const workId = get().workId
    if (!workId) return null
    const res = await window.api.material.upsertCharacter(workId, patch)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '保存角色失败', 'error')
      return null
    }
    await get().refresh()
    return res.data
  },

  deleteCharacter: async (id) => {
    const workId = get().workId
    if (!workId) return
    const res = await window.api.material.removeCharacter(workId, id)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '删除角色失败', 'error')
      return
    }
    if (get().activeCharacterId === id) set({ activeCharacterId: null })
    await get().refresh()
  },

  // ------------------------------------------------------------ 伏笔

  saveForeshadowing: async (patch) => {
    const workId = get().workId
    if (!workId) return null
    const res = await window.api.material.upsertForeshadowing(workId, patch)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '保存伏笔失败', 'error')
      return null
    }
    await get().refresh()
    return res.data
  },

  deleteForeshadowing: async (id) => {
    const workId = get().workId
    if (!workId) return
    const res = await window.api.material.removeForeshadowing(workId, id)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '删除伏笔失败', 'error')
      return
    }
    await get().refresh()
  },

  /** 标记回收（可指定回收章节） */
  recoverForeshadowing: async (id, chapterId) => {
    const workId = get().workId
    if (!workId) return
    const current = get().foreshadowings.find((f) => f.id === id)
    if (!current) return
    const res = await window.api.material.upsertForeshadowing(workId, {
      id,
      content: current.content,
      type: 'recover',
      status: 'recovered',
      recoveredChapterId: chapterId ?? current.recoveredChapterId,
      chapterId: current.chapterId,
      relatedTo: current.relatedTo,
      anchor: current.anchor
    })
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '标记回收失败', 'error')
      return
    }
    await get().refresh()
  },

  /** 手动把一条未匹配的回收项关联到已有伏笔：把源删除、目标置为已回收 */
  linkForeshadowing: async (id, targetId) => {
    const workId = get().workId
    if (!workId) return
    const source = get().foreshadowings.find((f) => f.id === id)
    const target = get().foreshadowings.find((f) => f.id === targetId)
    if (!source || !target) return
    try {
      await window.api.material.upsertForeshadowing(workId, {
        id: targetId,
        content: target.content,
        type: 'recover',
        status: 'recovered',
        recoveredChapterId: source.recoveredChapterId ?? source.chapterId,
        chapterId: target.chapterId,
        relatedTo: target.relatedTo ?? source.relatedTo,
        anchor: target.anchor
      })
      await window.api.material.removeForeshadowing(workId, id)
      useUiStore.getState().showToast('已关联并标记回收', 'success')
    } catch {
      useUiStore.getState().showToast('关联失败', 'error')
    }
    await get().refresh()
  },

  // ------------------------------------------------------------ 大纲

  saveOutline: async (nodes) => {
    const workId = get().workId
    if (!workId) return
    const res = await window.api.material.saveOutline(workId, nodes)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '保存大纲失败', 'error')
      return
    }
    set({ outlines: nodes })
  },

  addOutlineNode: async (level, parentId) => {
    const tree = cloneOutline(get().outlines)
    const id = nextId('out')
    const title = level === 'master' ? '总纲' : level === 'volume' ? `第 ${tree.length + 1} 卷` : '新章节纲'
    const node: Outline = {
      id,
      level,
      title,
      keyEvents: [],
      characters: [],
      children: [],
      order: 0,
      updatedAt: Date.now()
    }
    if (!parentId) {
      tree.push({ ...node, order: tree.length })
    } else {
      const insert = (list: Outline[]): Outline[] =>
        list.map((n) => {
          if (n.id === parentId) return { ...n, children: [...n.children, { ...node, order: n.children.length }] }
          return { ...n, children: insert(n.children ?? []) }
        })
      const next = insert(tree)
      if (!containsId(next, id)) tree.push({ ...node, order: tree.length })
      else {
        await get().saveOutline(next)
        set({ expandedOutline: dedupe([...get().expandedOutline, parentId]) })
        return
      }
    }
    await get().saveOutline(tree)
    if (parentId) set({ expandedOutline: dedupe([...get().expandedOutline, parentId]) })
  },

  updateOutlineNode: async (id, patch) => {
    const tree = cloneOutline(get().outlines)
    const next = mapOutline(tree, (n) =>
      n.id === id
        ? {
            ...n,
            ...patch,
            keyEvents: patch.keyEvents ? dedupe(patch.keyEvents) : n.keyEvents,
            characters: patch.characters ? dedupe(patch.characters) : n.characters,
            chapterSummary:
              patch.chapterSummary !== undefined
                ? patch.chapterSummary
                  ? clampSummary(patch.chapterSummary)
                  : undefined
                : n.chapterSummary,
            updatedAt: Date.now()
          }
        : n
    )
    await get().saveOutline(next)
  },

  removeOutlineNode: async (id) => {
    const tree = cloneOutline(get().outlines)
    const next = mapOutline(tree, (n) => (n.id === id ? null : n))
    await get().saveOutline(next)
  },

  /**
   * 原生 HTML5 拖拽排序。
   * - inside：成为 target 的子节点
   * - before/after：成为 target 的同级兄弟
   * 不允许把节点拖进自己的子树（形成环）。
   */
  moveOutlineNode: async (dragId, targetId, position) => {
    if (dragId === targetId) return
    const tree = cloneOutline(get().outlines)
    const dragged = flattenOutline(tree).find((n) => n.id === dragId)
    if (!dragged) return
    // 禁止拖入自身子树
    if (flattenOutline(dragged.children ?? []).some((n) => n.id === targetId)) return

    // 先摘除
    const detached: Outline = { ...dragged, children: dragged.children ?? [] }
    let removed = false
    const without = mapOutline(tree, (n) => {
      if (n.id === dragId) {
        removed = true
        return null
      }
      return n
    })
    const base = removed ? without : tree

    const insert = (list: Outline[], parentId: string | null): { list: Outline[]; done: boolean } => {
      const out: Outline[] = []
      let done = false
      for (const n of list) {
        if (done) {
          out.push(n)
          continue
        }
        if (n.id === targetId && position !== 'inside') {
          if (position === 'before') {
            out.push({ ...detached, order: n.order })
            out.push(n)
          } else {
            out.push(n)
            out.push({ ...detached, order: n.order + 1 })
          }
          done = true
          continue
        }
        if (n.id === targetId && position === 'inside') {
          out.push({ ...n, children: [...n.children, { ...detached, order: n.children.length }] })
          done = true
          continue
        }
        const sub = insert(n.children ?? [], n.id)
        if (sub.done) done = true
        out.push({ ...n, children: sub.list })
      }
      return { list: out, done }
    }

    const r = insert(base, null)
    // target 是根级且未命中时的兜底
    const finalTree = r.done ? r.list : [...base, detached]
    // 重新编号同级 order
    const renumber = (list: Outline[]): Outline[] =>
      list.map((n, i) => ({ ...n, order: i, children: renumber(n.children ?? []) }))
    await get().saveOutline(renumber(finalTree))
    if (position === 'inside') set({ expandedOutline: dedupe([...get().expandedOutline, targetId]) })
  },

  toggleOutlineExpanded: (id) => {
    const cur = get().expandedOutline
    set({ expandedOutline: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },

  // ------------------------------------------------------------ 便签

  addNote: async (content) => {
    const workId = get().workId
    if (!workId) return
    const text = String(content ?? '').trim()
    if (!text) return
    const res = await window.api.material.upsertNote(workId, { content: text })
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '保存便签失败', 'error')
      return
    }
    const notes = await window.api.material.notes(workId)
    set({ notes })
  },

  updateNote: async (id, patch) => {
    const workId = get().workId
    if (!workId) return
    const current = get().notes.find((n) => n.id === id)
    if (!current) return
    const res = await window.api.material.upsertNote(workId, {
      id,
      content: patch.content ?? current.content,
      pinned: patch.pinned ?? current.pinned
    })
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '更新便签失败', 'error')
      return
    }
    const notes = await window.api.material.notes(workId)
    set({ notes })
  },

  deleteNote: async (id) => {
    const workId = get().workId
    if (!workId) return
    const res = await window.api.material.removeNote(workId, id)
    if (!res.ok) {
      useUiStore.getState().showToast(res.error || '删除便签失败', 'error')
      return
    }
    const notes = await window.api.material.notes(workId)
    set({ notes })
  },

  toggleNotePinned: async (id) => {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    await get().updateNote(id, { pinned: !note.pinned })
  },

  setDraggingNote: (id) => {
    if (id) dragNoteText = get().notes.find((n) => n.id === id)?.content ?? null
    set({ draggingNoteId: id })
  },

  consumeDragNoteText: () => {
    const text = dragNoteText
    dragNoteText = null
    set({ draggingNoteId: null })
    return text
  },

  // ------------------------------------------------------------ 统计

  loadStats: async () => {
    const workId = get().workId
    if (!workId) return
    try {
      const [weekStats, allStats] = await Promise.all([
        window.api.material.stats(workId, 7),
        window.api.material.stats(workId)
      ])
      set({ weekStats, allStats })
    } catch {
      /* 忽略统计读取失败 */
    }
  },

  addStat: async (words, durationMs) => {
    const workId = get().workId
    if (!workId) return
    if (!words && !durationMs) return
    // 本地先更新，保证 UI 立刻有反馈（主进程写盘后再对齐）
    const key = dateKey()
    const apply = (list: DailyStat[]): DailyStat[] => {
      const hit = list.find((s) => s.date === key)
      const next = hit
        ? list.map((s) => (s.date === key ? { ...s, words: s.words + words, durationMs: s.durationMs + durationMs } : s))
        : [...list, { date: key, words, durationMs }]
      return next.sort((a, b) => a.date.localeCompare(b.date))
    }
    set({ weekStats: apply(get().weekStats), allStats: apply(get().allStats) })
    try {
      const res = await window.api.material.addStat(workId, words, durationMs)
      if (!res.ok) throw new Error(res.error)
    } catch {
      // 写盘失败：重新拉取以纠正乐观更新
      await get().loadStats()
    }
  },

  // ------------------------------------------------------------ 阶段 5.5 摘要

  /**
   * 生成单章摘要。
   * <200 字跳过；>3000 字分段摘要后合并；失败可重试（不弹阻塞对话框）。
   */
  generateSummary: async (chapterId, opts) => {
    const workId = get().workId
    const silent = opts?.silent ?? false
    if (!workId) return false
    if (get().summaryBusy.includes(chapterId)) return false

    const chapter =
      get().chapters.find((c) => c.id === chapterId) ??
      ((await window.api.chapter.get(workId, chapterId).catch(() => undefined)) as Chapter | undefined)
    if (!chapter) return false

    const text = String(chapter.content ?? '')
    const words = countWords(text)
    if (words < SUMMARY_MIN_CHARS) {
      if (!silent) useUiStore.getState().showToast(`章节不足 ${SUMMARY_MIN_CHARS} 字，已跳过摘要`, 'info')
      return false
    }

    set({ summaryBusy: [...get().summaryBusy, chapterId] })
    try {
      const segments = splitForSummary(text)
      let summary = ''

      if (segments.length <= 1) {
        const r = await callBackground('summarize', buildSummaryPrompt(segments[0] ?? text))
        if (!r.ok) {
          if (!silent) useUiStore.getState().showToast(`摘要失败：${r.error}`, 'error')
          return false
        }
        summary = clampSummary(r.text)
      } else {
        // 分段摘要（顺序执行：后台同一时间只允许一个请求）
        const parts: string[] = []
        for (let i = 0; i < segments.length; i++) {
          set({ batchProgress: { kind: 'summary', current: i + 1, total: segments.length + 1, label: `${chapter.title} 分段 ${i + 1}/${segments.length}` } })
          const r = await callBackground('summarize', buildSummaryPrompt(segments[i]))
          if (!r.ok) {
            if (!silent) useUiStore.getState().showToast(`分段摘要失败：${r.error}`, 'error')
            return false
          }
          parts.push(clampSummary(r.text, 200))
        }
        const merged = await callBackground('summarize', buildSummaryMergePrompt(parts))
        summary = merged.ok ? clampSummary(merged.text) : clampSummary(parts.join(' '))
      }

      if (!summary) {
        if (!silent) useUiStore.getState().showToast('摘要为空，请重试', 'error')
        return false
      }

      // 落地：写入章纲（素材域，本模块负责）+ 章节摘要（若契约已开放该通道）
      await persistSummary(workId, chapter, summary)
      if (!silent) useUiStore.getState().showToast('摘要已生成', 'success')
      return true
    } finally {
      set({ summaryBusy: get().summaryBusy.filter((x) => x !== chapterId), batchProgress: null })
    }
  },

  /** 批量生成摘要，显示进度，单章失败不中断 */
  generateSummaryBatch: async (chapterIds) => {
    const result = { ok: 0, failed: 0, skipped: 0 }
    for (let i = 0; i < chapterIds.length; i++) {
      const id = chapterIds[i]
      set({ batchProgress: { kind: 'summary', current: i + 1, total: chapterIds.length, label: '批量摘要' } })
      const chapter = get().chapters.find((c) => c.id === id)
      if (!chapter || countWords(chapter.content ?? '') < SUMMARY_MIN_CHARS) {
        result.skipped += 1
        continue
      }
      const done = await get().generateSummary(id, { silent: true })
      if (done) result.ok += 1
      else result.failed += 1
    }
    set({ batchProgress: null })
    const { showToast } = useUiStore.getState()
    showToast(`批量摘要完成：成功 ${result.ok}，跳过 ${result.skipped}，失败 ${result.failed}`, result.failed ? 'info' : 'success')
    return result
  },

  /**
   * 自动摘要：章节 ≥500 字且停输 30 秒后触发。
   * 每次调用重置计时器，因此"继续输入"会推迟触发。不阻塞编辑。
   */
  scheduleAutoSummary: (chapterId, text) => {
    if (autoSummaryTimer) {
      clearTimeout(autoSummaryTimer)
      autoSummaryTimer = null
    }
    if (countWords(text) < AUTO_SUMMARY_MIN_CHARS) return
    autoSummaryTimer = setTimeout(() => {
      autoSummaryTimer = null
      void get().generateSummary(chapterId, { silent: true })
    }, AUTO_SUMMARY_DEBOUNCE_MS)
  },

  cancelAutoSummary: () => {
    if (autoSummaryTimer) {
      clearTimeout(autoSummaryTimer)
      autoSummaryTimer = null
    }
  },

  // ------------------------------------------------------------ 阶段 5.6 同步

  /**
   * 提取并生成同步计划（不写库）。
   * 失败/未登录 → 提示且不阻塞。
   */
  analyzeChapter: async (chapterId, opts) => {
    const workId = get().workId
    const silent = opts?.silent ?? false
    if (!workId) return null

    const chapter =
      get().chapters.find((c) => c.id === chapterId) ??
      ((await window.api.chapter.get(workId, chapterId).catch(() => undefined)) as Chapter | undefined)
    if (!chapter) return null

    const text = String(chapter.content ?? '')
    if (countWords(text) < SYNC_MIN_CHARS) {
      if (!silent) useUiStore.getState().showToast(`章节不足 ${SYNC_MIN_CHARS} 字，跳过同步分析`, 'info')
      return null
    }

    set({ syncBusy: true })
    try {
      // 冷启动首次请求可能 30s+（实测 30.5s vs 热态 12.4s），
      // 这里给出"已等待 N 秒"的提示，避免用户以为卡死而反复点击。
      const startedAt = Date.now()
      const slowTip = setTimeout(() => {
        if (get().syncBusy) {
          useUiStore
            .getState()
            .showToast('首次分析较慢（需要初始化会话），请再稍候…', 'info')
        }
      }, 12_000)

      let r: Awaited<ReturnType<typeof callBackground>>
      try {
        r = await callBackground('sync-extract', buildSyncPrompt(text))
      } finally {
        clearTimeout(slowTip)
      }
      const elapsedMs = Date.now() - startedAt
      if (!r.ok) {
        if (!silent) useUiStore.getState().showToast(`同步分析失败：${r.error}`, 'error')
        return null
      }
      const parsed = parseExtraction(r.text)
      if (!parsed.ok) {
        if (!silent) useUiStore.getState().showToast(`同步分析失败：${parsed.error}`, 'error')
        return null
      }
      if (!silent) {
        // ⚠️ 缓存命中时耗时接近 0，若直接报"分析完成（用时 0.0s）"
        // 会让用户以为功能没跑（实测截图反馈过）。这里区分两种来源。
        useUiStore
          .getState()
          .showToast(
            r.fromCache
              ? '已使用缓存结果（内容未变化，24 小时内不重复请求 AI）'
              : `分析完成（用时 ${(elapsedMs / 1000).toFixed(1)}s）`,
            'success'
          )
      }
      const plan = buildSyncPlan(workId, chapter, parsed.data, {
        characters: get().characters,
        foreshadowings: get().foreshadowings,
        locations: get().locations,
        settingsList: get().settingsList,
        outlines: get().outlines
      })
      return plan
    } finally {
      set({ syncBusy: false })
    }
  },

  toggleSyncChange: (id) => {
    const plan = get().syncPlan
    if (!plan) return
    set({
      syncPlan: {
        ...plan,
        changes: plan.changes.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c))
      }
    })
  },

  /**
   * 模式分发（阶段 5.6）：
   *  - confirm（默认）：弹出确认清单，用户勾选后更新
   *  - auto：直接更新，30 秒内可撤销
   *  - manual：只提示"发现可更新内容"，点击后才写入
   */
  runSync: async (chapterId, opts) => {
    const plan = await get().analyzeChapter(chapterId, opts)
    if (!plan) return null
    if (plan.changes.length === 0) {
      if (!opts?.silent) useUiStore.getState().showToast('本章没有可更新的素材', 'info')
      return plan
    }
    const mode = get().syncMode()
    if (mode === 'auto') {
      await get().applySyncPlan(plan)
      set({ syncPlan: plan, syncDialogOpen: false })
      return plan
    }
    // confirm / manual：都先把计划交给 UI，由对话框决定是"直接更新"还是"点击后更新"
    set({ syncPlan: plan, syncDialogOpen: true })
    if (mode === 'manual' && !opts?.silent) {
      useUiStore.getState().showToast(`发现 ${plan.counts.total} 项可更新内容，点击「同步分析」查看`, 'info')
    }
    return plan
  },

  /** 批量同步：逐章串行（后台同一时间只处理一个请求） */
  runSyncBatch: async (chapterIds) => {
    const result = { ok: 0, failed: 0 }
    for (let i = 0; i < chapterIds.length; i++) {
      set({ batchProgress: { kind: 'sync', current: i + 1, total: chapterIds.length, label: '批量同步分析' } })
      const plan = await get().analyzeChapter(chapterIds[i], { silent: true })
      if (!plan) {
        result.failed += 1
        continue
      }
      if (plan.changes.length > 0) await get().applySyncPlan(plan)
      result.ok += 1
    }
    set({ batchProgress: null, syncDialogOpen: false })
    useUiStore
      .getState()
      .showToast(`批量同步完成：成功 ${result.ok} 章，失败 ${result.failed} 章`, result.failed ? 'info' : 'success')
    return result
  },

  /**
   * AI 自动建立人物画像（全作品扫描）。
   *
   * 与 runSyncBatch 的区别：
   *  - runSyncBatch 逐章提取"本章新出现的角色"，结果靠用户勾选；
   *  - 本方法把多章文本合并后让 AI 归纳**角色画像**（身份、性格、关系、经历弧线），
   *    再与已有角色表合并（同名则补充/更新 intro，不覆盖用户手改过的非空简介）。
   *
   * 合规：正文只发送给用户已登录的站点，且不触碰正文；失败不阻塞。
   */
  buildCharacterProfiles: async (opts) => {
    const workId = get().workId
    if (!workId) return { created: 0, updated: 0, failed: 0 }
    const maxChars = opts?.maxChars ?? 12000
    const onlyEmpty = opts?.onlyEmpty ?? false

    // 1) 汇总正文（按章节顺序，直到达到字数上限）
    const chapters = get().chapters.filter((c) => String(c.content ?? '').trim().length > 0)
    if (chapters.length === 0) {
      useUiStore.getState().showToast('当前作品还没有正文，无法建立人物画像', 'error')
      return { created: 0, updated: 0, failed: 0 }
    }

    let collected = ''
    const usedTitles: string[] = []
    for (const c of chapters) {
      const piece = String(c.content ?? '')
      if (collected.length + piece.length > maxChars && collected.length > 0) break
      collected += `\n\n【${c.title || '未命名'}】\n${piece}`
      usedTitles.push(c.title || '未命名')
    }

    set({
      batchProgress: {
        kind: 'sync',
        current: 0,
        total: usedTitles.length,
        label: `正在归纳人物画像（${usedTitles.length} 章）`
      }
    })

    try {
      const existing = get().characters
      const existingBrief = existing.length
        ? existing.map((c) => `- ${c.name}（已有简介：${c.intro || '无'}）`).join('\n')
        : '（暂无已有角色）'

      const prompt = `你是小说编辑。请根据下面的正文，为其中出现的**所有主要人物**建立人物画像。
严格只输出 JSON，不要任何解释文字，格式：
{"characters":[{"name":"姓名","intro":"100字以内的画像：身份、性格、外貌特征、关键经历与目标","tags":["标签1","标签2"]}]}

要求：
1. 只收录在正文中真正出场或被明确提及的人物，不要编造。
2. intro 要具体（写清身份与性格），不要写"某个人物"这类空话。
3. tags 用 1~4 个短词，如"主角""反派""导师""龙族"。
4. 已有角色如下，若同名请在其原有信息基础上**扩充**，不要丢失原设定：
${existingBrief}

正文：
${collected}`

      set({
        batchProgress: {
          kind: 'sync',
          current: Math.max(1, Math.floor(usedTitles.length / 2)),
          total: usedTitles.length,
          label: 'AI 正在归纳人物画像…'
        }
      })

      const t0 = Date.now()
      const r = await callBackground('sync-extract', prompt)
      if (!r.ok) {
        useUiStore.getState().showToast(`建立人物画像失败：${r.error}`, 'error')
        return { created: 0, updated: 0, failed: 1 }
      }

      // 2) 复用 sync-extract 的解析器（同样的 JSON 外形）
      const parsed = parseExtraction(r.text)
      if (!parsed.ok) {
        useUiStore.getState().showToast(`建立人物画像失败：${parsed.error}`, 'error')
        return { created: 0, updated: 0, failed: 1 }
      }

      const found = parsed.data.characters ?? []
      if (found.length === 0) {
        useUiStore.getState().showToast('AI 未从正文中识别出人物，请确认正文是否足够', 'info')
        return { created: 0, updated: 0, failed: 0 }
      }

      // 3) 合并进角色表
      let created = 0
      let updated = 0
      const current = get().characters
      for (const f of found) {
        const name = String(f.name ?? '').trim()
        if (!name) continue
        const tagArr = Array.isArray(f.tags) ? f.tags.map((t) => String(t)).filter(Boolean) : []
        const intro = String(f.intro ?? '').trim()
        const hit = current.find((c) => c.name === name)

        if (hit) {
          // 只补充空简介；用户手写过的非空简介不覆盖
          const nextIntro = hit.intro && hit.intro.trim().length > 0 ? hit.intro : intro
          const mergedTags = Array.from(new Set([...(hit.tags ?? []), ...tagArr]))
          if (nextIntro !== hit.intro || mergedTags.length !== (hit.tags ?? []).length) {
            await get().saveCharacter({ id: hit.id, name: hit.name, intro: nextIntro, tags: mergedTags })
            updated += 1
          }
        } else if (!onlyEmpty) {
          await get().saveCharacter({ name, intro, tags: tagArr })
          created += 1
        }
      }

      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      useUiStore
        .getState()
        .showToast(
          `人物画像完成：新建 ${created} 个、补充 ${updated} 个（用时 ${secs}s，来源 ${usedTitles.length} 章）`,
          created + updated > 0 ? 'success' : 'info'
        )
      return { created, updated, failed: 0 }
    } catch (err) {
      useUiStore
        .getState()
        .showToast(`建立人物画像异常：${err instanceof Error ? err.message : String(err)}`, 'error')
      return { created: 0, updated: 0, failed: 1 }
    } finally {
      set({ batchProgress: null, syncBusy: false })
    }
  },

  setSyncChangeChecked: (ids, checked) => {
    const plan = get().syncPlan
    if (!plan) return
    const target = new Set(ids)
    set({ syncPlan: { ...plan, changes: plan.changes.map((c) => (target.has(c.id) ? { ...c, checked } : c)) } })
  },

  closeSyncDialog: () => set({ syncDialogOpen: false }),

  /**
   * 应用同步计划：只写入被勾选的变更。
   * 写回顺序：角色 → 伏笔 → 地点 → 设定 → 章纲（全部走既有 IPC 通道，合并语义由主进程负责）。
   */
  applySyncPlan: async (plan) => {
    const workId = get().workId
    if (!workId) return { applied: 0, undoable: false }
    const checked = plan.changes.filter((c) => c.checked)

    // 记录撤销快照（仅素材域；同步不触碰正文）
    undoRecord = {
      workId,
      chapterId: plan.chapterId,
      expiresAt: Date.now() + SYNC_UNDO_WINDOW_MS,
      characters: get().characters,
      foreshadowings: get().foreshadowings,
      locations: get().locations,
      settingsList: get().settingsList,
      outlines: get().outlines,
      label: `同步「${plan.chapterTitle}」`
    }

    let applied = 0
    for (const change of checked) {
      try {
        if (change.domain === 'character') {
          const c = change.payload as Character
          await window.api.material.upsertCharacter(workId, {
            name: c.name,
            intro: c.intro,
            tags: c.tags,
            appearances: c.appearances,
            mentions: c.mentions
          })
        } else if (change.domain === 'foreshadowing') {
          const f = change.payload as Foreshadowing
          await window.api.material.upsertForeshadowing(workId, {
            content: f.content,
            type: f.type,
            status: f.status,
            chapterId: f.chapterId,
            recoveredChapterId: f.recoveredChapterId,
            relatedTo: f.relatedTo,
            anchor: f.anchor
          })
        } else if (change.domain === 'outline') {
          const node = change.payload as Outline
          await window.api.material.saveOutline(workId, mergeOutlineNode(get().outlines, node))
        }
        // 地点 / 设定：当前契约只有只读通道，交由主进程同步服务处理（见汇报）
        applied += 1
      } catch {
        /* 单条失败不中断其余变更 */
      }
    }

    await get().refresh()
    if (applied > 0) {
      useUiStore.getState().showToast(`${undoRecord.label} 已更新 ${applied} 项（30 秒内可撤销）`, 'success')
    }
    return { applied, undoable: applied > 0 }
  },

  /**
   * 一键生成章纲（阶段 11 第 1 项）。
   *
   * ⚠️ 此前该功能只存在于设置页的功能清单里：提示词模板 `outline-gen` 已定义、
   * Outline 结构也有齐全字段，但**没有任何 IPC 与 UI 入口**，
   * 用户点了也找不到，属于"宣传了但不存在"。
   *
   * 流程：读当前章节正文 -> 让 AI 输出章纲 JSON -> 落地到
   *   - Outline 节点（chapterSummary/keyEvents/characters/turningPoint/endingHook）
   *   - Chapter.summary（供写作页「本章信息」显示）
   */
  generateChapterOutline: async (chapterId) => {
    const workId = get().workId
    if (!workId) return null

    // 设置里的功能开关需要真正生效，否则开关只是装饰
    try {
      const s = await window.api.settings.get()
      if (s?.features && s.features.outlineGenerate === false) {
        useUiStore.getState().showToast('「一键生成章纲」已在设置 → 功能中关闭', 'error')
        return null
      }
    } catch {
      /* 设置读取失败不阻断主流程 */
    }

    const chapter =
      get().chapters.find((c) => c.id === chapterId) ??
      ((await window.api.chapter.get(workId, chapterId).catch(() => undefined)) as Chapter | undefined)
    if (!chapter) {
      useUiStore.getState().showToast('章节不存在', 'error')
      return null
    }

    const text = String(chapter.content ?? '')
    if (countWords(text) < SYNC_MIN_CHARS) {
      useUiStore
        .getState()
        .showToast(`本章仅 ${countWords(text)} 字，不足 ${SYNC_MIN_CHARS} 字，无法生成章纲`, 'error')
      return null
    }

    set({ syncBusy: true })
    try {
      const prompt = `请阅读以下章节正文，生成章纲。严格按以下 JSON 输出：
{"chapterSummary":"本章摘要","keyEvents":["核心事件"],"characters":["出场角色"],"turningPoint":"关键转折","endingHook":"结尾钩子"}

章节正文：
${text}`

      const r = await callBackground('outline-gen', prompt)
      if (!r.ok) {
        useUiStore.getState().showToast(`生成章纲失败：${r.error}`, 'error')
        return null
      }

      const json = extractJsonObject(r.text)
      if (!json) {
        useUiStore.getState().showToast('生成章纲失败：回复中未找到 JSON', 'error')
        return null
      }

      let raw: Record<string, unknown>
      try {
        raw = JSON.parse(json) as Record<string, unknown>
      } catch (err) {
        useUiStore.getState().showToast(`生成章纲失败：JSON 解析错误 ${(err as Error).message}`, 'error')
        return null
      }

      const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
      const arr = (v: unknown): string[] =>
        Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []

      const summary = str(raw.chapterSummary)
      const keyEvents = arr(raw.keyEvents)
      const characters = arr(raw.characters)
      const turningPoint = str(raw.turningPoint)
      const endingHook = str(raw.endingHook)

      if (!summary && keyEvents.length === 0) {
        useUiStore.getState().showToast('生成章纲失败：AI 未返回有效内容', 'error')
        return null
      }

      // 与已有章纲节点合并（保留 id 与 children，避免破坏大纲树）
      const existing = flattenOutline(get().outlines).find((n) => n.chapterId === chapterId)
      const node: Outline = {
        id: existing?.id ?? nextId('out'),
        chapterId,
        level: 'chapter',
        title: existing?.title || chapter.title,
        chapterSummary: summary || existing?.chapterSummary,
        keyEvents: keyEvents.length ? keyEvents : (existing?.keyEvents ?? []),
        characters: characters.length ? characters : (existing?.characters ?? []),
        turningPoint: turningPoint || existing?.turningPoint,
        endingHook: endingHook || existing?.endingHook,
        children: existing?.children ?? [],
        order: existing?.order ?? 0,
        updatedAt: Date.now()
      }

      await get().saveOutline(mergeOutlineNode(get().outlines, node))

      // 同步落地到 Chapter.summary，让写作页「本章信息」立即可见
      if (summary) {
        try {
          await window.api.chapter.setSummary(workId, chapterId, summary, countWords(text))
        } catch {
          /* 摘要落地失败不影响章纲 */
        }
        await get().refreshChapters()
      }

      useUiStore.getState().showToast('章纲已生成并写入大纲', 'success')
      return node
    } catch (err) {
      useUiStore
        .getState()
        .showToast(`生成章纲异常：${err instanceof Error ? err.message : String(err)}`, 'error')
      return null
    } finally {
      set({ syncBusy: false })
    }
  },

  /** 30 秒内撤销上一次自动同步 */
  undoLastSync: async () => {    if (!undoRecord || Date.now() > undoRecord.expiresAt) return false
    const workId = get().workId
    if (!workId || undoRecord.workId !== workId) return false
    const snap = undoRecord
    undoRecord = null
    try {
      // 角色：以完整实体覆盖（带 createdAt/lastUpdatedAt → 精确替换语义）
      await Promise.all([
        ...snap.characters.map((c) => window.api.material.upsertCharacter(workId, c)),
        ...snap.outlines.length ? [window.api.material.saveOutline(workId, snap.outlines)] : []
      ])
      await get().refresh()
      useUiStore.getState().showToast('已撤销同步', 'success')
      return true
    } catch {
      useUiStore.getState().showToast('撤销失败', 'error')
      return false
    }
  },

  canUndo: () => Boolean(undoRecord && Date.now() < undoRecord.expiresAt),

  setActiveCharacter: (id) => set({ activeCharacterId: id }),

  syncMode: () => {
    const settings = useUiStore.getState().settings
    return (settings?.syncMode as SyncMode | undefined) ?? 'confirm'
  }
}))

// ---------------------------------------------------------------- 内部函数

/** 把章纲节点合并进大纲树（已存在则就地更新，否则挂到最后一个分卷下） */
function mergeOutlineNode(tree: Outline[], node: Outline): Outline[] {
  const cloned = cloneOutline(tree)
  if (flattenOutline(cloned).some((n) => n.id === node.id || (node.chapterId && n.chapterId === node.chapterId))) {
    return mapOutline(cloned, (n) =>
      n.id === node.id || (node.chapterId && n.chapterId === node.chapterId)
        ? { ...n, ...node, children: n.children }
        : n
    )
  }
  let lastVolume = -1
  cloned.forEach((n, i) => {
    if (n.level === 'volume') lastVolume = i
  })
  if (lastVolume >= 0) {
    const vol = cloned[lastVolume]
    cloned[lastVolume] = { ...vol, children: [...vol.children, { ...node, order: vol.children.length }] }
  } else {
    cloned.push({ ...node, order: cloned.length })
  }
  return cloned
}

/** 摘要落地：章纲节点 + （若契约开放）Chapter.summary */
async function persistSummary(workId: string, chapter: Chapter, summary: string): Promise<void> {
  const store = useMaterialStore.getState()
  const node: Outline = {
    id: nextId('out'),
    chapterId: chapter.id,
    level: 'chapter',
    title: chapter.title,
    chapterSummary: summary,
    keyEvents: [],
    characters: [],
    children: [],
    order: 0,
    updatedAt: Date.now()
  }
  const existing = flattenOutline(store.outlines).find((n) => n.chapterId === chapter.id)
  const merged: Outline = existing ? { ...existing, chapterSummary: summary, updatedAt: Date.now() } : node
  await store.saveOutline(mergeOutlineNode(store.outlines, merged))

  // Chapter.summary 现在有真实落地点（IPC chapter:set-summary）。
  // 此前这里用 `chapterApi.setSummary?.()` 可选调用，而该 API 并不存在，
  // 失败被完全吞掉 —— 界面因此永远显示「（尚未生成摘要）」。
  try {
    await window.api.chapter.setSummary(workId, chapter.id, summary, countWords(chapter.content ?? ''))
  } catch {
    /* 作品域写入失败不影响章纲摘要 */
  }
  await useMaterialStore.getState().refreshChapters()
}

/** 同步计划构建所需的现有素材 */
interface ExistingMaterial {
  characters: Character[]
  foreshadowings: Foreshadowing[]
  locations: Location[]
  settingsList: Setting[]
  outlines: Outline[]
}

/**
 * 生成确认清单（轻量 diff，仅用于预览）。
 *
 * 规则与 `src/main/services/sync.ts` 的 diffExtraction 对齐：
 *  - 角色同名 → 更新（追加信息 / 合并 tags / 累加提及）；多同名 → 冲突，默认不勾选
 *  - 伏笔 recover → 优先匹配已埋设；匹配失败 → 冲突，提示手动关联
 *  - 地点 / 设定同名 → 追加，否则新建
 *  - 章纲 → 摘要 + 关键事件 + 结尾钩子
 */
export function buildSyncPlan(
  workId: string,
  chapter: Chapter,
  extraction: SyncExtraction,
  existing: ExistingMaterial
): SyncPlan {
  const changes: SyncChangeItem[] = []
  const chapterId = chapter.id
  let seq = 0
  const nid = (d: SyncDomain): string => `${d}-${chapterId}-${++seq}`

  // ---- 角色 ----
  for (const c of extraction.characters) {
    const key = normalizeName(c.name)
    const same = existing.characters.filter((x) => normalizeName(x.name) === key)
    if (same.length > 1) {
      changes.push({
        id: nid('character'),
        domain: 'character',
        action: 'conflict',
        label: `角色「${c.name}」`,
        detail: `已存在 ${same.length} 个同名角色`,
        candidates: same.map((x) => ({ id: x.id, label: `${x.name}（提及 ${x.mentions}）` })),
        conflictMessage: '同名角色：请选择合并目标，或取消勾选后手动新建',
        defaultChecked: false,
        checked: false,
        isNew: false,
        payload: {
          id: nextId('cha'),
          name: c.name,
          intro: c.intro,
          tags: dedupe(c.tags),
          appearances: [chapterId],
          mentions: c.appearances,
          supplements: [],
          createdAt: Date.now(),
          lastUpdatedAt: Date.now()
        }
      })
      continue
    }
    if (same.length === 1) {
      const t = same[0]
      const newTags = c.tags.filter((x) => !t.tags.some((y) => y.toLowerCase() === x.toLowerCase()))
      const detail: string[] = []
      if (newTags.length) detail.push(`新增标签 ${newTags.join('/')}`)
      if (c.intro && c.intro !== t.intro) detail.push('追加简介')
      detail.push(`提及 +${c.appearances}`)
      changes.push({
        id: nid('character'),
        domain: 'character',
        action: 'update',
        label: `角色「${c.name}」`,
        detail: detail.join('，'),
        targetId: t.id,
        candidates: [],
        defaultChecked: true,
        checked: true,
        isNew: false,
        payload: t
      })
      continue
    }
    changes.push({
      id: nid('character'),
      domain: 'character',
      action: 'create',
      label: `角色「${c.name}」（新）`,
      detail: c.intro || '新建角色',
      candidates: [],
      defaultChecked: true,
      checked: true,
      isNew: true,
      payload: {
        id: nextId('cha'),
        name: c.name,
        intro: c.intro,
        tags: dedupe(c.tags),
        appearances: [chapterId],
        mentions: c.appearances,
        supplements: [],
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }
    })
  }

  // ---- 伏笔 ----
  for (const f of extraction.foreshadowing) {
    if (f.type === 'recover') {
      let best: { item: Foreshadowing; score: number } | null = null
      for (const x of existing.foreshadowings) {
        if (x.status !== 'planted') continue
        const score = foreshadowingScore(x, f.content, f.relatedTo)
        if (score >= 0.34 && (!best || score > best.score)) best = { item: x, score }
      }
      if (best) {
        changes.push({
          id: nid('foreshadowing'),
          domain: 'foreshadowing',
          action: 'update',
          label: `回收「${best.item.content.slice(0, 20)}」`,
          detail: `匹配度 ${(best.score * 100).toFixed(0)}% · ${f.content.slice(0, 40)}`,
          targetId: best.item.id,
          candidates: [],
          defaultChecked: true,
          checked: true,
          isNew: false,
          payload: { ...best.item, type: 'recover', status: 'recovered', recoveredChapterId: chapterId, updatedAt: Date.now() }
        })
      } else {
        const candidates = existing.foreshadowings
          .filter((x) => x.status === 'planted')
          .map((x) => ({ id: x.id, label: x.content.slice(0, 40), score: similarity(x.content, f.content) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ id, label }) => ({ id, label }))
        changes.push({
          id: nid('foreshadowing'),
          domain: 'foreshadowing',
          action: 'conflict',
          label: `回收「${f.content.slice(0, 20)}」未匹配`,
          detail: f.content,
          candidates,
          conflictMessage: '未找到对应的已埋设伏笔，请手动关联或取消勾选',
          defaultChecked: false,
          checked: false,
          isNew: false,
          payload: {
            id: nextId('fsd'),
            content: f.content,
            type: 'recover',
            status: 'planted',
            chapterId,
            recoveredChapterId: chapterId,
            relatedTo: f.relatedTo,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        })
      }
      continue
    }

    const exact = existing.foreshadowings.find(
      (x) => x.status === 'planted' && normalizeName(x.content) === normalizeName(f.content)
    )
    if (exact) {
      changes.push({
        id: nid('foreshadowing'),
        domain: 'foreshadowing',
        action: 'update',
        label: `伏笔已存在「${exact.content.slice(0, 20)}」`,
        detail: '仅刷新关联对象',
        targetId: exact.id,
        candidates: [],
        defaultChecked: true,
        checked: true,
        isNew: false,
        payload: { ...exact, relatedTo: exact.relatedTo ?? f.relatedTo, updatedAt: Date.now() }
      })
    } else {
      changes.push({
        id: nid('foreshadowing'),
        domain: 'foreshadowing',
        action: 'create',
        label: `伏笔「${f.content.slice(0, 20)}」`,
        detail: f.relatedTo ? `关联：${f.relatedTo}` : '新埋设',
        candidates: [],
        defaultChecked: true,
        checked: true,
        isNew: true,
        payload: {
          id: nextId('fsd'),
          content: f.content,
          type: f.type,
          status: 'planted',
          chapterId,
          relatedTo: f.relatedTo,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })
    }
  }

  // ---- 地点 ----
  for (const loc of extraction.locations) {
    const key = normalizeName(loc.name)
    const same = existing.locations.filter((x) => normalizeName(x.name) === key)
    const target = same[0]
    const isConflict = same.length > 1
    changes.push({
      id: nid('location'),
      domain: 'location',
      action: isConflict ? 'conflict' : target ? 'update' : 'create',
      label: `地点「${loc.name}」${target ? '' : '（新）'}`,
      detail: target
        ? loc.description && loc.description !== target.description
          ? '追加描述'
          : '无变化'
        : loc.description,
      targetId: target?.id,
      candidates: isConflict ? same.map((x) => ({ id: x.id, label: x.name })) : [],
      conflictMessage: isConflict ? '同名地点：请选择要合并的目标' : undefined,
      defaultChecked: !isConflict,
      checked: !isConflict,
      isNew: !target,
      payload: target
        ? { ...target, supplements: dedupe([...target.supplements, loc.description]), lastUpdatedAt: Date.now() }
        : {
            id: nextId('loc'),
            name: loc.name,
            description: loc.description,
            firstChapterId: chapterId,
            supplements: [],
            createdAt: Date.now(),
            lastUpdatedAt: Date.now()
          }
    })
  }

  // ---- 设定 ----
  for (const s of extraction.settings) {
    const key = normalizeName(s.name)
    const same = existing.settingsList.filter((x) => normalizeName(x.name) === key)
    const target = same[0]
    const isConflict = same.length > 1
    changes.push({
      id: nid('setting'),
      domain: 'setting',
      action: isConflict ? 'conflict' : target ? 'update' : 'create',
      label: `设定「${s.name}」${target ? '' : '（新）'}`,
      detail: target ? (s.description && s.description !== target.description ? '追加描述' : '无变化') : s.description,
      targetId: target?.id,
      candidates: isConflict ? same.map((x) => ({ id: x.id, label: x.name })) : [],
      conflictMessage: isConflict ? '同名设定：请选择要合并的目标' : undefined,
      defaultChecked: !isConflict,
      checked: !isConflict,
      isNew: !target,
      payload: target
        ? { ...target, supplements: dedupe([...target.supplements, s.description]), lastUpdatedAt: Date.now() }
        : {
            id: nextId('set'),
            name: s.name,
            description: s.description,
            firstChapterId: chapterId,
            supplements: [],
            createdAt: Date.now(),
            lastUpdatedAt: Date.now()
          }
    })
  }

  // ---- 章纲 ----
  const hasOutline =
    Boolean(extraction.outline.chapterSummary) ||
    extraction.outline.keyEvents.length > 0 ||
    Boolean(extraction.outline.endingHook)
  if (hasOutline) {
    const existingNode = flattenOutline(existing.outlines).find((n) => n.chapterId === chapterId)
    const node: Outline = {
      id: existingNode?.id ?? nextId('out'),
      chapterId,
      level: 'chapter',
      title: existingNode?.title || chapter.title || '本章',
      chapterSummary: extraction.outline.chapterSummary
        ? clampSummary(extraction.outline.chapterSummary)
        : existingNode?.chapterSummary,
      keyEvents: extraction.outline.keyEvents.length
        ? dedupe(extraction.outline.keyEvents)
        : existingNode?.keyEvents ?? [],
      endingHook: extraction.outline.endingHook || existingNode?.endingHook,
      characters: extraction.characters.length
        ? dedupe(extraction.characters.map((c) => c.name))
        : existingNode?.characters ?? [],
      turningPoint: existingNode?.turningPoint,
      children: existingNode?.children ?? [],
      order: existingNode?.order ?? 0,
      updatedAt: Date.now()
    }
    changes.push({
      id: nid('outline'),
      domain: 'outline',
      action: existingNode ? 'update' : 'create',
      label: node.chapterSummary ? `章纲：${node.chapterSummary.slice(0, 30)}` : '章纲',
      detail: [
        extraction.outline.keyEvents.length ? `关键事件 ${extraction.outline.keyEvents.length} 条` : '',
        extraction.outline.endingHook ? '含结尾钩子' : ''
      ]
        .filter(Boolean)
        .join('，'),
      targetId: existingNode?.id,
      candidates: [],
      defaultChecked: true,
      checked: true,
      isNew: !existingNode,
      payload: node
    })
  }

  return {
    workId,
    chapterId,
    chapterTitle: chapter.title || '未命名章节',
    changes,
    counts: {
      create: changes.filter((c) => c.action === 'create').length,
      update: changes.filter((c) => c.action === 'update').length,
      conflict: changes.filter((c) => c.action === 'conflict').length,
      total: changes.length
    },
    createdAt: Date.now()
  }
}

/** 供大纲标签页使用的「全书摘要」视图数据 */
export function bookSummaries(state: {
  outlines: Outline[]
  chapters: Chapter[]
}): Array<{ chapterId: string; title: string; summary: string; updatedAt: number; hasSummary: boolean }> {
  const byChapter = new Map<string, Outline>()
  for (const n of flattenOutline(state.outlines)) {
    if (n.chapterId && n.level === 'chapter') byChapter.set(n.chapterId, n)
  }
  return state.chapters.map((c) => {
    const node = byChapter.get(c.id)
    const summary = node?.chapterSummary || c.summary || ''
    return {
      chapterId: c.id,
      title: c.title || '未命名章节',
      summary,
      updatedAt: node?.updatedAt ?? c.summaryUpdatedAt ?? c.updatedAt ?? 0,
      hasSummary: Boolean(summary)
    }
  })
}

/** 跳转到指定章节（供大纲/角色/伏笔点击跳转使用） */
export async function jumpToChapter(chapterId: string): Promise<void> {
  try {
    await useWorkStore.getState().selectChapter(chapterId)
  } catch {
    useUiStore.getState().showToast('跳转章节失败', 'error')
  }
}
