/**
 * 宠物形象包 manifest（v3 模块二）。
 *
 * 用户从本地导入形象包，工具仅引用本地路径，不内置任何素材。
 * 缺 license 字段时，UI 强制提示"仅限个人本地使用，请勿分发"。
 */
export type AvatarRenderer = 'sprite' | 'spritesheet' | 'gif' | 'apng' | 'static' | 'live2d' | 'spine'

export interface AvatarStateFrames {
  /** 帧文件名（相对 avatar 目录） */
  frames: string[]
  fps: number
  loop: boolean
}

export interface AvatarManifest {
  id: string
  name: string
  author?: string
  /** 'PersonalUseOnly' / 'CC-BY-4.0' 等；缺失则视为个人使用 */
  license?: string
  source?: string
  type: 'frames' | 'spritesheet' | 'gif' | 'apng' | 'static'
  renderer: AvatarRenderer
  scale?: number
  anchor?: { x: number; y: number }
  bubbleOffset?: { x: number; y: number }
  clickArea?: { x: number; y: number; w: number; h: number }
  passThroughArea?: Array<{ x: number; y: number; w: number; h: number }>
  /** 状态映射（10 类） */
  states: {
    idle: AvatarStateFrames
    writing?: AvatarStateFrames
    thinking?: AvatarStateFrames
    'ai-calling'?: AvatarStateFrames
    happy?: AvatarStateFrames
    alert?: AvatarStateFrames
    sleeping?: AvatarStateFrames
    dragging?: AvatarStateFrames
    risk?: AvatarStateFrames
    error?: AvatarStateFrames
  }
}

/** 主进程存储的形象包引用 */
export interface PetAvatarRef {
  id: string
  name: string
  author?: string
  license?: string
  /** 资源目录绝对路径（用户在本地选择 / 复制到 userData/pet-assets） */
  assetDir: string
  /** 是否把资源复制到了应用数据目录；false 表示只引用用户原路径 */
  copied: boolean
  importedAt: number
  manifest: AvatarManifest
}

/** 宠物设置（v3） */
export interface PetSettings {
  enabled: boolean
  avatarId: string | null
  /** 屏幕位置 */
  position: { x: number; y: number }
  /** 触发频率：'low' | 'normal' | 'high' */
  triggerFrequency: 'low' | 'normal' | 'high'
  /** 感知字数阈值：触发灵感至少需要的停顿字数 */
  perceptionMinChars: number
  /** 停顿秒数 */
  perceptionIdleSeconds: number
  /** 主动 AI 灵感（true = 走 AI；false = 仅本地规则） */
  allowAiInspiration: boolean
  /** 只使用收藏提示词 */
  onlyFavoritePrompts: boolean
  /** 静默模式：不显示气泡，只改表情 */
  silent: boolean
  /** 遵守 prefers-reduced-motion */
  honorReducedMotion: boolean
  /** 启用 / 禁用所有动画 */
  animationsEnabled: boolean
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: false,
  avatarId: null,
  position: { x: 100, y: 100 },
  triggerFrequency: 'normal',
  perceptionMinChars: 50,
  perceptionIdleSeconds: 2,
  allowAiInspiration: false,
  onlyFavoritePrompts: false,
  silent: false,
  honorReducedMotion: true,
  animationsEnabled: true
}

/* ---------- 本地灵感规则引擎（v3 P0-3.1） ---------- */

export type InspirationSource = 'local-rule' | 'local-random' | 'ai'

export interface InspirationItem {
  id: string
  source: InspirationSource
  ruleId?: string
  title: string
  content: string
  severity: 'info' | 'suggest' | 'warn'
  chapterId: string
  createdAt: number
  applied?: boolean
}

export interface PetPerceptionContext {
  chapterId: string
  recentText: string
  fullText: string
  characters: { name: string; lastSeenChapterIndex: number }[]
  foreshadowings: { id: string; content: string; status: string; plantedChapterId: string }[]
  chapterIndexMap: Record<string, number>
  currentChapterIndex: number
}

export interface PetRule {
  id: string
  name: string
  enabled: boolean
  cooldownMs: number
  lastFiredAt?: number
  evaluate: (ctx: PetPerceptionContext) => InspirationItem | null
}

export interface InspirationBankItem {
  id: string
  category: '角色' | '情节' | '对话' | '场景' | '冲突' | '主题' | '设定' | '物件' | '视角' | '其它'
  content: string
}

export interface InspirationBank {
  version: number
  items: InspirationBankItem[]
}

export const DEFAULT_INSPIRATION_BANK: InspirationBank = {
  version: 1,
  items: [
    { id: 'b1', category: '情节', content: '让一个次要角色临时反水，制造临时冲突。' },
    { id: 'b2', category: '对话', content: '用沉默代替回答，角色的反应比台词更出戏。' },
    { id: 'b3', category: '场景', content: '把场景从白天换到雨夜，气压骤降能马上拉情绪。' },
    { id: 'b4', category: '冲突', content: '让两个目标互斥的角色各让一步，读者会心疼两边。' },
    { id: 'b5', category: '视角', content: '切换到旁观者视角重述同一事件，读者立刻能看见盲点。' },
    { id: 'b6', category: '主题', content: '把上一章解决过的小冲突再次换皮出现，加深主题。' },
    { id: 'b7', category: '设定', content: '让读者已经熟悉的物件忽然有了新含义。' },
    { id: 'b8', category: '物件', content: '让一个看似无关的小物件成为关键线索。' },
    { id: 'b9', category: '角色', content: '让主角的某个习惯被对手反向利用一次。' },
    { id: 'b10', category: '其它', content: '把结尾最后一句话删掉，让读者自己补。' }
  ]
}