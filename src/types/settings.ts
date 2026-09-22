/** 应用设置、备份、合规 */

/** 主题 */
export type ThemeMode = 'light' | 'dark' | 'parchment' | 'system'

/** 编辑器排版设置（阶段 9） */
export interface EditorSettings {
  /** 字号 px，16-18 */
  fontSize: number
  /** 行高 */
  lineHeight: number
  /** 正文最大宽度 px，600-800 */
  maxWidth: number
  /** 字体 */
  fontFamily: 'song' | 'kai' | 'lora'
  /** 首行缩进字符数 */
  indent: number
  /** 段间距 em */
  paragraphSpacing: number
}

/** 备份副本配置（阶段 7.5） */
export interface BackupConfig {
  /** 本地备份启用 */
  localEnabled: boolean
  /** 保留天数 */
  retentionDays: number
  /** 用户指定目录 */
  customDir?: string
  /** 是否启用用户指定目录 */
  customDirEnabled: boolean
  /** 每章快照数 */
  maxSnapshots: number
  /** 上次导出时间 */
  lastExportAt?: number
  /** 上次备份时间 */
  lastBackupAt?: number
}

/** 备份副本状态 */
export interface BackupStatus {
  kind: 'local' | 'custom' | 'cloud' | 'manual'
  label: string
  path?: string
  enabled: boolean
  lastBackupAt?: number
  count: number
  lastError?: string
}

/** 备份文件结构（阶段 7.5，带 SHA-256 校验） */
export interface BackupEnvelope {
  meta: {
    workId: string
    workTitle: string
    createdAt: number
    appVersion: string
    schemaVersion: number
    chapterCount: number
    wordCount: number
  }
  hash: string
  data: unknown
}

/** 备份恢复策略 */
export type RestoreStrategy = 'overwrite' | 'merge' | 'new'

/** 数据存储位置配置 */
export interface StorageConfig {
  /**
   * 是否使用自定义数据目录。
   * false 时使用 Electron 默认的 userData 目录。
   */
  customDirEnabled: boolean
  /** 自定义数据目录绝对路径 */
  customDir?: string
  /**
   * 切换目录时的数据迁移方式：
   * - 'migrate'：把现有数据复制到新目录（推荐）
   * - 'fresh'：新目录从空开始，旧数据保留在原处不动
   */
  migrateMode: 'migrate' | 'fresh'
}

/** 数据存储位置状态（下发渲染进程展示） */
export interface StorageStatus {
  /** 当前实际生效的数据目录 */
  currentDir: string
  /** Electron 默认 userData 目录 */
  defaultDir: string
  /** 是否正在使用自定义目录 */
  usingCustom: boolean
  /** 该目录是否可写 */
  writable: boolean
  /** 数据文件大小（字节），读取失败为 -1 */
  sizeBytes: number
  /** 主数据文件名 */
  fileName: string
  /** 是否需要重启才能生效 */
  pendingRestart: boolean
}

