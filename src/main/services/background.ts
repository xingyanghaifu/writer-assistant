/**
 * 后台建议会话（阶段 3 / 3.5 / 11.5a / 11.5b / 12.5）。
 *
 * 关键约束：
 *  - 同一时间只允许一个请求（串行）
 *  - 默认 30 秒超时，支持取消
 *  - 不自动发送用户当前对话（只发送构造好的提示词）
 *  - 流式提取：轮询读取最后一条助手回复，增量推送给渲染进程
 *  - 分块发送：先收块回执，最后统一处理；块间隔 ≥500ms（合规）
 *  - 回复缓存：草稿 hash + 站点 + 任务类型，24 小时有效
 */
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { BgRequestParams, BgRequestParamsInternal, BgRequestResult } from '@shared/ipc'
import type { ChunkProgress, ChunkingSpec } from '@shared/adapter'
import { PROMPT_PLACEHOLDER } from '@shared/adapter'
import { splitIntoChunks } from '@shared/chunking'
import { appStore } from '../store'
import { executeScript, waitForWebview, getWebContents } from './inject'
import { buildCacheKey, getCache, setCache } from './cache'

const CHUNK_INTERVAL_MS = 500
const DEFAULT_POLL_MS = 400
const STREAM_IDLE_MS = 1500
const CHUNK_TIMEOUT_MS = 120_000

interface RunningRequest {
  requestId: string
  cancelled: boolean
}

let running: RunningRequest | null = null

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function status(requestId: string, s: string, error?: string): void {
  send(IPC.bgRequestStatus, { requestId, status: s, error })
}

