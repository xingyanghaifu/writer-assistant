/**
 * 上下文组装（阶段 3.5）。
 *
 * 优先级（高 -> 低）：
 *   1. 当前草稿（最后 1500 字）
 *   2. 前文摘要（前 3 章摘要）
 *   3. 当前章纲
 *   4. 出场角色（匹配角色卡，最多 5 个）
 *   5. 未回收伏笔（相关的最多 3 条）
 *
 * 总预算 ≤3000 字；超预算从低优先级开始裁剪。
 * 各来源缺失时跳过，不报错。
 */
import type { Work, Chapter } from '@shared/work'
import type { Character, Foreshadowing, Outline } from '@shared/material'

/** 总上下文预算（字） */
export const CONTEXT_BUDGET = 3000
const DRAFT_LIMIT = 1500
const SUMMARY_CHAPTERS = 3
const MAX_CHARACTERS = 5
const MAX_FORESHADOWINGS = 3

export interface ContextSources {
  draft: string
  summaries: string[]
  outline: string
  characters: Character[]
  foreshadowings: Foreshadowing[]
}

export interface AssembledContext {
  text: string
  /** 实际包含的来源，用于调试/展示 */
  included: string[]
  /** 因预算被裁剪的来源 */
  trimmed: string[]
  length: number
}

/** 截断到 max 字，保留结尾（写作场景结尾更重要） */
function tail(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(t.length - max)
}

/** 从作品中取出当前章节之前的前 N 章 */
export function previousChapters(work: Work | undefined, currentChapterId: string, count: number): Chapter[] {
  if (!work) return []
  const flat: Chapter[] = []
  for (const v of work.volumes) for (const c of v.chapters) flat.push(c)
  const idx = flat.findIndex((c) => c.id === currentChapterId)
  if (idx < 0) return []
  return flat.slice(Math.max(0, idx - count), idx)
}

