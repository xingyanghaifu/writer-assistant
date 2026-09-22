/**
 * 素材合并 / 冲突处理 / ID 生成（阶段 5.6、6）。
 *
 * ⚠️ OWNER: 子智能体 C
 *
 * 本文件是**纯逻辑层**：只做不可变数据变换，不接触 electron-store。
 * 持久化由 `src/main/ipc/material.ts` 完成，因此所有函数都可以被单测直接调用。
 *
 * 合并语义（写操作唯一入口，渲染进程的增量补丁与自动同步都走这里）：
 *  - **增量补丁**（不带 createdAt/lastUpdatedAt）：tags 取并集、supplements 追加去重、
 *    appearances 取并集、mentions 按增量累加；
 *  - **整实体写入**（带 createdAt 与 lastUpdatedAt，例如撤销回滚）：精确替换，不做累加。
 */
import { randomUUID } from 'node:crypto'
import type {
  Character,
  DailyStat,
  Foreshadowing,
  ForeshadowingType,
  Location,
  Note,
  Outline,
  Setting
} from '@shared/material'

// ---------------------------------------------------------------- ID 生成

/** 各实体 ID 前缀（用户可读，便于排查数据） */
export const ID_PREFIX = {
  character: 'cha',
  foreshadowing: 'fsd',
  outline: 'out',
  location: 'loc',
  setting: 'set',
  note: 'not'
} as const

export type EntityKind = keyof typeof ID_PREFIX

/** 生成全局唯一 ID：前缀_时间戳36进制_随机 */
export function generateId(kind: EntityKind): string {
  return `${ID_PREFIX[kind]}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

// ---------------------------------------------------------------- 通用工具

/** 名称归一化：去空白/常见标点、转小写，用于同名判定 */
export function normalizeName(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s\u3000·・.,，。:：;；、"'“”‘’（）()【】\[\]!！?？-]/g, '')
    .toLowerCase()
}

/** 字符串数组去重（按归一化值），保留首次出现的原始写法 */
export function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** 合并两个字符串数组（并集、去重、保序） */
export function unionStrings(base: string[] | undefined, add: string[] | undefined): string[] {
  return dedupeStrings([...(base ?? []), ...(add ?? [])])
}

/** 统计 name 在 text 中出现的非重叠次数（阶段 6 角色提及自动统计） */
export function countMentions(text: string, name: string): number {
  const needle = String(name ?? '').trim()
  if (!needle || !text) return 0
  let count = 0
  let from = 0
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    count += 1
    from = i + needle.length
  }
  return count
}

/** 统计算法：一次扫描统计多个名字的提及数 */
export function countMentionsAll(text: string, names: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of names) out[n] = countMentions(text, n)
  return out
}

/** 摘要清洗：去引号/换行/多余空白，并截断到 max 字（默认 100） */
export function clampSummary(text: string, max = 100): string {
  let s = String(text ?? '')
    .replace(/```[a-z]*/gi, '')
    .replace(/^\s*(摘要|概括|总结)\s*[:：]\s*/, '')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 去掉模型常见的"以上是摘要"之类尾巴
  s = s.replace(/(以上|希望|如需|注)[^。！？]*$/, '').trim()
  if (s.length > max) s = s.slice(0, max).replace(/[，,、；;：:]$/, '')
  return s
}

/** 本地日期键 YYYY-MM-DD */
export function dateKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------------------------------------------------------------- 冲突描述

export type ConflictKind =
  | 'duplicate-name'
  | 'empty-name'
  | 'foreshadowing-unmatched'
  | 'invalid-type'

export type EntityDomain = 'character' | 'foreshadowing' | 'outline' | 'location' | 'setting'

export interface ConflictCandidate {
  id: string
  label: string
}

/** 合并过程中发现的冲突（返回给渲染进程做「合并/新建」「手动关联」提示） */
export interface MergeConflict {
  kind: ConflictKind
  entity: EntityDomain
  /** 触发冲突的输入名/内容 */
  input: string
  message: string
  candidates?: ConflictCandidate[]
}

/** 合并结果 */
export interface UpsertResult<T> {
  list: T[]
  item: T
  created: boolean
  matchedBy: 'id' | 'name' | 'content' | 'none'
  conflicts: MergeConflict[]
}

/** 该补丁是否为「整实体写入」（精确替换语义） */
export function isFullWrite(patch: { createdAt?: number; lastUpdatedAt?: number }): boolean {
  return typeof patch.createdAt === 'number' && typeof patch.lastUpdatedAt === 'number'
}

