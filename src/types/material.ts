/** 写作素材模块：角色 / 伏笔 / 大纲 / 地点 / 设定 */

/** 角色（阶段 5.6 / 6 / 11） */
export interface Character {
  id: string
  name: string
  /** 简介 */
  intro: string
  /** 标签，如 主角/反派/配角 */
  tags: string[]
  /** 出场章节 ID 列表 */
  appearances: string[]
  /** 累计提及次数 */
  mentions: number
  /** 后续补充信息（自动同步追加） */
  supplements: string[]
  createdAt: number
  lastUpdatedAt: number

  // ---- 阶段 11 角色一致性检查（全部可选，不影响既有数据）----
  /** 别名/曾用名，如"李四"又称"四哥" */
  aliases?: string[]
  /** 性格/能力特征，如 ["失明", "寡言"] */
  traits?: string[]
  /** 外貌描述 */
  appearance?: string
  /** 角色状态，用于时间线一致性检查 */
  status?: CharacterStatus
  /** 人物关系 */
  relationships?: Array<{ targetName: string; type: string }>
}

/** 角色状态（阶段 11） */
export type CharacterStatus = 'alive' | 'dead' | 'missing' | 'exited' | 'unknown'

/** 伏笔状态 */
export type ForeshadowingStatus = 'planted' | 'recovered'

/** 伏笔类型 */
export type ForeshadowingType = 'plant' | 'recover' | 'item' | 'identity' | 'event' | 'other'

/** 伏笔（阶段 5.6 / 6） */
export interface Foreshadowing {
  id: string
  /** 描述 */
  content: string
  type: ForeshadowingType
  status: ForeshadowingStatus
  /** 埋设章节 */
  chapterId?: string
  /** 回收章节 */
  recoveredChapterId?: string
  /** 关联对象（角色/地点/物品名） */
  relatedTo?: string
  /** 在正文中的位置，用于高亮定位 */
  anchor?: { chapterId: string; from: number; to: number }
  createdAt: number
  updatedAt: number
}

/** 章纲（阶段 5.6 / 6 / 11） */
export interface Outline {
  id: string
  /** 关联章节 ID（章纲） */
  chapterId?: string
  /** 层级：总纲 / 分卷 / 章纲 */
  level: 'master' | 'volume' | 'chapter'
  title: string
  /** 摘要 */
  chapterSummary?: string
  /** 关键事件 */
  keyEvents: string[]
  /** 结尾钩子 */
  endingHook?: string
  /** 出场角色名 */
  characters: string[]
  /** 核心转折 */
  turningPoint?: string
  children: Outline[]
  order: number
  updatedAt: number
}

/** 地点（阶段 5.6） */
export interface Location {
  id: string
  name: string
  description: string
  /** 首次出现章节 */
  firstChapterId?: string
  supplements: string[]
  createdAt: number
  lastUpdatedAt: number
}

/** 设定（阶段 5.6） */
export interface Setting {
  id: string
  name: string
  description: string
  firstChapterId?: string
  supplements: string[]
  createdAt: number
  lastUpdatedAt: number
}

/** 灵感便签（阶段 6） */
export interface Note {
  id: string
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** 每日码字统计（阶段 6 / 13） */
export interface DailyStat {
  /** YYYY-MM-DD */
  date: string
  /** 当日新增字数 */
  words: number
  /** 写作时长（毫秒） */
  durationMs: number
}

/** 自动同步提取结果（阶段 5.6） */
export interface SyncExtraction {
  characters: Array<{
    name: string
    isNew: boolean
    intro: string
    tags: string[]
    appearances: number
  }>
  outline: {
    chapterSummary: string
    keyEvents: string[]
    endingHook: string
  }
  foreshadowing: Array<{
    content: string
    type: ForeshadowingType
    relatedTo?: string
  }>
  locations: Array<{ name: string; isNew: boolean; description: string }>
  settings: Array<{ name: string; isNew: boolean; description: string }>
}

/** 同步模式 */
export type SyncMode = 'confirm' | 'auto' | 'manual'