/** 应用设置 */
export interface AppSettings {
  currentWorkId?: string
  theme: ThemeMode
  editor: EditorSettings
  /** 自动监听草稿（默认关） */
  autoWatch: boolean
  /** 后台请求超时毫秒 */
  requestTimeoutMs: number
  /** 自动保存防抖毫秒 */
  autosaveDebounceMs: number
  /** 宠物设置（v3 P0-3.1；不写入则视为默认） */
  pet?: import('./pet').PetSettings
  /** 崩溃恢复临时写入间隔毫秒 */
  recoveryIntervalMs: number
  /** 数据与合规弹窗确认状态 */
  consent: {
    complianceAccepted: boolean
    privacyAccepted: boolean
    aiCopyrightAccepted: boolean
  }
  /** 备份配置 */
  backup: BackupConfig
  /** 数据存储位置配置 */
  storage: StorageConfig
  /** 写作模块自动同步模式 */
  syncMode: 'confirm' | 'auto' | 'manual'
  /** 全局默认目标字数 */
  defaultTargetWordCount: number
  /** 健康提醒：连续写作提醒毫秒 */
  healthReminderMs: number
  /** 番茄钟工作时长毫秒 */
  pomodoroWorkMs: number
  pomodoroBreakMs: number
  /** 功能开关（阶段 11 八项） */
  features: {
    /** 一键生成章纲 */
    outlineGenerate: boolean
    /** 敏感词检测 */
    sensitiveWord: boolean
    /** 章节目标字数 */
    chapterGoal: boolean
    /** 智能分章 */
    smartSplit: boolean
    /** 建议质量反馈 */
    qualityFeedback: boolean
    /** 写作风格学习 */
    styleLearning: boolean
    /** 角色一致性检查 */
    consistencyCheck: boolean
    /** 健康提醒 */
    healthReminder: boolean
  }
  /** 上次使用的站点 */
  lastSiteId: string
  /**
   * API 通道的凭据（与 Agent 分开存）。
   * key 只保存在本机用户数据目录，不联网同步。
   */
  apiProviders?: Array<{ id: string; name: string; baseUrl: string; apiKey: string }>
  /** 多模型对比是否启用 */
  multiModelEnabled: boolean
  /** 数据版本号 */
  schemaVersion: number
}

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  editor: {
    fontSize: 17,
    lineHeight: 1.8,
    maxWidth: 720,
    fontFamily: 'song',
    indent: 2,
    paragraphSpacing: 0.5
  },
  autoWatch: false,
  requestTimeoutMs: 30000,
  autosaveDebounceMs: 2000,
  recoveryIntervalMs: 5000,
  consent: {
    complianceAccepted: false,
    privacyAccepted: false,
    aiCopyrightAccepted: false
  },
  backup: {
    localEnabled: true,
    retentionDays: 30,
    customDirEnabled: false,
    maxSnapshots: 5
  },
  storage: {
    customDirEnabled: false,
    migrateMode: 'migrate'
  },
  syncMode: 'confirm',
  defaultTargetWordCount: 3000,
  healthReminderMs: 2 * 60 * 60 * 1000,
  pomodoroWorkMs: 25 * 60 * 1000,
  pomodoroBreakMs: 5 * 60 * 1000,
  features: {
    outlineGenerate: true,
    sensitiveWord: true,
    chapterGoal: true,
    smartSplit: true,
    qualityFeedback: true,
    styleLearning: true,
    consistencyCheck: true,
    healthReminder: true
  },
  lastSiteId: 'deepseek',
  multiModelEnabled: false,
  schemaVersion: 2
}

/** 导入导出错误码（阶段 6.5） */
export type ImportExportErrorCode =
  | 'E_TXT_TOO_LARGE'
  | 'E_CHAPTERS_TOO_MANY'
  | 'E_BACKUP_VERSION'
  | 'E_BACKUP_CORRUPTED'
  | 'E_IO_BUSY'
  | 'E_ENCODING_FAILED'
  | 'E_EXPORT_TOO_LARGE'
  | 'E_CANCELLED'
  | 'E_UNKNOWN'

/** 导入预览结果 */
export interface ImportPreview {
  /** 检测到的编码 */
  encoding: string
  /** 识别出的章节数 */
  chapterCount: number
  /** 总字数 */
  wordCount: number
  /** 章节标题预览（前若干个） */
  chapters: Array<{ title: string; wordCount: number }>
  /** 前言长度 */
  prefaceLength: number
  /** 警告信息 */
  warnings: string[]
}

/** 导入策略 */
export type ImportStrategy = 'new' | 'merge'

/** 导入结果 */
export interface ImportResult {
  ok: boolean
  workId?: string
  chapterCount: number
  skipped: number
  renamed: number
  error?: ImportExportErrorCode
  message?: string
}

/** 导出格式 */
export type ExportFormat = 'json' | 'txt' | 'markdown' | 'html'
