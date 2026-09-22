/**
 * 用户提示词库服务。
 *
 * 存储：electron-store key `promptLibrary`（v3 增量；不动现有 `prompts` 数据）。
 *
 * 设计要点：
 *  - 第一启动时把内置 PromptTemplate 通过 migrateFromPromptTemplate 注入为内置项；
 *    custom=false, enabled=true, version=1
 *  - 用户的所有修改只针对 custom=true 的项；内置项可"复制为自定义"再改
 *  - render 接口支持占位符，未知变量返回 missing 让调用方弹窗
 */
import { appStore } from '../store'
import type { PromptItem, PromptVars, PromptUsageEvent, PromptIteratePreview, PromptIterateResult, PromptIterateRequest } from '@shared/promptLibrary'
import { extractVariables, migrateFromPromptTemplate, renderTemplate } from '@shared/promptLibrary'
import { DEFAULT_PROMPTS } from '@shared/prompts'
import type { Res } from '@shared/ipc'

function ok<T>(data: T): Res<T> {
  return { ok: true, data }
}
function fail<T = never>(error: string): Res<T> {
  return { ok: false, error }
}

const STORE_KEY = 'promptLibrary'

function readAll(): PromptItem[] {
  const list = appStore.getRaw<PromptItem[]>(STORE_KEY)
  if (Array.isArray(list) && list.length > 0) return list
  // 第一启动：注入内置
  const seeded = DEFAULT_PROMPTS.map((t, i) => migrateFromPromptTemplate(t, i))
  appStore.setRaw(STORE_KEY, seeded)
  return seeded
}

function writeAll(list: PromptItem[]): void {
  appStore.setRaw(STORE_KEY, list)
}

export function listLibrary(): PromptItem[] {
  return readAll().slice().sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'zh-CN')
    return a.order - b.order
  })
}

export function upsertLibrary(item: PromptItem): Res<PromptItem> {
  const list = readAll()
  const idx = list.findIndex((x) => x.id === item.id)
  const next: PromptItem = {
    ...item,
    custom: true,
    variables: extractVariables(item.content),
    version: item.version ?? 1,
    updatedAt: Date.now(),
    createdAt: item.createdAt || Date.now()
  }
  if (idx < 0) list.unshift(next)
  else list[idx] = { ...list[idx], ...next, version: (list[idx].version ?? 1) }
  writeAll(list)
  return ok(next)
}

export function saveLibrary(item: PromptItem): Res<PromptItem> {
  const list = readAll()
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return upsertLibrary(item)
  // 内置项不允许直接 save；要求 duplicate 后再改
  const existing = list[i]
  if (!existing.custom && !item.custom) {
    return fail('内置项不可直接修改；请先复制为自定义')
  }
  const next: PromptItem = {
    ...item,
    variables: extractVariables(item.content),
    version: (item.version ?? 1) + 1,
    updatedAt: Date.now()
  }
  list[i] = next
  writeAll(list)
  return ok(next)
}

export function removeLibrary(id: string): Res<void> {
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('提示词不存在')
  if (!item.custom) return fail('内置项不可删除')
  writeAll(list.filter((x) => x.id !== id))
  return ok(undefined)
}

export function duplicateLibrary(id: string): Res<PromptItem> {
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('提示词不存在')
  const copy: PromptItem = {
    ...item,
    id: `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${item.name} · 副本`,
    custom: true,
    favorite: false,
    enabled: true,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    useCount: 0,
    lastUsedAt: undefined
  }
  writeAll([copy, ...list])
  return ok(copy)
}

export function reorderLibrary(ids: string[]): Res<void> {
  const list = readAll()
  const map = new Map(list.map((x) => [x.id, x]))
  const next: PromptItem[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const item = map.get(id)
    if (item) {
      item.order = i
      next.push(item)
      map.delete(id)
    }
  }
  // 未在 ids 里的追加到末尾
  for (const item of map.values()) next.push(item)
  writeAll(next)
  return ok(undefined)
}

export function touchLibrary(id: string): Res<void> {
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('提示词不存在')
  item.lastUsedAt = Date.now()
  item.useCount = (item.useCount ?? 0) + 1
  writeAll(list)
  recordPromptUsage({ promptId: id, value: 'use' })
  return ok(undefined)
}

export function renderLibrary(id: string, vars: Record<string, string>): Res<{ text: string; missing: string[] }> {
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('提示词不存在')
  if (!item.enabled) return fail('该提示词已停用')
  const v = vars as PromptVars
  const { text, missing } = renderTemplate(item.content, v)
  return ok({ text, missing })
}

/**
 * 导入 / 导出
 *  - 导出格式：JSON [{ ...PromptItem }]
 *  - 导入：合并 custom 项；id 冲突时重命名
 */
