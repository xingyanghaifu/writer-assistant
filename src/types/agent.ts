/**
 * 自定义 Agent（自选）。
 *
 * 一个 Agent = 站点 + 提示词 + 温度式偏好 + 适用场景。
 * 调用时按 Agent 配置走现有 bg.start（仍受站点登录/风控约束）。
 */
import type { TaskType } from './suggestion'

/** Agent 适用的写作场景 */
export type AgentScene =
  | 'draft'        // 正文创作
  | 'polish'       // 润色改写
  | 'outline'      // 大纲结构
  | 'character'    // 人设对白
  | 'consistency'  // 一致性检查
  | 'research'     // 设定考据
  | 'general'      // 通用

/** 调用通道：webview 网页驱动 / 直连 API */
export type AgentChannel = 'web' | 'api'

/** API 通道配置（仅 channel === 'api' 时使用） */
export interface AgentApiConfig {
  /** 引用 settings.apiProviders 中的条目 id */
  providerId: string
  /** OpenAI 兼容的 base_url，如 https://docode.cc/v1（展示用，实际取 provider） */
  baseUrl: string
  /** 模型名，如 gpt-5.6 / deepseek-v4-pro */
  model: string
  /** 是否存了 key（key 存设置里，不写进 Agent 本身） */
  hasKey?: boolean
  temperature?: number
  maxTokens?: number
  /** 是否流式输出（边生成边显示） */
  stream?: boolean
  /** 是否开启多轮：把最近对话一并带上 */
  multiTurn?: boolean
  /** 保留的历史轮数（仅 multiTurn 时生效） */
  historyTurns?: number
  /** 是否允许模型调用内置工具（查角色/伏笔/章节） */
  toolLoop?: boolean
  /** 最多工具调用轮次 */
  maxToolRounds?: number
  /** 采样 top_p */
  topP?: number
  /** 频率惩罚 */
  frequencyPenalty?: number
  /** 是否要求 JSON 输出 */
  jsonMode?: boolean
}

export interface AgentProfile {
  id: string
  name: string
  /** 自我介绍，用于 UI 展示 */
  description: string
  /** 调用通道：网页（默认）或 API */
  channel: AgentChannel
  /** 绑定站点 id（deepseek / chatgpt / claude / gemini）；API 通道下仅作标签 */
  siteId: string
  /** API 通道配置 */
  api?: AgentApiConfig
  /** 系统提示词：每次调用都会拼接 */
  systemPrompt: string
  /** 场景标签，便于筛选与自动推荐 */
  scenes: AgentScene[]
  /** 输出倾向：更收 / 更放 / 平衡 */
  style?: 'concise' | 'balanced' | 'rich'
  /** 是否作为该场景的默认 Agent */
  isDefault?: boolean
  /** 是否启用 */
  enabled: boolean
  /** 是否内置 */
  custom: boolean
  /** 允许使用的任务类型；空表示不限 */
  tasks?: TaskType[]
  createdAt: number
  updatedAt: number
  useCount?: number
  lastUsedAt?: number
  /** 累计 token 用量（仅 API 通道有值） */
  totalTokens?: number
  /** 最近一次请求耗时（毫秒） */
  lastDurationMs?: number
  /** 最近一次失败原因 */
  lastError?: string
}

export const AGENT_SCENE_LABEL: Record<AgentScene, string> = {
  draft: '正文创作',
  polish: '润色改写',
  outline: '大纲结构',
  character: '人设对白',
  consistency: '一致性',
  research: '设定考据',
  general: '通用'
}

export const AGENT_STYLE_LABEL: Record<NonNullable<AgentProfile['style']>, string> = {
  concise: '克制精炼',
  balanced: '均衡',
  rich: '铺陈丰富'
}


/** 对话消息（多轮上下文用） */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 工具调用时标记 */
  toolName?: string
}

/** 内置工具定义（OpenAI function calling 格式） */
export interface AgentToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** 传给模型的内置只读工具（不做写操作，避免误改稿子） */
export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: 'get_characters',
    description: '读取当前作品已登记的角色（名字、人设、状态），用于保持人设一致',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_foreshadowings',
    description: '读取当前作品已埋伏笔与回收状态，用于避免遗漏',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_chapter_summary',
    description: '读取当前章节的摘要与关键事件',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_outline',
    description: '读取当前作品的大纲结构',
    parameters: { type: 'object', properties: {}, required: [] }
  }
]
