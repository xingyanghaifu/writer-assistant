/**
 * 写作模块自动同步（阶段 5.6）+ 章节摘要（阶段 5.5）的主进程侧纯逻辑。
 *
 * ⚠️ OWNER: 子智能体 C
 *
 * 该文件同样**不持久化、不发起 AI 请求**：
 *  - 提示词构造 / 正文分段 / 分块计划  → 供渲染进程编排
 *  - 提取结果解析（容错 JSON）           → 供渲染进程调用后回传
 *  - 提取结果 diff（→ 确认清单/冲突）    → 供确认模式 UI 展示
 *  - 勾选后的合并写回                    → 供 IPC 落盘
 *
 * 之所以把 diff/merge 放在主进程：确认清单与合并语义需要与素材库使用**同一份**合并代码，
 * 避免渲染进程与主进程出现两套不一致的规则。
 */
import { render, getDefaultPrompt } from '@shared/prompts'
import type {
  Character,
  Foreshadowing,
  ForeshadowingType,
  Location,
  Outline,
  Setting,
  SyncExtraction
} from '@shared/material'
import {
  appendSupplement,
  clampSummary,
  dedupeStrings,
  findChapterOutline,
  generateId,
  matchForeshadowing,
  normalizeForeshadowingType,
  normalizeName,
  similarity
} from './material'

// ---------------------------------------------------------------- 常量

/** 少于该字数跳过摘要（阶段 5.5 降级要求） */
export const SUMMARY_MIN_CHARS = 200
/** 超过该字数先分段摘要再合并（阶段 5.5） */
export const SUMMARY_SEGMENT_CHARS = 3000
/** 摘要默认上限字数 */
export const SUMMARY_MAX_CHARS = 100
/** 自动摘要：停输防抖（毫秒） */
export const AUTO_SUMMARY_DEBOUNCE_MS = 30_000
/** 自动摘要触发的最低章节字数 */
export const AUTO_SUMMARY_MIN_CHARS = 500
/** 自动同步后允许撤销的时间窗（毫秒） */
export const SYNC_UNDO_WINDOW_MS = 30_000
/** 少于该字数跳过自动同步提取 */
export const SYNC_MIN_CHARS = 200

/** 摘要提示词（与 src/types/prompts.ts 的 summarize 模板保持一致） */
export function summaryPromptTemplate(): string {
  return (
    getDefaultPrompt('summarize')?.template ??
    '请为以下小说章节生成 100 字以内的摘要，概括主要剧情、出场角色和关键转折。只输出摘要：\n\n{content}'
  )
}

/** 分段摘要合并提示词 */
export function summaryMergePromptTemplate(): string {
  return (
    getDefaultPrompt('summarize-merge')?.template ??
    '以下是同一章的分段摘要，请合并为一段 100 字以内的完整摘要，概括主要剧情、出场角色和关键转折。只输出摘要：\n\n{segments}'
  )
}

/** 同步提取提示词（要求严格 JSON，与 src/types/prompts.ts 的 sync-extract 一致） */
export function syncPromptTemplate(): string {
  return (
    getDefaultPrompt('sync-extract')?.template ??
    '请阅读以下小说章节，提取结构化信息。严格按以下 JSON 输出，不要输出任何其他内容：\n' +
      '{"characters":[{"name":"角色名","isNew":true,"intro":"简介","tags":["标签"],"appearances":1}],\n' +
      ' "outline":{"chapterSummary":"本章摘要","keyEvents":["关键事件"],"endingHook":"结尾钩子"},\n' +
      ' "foreshadowing":[{"content":"伏笔内容","type":"plant","relatedTo":"关联对象"}],\n' +
      ' "locations":[{"name":"地点名","isNew":true,"description":"描述"}],\n' +
      ' "settings":[{"name":"设定名","isNew":true,"description":"描述"}]}\n\n章节正文：\n{content}'
  )
}

// ---------------------------------------------------------------- 提示词构造

/** 单段摘要提示词 */
export function buildSummaryPrompt(content: string): string {
  return render(summaryPromptTemplate(), { content: String(content ?? '').trim() })
}