/** 该补丁是否为整实体写入（伏笔用 updatedAt 字段） */
export function isFullWriteForeshadowing(patch: Partial<Foreshadowing>): boolean {
  return typeof patch.createdAt === 'number' && typeof patch.updatedAt === 'number'
}

// ---------------------------------------------------------------- 角色

/**
 * 新增 / 更新角色。
 * 匹配顺序：显式 id → 同名（归一化）→ 新建。
 * 同名命中多个时合并进「最近更新」的一个，并给出 duplicate-name 冲突让 UI 提示。
 */
export function upsertCharacter(
  list: Character[],
  patch: Partial<Character> & { name: string },
  now: number = Date.now(),
  opts: { forceNew?: boolean } = {}
): UpsertResult<Character> {
  const conflicts: MergeConflict[] = []
  const name = String(patch.name ?? '').trim()
  if (!name) {
    conflicts.push({
      kind: 'empty-name',
      entity: 'character',
      input: '',
      message: '角色名为空，已跳过'
    })
  }

  const byId = patch.id ? list.find((c) => c.id === patch.id) : undefined
  // 显式指定了一个不存在的 id → 视为按该 id 新建
  const explicitNew = Boolean(patch.id) && !byId

  let target: Character | undefined = byId
  let matchedBy: UpsertResult<Character>['matchedBy'] = byId ? 'id' : 'none'

  if (!target && !opts.forceNew && !explicitNew && name) {
    const key = normalizeName(name)
    const same = list.filter((c) => normalizeName(c.name) === key)
    if (same.length > 0) {
      same.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      target = same[0]
      matchedBy = 'name'
      if (same.length > 1) {
        conflicts.push({
          kind: 'duplicate-name',
          entity: 'character',
          input: name,
          message: `已存在 ${same.length} 个同名角色「${name}」，默认合并到最近更新的一个`,
          candidates: same.map((c) => ({ id: c.id, label: `${c.name}（提及 ${c.mentions}）` }))
        })
      }
    }
  }

  if (!target) {
    const created: Character = {
      id: patch.id || generateId('character'),
      name: name || '未命名角色',
      intro: String(patch.intro ?? ''),
      tags: dedupeStrings(patch.tags ?? []),
      appearances: dedupeStrings(patch.appearances ?? []),
      mentions: Math.max(0, Math.trunc(patch.mentions ?? 0)),
      supplements: dedupeStrings(patch.supplements ?? []),
      createdAt: typeof patch.createdAt === 'number' ? patch.createdAt : now,
      lastUpdatedAt: now
    }
    return { list: [...list, created], item: created, created: true, matchedBy: 'none', conflicts }
  }

  // ---- 更新既有角色 ----
  const full = isFullWrite({ createdAt: patch.createdAt, lastUpdatedAt: patch.lastUpdatedAt })
  const intro = String(patch.intro ?? '').trim()
  const nextSupplements = full
    ? dedupeStrings(patch.supplements ?? [])
    : appendSupplement(target.supplements, intro && intro !== target.intro ? intro : undefined)
  const next: Character = {
    ...target,
    name: name || target.name,
    intro: full ? String(patch.intro ?? '') : target.intro || intro,
    tags: full ? dedupeStrings(patch.tags ?? []) : unionStrings(target.tags, patch.tags),
    appearances: full
      ? dedupeStrings(patch.appearances ?? [])
      : unionStrings(target.appearances, patch.appearances),
    mentions: full
      ? Math.max(0, Math.trunc(patch.mentions ?? target.mentions))
      : Math.max(0, target.mentions + Math.trunc(patch.mentions ?? 0)),
    supplements: full ? dedupeStrings(patch.supplements ?? []) : nextSupplements,
    createdAt: target.createdAt,
    lastUpdatedAt: now
  }

  return {
    list: list.map((c) => (c.id === target!.id ? next : c)),
    item: next,
    created: false,
    matchedBy,
    conflicts
  }
}

/** 追加补充信息（去重、单条上限 20 条避免无限膨胀） */
export function appendSupplement(base: string[] | undefined, add: string | undefined): string[] {
  const merged = dedupeStrings([...(base ?? []), add])
  return merged.slice(-50)
}

/** 删除角色 */
export function removeCharacter(list: Character[], id: string): Character[] {
  return list.filter((c) => c.id !== id)
}

