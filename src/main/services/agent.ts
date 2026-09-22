/**
 * Agent 服务（主进程）。
 *
 * 存储：electron-store key `agents`。
 * 内置 Agent 首次启动写入，custom=false；用户改动只针对自定义项。
 */
import { appStore } from '../store'
import type { AgentProfile } from '@shared/agent'
import { BUILTIN_AGENTS } from '../../renderer/agents/presets'
import type { Res } from '@shared/ipc'

const KEY = 'agents'

function ok<T>(data: T): Res<T> {
  return { ok: true, data }
}
function fail<T = never>(error: string): Res<T> {
  return { ok: false, error }
}

/** 兼容旧数据：补齐后来新增的字段，避免老库读出来缺字段 */
function migrateAgent(a: AgentProfile): AgentProfile {
  return {
    ...a,
    channel: a.channel ?? 'web',
    scenes: a.scenes?.length ? a.scenes : ['general'],
    enabled: a.enabled ?? true,
    custom: a.custom ?? false
  }
}

export function readAgents(): AgentProfile[] {
  const list = appStore.getRaw<AgentProfile[]>(KEY)
  if (Array.isArray(list) && list.length > 0) return list.map(migrateAgent)
  appStore.setRaw(KEY, BUILTIN_AGENTS)
  return BUILTIN_AGENTS
}

function writeAgents(list: AgentProfile[]): void {
  appStore.setRaw(KEY, list)
}

export function listAgents(): AgentProfile[] {
  return readAgents().slice().sort((a, b) => {
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  })
}

export function getAgent(id: string): AgentProfile | undefined {
  return readAgents().find((a) => a.id === id)
}

/** 按场景推荐：优先默认项，其次最近使用 */
export function pickAgentFor(scene: string): AgentProfile | undefined {
  const list = readAgents().filter((a) => a.enabled && (a.scenes.includes(scene as never) || a.scenes.includes('general')))
  if (list.length === 0) return undefined
  return list.find((a) => a.isDefault) ?? list.slice().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0]
}

export function saveAgent(item: AgentProfile): Res<AgentProfile> {
  const list = readAgents()
  const i = list.findIndex((x) => x.id === item.id)
  const next: AgentProfile = { ...item, updatedAt: Date.now() }
  if (i < 0) {
    list.unshift({ ...next, custom: true, createdAt: Date.now() })
  } else {
    const existing = list[i]
    // 内置项被改动时自动转为自定义副本，避免"看得见改不了"
    if (!existing.custom && !item.custom) {
      const copy: AgentProfile = {
        ...existing,
        ...next,
        id: 'agent_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: (next.name || existing.name) + ' · 改',
        custom: true,
        isDefault: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      list.unshift(copy)
      writeAgents(list)
      return ok(copy)
    }
    list[i] = { ...existing, ...next, channel: next.channel ?? existing.channel ?? 'web' }
  }
  writeAgents(list)
  return ok(next)
}

export function removeAgent(id: string): Res<void> {
  const list = readAgents()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('Agent 不存在')
  if (!item.custom) return fail('内置 Agent 不可删除')
  writeAgents(list.filter((x) => x.id !== id))
  return ok(undefined)
}

export function duplicateAgent(id: string): Res<AgentProfile> {
  const list = readAgents()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('Agent 不存在')
  const copy: AgentProfile = {
    ...item,
    id: `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: item.name + ' · 副本',
    custom: true,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    useCount: 0,
    lastUsedAt: undefined
  }
  list.unshift(copy)
  writeAgents(list)
  return ok(copy)
}

/** 设为某场景默认：清掉同场景其它默认项 */
export function setAgentDefault(id: string, scene?: string): Res<AgentProfile> {
  const list = readAgents()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('Agent 不存在')
  const scenes = scene ? [scene] : item.scenes
  const next = list.map((a) => {
    if (a.id === id) return { ...a, isDefault: true, enabled: true, updatedAt: Date.now() }
    const overlap = a.scenes.some((s) => scenes.includes(s)) && a.isDefault
    return overlap ? { ...a, isDefault: false } : a
  })
  writeAgents(next)
  return ok(item)
}

export function touchAgent(id: string): Res<void> {
  const list = readAgents()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('Agent 不存在')
  item.useCount = (item.useCount ?? 0) + 1
  item.lastUsedAt = Date.now()
  writeAgents(list)
  return ok(undefined)
}

/** 记录一次 Agent 调用：累计 token、耗时、失败原因 */
export function recordAgentCall(
  id: string,
  info: { tokens?: number; durationMs?: number; error?: string; ok: boolean }
): Res<void> {
  const list = readAgents()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('Agent 不存在')
  item.useCount = (item.useCount ?? 0) + 1
  item.lastUsedAt = Date.now()
  if (info.tokens) item.totalTokens = (item.totalTokens ?? 0) + info.tokens
  if (info.durationMs) item.lastDurationMs = info.durationMs
  item.lastError = info.ok ? undefined : info.error
  writeAgents(list)
  return ok(undefined)
}

export function resetAgents(): Res<void> {
  const custom = readAgents().filter((x) => x.custom)
  writeAgents([...BUILTIN_AGENTS, ...custom])
  return ok(undefined)
}
