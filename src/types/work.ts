/** 作品 / 卷 / 章 数据结构与版本历史 */

/** 版本来源 */
export type VersionSource =
  | 'manual'
  | 'autosave'
  | 'ai-insert'
  | 'import'
  | 'chapter-complete'
  | 'recovery'

/** 章节版本快照（阶段 5.7） */
export interface ChapterVersion {
  id: string
  content: string
  wordCount: number
  source: VersionSource
  createdAt: number
  /** 用户标记为重要，清理时优先保留 */
  important?: boolean
}

/** 章节 */
export interface Chapter {
  id: string
  title: string
  content: string
  wordCount: number
  createdAt: number
  updatedAt: number
  /** 版本历史，最多 20 个（阶段 5.7） */
  versions: ChapterVersion[]

  // ---- 阶段 5.5 章节摘要 ----
  /** 100 字以内摘要 */
  summary?: string
  summaryUpdatedAt?: number
  /** 摘要对应的正文版本号，用于判断是否需要重新生成 */
  summaryVersion?: number

  // ---- 阶段 11 章节目标字数 ----
  targetWordCount?: number
}

/** 卷 */
export interface Volume {
  id: string
  title: string
  chapters: Chapter[]
  order: number
  createdAt: number
  updatedAt: number
}

/** 作品 */
export interface Work {
  id: string
  title: string
  author: string
  intro: string
  /** 封面：本地图片 data URL 或文件路径 */
  coverUrl?: string
  volumes: Volume[]
  createdAt: number
  updatedAt: number
  /** 单作品数据版本号，便于迁移 */
  schemaVersion: number
}

/** 当前编辑定位 */
export interface EditorCursor {
  workId: string
  chapterId: string
  /** 光标位置（字符偏移） */
  position: number
  scrollTop: number
}

/** 崩溃恢复临时文件内容（阶段 5.8） */
export interface RecoverySnapshot {
  chapterId: string
  workId: string
  content: string
  cursorPosition: number
  updatedAt: number
}

/** 恢复候选（启动检测结果） */
export interface RecoveryCandidate {
  chapterId: string
  workId: string
  chapterTitle: string
  workTitle: string
  wordCount: number
  updatedAt: number
  /** 与已保存内容是否不同 */
  differs: boolean
  /** 内容预览（前若干字），用于"查看" */
  preview?: string
}
