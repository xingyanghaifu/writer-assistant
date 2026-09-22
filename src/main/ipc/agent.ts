/**
 * Agent IPC。
 */
import { IPC } from '@shared/ipc'
import { handleRaw } from './handle'
import * as svc from '../services/agent'
import type { AgentProfile } from '@shared/agent'
import { callAgent } from '../services/apiChannel'
import { recordAgentCall } from '../services/agent'
import { appStore } from '../store'
import { AGENT_TOOLS } from '@shared/agent'

/** 内置只读工具：把作品素材转成文本喂给模型 */
async function runAgentTool(name: string, args: Record<string, unknown>, workId?: string): Promise<string> {
  const wid = workId ?? appStore.getSettings().currentWorkId ?? ''
  if (!wid) return '（当前没有打开的作品）'
  const work = appStore.getWork(wid)
  if (!work) return '（作品不存在）'

  if (name === 'get_characters') {
    const list = appStore.getCharacters(wid)
    if (!list.length) return '（尚未登记角色）'
    return list
      .slice(0, 60)
      .map((c) => {
        const parts = [c.name]
        if (c.intro) parts.push('人设：' + c.intro)
        if ((c as { status?: string }).status) parts.push('状态：' + (c as { status?: string }).status)
        if (c.tags?.length) parts.push('标签：' + c.tags.join('/'))
        return '- ' + parts.join('；')
      })
      .join('\n')
  }

  if (name === 'get_foreshadowings') {
    const list = appStore.getForeshadowings(wid)
    if (!list.length) return '（尚未记录伏笔）'
    return list
      .slice(0, 60)
      .map((f) => `- [${f.status === 'recovered' ? '已回收' : String(f.status) === 'dropped' ? '已放弃' : '未回收'}] ${f.content}`)
      .join('\n')
  }

  if (name === 'get_chapter_summary') {
    const cid = String((args.chapterId as string) ?? '')
    const chapters = work.volumes.flatMap((v) => v.chapters)
    const ch = cid ? chapters.find((c) => c.id === cid) : chapters[chapters.length - 1]
    if (!ch) return '（未找到章节）'
    const bits = [`章节：${ch.title}`, `字数：${ch.wordCount}`]
    if (ch.summary) bits.push('摘要：' + ch.summary)
    const outlineHit = appStore.getOutlines(wid).find((o) => o.chapterId === ch.id)
    if (outlineHit?.keyEvents?.length) bits.push('关键事件：' + outlineHit.keyEvents.join('；'))
    if (outlineHit?.endingHook) bits.push('章尾钩子：' + outlineHit.endingHook)
    return bits.join('\n')
  }

  if (name === 'get_outline') {
    const nodes = appStore.getOutlines(wid)
    if (!nodes.length) return '（尚未建立大纲）'
    const flatten = (list: typeof nodes, depth = 0): string[] =>
      list.flatMap((n) => [
        '  '.repeat(depth) + '- ' + n.title + (n.chapterSummary ? '：' + String(n.chapterSummary).slice(0, 40) : ''),
        ...flatten((n.children ?? []) as typeof nodes, depth + 1)
      ])
    return flatten(nodes).slice(0, 80).join('\n')
  }

  return '（未知工具：' + name + '）'
}

export function registerAgentIpc(): void {
  handleRaw(IPC.agentList, () => svc.listAgents())
  handleRaw(IPC.agentGet, (_e, id: string) => svc.getAgent(id) ?? null)
  handleRaw(IPC.agentPick, (_e, scene: string) => svc.pickAgentFor(scene) ?? null)
  handleRaw(IPC.agentSave, (_e, item: AgentProfile) => svc.saveAgent(item))
  handleRaw(IPC.agentRemove, (_e, id: string) => svc.removeAgent(id))
  handleRaw(IPC.agentDuplicate, (_e, id: string) => svc.duplicateAgent(id))
  handleRaw(IPC.agentSetDefault, (_e, id: string, scene?: string) => svc.setAgentDefault(id, scene))
  handleRaw(IPC.agentTouch, (_e, id: string) => svc.touchAgent(id))
  handleRaw(IPC.agentReset, () => svc.resetAgents())

  handleRaw(IPC.agentApiCall, async (_e, params: {
    providerId: string
    model: string
    prompt: string
    system?: string
    temperature?: number
    maxTokens?: number
    topP?: number
    frequencyPenalty?: number
    jsonMode?: boolean
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    useTools?: boolean
    maxToolRounds?: number
    workId?: string
    agentId?: string
    startedAt?: number
  }) => {
    const r = await callAgent({
      providerId: params.providerId,
      model: params.model,
      prompt: params.prompt,
      system: params.system,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      jsonMode: params.jsonMode,
      history: params.history,
      tools: params.useTools ? AGENT_TOOLS : undefined,
      maxToolRounds: params.maxToolRounds,
      runTool: params.useTools ? (name, args) => runAgentTool(name, args, params.workId) : undefined
    })
    if (params.agentId) {
      const tokens = (r.usage?.promptTokens ?? 0) + (r.usage?.completionTokens ?? 0)
      recordAgentCall(params.agentId, {
        ok: r.ok,
        tokens: tokens || undefined,
        durationMs: Date.now() - (params.startedAt ?? Date.now()),
        error: r.ok ? undefined : r.error
      })
    }
    return r.ok ? { ok: true, data: { text: r.text } } : { ok: false, error: r.error || 'API 调用失败' }
  })

  handleRaw(IPC.agentTestApi, async (_e, params: { providerId: string; model: string }) => {
    const r = await callAgent({
      providerId: params.providerId,
      model: params.model,
      system: 'You are a connectivity checker. Reply with exactly: OK',
      prompt: 'ping',
      maxTokens: 16
    })
    return r.ok ? { ok: true, data: { reply: r.text.slice(0, 120) } } : { ok: false, error: r.error || '连接失败' }
  })
}