function progress(requestId: string, p: ChunkProgress): void {
  send(IPC.bgChunkProgress, { requestId, ...p })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isCancelled(requestId: string): boolean {
  return running?.requestId === requestId && running.cancelled
}

/** 把提示词注入到 insert 脚本的占位符 */
function materializeInsert(script: string, prompt: string): string {
  const literal = JSON.stringify(prompt)
  if (script.includes(PROMPT_PLACEHOLDER)) {
    return script.split(PROMPT_PLACEHOLDER).join(literal)
  }
  // 兜底：脚本自带文本（例如 extractDraft 场景），原样返回
  return script
}

async function readReply(extractScript: string): Promise<string> {
  const r = await executeScript<string>('background', extractScript)
  return r.ok && typeof r.value === 'string' ? r.value : ''
}

/**
 * 发送一条消息并等待回复稳定。
 * 通过比较发送前后文本判断"新回复"。
 */
async function sendAndWait(
  params: BgRequestParams,
  prompt: string,
  requestId: string,
  timeoutMs: number,
  onDelta?: (full: string) => void
): Promise<{ text: string; timedOut: boolean }> {
  const { scripts } = params
  const before = await readReply(scripts.extractLastReply)

  const insertRes = await executeScript<{ ok?: boolean; error?: string; kind?: string }>(
    'background',
    materializeInsert(scripts.insert, prompt)
  )
  if (!insertRes.ok) {
    throw new Error(`写入输入框失败：${insertRes.error ?? '脚本执行异常'}`)
  }
  const insertVal = insertRes.value
  if (!insertVal?.ok) {
    // 把底层原因（input-not-found / not-editable）翻译成可操作的中文提示
    const why = insertVal?.error ?? '未知'
    const hint =
      why === 'input-not-found'
        ? '未找到输入框：请确认已登录，且右侧页面已完全加载'
        : why === 'not-editable'
          ? '输入框类型不支持：该站点的编辑器可能已改版'
          : why
    throw new Error(`自动填入失败（${hint}）`)
  }

  const submitRes = await executeScript<{ ok?: boolean; error?: string }>(
    'background',
    scripts.submit
  )
  if (!submitRes.ok) {
    throw new Error(`点击发送失败：${submitRes.error ?? '脚本执行异常'}`)
  }
  if (!submitRes.value?.ok) {
    const why = submitRes.value?.error ?? '未知'
    const hint =
      why === 'send-not-found'
        ? '未找到发送按钮：该站点的按钮结构可能已改版'
        : why
    throw new Error(`发送失败（${hint}）`)
  }

  /**
   * 超时判定：**以"无进展"为准，而不是绝对墙钟**。
   *
   * ⚠️ 实测（同一提示词、同一超时设置，连续两次）：
   *   冷启动第一次 = 30539ms，第二次 = 12400ms —— 相差 2.5 倍。
   * 原因是首次请求要等会话初始化/模型预热，远慢于后续请求。
   * 旧实现用 `deadline = 开始时刻 + timeoutMs` 作硬性墙钟，
   * 冷启动必然被判超时，用户看到"一直转圈然后报错"。
   *
   * 分两段判定：
   *   - 首字等待（还没任何内容）：给 timeoutMs*2（至少 60s），
   *     因为冷启动/深度思考的首 token 可能要 30s+
   *   - 续写空闲（已有内容）：连续 timeoutMs 无新内容才判卡死
   *   - hardDeadlineMs 作绝对上限兜底，避免无限等待
   */
  const firstTokenLimit = Math.max(timeoutMs * 2, 60_000)
  const idleLimit = timeoutMs
  const hardDeadlineMs = Date.now() + Math.max(timeoutMs * 4, 180_000)
  const pollMs = params.pollIntervalMs ?? DEFAULT_POLL_MS
  let last = ''
  let lastChange = Date.now()
  let sawNew = false
  let ticks = 0

  while (Date.now() < hardDeadlineMs) {
    if (isCancelled(requestId)) return { text: last, timedOut: false }

    const text = await readReply(scripts.extractLastReply)
    if (text && text !== before && text !== last) {
      last = text
      lastChange = Date.now()
      sawNew = true
      onDelta?.(text)
    }

    ticks++
    const streamingRes = await executeScript<boolean>('background', scripts.isStreaming)
    const streaming = streamingRes.ok && streamingRes.value === true

    if (sawNew && !streaming) {
      const idle = Date.now() - lastChange
      // 自适应空闲阈值：
      //  - 前 3 次轮询必须至少有一次完整轮询机会，避免"刚发出就判完成"（回复还没开始）
      //  - 回复越长，token 间网络抖动越大，阈值相应放宽，避免长回复被腰斩
      //  - 上限 6s，保证用户不会等太久
      const adaptiveIdle = Math.min(6000, STREAM_IDLE_MS + Math.floor(last.length / 400) * 500)
      if (ticks >= 3 && idle > adaptiveIdle) {
        return { text: last, timedOut: false }
      }
    }

    // 关键改动：空闲计时从"开始"改为"距上次有新内容"，
    // 且首字阶段用更宽的额度，避免冷启动被误杀。
    const idle = Date.now() - lastChange
    if (idle > (sawNew ? idleLimit : firstTokenLimit)) {
      // 已有部分内容时不算失败，交给调用方使用（避免丢掉半截回复）
      return { text: last, timedOut: !last }
    }

    await sleep(pollMs)
  }
  return { text: last, timedOut: true }
}

// ---------------------------------------------------------------------------
// 分块提示词（可序列化策略 -> 文本）
// ---------------------------------------------------------------------------

function buildChunkPrompt(
  spec: ChunkingSpec | undefined,
  index: number,
  total: number,
  text: string,
  prevSummary?: string
): string {
  const prefix = spec?.chunkPrefix ?? ''
  const suffix = spec?.chunkSuffix ?? ''
  if (index === 1) {
    return `${prefix}我将分 ${total} 段发送文本，请按规则处理：收到每段只回复"已收到第 X/${total} 段"，不要处理。我发送"开始处理"后再统一处理。${suffix}

第 1/${total} 段：
${text}`
  }
  const prev = prevSummary ? `（前文摘要：${prevSummary}）` : ''
  return `${prefix}第 ${index}/${total} 段${prev}：
${text}${suffix}`
}

function buildFinalPrompt(spec: ChunkingSpec | undefined, task: string, summaries: string[]): string {
  const block = summaries.length
    ? `\n\n各段摘要：\n${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''
  return `开始处理。请综合所有段落，${task}。只输出结果，不要重复原文。${block}`
}

function buildSummaryPrompt(text: string): string {
  return `请用 100 字以内概括以下内容的要点，只输出摘要：\n\n${text}`
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function startRequest(params: BgRequestParams): Promise<BgRequestResult> {
  if (running) throw new Error('已有请求正在进行，请稍后再试')

  const requestId = `req_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  const settings = appStore.getSettings()
  const timeoutMs = settings.requestTimeoutMs || 30000
  running = { requestId, cancelled: false }

  try {
    status(requestId, 'running')

    if (!(await waitForWebview('background', 8000))) {
      // 区分"未注册"与"加载中"两种原因，给出可操作提示
      const registered = getWebContents('background') !== null
      throw new Error(
        registered
          ? '后台会话仍在加载，请稍候几秒后重试（首次打开站点较慢）'
          : '后台会话未就绪：请切到「边写边看」或「AI 网页」让页面加载完成后再试'
      )
    }

    const loginRes = await executeScript<string>('background', params.scripts.loginState)
    if (loginRes.ok && loginRes.value === 'logged-out') {
      throw new Error(
        '尚未登录：请在右侧 AI 页面完成登录后重试（登录状态会被记住，只需登录一次）'
      )
    }

    const cacheKey = buildCacheKey(
      params.cacheKeyExtra ?? params.prompt,
      params.siteId,
      params.task,
      params.modelLabel
    )
    if (!params.skipCache) {
      const cached = getCache(cacheKey)
      if (cached) {
        status(requestId, 'idle')
        return { requestId, text: cached, fromCache: true, siteId: params.siteId, task: params.task, chunkCount: 1 }
      }
    }

    let finalText: string
    let chunkCount = 1

    if (params.chunked && params.chunkTask) {
      const r = await runChunked(params, requestId, timeoutMs)
      finalText = r.text
      chunkCount = r.chunkCount
    } else {
      const r = await sendAndWait(params, params.prompt, requestId, timeoutMs, (full) =>
        send(IPC.webviewStreamChunk, { requestId, text: full, done: false })
      )
      // 超时只在"完全没有内容"时才报错（空闲超时机制见 sendAndWait）
      if (r.timedOut && !r.text) {
        throw new Error(
          '长时间没有收到回复：请确认右侧 AI 页面可正常对话、未开启「深度思考」等耗时模式，然后重试'
        )
      }
      finalText = r.text
      send(IPC.webviewStreamChunk, { requestId, text: finalText, done: true })
    }

    if (finalText) setCache(cacheKey, finalText)
    status(requestId, 'idle')
    return {
      requestId,
      text: finalText,
      fromCache: false,
      siteId: params.siteId,
      task: params.task,
      chunkCount
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    status(requestId, isCancelled(requestId) ? 'cancelled' : 'failed', msg)
    throw err
  } finally {
    running = null
  }
}

/** 分块发送流程（阶段 11.5a / 11.5b） */
async function runChunked(
  params: BgRequestParams,
  requestId: string,
  timeoutMs: number
): Promise<{ text: string; chunkCount: number }> {
  const spec = params.chunkingProfile
  const size = spec?.maxChunkSize ?? 3000
  const overlap = spec?.overlap ?? 200
  // 分块针对"待处理的长文本"，即 chunkSource
  const source = params.chunkSource ?? params.prompt
  const chunks = splitIntoChunks(source, { size, overlap })

  if (chunks.length <= 1) {
    const r = await sendAndWait(params, params.prompt, requestId, timeoutMs, (full) =>
      send(IPC.webviewStreamChunk, { requestId, text: full, done: false })
    )
    return { text: r.text, chunkCount: 1 }
  }

  const summaries: string[] = []
  const perChunkTimeout = Math.max(timeoutMs, CHUNK_TIMEOUT_MS)

  for (const c of chunks) {
    if (isCancelled(requestId)) throw new Error('已取消')

    progress(requestId, {
      index: c.index,
      total: chunks.length,
      percent: Math.round(((c.index - 1) / chunks.length) * 100),
      summaries,
      phase: 'sending'
    })

    const prompt = buildChunkPrompt(spec, c.index, chunks.length, c.text, summaries[summaries.length - 1])

    // 单块失败重试，但不从头开始（已完成的块保留）
    let ok = false
    let replyText = ''
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      if (isCancelled(requestId)) throw new Error('已取消')
      const r = await sendAndWait(params, prompt, requestId, perChunkTimeout)
      if (r.text) {
        replyText = r.text
        ok = true
      } else {
        await sleep(800)
      }
    }

    if (!ok) {
      // 单块失败不丢已完成
      summaries.push(`（第 ${c.index} 段失败，已跳过）`)
    } else if (spec?.requireSummary !== false) {
      progress(requestId, {
        index: c.index,
        total: chunks.length,
        percent: Math.round((c.index / chunks.length) * 100),
        summaries,
        phase: 'summarizing'
      })
      const sumRes = await sendAndWait(params, buildSummaryPrompt(replyText.slice(0, 4000)), requestId, perChunkTimeout)
      summaries.push((sumRes.text || replyText).slice(0, 200))
    } else {
      summaries.push(replyText.slice(0, 200))
    }

    if (c.index < chunks.length) await sleep(CHUNK_INTERVAL_MS)
  }

  progress(requestId, {
    index: chunks.length,
    total: chunks.length,
    percent: 95,
    summaries,
    phase: 'finalizing'
  })

  const finalPrompt = buildFinalPrompt(spec, params.chunkTask ?? '请处理以上全部内容', summaries)
  const finalRes = await sendAndWait(params, finalPrompt, requestId, Math.max(timeoutMs, CHUNK_TIMEOUT_MS), (full) =>
    send(IPC.webviewStreamChunk, { requestId, text: full, done: false })
  )

  progress(requestId, {
    index: chunks.length,
    total: chunks.length,
    percent: 100,
    summaries,
    phase: 'done'
  })

  return { text: finalRes.text, chunkCount: chunks.length }
}

export function cancelRequest(requestId: string): boolean {
  if (!running || running.requestId !== requestId) return false
  running.cancelled = true
  status(requestId, 'cancelled')
  return true
}

export function isRunning(): boolean {
  return running !== null
}

export { PROMPT_PLACEHOLDER }
export type { BgRequestParamsInternal }