/** 从草稿中匹配出场角色（按名字出现与否） */
export function matchCharacters(draft: string, characters: Character[]): Character[] {
  const scored = characters
    .map((c) => {
      const name = c.name.trim()
      if (!name) return { c, score: -1 }
      let score = 0
      // 出现次数越多排序越前
      let i = draft.indexOf(name)
      while (i >= 0) {
        score++
        i = draft.indexOf(name, i + name.length)
      }
      // 主角/主要角色加权
      if (c.tags.includes('主角') || c.tags.includes('男主') || c.tags.includes('女主')) score += 2
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_CHARACTERS).map((x) => x.c)
}

/** 未回收伏笔 */
export function unrecoveredForeshadowings(foreshadowings: Foreshadowing[]): Foreshadowing[] {
  return foreshadowings.filter((f) => f.status === 'planted')
}

/** 章纲转文本 */
export function outlineToText(outlines: Outline[], chapterId: string): string {
  const parts: string[] = []
  for (const node of outlines) {
    if (node.chapterId === chapterId) {
      if (node.title) parts.push(node.title)
      if (node.chapterSummary) parts.push(node.chapterSummary)
      if (node.keyEvents?.length) parts.push(`关键事件：${node.keyEvents.join('；')}`)
      if (node.endingHook) parts.push(`结尾钩子：${node.endingHook}`)
    }
    // 递归子节点
    if (node.children?.length) {
      const sub = outlineToText(node.children, chapterId)
      if (sub) parts.push(sub)
    }
  }
  return parts.join('\n')
}

/** 按格式组装 */
export function formatContext(s: ContextSources): string {
  const blocks: string[] = []
  if (s.draft) blocks.push(`【当前草稿】\n${s.draft}`)
  if (s.summaries.length) blocks.push(`【前文摘要】\n${s.summaries.map((x, i) => `${i + 1}. ${x}`).join('\n')}`)
  if (s.outline) blocks.push(`【本章章纲】\n${s.outline}`)
  if (s.characters.length) {
    blocks.push(`【出场角色】\n${s.characters.map((c) => `- ${c.name}：${c.intro || '（暂无简介）'}`).join('\n')}`)
  }
  if (s.foreshadowings.length) {
    blocks.push(
      `【未回收伏笔】\n${s.foreshadowings.map((f) => `- ${f.content}${f.relatedTo ? `（关联：${f.relatedTo}）` : ''}`).join('\n')}`
    )
  }
  return blocks.join('\n\n')
}

/**
 * 组装上下文：先按优先级收集，再按预算从低优先级裁剪。
 */
export async function assembleContext(draft: string, workId: string, chapterId?: string): Promise<AssembledContext> {
  const included: string[] = []
  const trimmed: string[] = []

  // 各来源并发读取，任一失败按缺失处理（降级）
  const [work, characters, foreshadowings, outlines] = await Promise.all([
    window.api.work.get(workId).catch(() => undefined),
    window.api.material.characters(workId).catch(() => [] as Character[]),
    window.api.material.foreshadowings(workId).catch(() => [] as Foreshadowing[]),
    window.api.material.outline(workId).catch(() => [] as Outline[])
  ])

  const sources: ContextSources = {
    draft: tail(draft, DRAFT_LIMIT),
    summaries: [],
    outline: '',
    characters: [],
    foreshadowings: []
  }
  if (sources.draft) included.push('当前草稿')

  // 前 3 章摘要（仅取已有摘要的章节）
  if (work && chapterId) {
    const prev = previousChapters(work, chapterId, SUMMARY_CHAPTERS)
    sources.summaries = prev
      .map((c) => c.summary)
      .filter((x): x is string => !!x && x.trim().length > 0)
    if (sources.summaries.length) included.push('前文摘要')
  }

  // 章纲
  if (chapterId) {
    sources.outline = outlineToText(outlines, chapterId)
    if (sources.outline) included.push('本章章纲')
  }

  // 角色
  sources.characters = matchCharacters(sources.draft, characters)
  if (sources.characters.length) included.push('出场角色')

  // 伏笔（优先与出场角色相关的）
  const names = new Set(sources.characters.map((c) => c.name))
  const unrec = unrecoveredForeshadowings(foreshadowings)
  const related = unrec.filter((f) => f.relatedTo && names.has(f.relatedTo))
  const rest = unrec.filter((f) => !related.includes(f))
  sources.foreshadowings = [...related, ...rest].slice(0, MAX_FORESHADOWINGS)
  if (sources.foreshadowings.length) included.push('未回收伏笔')

  // ---- 预算裁剪：从最低优先级开始 ----
  let text = formatContext(sources)
  if (text.length > CONTEXT_BUDGET) {
    // 1) 去掉伏笔
    if (sources.foreshadowings.length) {
      sources.foreshadowings = []
      trimmed.push('未回收伏笔')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 2) 角色减半
    if (sources.characters.length > 2) {
      sources.characters = sources.characters.slice(0, 2)
      trimmed.push('出场角色(部分)')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 3) 去掉角色
    if (sources.characters.length) {
      sources.characters = []
      trimmed.push('出场角色')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 4) 去掉章纲
    if (sources.outline) {
      sources.outline = ''
      trimmed.push('本章章纲')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 5) 摘要只留最近 1 章
    if (sources.summaries.length > 1) {
      sources.summaries = sources.summaries.slice(-1)
      trimmed.push('前文摘要(部分)')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 6) 去掉摘要
    if (sources.summaries.length) {
      sources.summaries = []
      trimmed.push('前文摘要')
      text = formatContext(sources)
    }
  }
  if (text.length > CONTEXT_BUDGET) {
    // 7) 最后压缩草稿本身（保留结尾）
    const overhead = text.length - sources.draft.length
    const budgetForDraft = Math.max(200, CONTEXT_BUDGET - overhead)
    sources.draft = tail(sources.draft, budgetForDraft)
    trimmed.push('当前草稿(部分)')
    text = formatContext(sources)
  }

  return { text, included, trimmed, length: text.length }
}
