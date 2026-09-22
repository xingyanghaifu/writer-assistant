/**
 * API 直连通道（与网页驱动完全分开）。
 *
 * 走 OpenAI 兼容的 /chat/completions；不经过 webview、不碰站点登录态。
 * 凭据存在 settings.apiProviders，按 providerId 取；Agent 只引用 providerId。
 */
import { appStore } from '../store'
import { buildCacheKey, getCache, setCache } from './cache'

export interface ApiCallParams {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  system?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  jsonMode?: boolean
  /** 历史对话（多轮） */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 内置工具定义（function calling） */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  /** 工具执行器：按名字返回文本结果 */
  runTool?: (name: string, args: Record<string, unknown>) => Promise<string>
  maxToolRounds?: number
  /** 流式增量回调 */
  onDelta?: (full: string) => void
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ApiCallResult {
  ok: boolean
  text: string
  error?: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

function normalizeBase(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '')
}

/** 调用 OpenAI 兼容接口；失败如实返回，由上层决定降级 */
export async function callOpenAiCompatible(params: ApiCallParams): Promise<ApiCallResult> {
  const base = normalizeBase(params.baseUrl)
  if (!base) return { ok: false, text: '', error: 'API 地址为空' }
  if (!params.apiKey) return { ok: false, text: '', error: '未配置 API Key' }
  if (!params.model) return { ok: false, text: '', error: '未指定模型' }

  // 复用同一套回复缓存：同提示词 + 同模型不重复请求
  const cacheKey = buildCacheKey(params.prompt, 'api:' + params.model, 'api-channel')
  const cached = getCache(cacheKey)
  if (cached) return { ok: true, text: cached }

  const url = base + '/chat/completions'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 120000)
  if (params.signal) params.signal.addEventListener('abort', () => controller.abort())

  const messages: Array<Record<string, unknown>> = [
    ...(params.system ? [{ role: 'system', content: params.system }] : []),
    ...(params.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: params.prompt }
  ]
  const useStream = typeof params.onDelta === 'function'

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + params.apiKey
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens,
        top_p: params.topP,
        frequency_penalty: params.frequencyPenalty,
        ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(params.tools && params.tools.length
          ? {
              tools: params.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters }
              })),
              tool_choice: 'auto'
            }
          : {}),
        stream: useStream
      }),
      signal: controller.signal
    })

    if (useStream && res.ok && res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let full = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = t.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
            const delta = j.choices?.[0]?.delta?.content
            if (delta) {
              full += delta
              params.onDelta?.(full)
            }
          } catch {
            /* 忽略半截 JSON */
          }
        }
      }
      if (!full.trim()) return { ok: false, text: '', error: '流式返回为空' }
      setCache(cacheKey, full)
      return { ok: true, text: full }
    }

    const raw = await res.text()
    if (!res.ok) {
      let detail = raw.slice(0, 300)
      try {
        const j = JSON.parse(raw) as { error?: { message?: string } }
        if (j.error?.message) detail = j.error.message
      } catch {
        /* 保持原文 */
      }
      return { ok: false, text: '', error: 'HTTP ' + res.status + '：' + detail }
    }

    let json: {
      choices?: Array<{ message?: { content?: string }; text?: string }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      json = JSON.parse(raw)
    } catch {
      return { ok: false, text: '', error: '返回不是合法 JSON' }
    }

    // 工具调用：模型可能要求先读角色/伏笔/大纲
    const toolCalls = (json.choices?.[0]?.message as {
      tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>
    } | undefined)?.tool_calls
    if (toolCalls && toolCalls.length && params.runTool) {
      const rounds = await runToolLoop(params, toolCalls)
      if (rounds) return rounds
    }

    const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
    if (!text.trim()) return { ok: false, text: '', error: '模型返回空内容' }

    setCache(cacheKey, text)
    return {
      ok: true,
      text,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('aborted')) return { ok: false, text: '', error: '请求超时或已取消' }
    return { ok: false, text: '', error: msg }
  } finally {
    clearTimeout(timeout)
  }
}

/** 按 providerId 取凭据 */
export function resolveProvider(providerId: string): { baseUrl: string; apiKey: string; name: string } | null {
  const list = appStore.getSettings().apiProviders ?? []
  const hit = list.find((x) => x.id === providerId)
  if (!hit) return null
  return { baseUrl: hit.baseUrl, apiKey: hit.apiKey, name: hit.name }
}

/** 用 Agent 配置发一次请求：Agent 存 providerId + model，凭据从设置取 */
export async function callAgent(params: {
  providerId: string
  model: string
  prompt: string
  system?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  jsonMode?: boolean
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  runTool?: (name: string, args: Record<string, unknown>) => Promise<string>
  maxToolRounds?: number
  onDelta?: (full: string) => void
}): Promise<ApiCallResult> {
  const prov = resolveProvider(params.providerId)
  if (!prov) return { ok: false, text: '', error: '未找到 API 凭据，请先在 Agent 面板配置' }
  return callOpenAiCompatible({
    baseUrl: prov.baseUrl,
    apiKey: prov.apiKey,
    model: params.model,
    prompt: params.prompt,
    system: params.system,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    topP: params.topP,
    frequencyPenalty: params.frequencyPenalty,
    jsonMode: params.jsonMode,
    history: params.history,
    tools: params.tools,
    runTool: params.runTool,
    maxToolRounds: params.maxToolRounds,
    onDelta: params.onDelta
  })
}


/**
 * 工具调用循环：执行模型请求的只读工具，把结果作为 tool 消息回灌，再问一次。
 * 最多 maxToolRounds 轮，避免无限循环。
 */
async function runToolLoop(
  params: ApiCallParams & { runTool?: (n: string, a: Record<string, unknown>) => Promise<string> },
  firstCalls: Array<{ id: string; function?: { name?: string; arguments?: string } }>
): Promise<ApiCallResult | null> {
  const maxRounds = Math.max(1, Math.min(4, params.maxToolRounds ?? 2))
  const messages: Array<Record<string, unknown>> = [
    ...(params.system ? [{ role: 'system', content: params.system }] : []),
    ...(params.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: params.prompt }
  ]
  let calls = firstCalls

  for (let round = 0; round < maxRounds; round++) {
    messages.push({ role: 'assistant', content: null, tool_calls: calls })
    for (const c of calls) {
      const name = c.function?.name ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function?.arguments ?? '{}')
      } catch {
        /* 参数异常时用空对象 */
      }
      let result = ''
      try {
        result = await params.runTool!(name, args)
      } catch (err) {
        result = '工具执行失败：' + (err instanceof Error ? err.message : String(err))
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: result })
    }

    let next: {
      choices?: Array<{ message?: { content?: string; tool_calls?: typeof calls } }>
    }
    try {
      const res = await fetch(params.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + params.apiKey },
        body: JSON.stringify({
          model: params.model,
          messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens,
          ...(params.tools && params.tools.length
            ? {
                tools: params.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters }
                })),
                tool_choice: 'auto'
              }
            : {})
        })
      })
      next = (await res.json()) as typeof next
    } catch (err) {
      return { ok: false, text: '', error: '工具轮次请求失败：' + (err instanceof Error ? err.message : String(err)) }
    }

    const msg = next.choices?.[0]?.message
    if (msg?.tool_calls && msg.tool_calls.length && round < maxRounds - 1) {
      calls = msg.tool_calls
      continue
    }
    const text = msg?.content ?? ''
    if (text.trim()) return { ok: true, text }
    return { ok: false, text: '', error: '工具执行后模型未给出正文' }
  }
  return { ok: false, text: '', error: '工具调用轮次超限' }
}