/** 分段摘要合并提示词 */
export function buildSummaryMergePrompt(segments: string[]): string {
  return render(summaryMergePromptTemplate(), {
    segments: segments.map((s, i) => `【第 ${i + 1} 段摘要】${s}`).join('\n')
  })
}

/** 同步提取提示词 */
export function buildSyncPrompt(content: string): string {
  return render(syncPromptTemplate(), { content: String(content ?? '').trim() })
}

// ---------------------------------------------------------------- 分段

/**
 * 按段落边界把正文切成 ≤ max 字的段（阶段 5.5：>3000 字分段摘要后合并）。
 * 段落超长时在 max 处硬切；返回数组长度 ≥ 1。
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

/** 是否需要分段摘要 */
export function needsSegmentedSummary(content: string, max: number = SUMMARY_SEGMENT_CHARS): boolean {
  return String(content ?? '').length > max
}

/** 正文是否达到摘要门槛（<200 字跳过） */
export function shouldSummarize(content: string, min: number = SUMMARY_MIN_CHARS): boolean {
  return String(content ?? '').replace(/\s+/g, '').length >= min
}

// ---------------------------------------------------------------- 解析

/** 去掉 ```json 围栏 */
export function stripCodeFence(text: string): string {
  return String(text ?? '')
    .replace(/^\s*```[a-zA-Z]*\s*/,'')
    .replace(/```\s*$/,'')
    .trim()
}

/**
 * 从模型回复中提取第一个平衡的 JSON 对象。
 * 模型常在 JSON 前后附加说明文字，这里做容错扫描。
 */