export function exportLibrary(): string {
  const list = readAll().filter((x) => x.custom) // 只导出用户自定义
  return JSON.stringify({ version: 1, exportedAt: Date.now(), items: list }, null, 2)
}

/**
 * 把任意文本解析成提示词条目。
 *
 * 支持四种常见形态，按顺序尝试：
 *  1. 内置导出格式：{ items: [...] }
 *  2. 裸数组：[ {...}, {...} ] 或 [ "文本1", "文本2" ]
 *  3. 分节文本：用 --- 或 ### 标题 分隔，每节一条
 *  4. 整段文本：一条（取首行做名字）
 */
export function parseImportText(text: string, defaultCategory = '其他'): Array<Partial<PromptItem>> {
  const src = (text ?? '').trim()
  if (!src) return []

  // 1/2. JSON
  if (src.startsWith('{') || src.startsWith('[')) {
    try {
      const parsed = JSON.parse(src) as unknown
      const arr = Array.isArray(parsed)
        ? parsed
        : ((parsed as { items?: unknown }).items as unknown[])
      if (Array.isArray(arr)) {
        return arr
          .map((raw) => {
            if (typeof raw === 'string') return { name: firstLine(raw), content: raw }
            if (raw && typeof raw === 'object') return raw as Partial<PromptItem>
            return null
          })
          .filter((x): x is Partial<PromptItem> => !!x)
      }
    } catch {
      /* 落到文本解析 */
    }
  }

  // 3. 分节：--- 分隔
  const byDash = src.split(/^\s*-{3,}\s*$/m).map((x) => x.trim()).filter(Boolean)
  if (byDash.length > 1) {
    return byDash.map((block) => {
      const lines = block.split('\n')
      const head = lines[0].trim()
      const isTitle = /^(#|【|\[)/.test(head) || head.length <= 24
      return isTitle
        ? { name: head.replace(/^#+\s*/, '').replace(/^【|】$/g, ''), content: lines.slice(1).join('\n').trim() || head, category: defaultCategory as never }
        : { name: firstLine(block), content: block, category: defaultCategory as never }
    })
  }

  // 3b. Markdown 标题分节
  const heads = src.split(/^#{1,3}\s+/m)
  if (heads.length > 2) {
    const blocks = src.split(/^#{1,3}\s+/m).slice(1)
    return blocks
      .map((block) => {
        const lines = block.split('\n')
        return { name: lines[0].trim(), content: lines.slice(1).join('\n').trim(), category: defaultCategory as never }
      })
      .filter((x) => x.content)
  }

  // 4. 整段一条
  return [{ name: firstLine(src), content: src, category: defaultCategory as never }]
}

function firstLine(s: string): string {
  const l = (s.split('\n')[0] ?? '').trim().replace(/^#+\s*/, '')
  return l.length > 30 ? l.slice(0, 30) + '…' : l || '导入的提示词'
}

export function importLibrary(json: string): Res<PromptItem[]> {
  const items = parseImportText(json)
  if (items.length === 0) return fail('没有解析到可导入的内容')
  const list = readAll()
  const added: PromptItem[] = []
  const existingIds = new Set(list.map((x) => x.id))
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const it = raw as PromptItem
    if (!it.id || !it.content) continue
    if (existingIds.has(it.id)) {
      it.id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    }
    it.custom = true
    it.createdAt = it.createdAt ?? Date.now()
    it.updatedAt = Date.now()
    it.variables = extractVariables(it.content)
    list.unshift(it)
    added.push(it)
  }
  writeAll(list)
  return ok(added)
}

/** 从粘贴文本导入（自动识别格式） */
export function importFromText(text: string, category = '其他'): Res<PromptItem[]> {
  const parsed = parseImportText(text, category)
  if (parsed.length === 0) return fail('没有解析到内容')
  const list = readAll()
  const added: PromptItem[] = []
  const existing = new Set(list.map((x) => x.content.trim()))
  for (const raw of parsed) {
    const content = (raw.content ?? '').trim()
    if (!content) continue
    if (existing.has(content)) continue // 内容重复直接跳过
    const item: PromptItem = {
      id: raw.id ?? `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: raw.name?.trim() || firstLine(content),
      category: (raw.category as never) ?? (category as never),
      description: raw.description ?? '导入',
      content,
      variables: extractVariables(content),
      tags: Array.from(new Set([...(raw.tags ?? []), '导入'])),
      favorite: false,
      enabled: true,
      order: 0,
      actionType: raw.actionType,
      siteScope: raw.siteScope ?? [],
      version: 1,
      custom: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      useCount: 0
    }
    list.unshift(item)
    added.push(item)
  }
  writeAll(list)
  return ok(added)
}

const USAGE_KEY = 'promptUsage'

function readUsage(): PromptUsageEvent[] {
  return appStore.getRaw<PromptUsageEvent[]>(USAGE_KEY) ?? []
}
function writeUsage(list: PromptUsageEvent[]): void {
  appStore.setRaw(USAGE_KEY, list.slice(-800))
}

export function recordPromptUsage(input: {
  promptId: string
  action?: string
  value: 'up' | 'down' | 'use'
  note?: string
  siteId?: string
}): PromptUsageEvent {
  const ev: PromptUsageEvent = {
    id: `use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    promptId: input.promptId,
    action: input.action,
    value: input.value,
    note: input.note,
    siteId: input.siteId,
    createdAt: Date.now()
  }
  const list = readUsage()
  list.push(ev)
  writeUsage(list)
  return ev
}

function countUsage(promptId: string): { up: number; down: number; use: number; notes: string[] } {
  const list = readUsage().filter((x) => x.promptId === promptId || (!x.promptId && x.action))
  return {
    up: list.filter((x) => x.value === 'up').length,
    down: list.filter((x) => x.value === 'down').length,
    use: list.filter((x) => x.value === 'use').length,
    notes: list.map((x) => x.note).filter((x): x is string => !!x).slice(-8)
  }
}

function buildIteratedContent(item: PromptItem, ev: { up: number; down: number; use: number }): { next: string; changelog: string[] } {
  const changelog: string[] = []
  let next = item.content.trim()
  const has = (s: string): boolean => next.includes(s)

  if (ev.down >= 2 && !has('不要总结全文，不要解释你的改动')) {
    next += '\n\n【迭代补充】不要总结全文，不要解释你的改动；直接给出可用正文。少用套话和排比。'
    changelog.push('针对点踩：禁止总结/解释，减少套话')
  }
  if (ev.down >= 1 && !has('保持原作人称与叙事距离')) {
    next += '\n保持原作人称与叙事距离，不擅自改写人物口吻。'
    changelog.push('针对点踩：锁人称与口吻')
  }
  if (ev.up >= 2 && !has('沿用已获认可的节奏')) {
    next += '\n沿用已获认可的节奏：该细的地方细写动作与感官，该快的地方一句带过。'
    changelog.push('针对点赞：强化已认可节奏')
  }
  if (ev.use >= 3 && !has('只完成一个主要推进')) {
    next += '\n本章/本段只完成一个主要推进，并留下具体可写的下一拍。'
    changelog.push('高频使用：限制一次只推进一步')
  }
  if (changelog.length === 0) {
    next += '\n\n【迭代补充】输出前自检：人称、时间线、称呼、能力规则是否与上下文一致；有问题先改再给正文。'
    changelog.push('基线自检：一致性与规则')
  }
  return { next, changelog }
}

export function previewIterate(id: string): { ok: true; data: PromptIteratePreview } | { ok: false; error: string } {
  const item = readAll().find((x) => x.id === id)
  if (!item) return { ok: false, error: '提示词不存在' }
  const ev = countUsage(id)
  if (ev.up + ev.down + ev.use < 1) return { ok: false, error: '还没有使用或反馈记录，先用几次再迭代' }
  const { next, changelog } = buildIteratedContent(item, ev)
  return {
    ok: true,
    data: {
      promptId: item.id,
      name: item.name,
      fromVersion: item.version,
      nextContent: next,
      changelog,
      evidence: { up: ev.up, down: ev.down, use: ev.use }
    }
  }
}

export function iterateLibraryPrompt(id: string): { ok: true; data: PromptIterateResult } | { ok: false; error: string } {
  const prev = previewIterate(id)
  if (!prev.ok) return prev
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return { ok: false, error: '提示词不存在' }
  let cloned = false
  let target = item
  if (!item.custom) {
    const dup = duplicateLibrary(id)
    if (!dup.ok) return dup
    cloned = true
    target = dup.data
  }
  const nextItem: PromptItem = {
    ...target,
    content: prev.data.nextContent,
    name: cloned ? `${item.name} · 迭代v${item.version + 1}` : target.name,
    custom: true,
    version: (target.version ?? 1) + 1,
    updatedAt: Date.now(),
    tags: Array.from(new Set([...(target.tags ?? []), '自迭代']))
  }
  const saved = saveLibrary(nextItem)
  if (!saved.ok) return saved
  appendIterationHistory({
    promptId: saved.data.id,
    promptName: saved.data.name,
    version: saved.data.version,
    reason: 'feedback',
    changelog: prev.data.changelog,
    contentSnapshot: item.content,
    at: Date.now()
  })
  return { ok: true, data: { item: saved.data, changelog: prev.data.changelog, cloned } }
}


const HISTORY_KEY = 'promptIterationHistory'

export function appendIterationHistory(entry: import('@shared/bookBreakdown').PromptIterationHistoryEntry): void {
  const list = appStore.getRaw<import('@shared/bookBreakdown').PromptIterationHistoryEntry[]>(HISTORY_KEY) ?? []
  list.push(entry)
  appStore.setRaw(HISTORY_KEY, list.slice(-200))
}

export function listIterationHistory(promptId?: string): import('@shared/bookBreakdown').PromptIterationHistoryEntry[] {
  const list = appStore.getRaw<import('@shared/bookBreakdown').PromptIterationHistoryEntry[]>(HISTORY_KEY) ?? []
  const filtered = promptId ? list.filter((x) => x.promptId === promptId) : list
  return filtered.slice(-50).reverse()
}


/**
 * 按用户要求迭代：把要求写成可执行的约束追加到提示词。
 * 不调用 AI，纯本地拼装，结果可预期、可回滚。
 */
export function previewByInstruction(
  id: string,
  req: PromptIterateRequest
): { ok: true; data: PromptIteratePreview } | { ok: false; error: string } {
  const item = readAll().find((x) => x.id === id)
  if (!item) return { ok: false, error: '提示词不存在' }
  const instruction = (req.instruction ?? '').trim()
  if (!instruction) return { ok: false, error: '请先写清要求' }
  const changelog: string[] = []
  let next = item.content.trim()

  const block = `\n\n【按需迭代】${instruction}`
  next += block
  changelog.push(`按你的要求：${instruction.slice(0, 60)}`)

  if (req.tone && req.tone.trim()) {
    next += `\n风格要求：${req.tone.trim()}。`
    changelog.push('限定风格：' + req.tone.trim())
  }
  if (req.length === 'shorter') {
    next += '\n篇幅控制：比原稿更短，删掉重复修饰，只留推进情节的句子。'
    changelog.push('篇幅：更短')
  } else if (req.length === 'longer') {
    next += '\n篇幅控制：比原稿更充分，把关键动作、感官与心理写实，但不注水。'
    changelog.push('篇幅：更充分')
  }

  next += '\n输出前逐条核对上述要求，不满足就重写后再给结果。'

  return {
    ok: true,
    data: {
      promptId: item.id,
      name: item.name,
      fromVersion: item.version,
      nextContent: next,
      changelog,
      evidence: countUsage(id)
    }
  }
}

export function iterateByInstruction(
  id: string,
  req: PromptIterateRequest
): { ok: true; data: PromptIterateResult } | { ok: false; error: string } {
  const prev = previewByInstruction(id, req)
  if (!prev.ok) return prev
  const list = readAll()
  const item = list.find((x) => x.id === id)
  if (!item) return { ok: false, error: '提示词不存在' }
  let cloned = false
  let target = item
  if (!item.custom) {
    const dup = duplicateLibrary(id)
    if (!dup.ok) return dup
    cloned = true
    target = dup.data
  }
  const nextItem: PromptItem = {
    ...target,
    content: prev.data.nextContent,
    name: cloned ? `${item.name} · 按需v${item.version + 1}` : target.name,
    custom: true,
    version: (target.version ?? 1) + 1,
    updatedAt: Date.now(),
    tags: Array.from(new Set([...(target.tags ?? []), '按需迭代']))
  }
  const saved = saveLibrary(nextItem)
  if (!saved.ok) return saved
  appendIterationHistory({
    promptId: saved.data.id,
    promptName: saved.data.name,
    version: saved.data.version,
    reason: 'instruction',
    changelog: prev.data.changelog,
    contentSnapshot: item.content,
    at: Date.now()
  })
  return { ok: true, data: { item: saved.data, changelog: prev.data.changelog, cloned } }
}


/**
 * 回滚到某次迭代前的内容：把历史里记的版本内容重新写回提示词。
 * 需要历史条目里带 content 快照。
 */
export function restoreIteration(historyIndex: number): Res<PromptItem> {
  const list = appStore.getRaw<import('@shared/bookBreakdown').PromptIterationHistoryEntry[]>(HISTORY_KEY) ?? []
  const asc = list.slice()
  if (historyIndex < 0 || historyIndex >= asc.length) return fail('历史记录不存在')
  const entry = asc[asc.length - 1 - historyIndex]
  if (!entry) return fail('历史记录不存在')
  const target = readAll().find((x) => x.id === entry.promptId)
  if (!target) return fail('对应提示词已删除')
  if (!entry.contentSnapshot) return fail('这条历史没有内容快照，无法回滚')
  const next: PromptItem = {
    ...target,
    content: entry.contentSnapshot,
    version: (target.version ?? 1) + 1,
    updatedAt: Date.now(),
    tags: Array.from(new Set([...(target.tags ?? []), '回滚']))
  }
  const saved = saveLibrary(next)
  if (!saved.ok) return saved
  appendIterationHistory({
    promptId: saved.data.id,
    promptName: saved.data.name,
    version: saved.data.version,
    reason: 'rollback',
    changelog: ['回滚到 v' + entry.version],
    at: Date.now()
  })
  return ok(saved.data)
}
