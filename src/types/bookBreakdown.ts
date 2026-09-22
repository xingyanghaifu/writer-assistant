/**
 * 拆书工作台（v3 模块三）数据模型。
 *
 * 存储位置：<userData>/book-breakdowns/<projectId>.json
 * 索引：electron-store key `bookBreakdowns` 保存 projectId/title/updatedAt 摘要列表。
 *
 * 合规要求：
 *  - 导入内容仅保存在本地
 *  - AI 调用只发必要分块（3000 字 / 块），不默认上传整本
 *  - 用户可启用「脱敏模式」：只发结构（标题、人物名），不发原文
 */
export interface BookBreakdownChapter {
  id: string
  index: number
  title: string
  /** 原文（保留） */
  content: string
  /** 状态机：pending / running / done / failed */
  analysisStatus: 'pending' | 'running' | 'done' | 'failed'
  /** 分析结果（运行 AI 后填） */
  summary?: string
  keyEvents?: string[]
  characters?: string[]
  turningPoint?: string
  endingHook?: string
  /** 错误信息 */
  error?: string
  /** AI 完成的服务器时间 */
  analyzedAt?: number
  /** v3 P0-3.3：节奏评分 */
  rhythm?: ChapterRhythm
}

export interface BookBreakdownProject {
  id: string
  title: string
  author?: string
  sourceFile?: string
  chapters: BookBreakdownChapter[]
  /** 全局进度：0~1 */
  progress: number
  /** 当前状态 */
  status: 'idle' | 'running' | 'paused' | 'done' | 'failed'
  createdAt: number
  updatedAt: number
  /** 是否脱敏模式（只发结构） */
  anonymized?: boolean
  /** 用户配置：每块大小（默认 3000） */
  chunkSize?: number
  /** v3 P0-3.3 进阶分析结果 */
  extras?: BreakdownProjectExtras
}

/** 拆书结果可入库：导出时使用 */
export interface BreakdownExport {
  projectId: string
  title: string
  chapters: Array<Pick<BookBreakdownChapter, 'index' | 'title' | 'summary' | 'keyEvents' | 'characters' | 'turningPoint' | 'endingHook'>>
  createdAt: number
}

export interface BreakdownProgress {
  projectId: string
  chapterIndex: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'paused'
  message?: string
  progress: number
  at: number
}

/* ---------- P0-3.3 进阶分析 ---------- */

export interface StyleReport {
  sentenceLengthDist: Array<{ range: string; count: number }>
  topWords: Array<{ word: string; count: number }>
  styleTags: string[]
  pov: 'first' | 'third' | 'omniscient' | 'mixed' | 'unknown'
}

export interface ChapterRhythm {
  /** 紧张度 1-10 */
  tension: number
  /** 情绪 1-10（1=悲，10=欢） */
  emotion: number
  /** 钩子强度 1-10 */
  hook: number
}

export interface BreakdownOutlineNode {
  id: string
  title: string
  summary: string
  /** 子节点 */
  children: BreakdownOutlineNode[]
  /** 对应章节 id */
  chapterId?: string
  /** 排序 */
  order: number
}

export interface BreakdownProjectExtras {
  /** v3 P0-3.3：风格报告 */
  style?: StyleReport
  /** 节奏曲线（按章节） */
  rhythm?: Array<{ chapterId: string; chapterIndex: number } & ChapterRhythm>
  /** 大纲树 */
  outline?: BreakdownOutlineNode[]
}

/** 从原文抽出的细纲节拍 */
export interface OutlineBeat {
  order: number
  scene: string
  conflict: string
  turn: string
  hook: string
  constraint?: string
}

export interface ChapterBeatSheet {
  chapterId: string
  title: string
  pov?: string
  tone?: string
  beats: OutlineBeat[]
}

export interface OutlineImitationRound {
  round: number
  score: number
  promptId: string
  promptVersion: number
  changelog: string[]
  gaps: string[]
  sample?: string
  at: number
}

export interface OutlineImitationResult {
  projectId: string
  chapterId: string
  targetScore: number
  bestScore: number
  rounds: OutlineImitationRound[]
  beatSheet?: ChapterBeatSheet
  stoppedReason: 'reached' | 'max-rounds' | 'ai-failed' | 'cancelled'
}


/** 提示词迭代历史（每次迭代追加，便于回看每一版改了什么） */
export interface PromptIterationHistoryEntry {
  promptId: string
  promptName: string
  version: number
  reason: 'feedback' | 'imitate-gap' | 'baseline' | 'instruction' | 'rollback'
  /** 迭代前的提示词正文快照，用于回滚 */
  contentSnapshot?: string
  changelog: string[]
  gaps?: string[]
  score?: number
  at: number
}
