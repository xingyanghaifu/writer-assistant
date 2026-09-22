/**
 * 建议请求编排（阶段 3 / 4 / 4.5）。
 *
 * - 调用后台会话发起请求
 * - 解析 JSON（第一个 { 到最后一个 }），失败降级为纯文本卡片
 * - 构造建议批次与卡片
 * - 追问：同一批次内追加，父卡片关联
 */
import type { Card, SuggestionBatch, SuggestionResponse, TaskType } from '@shared/suggestion'
import type { SiteAdapter, ChunkingSpec } from '@shared/adapter'
import { getAdapter } from '../adapters/registry'
import { toScripts, toChunkingSpec } from '../adapters/scripts'
import { getDefaultPrompt, render } from '@shared/prompts'

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

/**
 * 从模型回复中提取 JSON。
 * 取第一个 '{' 到最后一个 '}'；解析失败返回 null（调用方降级纯文本）。
 */
export function extractJson(text: string): unknown | null {
  if (!text) return null
  // 去掉常见的 markdown 代码块围栏
  const cleaned = text.replace(/```json/gi, '```').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const candidate = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    // 尝试修复常见问题：尾随逗号
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}

/** 解析建议响应；失败返回 null */
export function parseSuggestions(text: string): SuggestionResponse | null {
  const json = extractJson(text)
  if (!json || typeof json !== 'object') return null
  const obj = json as { suggestions?: unknown }
  if (!Array.isArray(obj.suggestions)) return null
  const suggestions = obj.suggestions
    .map((s) => {
      const o = s as Record<string, unknown>
      return {
        tag: String(o.tag ?? '建议'),
        summary: String(o.summary ?? ''),
        detail: String(o.detail ?? ''),
        effect: String(o.effect ?? '')
      }
    })
    .filter((s) => s.summary || s.detail)
  if (suggestions.length === 0) return null
  return { suggestions }
}

/** 解析失败时构造单张纯文本卡片 */
export function plainTextCard(text: string, siteId: string): Card {
  return {
    id: newId('card'),
    tag: '原始回复',
    summary: text.slice(0, 80) || '（空回复）',
    detail: text,
    effect: '',
    isFollowUp: false,
    siteId,
    plainText: true,
    feedback: null,
    createdAt: Date.now()
  }
}

export interface SuggestParams {
  draft: string
  contextText: string
  siteId: string
  /** 是否跳过缓存（重新生成） */
  skipCache?: boolean
  /** 是否分块发送 */
  chunked?: boolean
  /** 分块任务描述 */
  chunkTask?: string
  /** 模型标签（多模型对比） */
  modelLabel?: string
}

export interface SuggestOutcome {
  batch: SuggestionBatch
  fromCache: boolean
  requestId: string
  chunkCount: number
}

/** 把提示词模板渲染为最终提示词（含上下文） */
export function buildSuggestPrompt(contextText: string, draft: string): string {
  const tpl = getDefaultPrompt('suggest')
  // 模板里的 {draft} 用"上下文 + 草稿"替换，保证 AI 拿到完整信息
  const body = contextText ? `${contextText}\n\n【当前片段】\n${draft}` : draft
  return tpl ? render(tpl.template, { draft: body }) : body
}

/** 发起"获取建议" */
export async function requestSuggestions(params: SuggestParams): Promise<SuggestOutcome> {
  const adapter: SiteAdapter | undefined = getAdapter(params.siteId)
  if (!adapter) throw new Error(`未找到站点适配器：${params.siteId}`)

  const prompt = buildSuggestPrompt(params.contextText, params.draft)
  const task: TaskType = 'suggest'

  const res = await window.api.bg.start({
    task,
    prompt,
    siteId: params.siteId,
    skipCache: params.skipCache,
    chunked: params.chunked,
    chunkTask: params.chunkTask,
    chunkSource: params.chunked ? params.contextText || params.draft : undefined,
    cacheKeyExtra: params.draft,
    modelLabel: params.modelLabel,
    scripts: toScripts(adapter),
    chunkingProfile: params.chunked ? toChunkingSpec(adapter) : undefined
  })

  if (!res.ok) throw new Error(res.error)

  const { text, requestId, fromCache, chunkCount } = res.data
  const parsed = parseSuggestions(text)

  const cards: Card[] = parsed
    ? parsed.suggestions.map((s) => ({
        id: newId('card'),
        tag: s.tag,
        summary: s.summary,
        detail: s.detail,
        effect: s.effect,
        isFollowUp: false,
        siteId: params.siteId,
        modelLabel: params.modelLabel,
        feedback: null,
        createdAt: Date.now()
      }))
    : [plainTextCard(text, params.siteId)]

  const batch: SuggestionBatch = {
    id: newId('batch'),
    draftSnapshot: params.draft,
    cards,
    createdAt: Date.now(),
    collapsed: false,
    modelGroups: params.modelLabel ? [{ modelLabel: params.modelLabel, cards }] : undefined
  }

  return { batch, fromCache, requestId, chunkCount: chunkCount ?? 1 }
}

/**
 * 追问（阶段 4 / 4.5）：在后台继续提问，结果作为新卡片追加到同一批次。
 * 追问不新建批次，父卡片通过 parentCardId 关联。
 */
export async function requestFollowUp(
  parent: Card,
  siteId: string,
  extraContext?: string
): Promise<Card> {
  const adapter = getAdapter(siteId)
  if (!adapter) throw new Error(`未找到站点适配器：${siteId}`)

  const tpl = getDefaultPrompt('follow-up')
  const prompt = tpl
    ? render(tpl.template, { tag: parent.tag })
    : `基于你刚才建议的「${parent.tag}」走向，请展开写 500 字。`

  const full = extraContext ? `${extraContext}\n\n${prompt}` : prompt

  const res = await window.api.bg.start({
    task: 'follow-up',
    prompt: full,
    siteId,
    cacheKeyExtra: parent.summary,
    scripts: toScripts(adapter)
  })
  if (!res.ok) throw new Error(res.error)

  const json = extractJson(res.data.text) as { summary?: string; detail?: string; effect?: string } | null
  return {
    id: newId('card'),
    tag: `${parent.tag} · 追问`,
    summary: json?.summary ?? res.data.text.slice(0, 80),
    detail: json?.detail ?? res.data.text,
    effect: json?.effect ?? '',
    isFollowUp: true,
    parentCardId: parent.id,
    siteId,
    feedback: null,
    createdAt: Date.now()
  }
}

/**
 * 把文本插入右侧 AI 输入框（阶段 4）。
 * 只写入，不自动发送。
 */
export async function insertToSite(siteId: string, text: string): Promise<boolean> {
  const adapter = getAdapter(siteId)
  if (!adapter) return false
  const r = await window.api.webview.execute('main', adapter.insertDraftScript(text))
  return r.ok && !!(r.value as { ok?: boolean } | undefined)?.ok
}

/**
 * 通用原始请求：直接把 prompt 发给 AI 并取回纯文本。
 *
 * 供灵感库、章纲等"只要文本、不需要卡片批次"的功能使用，
 * 避免为每个新功能都写一套请求/解析逻辑。
 */
export async function requestRaw(params: {
  prompt: string
  task: TaskType
  siteId: string
  skipCache?: boolean
  cacheKeyExtra?: string
}): Promise<string> {
  const adapter = getAdapter(params.siteId)
  if (!adapter) throw new Error(`未找到站点适配器：${params.siteId}`)

  const res = await window.api.bg.start({
    task: params.task,
    prompt: params.prompt,
    siteId: params.siteId,
    skipCache: params.skipCache,
    cacheKeyExtra: params.cacheKeyExtra ?? params.prompt,
    scripts: toScripts(adapter)
  })
  if (!res.ok) throw new Error(res.error)
  return res.data.text
}

/** 多模型对比（阶段 12.5）：对多个站点/模型并发请求同一草稿 */
export async function requestMultiModel(
  params: SuggestParams,
  siteIds: string[]
): Promise<SuggestionBatch[]> {
  const results = await Promise.all(
    siteIds.map(async (siteId) => {
      try {
        const r = await requestSuggestions({ ...params, siteId, modelLabel: siteId })
        return r.batch
      } catch {
        return null
      }
    })
  )
  return results.filter((b): b is SuggestionBatch => b !== null)
}

export type { ChunkingSpec }
