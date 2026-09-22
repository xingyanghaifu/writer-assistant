/**
 * 宠物 AI 灵感增强（v3 P0-3.2）。
 *
 * 触发链路：
 *  - 本地规则命中 → 判断是否"值得问 AI"（命中规则 severity=suggest/warn 或非随机）
 *  - 若 allowAiInspiration=true 且距上次 AI 调用 ≥ cooldownMs
 *  - 复用提示词库"灵感"分类的模板（或用户收藏的）
 *  - 构造 prompt：最近 1~3 段 + 章摘要 + 角色/伏笔关键项
 *  - 走 window.api.bg.start（BackgroundWebview 路径）
 *  - 缓存命中优先
 *  - 风控/未登录 → 静默回退本地灵感
 *  - 输出 3 条、每条 ≤ 80 字
 */
import { getAdapter } from '../adapters/registry'
import { toScripts } from '../adapters/scripts'
import { useSiteStore } from '../store/site'
import { useUiStore } from '../store/ui'
import { getCacheAsync, setCache } from '../services/cacheBridge'
import type { InspirationItem } from '@shared/pet'
import type { PromptItem } from '@shared/promptLibrary'

const AI_COOLDOWN_MS = 45_000 // 距上次 AI 灵感至少 45s
const AI_OUTPUT_LIMIT = 3
const AI_MAX_LEN = 80

let lastAiCallAt = 0

const INSPIRATION_PROMPT = `你是小说写作灵感助手。基于以下上下文，输出 ≤{n} 条、每条 ≤80 字的灵感。
要求：具体、可立刻落笔，不要泛泛而谈，不要 markdown 列表。
JSON 格式：[{{"title":"...","content":"..."}}, ...]

章节摘要：{summary}
最近段落：
{recent}
关键角色：{characters}
关键伏笔：{foreshadowings}`

interface AiInspirationInput {
  chapterId: string
  recentParagraphs: string
  summary: string
  characters: string
  foreshadowings: string
}

export async function generateAiInspiration(input: AiInspirationInput): Promise<InspirationItem | null> {
  const settings = useUiStore.getState().settings?.pet
  if (!settings?.allowAiInspiration) return null
  const now = Date.now()
  if (now - lastAiCallAt < AI_COOLDOWN_MS) return null

  // 站点前置拦截
  const siteId = useUiStore.getState().siteId
  const siteState = useSiteStore.getState().sites[siteId]
  if (siteState?.status.kind === 'logged-out' || siteState?.status.kind === 'risk' || siteState?.status.kind === 'offline') {
    return null
  }

  // 选模板
  const libResp = await window.api.promptLibrary.list()
  const lib = (libResp as unknown) as PromptItem[]
  const inspirationItems = settings.onlyFavoritePrompts
    ? lib.filter((x) => x.enabled && x.favorite && x.category === '灵感')
    : lib.filter((x) => x.enabled && x.category === '灵感')
  if (inspirationItems.length === 0) return null
  const tmpl = inspirationItems[0]

  // 缓存 key
  const cacheKey = `pet-ai:${input.chapterId}:${tmpl.id}:${tmpl.version}`
  const cached = await getCacheAsync(cacheKey, 'pet')
  if (cached) {
    lastAiCallAt = now
    return parseInspirationFromCache(cached, input.chapterId)
  }

  const finalPrompt = INSPIRATION_PROMPT
    .replace('{n}', String(AI_OUTPUT_LIMIT))
    .replace('{summary}', input.summary || '（无）')
    .replace('{recent}', input.recentParagraphs || '（无）')
    .replace('{characters}', input.characters || '（无）')
    .replace('{foreshadowings}', input.foreshadowings || '（无）')

  const adapter = getAdapter(siteId)
  if (!adapter) return null
  const scripts = toScripts(adapter)

  try {
    const r = await window.api.bg.start({
      task: 'inspiration',
      prompt: finalPrompt,
      siteId,
      skipCache: false,
      scripts: scripts as never
    })
    lastAiCallAt = now
    if (!r.ok) return null
    const parsed = parseRawToInspirations(r.data.text, input.chapterId)
    if (!parsed) return null
    setCache(cacheKey, JSON.stringify(parsed), 'pet')
    return parsed
  } catch {
    return null
  }
}

function parseInspirationFromCache(json: string, chapterId: string): InspirationItem | null {
  try {
    const arr = JSON.parse(json) as Array<{ title: string; content: string }>
    return arrToInspiration(arr, chapterId)
  } catch {
    return null
  }
}

function parseRawToInspirations(raw: string, chapterId: string): InspirationItem | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < 0) return null
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as Array<{ title: string; content: string }>
    return arrToInspiration(arr, chapterId)
  } catch {
    return null
  }
}

function arrToInspiration(arr: Array<{ title: string; content: string }>, chapterId: string): InspirationItem | null {
  if (!Array.isArray(arr) || arr.length === 0) return null
  const first = arr[0]
  return {
    id: `insp_ai_${Date.now()}`,
    source: 'ai',
    title: first.title?.slice(0, 30) || 'AI 灵感',
    content: first.content?.slice(0, AI_MAX_LEN * 4) || '',
    severity: 'suggest',
    chapterId,
    createdAt: Date.now()
  }
}