/** 为角色登记一次出场（章节 ID + 提及增量） */
export function recordAppearance(
  list: Character[],
  id: string,
  chapterId: string | undefined,
  mentions: number,
  now: number = Date.now()
): Character[] {
  return list.map((c) =>
    c.id === id
      ? {
          ...c,
          appearances: chapterId ? dedupeStrings([...c.appearances, chapterId]) : c.appearances,
          mentions: Math.max(0, c.mentions + Math.max(0, Math.trunc(mentions))),
          lastUpdatedAt: now
        }
      : c
  )
}

// ---------------------------------------------------------------- 伏笔

/** 二元组集合 */
function bigrams(value: string): Set<string> {
  const s = normalizeName(value)
  const out = new Set<string>()
  if (s.length <= 2) {
    if (s) out.add(s)
    return out
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** Dice 系数，0-1，用于伏笔内容模糊匹配 */
export function similarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

/** 伏笔匹配评分：内容相似度 + 关联对象一致 + 包含关系 */
export function foreshadowingScore(
  existing: Foreshadowing,
  content: string,
  relatedTo?: string
): number {
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

/** 在已埋设（planted）的伏笔中寻找最匹配的一条 */
export function matchForeshadowing(
  list: Foreshadowing[],
  content: string,
  relatedTo?: string,
  threshold = 0.34
): { item: Foreshadowing; score: number } | undefined {
  let best: { item: Foreshadowing; score: number } | undefined
  for (const f of list) {
    if (f.status !== 'planted') continue
    const score = foreshadowingScore(f, content, relatedTo)
    if (score >= threshold && (!best || score > best.score)) best = { item: f, score }
  }
  return best
}

const FORESHADOWING_TYPES: ForeshadowingType[] = ['plant', 'recover', 'item', 'identity', 'event', 'other']

/** 把任意输入规整为合法伏笔类型 */
export function normalizeForeshadowingType(value: unknown): ForeshadowingType {
  const v = String(value ?? '').trim().toLowerCase() as ForeshadowingType
  return FORESHADOWING_TYPES.includes(v) ? v : 'other'
}

/**
 * 新增 / 更新伏笔。
 * - 带 id 命中 → 更新；
 * - `type === 'recover'`（或带 recoveredChapterId）→ 先找已埋设伏笔改为已回收；
 *   匹配失败时新建（status 仍为 planted）并给出 foreshadowing-unmatched 冲突，等待手动关联；
 * - 其余 → 新建。
 */
export function upsertForeshadowing(
  list: Foreshadowing[],
  patch: Partial<Foreshadowing> & { content: string },
  now: number = Date.now()
): UpsertResult<Foreshadowing> {
  const conflicts: MergeConflict[] = []
  const content = String(patch.content ?? '').trim()
  const type = normalizeForeshadowingType(patch.type ?? 'plant')
  const byId = patch.id ? list.find((f) => f.id === patch.id) : undefined

  // ---- 1. 按 id 精确更新 ----
  if (byId) {
    const recovering = type === 'recover' || patch.status === 'recovered' || Boolean(patch.recoveredChapterId)
    const next: Foreshadowing = {
      ...byId,
      content: content || byId.content,
      type,
      status: recovering ? 'recovered' : (patch.status ?? byId.status),
      chapterId: patch.chapterId ?? byId.chapterId,
      recoveredChapterId: recovering
        ? patch.recoveredChapterId ?? byId.recoveredChapterId ?? patch.chapterId ?? byId.chapterId
        : patch.recoveredChapterId ?? byId.recoveredChapterId,
      relatedTo: patch.relatedTo ?? byId.relatedTo,
      anchor: patch.anchor ?? byId.anchor,
      updatedAt: now
    }
    return {
      list: list.map((f) => (f.id === byId.id ? next : f)),
      item: next,
      created: false,
      matchedBy: 'id',
      conflicts
    }
  }

  // ---- 2. 回收：先匹配已有伏笔 ----
  const wantsRecover = type === 'recover' || patch.status === 'recovered' || Boolean(patch.recoveredChapterId)
  if (wantsRecover) {
    const hit = matchForeshadowing(list, content, patch.relatedTo)
    if (hit) {
      const next: Foreshadowing = {
        ...hit.item,
        content: hit.item.content,
        type: 'recover',
        status: 'recovered',
        recoveredChapterId: patch.recoveredChapterId ?? patch.chapterId ?? hit.item.recoveredChapterId,
        relatedTo: hit.item.relatedTo ?? patch.relatedTo,
        updatedAt: now
      }
      return {
        list: list.map((f) => (f.id === hit.item.id ? next : f)),
        item: next,
        created: false,
        matchedBy: 'content',
        conflicts
      }
    }
    const created: Foreshadowing = {
      id: generateId('foreshadowing'),
      content,
      type: 'recover',
      // 未能匹配到埋设点：先按未回收登记，等用户在冲突面板手动关联
      status: 'planted',
      chapterId: patch.chapterId,
      recoveredChapterId: patch.recoveredChapterId ?? patch.chapterId,
      relatedTo: patch.relatedTo,
      anchor: patch.anchor,
      createdAt: now,
      updatedAt: now
    }
    const candidates = list
      .filter((f) => f.status === 'planted')
      .map((f) => ({ id: f.id, label: f.content.slice(0, 40), score: foreshadowingScore(f, content, patch.relatedTo) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ id, label }) => ({ id, label }))
    conflicts.push({
      kind: 'foreshadowing-unmatched',
      entity: 'foreshadowing',
      input: content,
      message: `回收项「${content.slice(0, 24)}」未匹配到已埋设伏笔，请手动关联`,
      candidates
    })
    return { list: [...list, created], item: created, created: true, matchedBy: 'none', conflicts }
  }

  // ---- 3. 埋设新增 ----
  const created: Foreshadowing = {
    id: generateId('foreshadowing'),
    content,
    type,
    status: 'planted',
    chapterId: patch.chapterId,
    recoveredChapterId: undefined,
    relatedTo: patch.relatedTo,
    anchor: patch.anchor,
    createdAt: now,
    updatedAt: now
  }
  return { list: [...list, created], item: created, created: true, matchedBy: 'none', conflicts }
}

/** 删除伏笔 */
export function removeForeshadowing(list: Foreshadowing[], id: string): Foreshadowing[] {
  return list.filter((f) => f.id !== id)
}

/** 未回收伏笔（UI 高亮用） */
export function plantedForeshadowings(list: Foreshadowing[]): Foreshadowing[] {
  return list.filter((f) => f.status === 'planted')
}

// ---------------------------------------------------------------- 地点 / 设定

interface NamedEntity {
  id: string
  name: string
  description: string
  firstChapterId?: string
  supplements: string[]
  createdAt: number
  lastUpdatedAt: number
}

/** 地点/设定通用合并：同名追加 description 到 supplements，isNew 为 false 时保留原描述 */
export function upsertNamedEntity<T extends NamedEntity>(
  list: T[],
  patch: Partial<T> & { name: string },
  kind: 'location' | 'setting',
  now: number = Date.now(),
  opts: { forceNew?: boolean } = {}
): UpsertResult<T> {
  const conflicts: MergeConflict[] = []
  const name = String(patch.name ?? '').trim()
  if (!name) {
    conflicts.push({ kind: 'empty-name', entity: kind, input: '', message: `${kind === 'location' ? '地点' : '设定'}名为空，已跳过` })
  }
  const byId = patch.id ? list.find((x) => x.id === patch.id) : undefined
  const explicitNew = Boolean(patch.id) && !byId
  let target: T | undefined = byId

  if (!target && !opts.forceNew && !explicitNew && name) {
    const key = normalizeName(name)
    const same = list.filter((x) => normalizeName(x.name) === key)
    if (same.length > 0) {
      target = same[0]
      if (same.length > 1) {
        conflicts.push({
          kind: 'duplicate-name',
          entity: kind,
          input: name,
          message: `已存在 ${same.length} 个同名${kind === 'location' ? '地点' : '设定'}「${name}」，默认合并`,
          candidates: same.map((x) => ({ id: x.id, label: x.name }))
        })
      }
    }
  }

  const description = String(patch.description ?? '').trim()
  if (!target) {
    const created = {
      id: patch.id || generateId(kind),
      name: name || '未命名',
      description,
      firstChapterId: patch.firstChapterId,
      supplements: dedupeStrings(patch.supplements ?? []),
      createdAt: typeof patch.createdAt === 'number' ? patch.createdAt : now,
      lastUpdatedAt: now
    } as T
    return { list: [...list, created], item: created, created: true, matchedBy: 'none', conflicts }
  }

  const full = isFullWrite({ createdAt: patch.createdAt, lastUpdatedAt: patch.lastUpdatedAt })
  const next = {
    ...target,
    name: name || target.name,
    description: full ? String(patch.description ?? '') : target.description || description,
    firstChapterId: target.firstChapterId ?? patch.firstChapterId,
    supplements: full
      ? dedupeStrings(patch.supplements ?? [])
      : appendSupplement(target.supplements, description && description !== target.description ? description : undefined),
    createdAt: target.createdAt,
    lastUpdatedAt: now
  } as T

  return {
    list: list.map((x) => (x.id === target!.id ? next : x)),
    item: next,
    created: false,
    matchedBy: byId ? 'id' : 'name',
    conflicts
  }
}

// ---------------------------------------------------------------- 大纲

const OUTLINE_LEVELS: Array<Outline['level']> = ['master', 'volume', 'chapter']

/** 规整大纲节点（补 id/数组/时间戳），不改变已有 id */
export function normalizeOutlineNode(node: Outline, now: number = Date.now()): Outline {
  return {
    id: node.id || generateId('outline'),
    chapterId: node.chapterId,
    level: OUTLINE_LEVELS.includes(node.level) ? node.level : 'chapter',
    title: String(node.title ?? '').trim() || '未命名',
    chapterSummary: node.chapterSummary,
    keyEvents: dedupeStrings(node.keyEvents ?? []),
    endingHook: node.endingHook,
    characters: dedupeStrings(node.characters ?? []),
    turningPoint: node.turningPoint,
    children: (node.children ?? []).map((c) => normalizeOutlineNode(c, now)),
    order: Number.isFinite(node.order) ? node.order : 0,
    updatedAt: node.updatedAt || now
  }
}

/** 规整整棵大纲树：去重 id、重排同级 order */
export function normalizeOutlineTree(nodes: Outline[] | undefined, now: number = Date.now()): Outline[] {
  const seen = new Set<string>()
  const walk = (list: Outline[]): Outline[] =>
    list.map((raw, index) => {
      const node = normalizeOutlineNode(raw, now)
      if (seen.has(node.id)) node.id = generateId('outline')
      seen.add(node.id)
      return { ...node, order: index, children: walk(node.children ?? []) }
    })
  return walk(Array.isArray(nodes) ? nodes : [])
}

/** 深度优先展开 */
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

/** 按 id 查找节点 */
export function findOutlineNode(nodes: Outline[], id: string): Outline | undefined {
  return flattenOutline(nodes).find((n) => n.id === id)
}

/** 按章节 ID 查找章纲节点 */
export function findChapterOutline(nodes: Outline[], chapterId: string): Outline | undefined {
  return flattenOutline(nodes).find((n) => n.chapterId === chapterId && n.level === 'chapter')
}

/**
 * 写入 / 更新章纲节点（自动同步写入本章摘要、关键事件、结尾钩子）。
 * 若该章已存在章纲，则就地更新；否则挂到最后一个分卷下（无分卷则挂根）。
 */
export function upsertChapterOutline(
  nodes: Outline[],
  input: {
    chapterId: string
    title?: string
    chapterSummary?: string
    keyEvents?: string[]
    endingHook?: string
    characters?: string[]
    turningPoint?: string
  },
  now: number = Date.now()
): { tree: Outline[]; node: Outline; created: boolean } {
  const existing = findChapterOutline(nodes, input.chapterId)
  const summary = input.chapterSummary ? clampSummary(input.chapterSummary) : undefined

  if (existing) {
    const next: Outline = {
      ...existing,
      title: input.title || existing.title,
      chapterSummary: summary ?? existing.chapterSummary,
      keyEvents: input.keyEvents?.length ? dedupeStrings(input.keyEvents) : existing.keyEvents,
      endingHook: input.endingHook || existing.endingHook,
      characters: input.characters?.length ? dedupeStrings(input.characters) : existing.characters,
      turningPoint: input.turningPoint || existing.turningPoint,
      updatedAt: now
    }
    const replace = (list: Outline[]): Outline[] =>
      list.map((n) =>
        n.id === next.id ? next : { ...n, children: replace(n.children ?? []) }
      )
    return { tree: replace(nodes), node: next, created: false }
  }

  const node: Outline = {
    id: generateId('outline'),
    chapterId: input.chapterId,
    level: 'chapter',
    title: input.title || '本章',
    chapterSummary: summary,
    keyEvents: dedupeStrings(input.keyEvents ?? []),
    endingHook: input.endingHook || undefined,
    characters: dedupeStrings(input.characters ?? []),
    turningPoint: input.turningPoint || undefined,
    children: [],
    order: 0,
    updatedAt: now
  }

  const tree = [...nodes]
  // 挂到最后一个分卷下；没有分卷则挂根
  let lastVolumeIndex = -1
  tree.forEach((n, i) => {
    if (n.level === 'volume') lastVolumeIndex = i
  })
  if (lastVolumeIndex >= 0) {
    const vol = tree[lastVolumeIndex]
    tree[lastVolumeIndex] = {
      ...vol,
      children: [...vol.children, { ...node, order: vol.children.length }],
      updatedAt: now
    }
  } else {
    tree.push({ ...node, order: tree.length })
  }
  return { tree, node, created: true }
}

/** 仅更新某章的摘要（阶段 5.5 生成结果落地） */
export function setChapterSummary(
  nodes: Outline[],
  chapterId: string,
  summary: string,
  now: number = Date.now()
): { tree: Outline[]; node: Outline; updated: boolean } {
  const input = { chapterId, chapterSummary: summary }
  const res = upsertChapterOutline(nodes, input, now)
  return { tree: res.tree, node: res.node, updated: true }
}

/** 移除节点（含子树） */
export function removeOutlineNode(nodes: Outline[], id: string): Outline[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeOutlineNode(n.children ?? [], id) }))
}

