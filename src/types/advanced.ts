/**
 * 阶段 11 进阶功能类型定义。
 *
 * 八项功能：
 *  1. 一键生成章纲  2. 敏感词检测  3. 章节目标字数  4. 智能分章
 *  5. 建议质量反馈  6. 写作风格学习 7. 角色一致性检查 8. 健康提醒
 */

/** 敏感词级别 */
export type SensitiveLevel = 'block' | 'warn' | 'info'

/** 敏感词内置词库条目 */
export interface SensitiveWord {
  word: string
  level: SensitiveLevel
  /** 分类：政治/色情/暴力/广告等（本地词库，仅提示不阻断创作） */
  category: string
}

/** 敏感词命中 */
export interface SensitiveHit {
  word: string
  level: SensitiveLevel
  category: string
  /** 出现次数 */
  count: number
  /** 首次出现位置 */
  firstIndex: number
}

/** 敏感词检测结果 */
export interface SensitiveReport {
  hits: SensitiveHit[]
  /** 命中总数 */
  total: number
  /** 按级别聚合 */
  byLevel: Record<SensitiveLevel, number>
  /** 扫描字数 */
  scanned: number
}

/** 章节目标字数设置 */
export interface ChapterGoal {
  chapterId: string
  target: number
  /** 是否启用（默认取全局 defaultTargetWordCount） */
  enabled: boolean
}

/** 目标进度 */
export interface GoalProgress {
  chapterId: string
  current: number
  target: number
  /** 0-100 */
  percent: number
  /** 是否达标 */
  reached: boolean
  /** 还差多少字 */
  remaining: number
}

/** 建议质量反馈 */
export interface QualityFeedback {
  /** 建议标签（任务类型或卡片 tag） */
  tag: string
  value: 'up' | 'down'
  siteId: string
  createdAt: number
}

/** 质量反馈汇总（用于提示词自适应） */
export interface FeedbackSummary {
  tag: string
  up: number
  down: number
  /** 好评率 0-1，无数据时 null */
  rate: number | null
}

/**
 * 写作风格画像（阶段 11：写作风格学习）。
 * 全部由本地统计得出，不上传正文。
 */
export interface StyleProfile {
  /** 平均句长（字） */
  avgSentenceLength: number
  /** 平均段长（字） */
  avgParagraphLength: number
  /** 对话占比 0-1（含引号的段落比例） */
  dialogueRatio: number
  /** 高频词 top 20（已去停用词） */
  topWords: Array<{ word: string; count: number }>
  /** 高频二字词组 top 10 */
  topPhrases: Array<{ phrase: string; count: number }>
  /** 标点偏好：各类标点占比 */
  punctuation: Record<string, number>
  /** 样本字数 */
  sampleWords: number
  /** 生成时间 */
  updatedAt: number
}

/** 建议质量反馈汇总（用于提示词自适应） */
export interface FeedbackSummary {
  tag: string
  up: number
  down: number
  /** 好评率 0-1，无数据时 null */
  rate: number | null
}

/** 健康提醒状态 */
export interface HealthStatus {
  /** 本次连续写作时长（毫秒） */
  continuousMs: number
  /** 今日累计写作时长 */
  todayMs: number
  /** 是否该休息了 */
  shouldRest: boolean
  /** 提醒文案 */
  message: string
  /** 提醒间隔（毫秒） */
  intervalMs: number
  /** 健康提醒是否开启 */
  enabled: boolean
  /** 下次提醒时间 */
  nextReminderAt: number | null
}

/** 章纲生成结果（阶段 11：一键生成章纲） */
export interface OutlineDraft {
  /** 章节标题 */
  title: string
  /** 本章目标 */
  goal: string
  /** 情节点（有序） */
  beats: string[]
  /** 涉及角色 */
  characters: string[]
  /** 埋设/回收的伏笔 */
  foreshadowings: string[]
  /** 预计字数 */
  estimatedWords: number
}

/**
 * 说明：八项功能的总开关复用 AppSettings.features（见 shared/settings.ts），
 * 不在此重复定义，避免两份配置漂移。
 */
