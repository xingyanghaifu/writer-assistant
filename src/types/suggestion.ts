/** 走向建议：批次与卡片（阶段 3 / 4 / 4.5 / 11 / 12.5） */

/** 建议卡片 */
export interface Card {
  id: string
  /** 方向标签，如 悬疑向 / 热血向 */
  tag: string
  /** 一句话概括 */
  summary: string
  /** 2-3 句展开 */
  detail: string
  /** 预期效果 */
  effect: string
  /** 是否为追问产生 */
  isFollowUp: boolean
  /** 追问的父卡片 ID */
  parentCardId?: string
  /** 生成该卡片的站点 */
  siteId?: string
  /** 生成该卡片的模型/标签，用于多模型对比 */
  modelLabel?: string
  /** 用户反馈：未反馈 / 有用 / 无用 */
  feedback?: 'up' | 'down' | null
  /** 是否为纯文本降级结果（JSON 解析失败） */
  plainText?: boolean
  createdAt: number
}

/** 建议批次（阶段 4.5） */
export interface SuggestionBatch {
  id: string
  /** 触发时的草稿快照 */
  draftSnapshot: string
  cards: Card[]
  createdAt: number
  /** 批次是否折叠 */
  collapsed?: boolean
  /** 多模型对比：本批次的模型分组 */
  modelGroups?: Array<{ modelLabel: string; cards: Card[] }>
}

/** 单条建议（AI 返回 JSON 的结构） */
export interface Suggestion {
  tag: string
  summary: string
  detail: string
  effect: string
}

/** AI 返回的建议包装 */
export interface SuggestionResponse {
  suggestions: Suggestion[]
}

/** 任务类型（用于缓存 key 与提示词选择） */
export type TaskType =
  | 'suggest'
  | 'follow-up'
  | 'summarize'
  | 'sync-extract'
  | 'polish'
  | 'expand'
  | 'condense'
  | 'rewrite'
  | 'ask'
  | 'outline-gen'
  | 'consistency-check'
  | 'chunk-process'
  | 'chapter-split'
  /** 灵感库：多分类创意生成 */
  | 'inspiration'

/** AI 回复缓存条目（阶段 12.5） */
export interface CacheEntry {
  key: string
  value: string
  createdAt: number
  /** 命中次数 */
  hits: number
}

/** 提示词模板（阶段 12.5 / 13） */
export interface PromptTemplate {
  id: string
  name: string
  /** 任务类型 */
  task: TaskType
  /** 模板正文，支持 {draft} {context} 等占位符 */
  template: string
  version: number
  /** 最低应用版本要求（阶段 13 迁移） */
  minAppVersion?: string
  /** 是否被用户锁定，锁定后不自动更新 */
  locked?: boolean
  /** 是否为用户自定义 */
  custom?: boolean
  /** 灵感库分类（仅 task === 'inspiration' 时有值），用于 UI 分组 */
  category?: string
}

/** 智能分章建议点（阶段 11） */
export interface SplitPoint {
  /** 字符偏移 */
  offset: number
  title: string
  reason: string
  /** 依据类型：场景切换 / 字数达标 / 过渡 */
  kind?: 'scene' | 'wordCount' | 'transition' | 'time'
  /** 该位置之前的字数 */
  wordsBefore?: number
}

/** 角色一致性检查问题（阶段 11） */
export interface ConsistencyIssue {
  severity: 'high' | 'medium' | 'low'
  character: string
  description: string
  suggestion: string
  /** 正文中的位置，用于点击跳转 */
  from?: number
  to?: number
  /** 问题类型 */
  kind?: 'name' | 'trait' | 'appearance' | 'relationship' | 'timeline'
  /** 涉及章节 */
  chapterId?: string
  /** 命中片段 */
  excerpt?: string
}

/** 角色一致性检查结果（阶段 11） */
export interface ConsistencyReport {
  issues: ConsistencyIssue[]
  /** 检查的角色数 */
  checkedCharacters: number
  /** 扫描章节数 */
  scannedChapters: number
  /** 检查耗时 */
  durationMs: number
  /** 该功能已在设置中关闭（此时 issues 为空，不代表"没问题"） */
  disabled?: boolean
}

/** 网络状态（阶段 12.5 离线写作） */
export type NetworkState = 'online' | 'offline' | 'unknown'
