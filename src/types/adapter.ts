/**
 * 站点适配器与分块策略接口。
 *
 * 选择器是最大风险点：站点改版后只改本文件所在目录下的 adapter 实现（selectors），
 * 不得散落到业务代码里。
 */

/** 分块发送模式 */
export type ChunkingMode =
  /** 先逐块接收、再统一处理（对"接收-处理分离"指令服从度高的平台） */
  | 'receive-then-process'
  /** 先让模型对每块产出摘要，最后基于全部摘要统一处理 */
  | 'summary-first'
  /** 每块独立处理，互不依赖（前文易遗忘平台的安全降级模式） */
  | 'per-chunk-independent'

/** 站点登录态 */
export type LoginState = 'unknown' | 'logged-in' | 'logged-out'

/** 请求状态：同一时间只允许一个后台请求 */
export type RequestStatus = 'idle' | 'running' | 'failed' | 'timeout' | 'cancelled'

/** 分块进度 */
export interface ChunkProgress {
  /** 当前块序号，从 1 开始 */
  index: number
  /** 总块数 */
  total: number
  /** 0-100 */
  percent: number
  /** 已完成块的摘要 */
  summaries: string[]
  phase: 'sending' | 'summarizing' | 'finalizing' | 'done' | 'failed'
}

/**
 * 分平台分块策略（阶段 11.5b）。
 * 与通用分块层（11.5a）解耦：通用层负责切块，本接口负责"怎么问"。
 */
export interface ChunkingProfile {
  mode: ChunkingMode
  /** 单块最大字数 */
  maxChunkSize: number
  /** 相邻块重叠字数 */
  overlap: number
  /** 是否要求每块产出摘要 */
  requireSummary: boolean
  /** 块提示词前缀（可含平台偏好的结构化标记，如 DeepSeek 的 〖〗） */
  chunkPrefix?: string
  chunkSuffix?: string
  /** 构造第 index 块的提示词（index 从 1 开始） */
  buildChunkPrompt(index: number, total: number, text: string, prevSummary?: string): string
  /** 构造收尾"开始处理"提示词 */
  buildFinalPrompt(task: string, summaries: string[]): string
}

/** 站点适配器 */
export interface SiteAdapter {
  /** 唯一标识，如 'deepseek' */
  id: string
  /** 展示名 */
  name: string
  /** 站点首页 URL */
  url: string
  /** 用于匹配当前 URL 的模式（子串或 glob） */
  matchPatterns: string[]

  /** 输入框候选选择器，按顺序尝试，找不到返回 null（不抛异常） */
  inputSelectors: string[]
  /** 发送按钮候选选择器 */
  sendButtonSelectors: string[]
  /** 助手消息候选选择器（取最后一条为最新回复） */
  assistantMessageSelectors: string[]
  /** 登录态指示（存在即视为已登录） */
  loginIndicatorSelectors?: string[]
  /** 流式输出中指示 */
  streamingIndicatorSelectors?: string[]

  /** 分块策略 */
  chunking: ChunkingProfile

  /** 提取"用户当前草稿"（通常为输入框内容） */
  extractDraftScript(): string
  /** 把文本写入站点输入框（不自动发送） */
  insertDraftScript(text: string): string
  /** 读取最后一条助手回复 */
  extractLastReplyScript(): string
  /** 提交发送（点击发送按钮或回车） */
  submitScript?(): string
  /** 流式监听脚本：把增量文本通过 __WA_STREAM__ 回传 */
  streamingObserverScript(): string
  /** 登录态检测脚本，返回 'logged-in' | 'logged-out' | 'unknown' */
  loginStateScript(): string
}

/** 适配器注册表对外接口 */
export interface AdapterRegistry {
  list(): SiteAdapter[]
  get(id: string): SiteAdapter | undefined
  getByUrl(url: string): SiteAdapter | undefined
}

/** 注入脚本执行结果 */
export interface ScriptResult<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}

/**
 * 渲染进程把一个后台请求所需的全部脚本随请求下发给主进程。
 *
 * 这样主进程无需知道任何站点细节（只负责 executeJavaScript），
 * 站点改版时只改 renderer/adapters/*.ts 一个文件。
 *
 * ⚠️ 函数无法跨 IPC，因此：
 *  - insert 脚本内用占位符 "__WA_PROMPT__"（含引号）表示要插入的文本，
 *    主进程执行前替换为 JSON.stringify(实际提示词)
 *  - 分块策略用可序列化的 ChunkingSpec 下传
 */
export interface AdapterScripts {
  /** 把提示词写入输入框（不发送）；文本位置用 "__WA_PROMPT__" 占位 */
  insert: string
  /** 点击发送 */
  submit: string
  /** 读取最后一条助手回复文本 */
  extractLastReply: string
  /** 登录态检测，脚本返回 'logged-in' | 'logged-out' | 'unknown' */
  loginState: string
  /** 是否仍在流式输出中，返回 boolean */
  isStreaming: string
}

/** 可序列化的分块策略描述（跨 IPC 传递，主进程据此构造提示词） */
export interface ChunkingSpec {
  mode: ChunkingMode
  maxChunkSize: number
  overlap: number
  requireSummary: boolean
  /** 平台偏好的结构化前缀，如 DeepSeek 的 〖接收〗 */
  chunkPrefix?: string
  chunkSuffix?: string
}

/**
 * 插入占位符哨兵值。
 *
 * adapters 的 insertDraftScript() 接收此哨兵时，会把插入文本位置写成
 * JS 字面量 "__WA_PROMPT__"（而不是把哨兵本身当文本插入）；
 * 主进程执行前再把 '"__WA_PROMPT__"' 整体替换为 JSON.stringify(实际提示词)。
 */
export const PROMPT_SENTINEL = '__WA_PROMPT__'
/** 哨兵在脚本中的字面量形式（含引号），供主进程做整体替换 */
export const PROMPT_PLACEHOLDER = '"__WA_PROMPT__"'