export function extractJsonObject(text: string): string | null {
  const s = stripCodeFence(String(text ?? ''))
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return dedupeStrings(value.map((v) => (typeof v === 'string' ? v : String(v ?? ''))))
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

/** 把任意解析结果规整为 SyncExtraction（缺字段补空，类型非法降级） */
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
      type: normalizeForeshadowingType(f['type']) as ForeshadowingType,
      relatedTo: asString(f['relatedTo']) || undefined
    }))

  const locations = (Array.isArray(obj['locations']) ? obj['locations'] : [])
    .map((l) => l as Record<string, unknown>)
    .filter((l) => l && typeof l === 'object' && asString(l['name']))
    .map((l) => ({
      name: asString(l['name']),
      isNew: Boolean(l['isNew']),
      description: asString(l['description'])
    }))

  const settings = (Array.isArray(obj['settings']) ? obj['settings'] : [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => s && typeof s === 'object' && asString(s['name']))
    .map((s) => ({
      name: asString(s['name']),
      isNew: Boolean(s['isNew']),
      description: asString(s['description'])
    }))

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

export type ParseExtractionResult =
  | { ok: true; data: SyncExtraction; raw: string }
  | { ok: false; error: string; raw: string }

/** 解析同步提取回复：容错 JSON → SyncExtraction */
export function parseExtraction(text: string): ParseExtractionResult {
  const raw = String(text ?? '')
  const json = extractJsonObject(raw)
  if (!json) return { ok: false, error: '回复中未找到 JSON 对象', raw }
  try {
    const parsed = JSON.parse(json) as unknown
    const data = validateExtraction(parsed)
    const empty =
      data.characters.length === 0 &&
      data.foreshadowing.length === 0 &&
      data.locations.length === 0 &&
      data.settings.length === 0 &&
      !data.outline.chapterSummary &&
      data.outline.keyEvents.length === 0
    if (empty) return { ok: false, error: '提取结果为空', raw }
    return { ok: true, data, raw }
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${(err as Error).message}`, raw }
  }
}

// ---------------------------------------------------------------- diff

/** 素材快照（同步 diff 的输入） */
export interface MaterialSnapshot {
  workId: string
  chapterId: string
  chapterTitle: string
  characters: Character[]
  foreshadowings: Foreshadowing[]
  outline: Outline[]
  locations: Location[]
  settings: Setting[]
}

export type SyncDomain = 'character' | 'foreshadowing' | 'location' | 'setting' | 'outline'

/** 单条可勾选变更 */
export interface SyncPlanChange {
  /** 变更 id（勾选用） */
  id: string
  domain: SyncDomain
  action: 'create' | 'update' | 'conflict'
  /** 一行摘要 */
  label: string
  /** 明细（UI 展开显示） */
  detail?: string
  /** 命中的已有实体 id */
  targetId?: string
  /** 冲突候选（同名/匹配失败时给出，供手动选择） */
  candidates?: Array<{ id: string; label: string }>
  /** 冲突说明 */
  conflictMessage?: string
  /** 默认是否勾选（冲突项默认不勾选） */
  defaultChecked: boolean
  /** 确认面板中的当前勾选状态（缺省时以 defaultChecked 为准） */
  checked?: boolean
  /** 落地数据 */
  change: SyncChange
  /** 是否为纯新增 */
  isNew: boolean
}

export type SyncChange =
  | { domain: 'character'; data: Character }
  | { domain: 'foreshadowing'; data: Foreshadowing }
  | { domain: 'location'; data: Location }
  | { domain: 'setting'; data: Setting }
  | { domain: 'outline'; data: Outline }

/** 同步计划 */
export interface SyncPlan {
  workId: string
  chapterId: string
  chapterTitle: string
  changes: SyncPlanChange[]
  counts: { create: number; update: number; conflict: number; total: number; checked: number }
  /** 解析得到的原始提取结果（供"只更新大纲"等局部操作用） */
  extraction: SyncExtraction
  createdAt: number
}

function labelForOutline(extraction: SyncExtraction): string {
  const summary = clampSummary(extraction.outline.chapterSummary)
  return summary ? `章纲：${summary.slice(0, 30)}` : '章纲'
}

/**
 * 把提取结果与现有素材做 diff，产出确认清单。
 * 规则（阶段 5.6）：
 *  - 角色：同名 → 追加信息 + 合并 tags + 累加提及；多个同名 → 冲突（默认不勾选）
 *  - 大纲：摘要 + 关键事件 + 结尾钩子
 *  - 伏笔：plant 新增；recover 匹配已有 → 改已回收；匹配失败 → 冲突（手动关联）
 *  - 地点/设定：同名追加，否则新建
 */
export function diffExtraction(snapshot: MaterialSnapshot, extraction: SyncExtraction, now: number = Date.now()): SyncPlan {
  const changes: SyncPlanChange[] = []
  const chapterId = snapshot.chapterId
  let seq = 0
  const nextId = (domain: SyncDomain): string => `${domain}-${chapterId}-${++seq}`

  // ---- 角色 ----
  for (const c of extraction.characters) {
    const key = normalizeName(c.name)
    const same = snapshot.characters.filter((x) => normalizeName(x.name) === key)
    const label = `角色「${c.name}」`

    if (same.length > 1) {
      changes.push({
        id: nextId('character'),
        domain: 'character',
        action: 'conflict',
        label,
        detail: `已存在 ${same.length} 个同名角色，默认不自动合并`,
        candidates: same.map((x) => ({ id: x.id, label: `${x.name}（提及 ${x.mentions}）` })),
        conflictMessage: '同名角色：请选择合并到哪一个，或取消勾选后手动新建',
        defaultChecked: false,
        isNew: false,
        change: {
          domain: 'character',
          data: {
            id: generateId('character'),
            name: c.name,
            intro: c.intro,
            tags: dedupeStrings(c.tags),
            appearances: [chapterId],
            mentions: c.appearances,
            supplements: [],
            createdAt: now,
            lastUpdatedAt: now
          }
        }
      })
      continue
    }

    if (same.length === 1) {
      const target = same[0]
      const newTags = c.tags.filter((t) => !target.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
      const detailParts: string[] = []
      if (newTags.length) detailParts.push(`新增标签 ${newTags.join('/')}`)
      if (c.intro && c.intro !== target.intro) detailParts.push('追加简介')
      detailParts.push(`提及 +${c.appearances}`)
      changes.push({
        id: nextId('character'),
        domain: 'character',
        action: 'update',
        label,
        detail: detailParts.join('，'),
        targetId: target.id,
        defaultChecked: true,
        isNew: false,
        change: {
          domain: 'character',
          data: {
            ...target,
            id: target.id,
            intro: c.intro || target.intro,
            tags: dedupeStrings(c.tags),
            appearances: [chapterId],
            mentions: c.appearances,
            supplements: appendSupplement(target.supplements, c.intro && c.intro !== target.intro ? c.intro : undefined),
            lastUpdatedAt: now
          }
        }
      })
      continue
    }

    changes.push({
      id: nextId('character'),
      domain: 'character',
      action: 'create',
      label: `${label}（新）`,
      detail: c.intro || '新建角色',
      defaultChecked: true,
      isNew: true,
      change: {
        domain: 'character',
        data: {
          id: generateId('character'),
          name: c.name,
          intro: c.intro,
          tags: dedupeStrings(c.tags),
          appearances: [chapterId],
          mentions: c.appearances,
          supplements: [],
          createdAt: now,
          lastUpdatedAt: now
        }
      }
    })
  }

  // ---- 伏笔 ----
  for (const f of extraction.foreshadowing) {
    const wantsRecover = f.type === 'recover'
    if (wantsRecover) {
      const hit = matchForeshadowing(snapshot.foreshadowings, f.content, f.relatedTo)
      if (hit) {
        changes.push({
          id: nextId('foreshadowing'),
          domain: 'foreshadowing',
          action: 'update',
          label: `回收「${hit.item.content.slice(0, 20)}」`,
          detail: `匹配度 ${(hit.score * 100).toFixed(0)}% · ${f.content.slice(0, 40)}`,
          targetId: hit.item.id,
          defaultChecked: true,
          isNew: false,
          change: {
            domain: 'foreshadowing',
            data: {
              ...hit.item,
              type: 'recover',
              status: 'recovered',
              recoveredChapterId: chapterId,
              updatedAt: now
            }
          }
        })
        continue
      }
      const candidates = snapshot.foreshadowings
        .filter((x) => x.status === 'planted')
        .map((x) => ({ id: x.id, label: x.content.slice(0, 40), score: similarity(x.content, f.content) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, label }))
      changes.push({
        id: nextId('foreshadowing'),
        domain: 'foreshadowing',
        action: 'conflict',
        label: `回收「${f.content.slice(0, 20)}」未匹配`,
        detail: f.content,
        candidates,
        conflictMessage: '未找到对应的已埋设伏笔，请手动关联或取消勾选',
        defaultChecked: false,
        isNew: false,
        change: {
          domain: 'foreshadowing',
          data: {
            id: generateId('foreshadowing'),
            content: f.content,
            type: 'recover',
            status: 'planted',
            chapterId,
            recoveredChapterId: chapterId,
            relatedTo: f.relatedTo,
            createdAt: now,
            updatedAt: now
          }
        }
      })
      continue
    }

    // plant：完全重复则只刷新关联对象；否则新建
    const exact = snapshot.foreshadowings.find(
      (x) => x.status === 'planted' && normalizeName(x.content) === normalizeName(f.content)
    )
    if (exact) {
      changes.push({
        id: nextId('foreshadowing'),
        domain: 'foreshadowing',
        action: 'update',
        label: `伏笔已存在「${exact.content.slice(0, 20)}」`,
        detail: '仅刷新关联对象',
        targetId: exact.id,
        defaultChecked: true,
        isNew: false,
        change: {
          domain: 'foreshadowing',
          data: { ...exact, relatedTo: exact.relatedTo ?? f.relatedTo, updatedAt: now }
        }
      })
      continue
    }

    changes.push({
      id: nextId('foreshadowing'),
      domain: 'foreshadowing',
      action: 'create',
      label: `伏笔「${f.content.slice(0, 20)}」`,
      detail: f.relatedTo ? `关联：${f.relatedTo}` : '新埋设',
      defaultChecked: true,
      isNew: true,
      change: {
        domain: 'foreshadowing',
        data: {
          id: generateId('foreshadowing'),
          content: f.content,
          type: f.type,
          status: 'planted',
          chapterId,
          relatedTo: f.relatedTo,
          createdAt: now,
          updatedAt: now
        }
      }
    })
  }

  // ---- 地点 ----
  for (const loc of extraction.locations) {
    const key = normalizeName(loc.name)
    const same = snapshot.locations.filter((x) => normalizeName(x.name) === key)
    if (same.length > 0) {
      const target = same[0]
      const detailParts: string[] = []
      if (loc.description && loc.description !== target.description) detailParts.push('追加描述')
      if (same.length > 1) detailParts.push(`存在 ${same.length} 个同名，默认合并`)
      changes.push({
        id: nextId('location'),
        domain: 'location',
        action: same.length > 1 ? 'conflict' : 'update',
        label: `地点「${loc.name}」`,
        detail: detailParts.join('，') || '无变化',
        targetId: target.id,
        candidates: same.length > 1 ? same.map((x) => ({ id: x.id, label: x.name })) : undefined,
        conflictMessage: same.length > 1 ? '同名地点：请选择要合并的目标' : undefined,
        defaultChecked: same.length <= 1,
        isNew: false,
        change: {
          domain: 'location',
          data: {
            ...target,
            description: target.description || loc.description,
            supplements: appendSupplement(
              target.supplements,
              loc.description && loc.description !== target.description ? loc.description : undefined
            ),
            lastUpdatedAt: now
          }
        }
      })
    } else {
      changes.push({
        id: nextId('location'),
        domain: 'location',
        action: 'create',
        label: `地点「${loc.name}」（新）`,
        detail: loc.description,
        defaultChecked: true,
        isNew: true,
        change: {
          domain: 'location',
          data: {
            id: generateId('location'),
            name: loc.name,
            description: loc.description,
            firstChapterId: chapterId,
            supplements: [],
            createdAt: now,
            lastUpdatedAt: now
          }
        }
      })
    }
  }

  // ---- 设定 ----
  for (const s of extraction.settings) {
    const key = normalizeName(s.name)
    const same = snapshot.settings.filter((x) => normalizeName(x.name) === key)
    if (same.length > 0) {
      const target = same[0]
      changes.push({
        id: nextId('setting'),
        domain: 'setting',
        action: same.length > 1 ? 'conflict' : 'update',
        label: `设定「${s.name}」`,
        detail: s.description && s.description !== target.description ? '追加描述' : '无变化',
        targetId: target.id,
        candidates: same.length > 1 ? same.map((x) => ({ id: x.id, label: x.name })) : undefined,
        conflictMessage: same.length > 1 ? '同名设定：请选择要合并的目标' : undefined,
        defaultChecked: same.length <= 1,
        isNew: false,
        change: {
          domain: 'setting',
          data: {
            ...target,
            description: target.description || s.description,
            supplements: appendSupplement(
              target.supplements,
              s.description && s.description !== target.description ? s.description : undefined
            ),
            lastUpdatedAt: now
          }
        }
      })
    } else {
      changes.push({
        id: nextId('setting'),
        domain: 'setting',
        action: 'create',
        label: `设定「${s.name}」（新）`,
        detail: s.description,
        defaultChecked: true,
        isNew: true,
        change: {
          domain: 'setting',
          data: {
            id: generateId('setting'),
            name: s.name,
            description: s.description,
            firstChapterId: chapterId,
            supplements: [],
            createdAt: now,
            lastUpdatedAt: now
          }
        }
      })
    }
  }

  // ---- 大纲（单条） ----
  const hasOutline =
    Boolean(extraction.outline.chapterSummary) ||
    extraction.outline.keyEvents.length > 0 ||
    Boolean(extraction.outline.endingHook)
  if (hasOutline) {
    const existing = findChapterOutline(snapshot.outline, chapterId)
    const node: Outline = {
      id: existing?.id ?? generateId('outline'),
      chapterId,
      level: 'chapter',
      title: existing?.title || snapshot.chapterTitle || '本章',
      chapterSummary: extraction.outline.chapterSummary
        ? clampSummary(extraction.outline.chapterSummary)
        : existing?.chapterSummary,
      keyEvents: extraction.outline.keyEvents.length
        ? dedupeStrings(extraction.outline.keyEvents)
        : existing?.keyEvents ?? [],
      endingHook: extraction.outline.endingHook || existing?.endingHook,
      characters: extraction.characters.length
        ? dedupeStrings(extraction.characters.map((c) => c.name))
        : existing?.characters ?? [],
      turningPoint: existing?.turningPoint,
      children: existing?.children ?? [],
      order: existing?.order ?? 0,
      updatedAt: now
    }
    changes.push({
      id: nextId('outline'),
      domain: 'outline',
      action: existing ? 'update' : 'create',
      label: labelForOutline(extraction),
      detail: [
        extraction.outline.keyEvents.length ? `关键事件 ${extraction.outline.keyEvents.length} 条` : '',
        extraction.outline.endingHook ? '含结尾钩子' : ''
      ]
        .filter(Boolean)
        .join('，'),
      targetId: existing?.id,
      defaultChecked: true,
      isNew: !existing,
      change: { domain: 'outline', data: node }
    })
  }

  const counts = {
    create: changes.filter((c) => c.action === 'create').length,
    update: changes.filter((c) => c.action === 'update').length,
    conflict: changes.filter((c) => c.action === 'conflict').length,
    total: changes.length,
    checked: changes.filter((c) => c.defaultChecked).length
  }

  return {
    workId: snapshot.workId,
    chapterId: snapshot.chapterId,
    chapterTitle: snapshot.chapterTitle,
    changes,
    counts,
    extraction,
    createdAt: now
  }
}

// ---------------------------------------------------------------- 落库

/** 应用一次变更到快照（纯函数） */
function applyChange(snapshot: MaterialSnapshot, change: SyncPlanChange, now: number): void {
  switch (change.change.domain) {
    case 'character': {
      const data = change.change.data
      if (change.action === 'conflict') return
      const i = snapshot.characters.findIndex((c) => c.id === change.targetId || c.id === data.id)
      if (i >= 0) {
        const target = snapshot.characters[i]
        const intro = data.intro && data.intro !== target.intro ? data.intro : ''
        snapshot.characters[i] = {
          ...target,
          // 已存在：追加信息、合并 tags、累加提及
          tags: dedupeStrings([...target.tags, ...data.tags]),
          appearances: dedupeStrings([...target.appearances, ...data.appearances]),
          mentions: target.mentions + data.mentions,
          intro: target.intro || data.intro,
          supplements: appendSupplement(target.supplements, intro || undefined),
          lastUpdatedAt: now
        }
      } else {
        snapshot.characters = [...snapshot.characters, data]
      }
      break
    }
    case 'foreshadowing': {
      const data = change.change.data
      if (change.action === 'conflict') return
      const i = snapshot.foreshadowings.findIndex((f) => f.id === change.targetId)
      if (i >= 0) snapshot.foreshadowings[i] = { ...data, updatedAt: now }
      else snapshot.foreshadowings = [...snapshot.foreshadowings, data]
      break
    }
    case 'location': {
      const data = change.change.data
      if (change.action === 'conflict') return
      const i = snapshot.locations.findIndex((l) => l.id === data.id)
      if (i >= 0) {
        const target = snapshot.locations[i]
        snapshot.locations[i] = {
          ...target,
          description: target.description || data.description,
          supplements: data.supplements,
          lastUpdatedAt: now
        }
      } else {
        snapshot.locations = [...snapshot.locations, data]
      }
      break
    }
    case 'setting': {
      const data = change.change.data
      if (change.action === 'conflict') return
      const i = snapshot.settings.findIndex((s) => s.id === data.id)
      if (i >= 0) {
        const target = snapshot.settings[i]
        snapshot.settings[i] = {
          ...target,
          description: target.description || data.description,
          supplements: data.supplements,
          lastUpdatedAt: now
        }
      } else {
        snapshot.settings = [...snapshot.settings, data]
      }
      break
    }
    case 'outline': {
      const node = change.change.data
      const replace = (list: Outline[]): Outline[] =>
        list.map((n) => (n.id === node.id ? { ...node, children: n.children } : { ...n, children: replace(n.children ?? []) }))
      const exists = findChapterOutline(snapshot.outline, node.chapterId ?? '')
      if (exists) {
        snapshot.outline = replace(snapshot.outline)
      } else {
        // 挂到最后一个分卷下，没有分卷则挂根
        const tree = [...snapshot.outline]
        let lastVolume = -1
        tree.forEach((n, i) => {
          if (n.level === 'volume') lastVolume = i
        })
        if (lastVolume >= 0) {
          const vol = tree[lastVolume]
          tree[lastVolume] = { ...vol, children: [...vol.children, { ...node, order: vol.children.length }], updatedAt: now }
        } else {
          tree.push({ ...node, order: tree.length })
        }
        snapshot.outline = tree
      }
      break
    }
  }
}

/** 应用勾选后的变更，返回新快照（不修改入参） */
export function applySyncPlan(
  snapshot: MaterialSnapshot,
  changes: SyncPlanChange[],
  now: number = Date.now()
): MaterialSnapshot {
  const next: MaterialSnapshot = {
    ...snapshot,
    characters: [...snapshot.characters],
    foreshadowings: [...snapshot.foreshadowings],
    outline: snapshot.outline,
    locations: [...snapshot.locations],
    settings: [...snapshot.settings]
  }
  for (const c of changes) applyChange(next, c, now)
  return next
}

/** 勾选的变更数量 */
export function countChecked(changes: SyncPlanChange[]): number {
  return changes.filter((c) => c.checked !== false).length
}

/**
 * 自动模式：直接把整份提取结果合并进素材库（跳过确认）。
 * 与确认模式共用同一套 diff/apply 规则，保证两种模式结果一致。
 */
export function applyExtraction(
  snapshot: MaterialSnapshot,
  extraction: SyncExtraction,
  now: number = Date.now()
): { snapshot: MaterialSnapshot; plan: SyncPlan } {
  const plan = diffExtraction(snapshot, extraction, now)
  // 冲突项在自动模式下也跳过（与默认不勾选一致），避免误合并
  const auto = plan.changes.filter((c) => c.action !== 'conflict')
  return { snapshot: applySyncPlan(snapshot, auto, now), plan }
}

/** 反向快照：撤销用（记录合并前的原始列表） */
export interface SyncUndoSnapshot {
  characters: Character[]
  foreshadowings: Foreshadowing[]
  outline: Outline[]
  locations: Location[]
  settings: Setting[]
}

/** 从素材快照抽出可回滚状态 */
export function undoSnapshotOf(snapshot: MaterialSnapshot): SyncUndoSnapshot {
  return {
    characters: snapshot.characters.map((c) => ({ ...c, tags: [...c.tags], appearances: [...c.appearances], supplements: [...c.supplements] })),
    foreshadowings: snapshot.foreshadowings.map((f) => ({ ...f })),
    outline: snapshot.outline,
    locations: snapshot.locations.map((l) => ({ ...l, supplements: [...l.supplements] })),
    settings: snapshot.settings.map((s) => ({ ...s, supplements: [...s.supplements] }))
  }
}

// ---------------------------------------------------------------- 摘要

/** 组合分段摘要为最终摘要的兜底（后台不可用时的本地降级） */
export function mergeSegmentsLocally(segments: string[], max: number = SUMMARY_MAX_CHARS): string {
  return clampSummary(segments.join(' '), max)
}

/** 摘要是否需要重新生成（正文变化或从未生成） */
export function summaryStale(
  chapter: { summary?: string; summaryVersion?: number; wordCount?: number },
  currentWordCount: number
): boolean {
  if (!chapter.summary) return true
  if (typeof chapter.summaryVersion === 'number' && chapter.summaryVersion !== currentWordCount) return true
  return false
}
