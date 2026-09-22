/**
 * 用户提示词库（Prompt Library）。
 *
 * 在内置 13 个模板基础上，支持：
 *  - 分类（category）+ 标签（tags）+ 收藏（favorite）+ 启用（enabled）
 *  - 自定义变量占位符（如 {tone}、{length}）；调用时未知变量可弹窗填写
 *  - 站点作用域（siteScope）：限定提示词在哪些站点可用
 *  - 排序（order）
 *  - 复用 PromptTemplate 兼容字段（id/name/task/version/minAppVersion/custom）
 *
 * 兼容策略：
 *  - store 第一启动时从 PromptTemplate（内置）迁移为 PromptItem，custom=false, version=1
 *  - 用户保存的 PromptItem 通过 IPC 落到 electron-store
 *  - 老的 IPC（prompts.list/save/reset/import/export/checkUpdate）继续工作
 */

import type { PromptTemplate, TaskType } from './suggestion'

/** 提示词分类（与 UI 分组对齐） */
export type PromptCategory =
  | '润色改写'
  | '扩写缩写'
  | '角色人物'
  | '伏笔剧情'
  | '大纲结构'
  | '风格分析'
  | '一致性'
  | '灵感'
  | '工具'
  | '其他'

/** 扩展的提示词项 */
export interface PromptItem {
  id: string
  name: string
  category: PromptCategory
  description?: string
  /** 模板正文，支持 {text} {content} {question} {tone} 等占位符 */
  content: string
  /** 自动从 content 抽取的占位符列表（含内置变量） */
  variables: string[]
  tags: string[]
  favorite: boolean
  enabled: boolean
  /** 同分类内排序，0 在前 */
  order: number
  /** 关联的任务类型（与气泡菜单 / 拆书 / 宠物复用） */
  actionType?:
    | 'polish'
    | 'expand'
    | 'condense'
    | 'rewrite'
    | 'ask'
    | 'inspiration'
    | 'outline'
    | 'character'
    | 'foreshadowing'
    | 'consistency'
    | 'style'
    | 'custom'
  /** 限定可用站点 id 列表；空数组 = 全部 */
  siteScope?: string[]
  version: number
  minAppVersion?: string
  /** 是否用户自定义；内置项 false */
  custom: boolean
  createdAt: number
  updatedAt: number
  /** 最近一次使用时间，用于 UI 排序 */
  lastUsedAt?: number
  /** 使用次数 */
  useCount?: number
}

/** 调用时的变量绑定（内置变量自动填充，未知变量由用户填） */
export interface PromptVars {
  /** 当前选中的文本 */
  text?: string
  /** 当前章节正文 */
  content?: string
  /** 用户输入问题 */
  question?: string
  /** 当前章节摘要 */
  chapterSummary?: string
  /** 角色列表（多行） */
  characters?: string
  /** 伏笔列表（多行） */
  foreshadowings?: string
  /** 地点列表 */
  locations?: string
  /** 大纲（多行） */
  outline?: string
  /** 自定义扩展 */
  [k: string]: string | number | undefined
}

/** 内置占位符集合（用于提示用户可使用哪些变量） */
export const BUILTIN_VARS: Array<{ key: string; label: string; description: string }> = [
  { key: 'text', label: '选中文本', description: '编辑器中当前选中的文本' },
  { key: 'content', label: '章节正文', description: '当前章节的完整正文' },
  { key: 'question', label: '问题', description: '用户在问 AI 时输入的问题' },
  { key: 'chapterSummary', label: '章节摘要', description: '当前章节的 AI 摘要' },
  { key: 'characters', label: '角色列表', description: '所有已录入角色' },
  { key: 'foreshadowings', label: '伏笔列表', description: '所有已埋伏笔' },
  { key: 'locations', label: '地点列表', description: '所有已录入地点' },
  { key: 'outline', label: '大纲', description: '完整大纲树' }
]

/** 从 content 自动抽取占位符 */
export function extractVariables(content: string): string[] {
  const set = new Set<string>()
  for (const m of content.matchAll(/\{(\w+)\}/g)) set.add(m[1])
  return Array.from(set)
}

/**
 * 渲染模板：
 *  - 已知变量替换；未知变量保留 {name} 占位
 *  - 不抛错；缺值的已知变量留空字符串
 */
export function renderTemplate(content: string, vars: PromptVars): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = content.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key in vars) {
      const v = vars[key]
      return v === undefined || v === null ? '' : String(v)
    }
    missing.push(key)
    return `{${key}}`
  })
  return { text, missing }
}

/**
 * 内置 PromptTemplate → PromptItem 的迁移映射。
 * 对应 task 与 actionType 与 category 的转换。
 */
const TASK_TO_ACTION: Partial<Record<TaskType, PromptItem['actionType']>> = {
  polish: 'polish',
  expand: 'expand',
  condense: 'condense',
  rewrite: 'rewrite',
  ask: 'ask',
  'sync-extract': 'consistency',
  'consistency-check': 'consistency',
  'outline-gen': 'outline',
  summarize: 'outline',
  'chapter-split': 'outline',
  inspiration: 'inspiration'
}

const TASK_TO_CATEGORY: Partial<Record<TaskType, PromptCategory>> = {
  polish: '润色改写',
  expand: '扩写缩写',
  condense: '扩写缩写',
  rewrite: '润色改写',
  ask: '工具',
  'sync-extract': '一致性',
  'consistency-check': '一致性',
  'outline-gen': '大纲结构',
  summarize: '大纲结构',
  'chapter-split': '大纲结构',
  inspiration: '灵感'
}

/** 把内置 PromptTemplate 转成 PromptItem */
export function migrateFromPromptTemplate(t: PromptTemplate, index: number): PromptItem {
  return {
    id: t.id,
    name: t.name,
    category: TASK_TO_CATEGORY[t.task] ?? '其他',
    description: '',
    content: t.template,
    variables: extractVariables(t.template),
    tags: [],
    favorite: false,
    enabled: true,
    order: index,
    actionType: TASK_TO_ACTION[t.task],
    siteScope: [],
    version: t.version ?? 1,
    minAppVersion: t.minAppVersion,
    custom: !!t.custom,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    useCount: 0
  }
}

/** 提示词使用/反馈事件（用于自迭代） */
export interface PromptUsageEvent {
  id: string
  promptId: string
  action?: string
  value: 'up' | 'down' | 'use'
  note?: string
  siteId?: string
  createdAt: number
}

export interface PromptIteratePreview {
  promptId: string
  name: string
  fromVersion: number
  nextContent: string
  changelog: string[]
  evidence: { up: number; down: number; use: number }
}

export interface PromptIterateResult {
  item: PromptItem
  changelog: string[]
  cloned: boolean
}


/** 用户对迭代提出的具体要求 */
export interface PromptIterateRequest {
  /** 自由描述要求，例如"更口语、少排比、对话占比提高" */
  instruction: string
  /** 可选：期望风格标签 */
  tone?: string
  /** 可选：期望长度倾向 */
  length?: 'shorter' | 'same' | 'longer'
}