// ---------------------------------------------------------------- 便签

/** 新增 / 更新便签 */
export function upsertNote(
  list: Note[],
  patch: Partial<Note> & { content: string },
  now: number = Date.now()
): UpsertResult<Note> {
  const content = String(patch.content ?? '')
  const byId = patch.id ? list.find((n) => n.id === patch.id) : undefined
  if (byId) {
    const next: Note = {
      ...byId,
      content: patch.content !== undefined ? content : byId.content,
      pinned: patch.pinned ?? byId.pinned,
      updatedAt: now
    }
    return {
      list: list.map((n) => (n.id === byId.id ? next : n)),
      item: next,
      created: false,
      matchedBy: 'id',
      conflicts: []
    }
  }
  const created: Note = {
    id: patch.id || generateId('note'),
    content,
    pinned: patch.pinned ?? false,
    createdAt: typeof patch.createdAt === 'number' ? patch.createdAt : now,
    updatedAt: now
  }
  return { list: [created, ...list], item: created, created: true, matchedBy: 'none', conflicts: [] }
}

/** 便签排序：置顶优先，其次按更新时间倒序 */
export function sortNotes(list: Note[]): Note[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

/** 删除便签 */
export function removeNote(list: Note[], id: string): Note[] {
  return list.filter((n) => n.id !== id)
}

// ---------------------------------------------------------------- 码字统计

/** 累加当日码字统计（阶段 6 番茄钟/字数） */
export function accumulateDailyStat(
  list: DailyStat[],
  words: number,
  durationMs: number,
  now: number = Date.now()
): DailyStat[] {
  const key = dateKey(now)
  const w = Math.max(0, Math.round(words))
  const d = Math.max(0, Math.round(durationMs))
  const found = list.find((s) => s.date === key)
  const next = found
    ? list.map((s) => (s.date === key ? { ...s, words: s.words + w, durationMs: s.durationMs + d } : s))
    : [...list, { date: key, words: w, durationMs: d }]
  return next.sort((a, b) => a.date.localeCompare(b.date)).slice(-400)
}

/** 取最近 days 天（默认 7）的统计，缺失日期补 0，按日期升序 */
export function recentStats(list: DailyStat[], days = 7, now: number = Date.now()): DailyStat[] {
  const map = new Map(list.map((s) => [s.date, s]))
  const out: DailyStat[] = []
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000)
    const key = dateKey(d.getTime())
    const hit = map.get(key)
    out.push({ date: key, words: hit?.words ?? 0, durationMs: hit?.durationMs ?? 0 })
  }
  return out
}

/** 统计汇总 */
export function summarizeStats(list: DailyStat[]): { totalWords: number; totalDurationMs: number; days: number } {
  return {
    totalWords: list.reduce((sum, s) => sum + (s.words || 0), 0),
    totalDurationMs: list.reduce((sum, s) => sum + (s.durationMs || 0), 0),
    days: list.length
  }
}
