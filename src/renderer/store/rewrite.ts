import { create } from 'zustand'
import type { TaskType } from '@shared/suggestion'

/**
 * 单次润色/扩写/缩写/改写/问 AI 的结果。
 *
 * 设计目的：让用户事后仍可"翻旧账"——
 * 1. 上一轮觉得结果不理想，刷新一下没保存怎么办？
 * 2. 多次重新生成哪个最好？能不能对比？
 * 3. 写作过程中能不能引用过去的输出？
 *
 * 不落地到主进程 store：仅会话级持久化（最多 100 条 + 跨进程持久化用 localStorage），
 * 避免污染主数据。重启后保留最近 100 条。
 */
export type RewriteKind = 'polish' | 'expand' | 'condense' | 'rewrite' | 'ask'

export interface RewriteEntry {
  id: string
  kind: RewriteKind
  /** 关联章节（用于侧栏分组） */
  chapterId: string | null
  workId: string | null
  /** 选中的原文（清洗后） */
  source: string
  /** AI 输出（清洗后） */
  output: string
  /** 用户给的问题（仅 ask 动作） */
  question?: string
  /** 提示词快照，便于事后回看"当时用的什么模板" */
  promptPreview: string
  /** 时间戳 */
  createdAt: number
  /** 是否已被采纳（替换或插入到正文过） */
  applied?: 'replace' | 'insert' | null
}

const MAX_ENTRIES = 100
const STORAGE_KEY = 'wa.rewriteHistory.v1'

interface RewriteHistoryState {
  entries: RewriteEntry[]
  /** 是否在侧栏展开某条目（与全局 UI 解耦） */
  expanded: Record<string, boolean>
  /** 当前右侧 tab 是否切到「改写记录」 */
  sidePanelTab: 'web' | 'history'

  add: (e: Omit<RewriteEntry, 'id' | 'createdAt'>) => RewriteEntry
  remove: (id: string) => void
  clear: () => void
  reload: () => void
  toggleExpanded: (id: string) => void
  markApplied: (id: string, kind: 'replace' | 'insert') => void
  setSidePanelTab: (tab: 'web' | 'history') => void
}

function loadFromStorage(): RewriteEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_ENTRIES) as RewriteEntry[]
  } catch {
    return []
  }
}

function persistToStorage(entries: RewriteEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    /* 容量超限：忽略 */
  }
}

function genId(): string {
  return 'rw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export const useRewriteHistoryStore = create<RewriteHistoryState>((set, get) => ({
  entries: typeof window !== 'undefined' ? loadFromStorage() : [],
  expanded: {},
  sidePanelTab: 'web',

  add: (e) => {
    const entry: RewriteEntry = { ...e, id: genId(), createdAt: Date.now() }
    const next = [entry, ...get().entries].slice(0, MAX_ENTRIES)
    persistToStorage(next)
    set({ entries: next })
    return entry
  },
  remove: (id) => {
    const next = get().entries.filter((x) => x.id !== id)
    persistToStorage(next)
    set({ entries: next })
  },
  clear: () => {
    persistToStorage([])
    set({ entries: [] })
  },
  /** 强制从 localStorage 重新读取（用于「切到改写记录 tab 时」同步外部写入） */
  reload: () => {
    const next = loadFromStorage()
    set({ entries: next })
  },
  toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  markApplied: (id, kind) => {
    const next = get().entries.map((x) => (x.id === id ? { ...x, applied: kind } : x))
    persistToStorage(next)
    set({ entries: next })
  },
  setSidePanelTab: (tab) => set({ sidePanelTab: tab })
}))

/** 选区清洗：去前后空白 + 内部多空白合并，保留段落结构 */
export function cleanSelection(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 模型输出清洗：去除首尾 markdown 围栏 / 解释前缀 */
export function cleanModelOutput(s: string): string {
  let t = s.trim()
  // 去 ``` / ```text``` 围栏
  t = t.replace(/^```(?:text|markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  // 去前缀"润色后："/"改写后："等
  t = t.replace(/^(润色后|改写后|扩写后|缩写后|润色版|输出|结果)[：:]\s*\n?/i, '')
  return t.trim()
}

/** 把 TaskType 收敛到 RewriteKind（ask 复用 rewrite kind = 'ask'） */
export function taskToKind(task: TaskType): RewriteKind | null {
  if (task === 'polish' || task === 'expand' || task === 'condense' || task === 'rewrite' || task === 'ask') {
    return task
  }
  return null
}