import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../store/editor'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'
import { useRewriteHistoryStore, cleanModelOutput, cleanSelection, taskToKind } from '../store/rewrite'
import { useSiteStore } from '../store/site'
import { useAiTraceStore } from '../store/aiTrace'
import { getAdapter } from '../adapters/registry'
import { toScripts } from '../adapters/scripts'
import { getDefaultPrompt, render } from '@shared/prompts'
import type { TaskType } from '@shared/suggestion'
import { InputDialog } from './InputDialog'
import { DiffView } from './RewriteHistoryPanel'
import { refreshSiteStatus, interpretAiError } from '../services/aiError'
import { PromptPicker } from './PromptPicker'
import type { PromptItem } from '@shared/promptLibrary'

/** 气泡菜单动作 */
type BubbleAction = 'polish' | 'expand' | 'condense' | 'rewrite' | 'foreshadow' | 'ask'

/** 气泡动作 → Agent 场景 */
const ACTION_SCENE: Record<BubbleAction, string> = {
  polish: 'polish',
  expand: 'draft',
  condense: 'polish',
  rewrite: 'polish',
  foreshadow: 'general',
  ask: 'general'
}

const ACTIONS: Array<{ id: BubbleAction; label: string; icon: string; task?: TaskType; shortcut?: string }> = [
  { id: 'polish', label: '润色', icon: '✨', task: 'polish', shortcut: 'Ctrl+Shift+R' },
  { id: 'expand', label: '扩写', icon: '➕', task: 'expand', shortcut: 'Ctrl+Shift+E' },
  { id: 'condense', label: '缩写', icon: '➖', task: 'condense', shortcut: 'Ctrl+Shift+C' },
  { id: 'rewrite', label: '改写', icon: '🔄', task: 'rewrite', shortcut: 'Ctrl+Shift+W' },
  { id: 'foreshadow', label: '标记伏笔', icon: '🎯' },
  { id: 'ask', label: '问 AI', icon: '💬', task: 'ask', shortcut: 'Ctrl+Shift+Q' }
]

export interface BubbleMenuProps {
  /** 把结果替换回选区 */
  onReplace: (text: string) => void
  /** 在光标处插入结果 */
  onInsert: (text: string) => void
  /** 标记伏笔（阶段 6） */
  onMarkForeshadow: (text: string, from: number, to: number) => void
}

/**
 * 选中文字气泡菜单（阶段 9.5）。
 *
 * 菜单项：润色、扩写、缩写、改写、标记伏笔、问 AI
 * - 操作条：半透明深色背景 + 横向图标+文字 + 提示词预览
 * - 结果卡片：diff 对比视图（原文 vs AI 输出），支持：
 *     替换 / 插入 / 复制结果 / 部分采纳（仅采纳新增/采纳结果）
 *     重新生成 / 跳到侧栏历史 / 展开提示词快照
 * - 操作记录自动入「改写记录」侧栏（按章节分组，可翻历史）
 * - 全局快捷键：选中文字后 Ctrl+Shift+R/E/C/W/Q 触发对应动作
 */
export function BubbleMenu({ onReplace, onInsert, onMarkForeshadow }: BubbleMenuProps): JSX.Element | null {
  const bubble = useEditorStore((s) => s.bubble)
  const hideBubble = useEditorStore((s) => s.hideBubble)
  const showToast = useUiStore((s) => s.showToast)
  const siteId = useUiStore((s) => s.siteId)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)

  const addHistory = useRewriteHistoryStore((s) => s.add)
  const setSidePanelTab = useRewriteHistoryStore((s) => s.setSidePanelTab)
  const markApplied = useRewriteHistoryStore((s) => s.markApplied)

  const pushTrace = useAiTraceStore((s) => s.push)
  const updateTrace = useAiTraceStore((s) => s.update)
  const markTraceDone = useAiTraceStore((s) => s.markDone)
  const markTraceFailed = useAiTraceStore((s) => s.markFailed)
  const [agents, setAgents] = useState<Array<{ id: string; name: string; siteId: string; systemPrompt: string; scenes: string[]; isDefault?: boolean; enabled: boolean; channel?: 'web' | 'api'; api?: { providerId: string; model: string; temperature?: number; maxTokens?: number; topP?: number; frequencyPenalty?: number; jsonMode?: boolean; toolLoop?: boolean; maxToolRounds?: number } }>>([])
  const [agentId, setAgentId] = useState<string>('')
  /** 每个动作各自记住上次用的 Agent（润色和扩写可以不同） */
  const [agentByAction, setAgentByAction] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('wa.agentPick.v1')
      return raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch {
      return {}
    }
  })

  function rememberAgent(action: string, id: string): void {
    const next = { ...agentByAction, [action]: id }
    setAgentByAction(next)
    try {
      localStorage.setItem('wa.agentPick.v1', JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  const [busy, setBusy] = useState(false)
  /** 实时进度：流式文字 / 阶段 / 分块 */
  const [streamText, setStreamText] = useState('')
  const [stage, setStage] = useState('')
  const [chunkInfo, setChunkInfo] = useState<{ index: number; total: number; percent: number; phase: string } | null>(null)
  /** 多 Agent 对比：同一段文字，两个 Agent 各出一版 */
  const [compareA, setCompareA] = useState<string>('')
  const [compareB, setCompareB] = useState<string>('')
  const [compareResult, setCompareResult] = useState<{
    a: { agent: string; text: string }
    b: { agent: string; text: string }
  } | null>(null)
  const [comparing, setComparing] = useState(false)
  const [result, setResult] = useState<{ id: string; text: string; action: BubbleAction; promptPreview: string; agentName?: string } | null>(null)
  const [pendingAsk, setPendingAsk] = useState<{ text: string } | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** 点动作后待选择提示词：{ action, text } */
  const [pendingPick, setPendingPick] = useState<{ action: BubbleAction; text: string } | null>(null)
  const [agentPickAction, setAgentPickAction] = useState<string>('polish')
  /** 每个动作记住上次选的提示词，避免每次都要重选 */
  const [promptMemory, setPromptMemory] = useState<Record<string, { id: string; name: string; content: string }>>(() => {
    try {
      const raw = localStorage.getItem('wa.promptPick.v1')
      return raw ? (JSON.parse(raw) as Record<string, { id: string; name: string; content: string }>) : {}
    } catch {
      return {}
    }
  })

  function rememberPrompt(action: string, item: { id: string; name: string; content: string }): void {
    const next = { ...promptMemory, [action]: item }
    setPromptMemory(next)
    try {
      localStorage.setItem('wa.promptPick.v1', JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingPickRef = useRef(pendingPick)
  pendingPickRef.current = pendingPick
  const pickerOpenRef = useRef(pickerOpen)
  pickerOpenRef.current = pickerOpen
  const busyRef = useRef(busy)
  busyRef.current = busy
  const lastBubbleRef = useRef(bubble)
  if (bubble) lastBubbleRef.current = bubble

  // 载入可用 Agent，并默认选中当前动作场景的推荐项
  useEffect(() => {
    let alive = true
    void (async () => {
      const list = await window.api.agent.list()
      if (!alive) return
      // 存完整字段：channel / api / systemPrompt 都要带上，否则 API 通道判断不成立
      const usable = (list ?? [])
        .filter((a) => a.enabled)
        .map((a) => ({
          id: a.id,
          name: a.name,
          siteId: a.siteId,
          systemPrompt: a.systemPrompt,
          scenes: a.scenes,
          isDefault: a.isDefault,
          enabled: a.enabled,
          channel: a.channel,
          api: a.api
        }))
      setAgents(usable)
      if (usable.length > 0) {
        const pick = usable.find((a) => a.isDefault) ?? usable[0]
        setAgentId((cur) => cur || pick.id)
      }
    })()
    return () => { alive = false }
  }, [])

  // 订阅主进程进度：让"扩写中"能看到实时文字与分块进度
  useEffect(() => {
    const offStream = window.api.webview.onStreamChunk((p) => {
      if (!p || !p.text) return
      setStreamText(p.text)
    })
    const offStatus = window.api.bg.onStatus((p) => {
      if (!p) return
      if (p.status === 'running') setStage('模型生成中')
      else if (p.status === 'idle') setStage('')
      else if (p.status === 'failed') setStage('失败：' + (p.error ?? '未知原因'))
      else if (p.status === 'cancelled') setStage('已取消')
    })
    const offChunk = window.api.bg.onChunkProgress((p) => {
      if (!p) return
      setChunkInfo({ index: p.index ?? 0, total: p.total ?? 0, percent: p.percent ?? 0, phase: p.phase ?? '' })
    })
    return () => {
      offStream()
      offStatus()
      offChunk()
    }
  }, [])

  // 全局快捷键：仅在 textarea/编辑器聚焦时生效，避免与全局冲突
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!bubble) return
      // 排除「问 AI」对话框、提示词编辑、prompt textarea、设置页
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
      if (!e.ctrlKey || !e.shiftKey) return
      const k = e.key.toLowerCase()
      let act: BubbleAction | null = null
      if (k === 'r') act = 'polish'
      else if (k === 'e') act = 'expand'
      else if (k === 'c') act = 'condense'
      else if (k === 'w') act = 'rewrite'
      else if (k === 'q') act = 'ask'
      if (act) {
        e.preventDefault()
        void run(act, bubble.text)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble, siteId])

  // Esc 隐藏
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setResult(null)
        hideBubble()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hideBubble])

  // 点击外部隐藏。提示词弹窗 / 正在请求时不要清掉气泡，否则「使用」会把选区弄丢、run 直接 return。
  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (!bubble) return
      if (pickerOpenRef.current || busyRef.current) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.('.wa-modal-backdrop, .wa-modal, [role="dialog"]')) return
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setResult(null)
        hideBubble()
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [bubble, hideBubble])

  /**
   * 执行气泡菜单动作。
   */
  /** 用两个 Agent 跑同一段文字，结果并排对比 */
  async function runCompare(act: BubbleAction, text: string): Promise<void> {
    const a = agents.find((x) => x.id === compareA)
    const b = agents.find((x) => x.id === compareB)
    if (!a || !b) {
      showToast('先选两个 Agent', 'error')
      return
    }
    if (a.id === b.id) {
      showToast('两个 Agent 不能相同', 'error')
      return
    }
    const tpl = getDefaultPrompt(act as never)
    const prompt = tpl ? render(tpl.template, { text }) : text
    setComparing(true)
    setCompareResult(null)
    try {
      const runOne = async (ag: typeof a): Promise<{ agent: string; text: string }> => {
        if (ag.channel === 'api') {
          if (!ag.api?.providerId) throw new Error(ag.name + '：未配置 API 凭据')
          const r = await window.api.agent.apiCall({
            providerId: ag.api.providerId,
            model: ag.api.model,
            prompt,
            system: ag.systemPrompt,
            temperature: ag.api.temperature,
            maxTokens: ag.api.maxTokens,
            agentId: ag.id,
            startedAt: Date.now()
          })
          if (!r.ok) throw new Error(ag.name + '：' + r.error)
          return { agent: ag.name, text: cleanModelOutput(r.data.text) }
        }
        const ad = getAdapter(ag.siteId)
        if (!ad) throw new Error(ag.name + '：站点未适配')
        const r = await window.api.bg.start({
          task: act as TaskType,
          prompt: ag.systemPrompt ? ag.systemPrompt + '\n\n' + prompt : prompt,
          siteId: ag.siteId,
          skipCache: true,
          scripts: toScripts(ad)
        })
        if (!r.ok) throw new Error(ag.name + '：' + (r.error ?? '调用失败'))
        return { agent: ag.name, text: cleanModelOutput(r.data.text) }
      }
      // 串行，避免并发触发站点风控
      const ra = await runOne(a)
      await new Promise((r) => setTimeout(r, 600))
      const rb = await runOne(b)
      setCompareResult({ a: ra, b: rb })
    } catch (err) {
      showToast(err instanceof Error ? err.message : '对比失败', 'error')
    } finally {
      setComparing(false)
    }
  }

  async function run(action: BubbleAction, text: string, question?: string, opts?: { promptOverride?: string; promptName?: string }): Promise<void> {
    if (action === 'foreshadow') {
      if (bubble) {
        onMarkForeshadow(text, bubble.from, bubble.to)
        hideBubble()
      }
      return
    }

    if (action === 'ask' && question === undefined) {
      setPendingAsk({ text })
      return
    }

    setBusy(true)
    setStage('准备中')
    setStreamText('')
    setChunkInfo(null)

    // 优先使用所选 Agent：站点与系统提示词都以它为准
    const pickedAgent = agents.find((a) => a.id === agentId)
    const effSiteId = pickedAgent?.siteId || siteId
    const adapter = getAdapter(effSiteId)
    if (!adapter && pickedAgent?.channel !== 'api') {
      setBusy(false)
      showToast('当前站点未适配', 'error')
      return
    }

    // 前置检查：站点当前状态
    const isApiChannel = pickedAgent?.channel === 'api'
    const siteState = useSiteStore.getState().sites[effSiteId]
    if (!isApiChannel && siteState?.status.kind === 'logged-out') {
      setBusy(false)
      const id = pushTrace({ phase: 'failed', action: '检查站点', detail: `${adapter?.name ?? 'API'} 未登录，已中止` })
      void id
      showToast(`站点「${adapter?.name ?? effSiteId}」未登录，请到右侧网页登录后再试`, 'error')
      return
    }
    if (!isApiChannel && siteState?.status.kind === 'risk') {
      setBusy(false)
      showToast(`站点「${adapter?.name ?? effSiteId}」触发风控，请到右侧完成验证或切换站点`, 'error')
      return
    }
    if (!isApiChannel && siteState?.status.kind === 'offline') {
      setBusy(false)
      showToast(`站点「${adapter?.name ?? effSiteId}」离线，请检查网络`, 'error')
      return
    }

    let prompt: string
    let promptPreview: string
    if (opts?.promptOverride) {
      prompt = opts.promptOverride
      promptPreview = '（选用的提示词：' + (opts.promptName ?? '自定义') + '）'
    } else if (action === 'ask') {
      const tpl = getDefaultPrompt('ask')
      prompt = tpl
        ? render(tpl.template, { text, question: question ?? '' })
        : `关于以下文字：${question ?? ''}\n\n${text}`
      promptPreview = tpl?.template ?? '(内置)'
    } else {
      const tpl = getDefaultPrompt(action)
      prompt = tpl ? render(tpl.template, { text }) : `请处理以下文字：\n\n${text}`
      promptPreview = tpl?.template ?? '(内置)'
    }

    const actionLabel = ACTIONS.find((x) => x.id === action)?.label ?? action
    const startedAt = Date.now()
    const traceId = pushTrace({
      phase: 'thinking',
      action: actionLabel,
      detail: '整理选中文字与提示词（' + text.length + ' 字 → 模板）',
      meta: { siteId }
    })
    try {
      const withAgent = pickedAgent?.systemPrompt
        ? `${pickedAgent.systemPrompt}\n\n——以下是要处理的文本——\n${prompt}`
        : prompt
      // 通道分流：API 直连不经过 webview
      if (pickedAgent?.channel === 'api') {
        if (!pickedAgent.api?.providerId) throw new Error('该 Agent 未配置 API 凭据，请到 Agent 面板设置')
        updateTrace(traceId, {
          phase: 'requesting',
          detail: `Agent「${pickedAgent.name}」· API 直连 ${pickedAgent.api.model}`,
          meta: { siteId: 'api' }
        })
        void window.api.agent.touch(pickedAgent.id)
        const apiRes = await window.api.agent.apiCall({
          providerId: pickedAgent.api.providerId,
          model: pickedAgent.api.model,
          prompt,
          system: pickedAgent.systemPrompt,
          temperature: pickedAgent.api.temperature,
          maxTokens: pickedAgent.api.maxTokens,
          topP: pickedAgent.api.topP,
          frequencyPenalty: pickedAgent.api.frequencyPenalty,
          jsonMode: pickedAgent.api.jsonMode,
          useTools: pickedAgent.api.toolLoop,
          maxToolRounds: pickedAgent.api.maxToolRounds,
          workId: currentWorkId ?? undefined,
          agentId: pickedAgent.id,
          startedAt
        })
        if (!apiRes.ok) {
          const msg = apiRes.error || 'API 调用失败'
          // 未配凭据：直接报错并指路，不降级（降级也没登录态，照样失败）
          if (/凭据|Key|provider/i.test(msg)) {
            throw new Error(msg + '。请到 左边栏 → Agent → 选该 Agent → 新增凭据并点「测试连接」')
          }
          // 其它失败（超时、限流、服务端错误）→ 自动降级到网页通道
          const fallbackSite = pickedAgent.siteId || siteId
          const fallbackAdapter = getAdapter(fallbackSite)
          const fallbackState = useSiteStore.getState().sites[fallbackSite]
          if (fallbackAdapter && fallbackState?.status.kind === 'online') {
            pushTrace({
              phase: 'thinking',
              action: actionLabel,
              detail: `API 失败（${msg.slice(0, 40)}），自动改用网页通道 ${fallbackAdapter.name}`
            })
            const fbRes = await window.api.bg.start({
              task: action === 'ask' ? 'ask' : (action as TaskType),
              prompt: withAgent,
              siteId: fallbackSite,
              skipCache: true,
              scripts: toScripts(fallbackAdapter)
            })
            if (!fbRes.ok) throw new Error('API 失败且网页通道也不可用：' + (fbRes.error ?? ''))
            const fbText = cleanModelOutput(fbRes.data.text)
            setResult({ id: '', text: fbText, action, promptPreview, agentName: pickedAgent.name + '（降级网页）' })
            markTraceDone(traceId, fbText.slice(0, 200), {
              siteId: fallbackSite,
              chars: fbText.length,
              durationMs: Date.now() - startedAt
            })
            return
          }
          throw new Error(msg + '（网页通道未登录，无法降级）')
        }
        const apiClean = cleanModelOutput(apiRes.data.text)
        setResult({ id: '', text: apiClean, action, promptPreview, agentName: pickedAgent.name })
        markTraceDone(traceId, apiClean.slice(0, 200), {
          siteId: 'api',
          chars: apiClean.length,
          durationMs: Date.now() - startedAt
        })
        const kindApi = taskToKind(action === 'ask' ? 'ask' : (action as TaskType))
        if (kindApi) {
          addHistory({
            kind: kindApi,
            chapterId: currentChapterId,
            workId: currentWorkId,
            source: cleanSelection(text),
            output: apiClean,
            question: action === 'ask' ? question : undefined,
            siteId: 'api',
            action: String(action)
          } as never)
        }
        return
      }
      if (!adapter) {
        throw new Error('当前站点未适配，且该 Agent 不是 API 通道')
      }
      updateTrace(traceId, {
        phase: 'requesting',
        detail: (pickedAgent ? `Agent「${pickedAgent.name}」· ` : '') + '提交到 ' + adapter.name + '，等待模型返回',
        meta: { siteId: effSiteId }
      })
      if (pickedAgent) void window.api.agent.touch(pickedAgent.id)
      const res = await window.api.bg.start({
        task: action === 'ask' ? 'ask' : (action as TaskType),
        prompt: withAgent,
        siteId: effSiteId,
        skipCache: true,
        scripts: toScripts(adapter)
      })
      if (!res.ok) throw new Error(res.error)
      const cleaned = cleanModelOutput(res.data.text)
      setResult({ id: '', text: cleaned, action, promptPreview, agentName: pickedAgent?.name })
      markTraceDone(traceId, cleaned.slice(0, 200), {
        siteId,
        chars: cleaned.length,
        durationMs: Date.now() - startedAt,
        fromCache: (res.data as { fromCache?: boolean }).fromCache
      })
      if (cleaned) {
        pushTrace({
          phase: 'done',
          action: actionLabel + ' 完成',
          detail: '输出 ' + cleaned.length + ' 字，耗时 ' + Math.round((Date.now() - startedAt) / 1000) + 's'
        })
      }

      // 入历史
      const kind = taskToKind(action === 'ask' ? 'ask' : (action as TaskType))
      if (kind) {
        const entry = addHistory({
          kind,
          chapterId: currentChapterId,
          workId: currentWorkId,
          source: cleanSelection(text),
          output: cleaned,
          question: action === 'ask' ? question : undefined,
          promptPreview
        })
        setResult((r) => (r ? { ...r, id: entry.id } : r))
      }

      if (action === 'ask') setLastQuestion(question ?? '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理失败'
      markTraceFailed(traceId, msg)
      const tip = interpretAiError(msg)
      showToast(tip.toast, 'error')
      // 重新检测站点状态（可能上次检测时还没风控）
      void refreshSiteStatus(effSiteId)
    } finally {
      setBusy(false)
    }
  }

  const geo = bubble ?? lastBubbleRef.current
  const bubbleVisible = (!!geo && (bubble?.visible ?? false)) || busy || !!result || comparing
  // 结果卡片可能很高：上方优先；上方放不下则下移，但要夹在视口内。
  const STACK_H = result ? 540 : 40
  const preferredTop = geo
    ? geo.y - STACK_H - 12
    : 0
  const fallbackTop = geo ? geo.y + 24 : 0
  let top = preferredTop >= 4 ? preferredTop : fallbackTop
  if (top + STACK_H > window.innerHeight - 8) {
    top = Math.max(4, window.innerHeight - STACK_H - 8)
  }
  // 横向夹在视口内（结果宽 400+）
  const STACK_W = result ? 410 : 320
  const left = geo
    ? Math.max(8, Math.min(geo.x - STACK_W / 2, window.innerWidth - STACK_W - 8))
    : 8

  function applyResult(kind: 'replace' | 'insert' | 'copy'): void {
    if (!result) return
    const sel = bubble ?? lastBubbleRef.current
    if (!sel && kind !== 'copy') return
    if (kind === 'replace') {
      onReplace(result.text)
      showToast('已替换原文', 'success')
      markApplied(result.id, 'replace')
    } else if (kind === 'insert') {
      onInsert(result.text)
      showToast('已插入到光标处', 'success')
      markApplied(result.id, 'insert')
    } else {
      void navigator.clipboard.writeText(result.text).then(
        () => showToast('已复制结果', 'success'),
        () => showToast('复制失败', 'error')
      )
    }
    setResult(null)
    if (kind !== 'copy') hideBubble()
  }

  return (
    <>
      {bubbleVisible && (
        <div
          ref={panelRef}
          className="wa-slide-up fixed z-40"
          style={{
            left,
            top
          }}
        >
          {/* 操作条 */}
          <div className="flex items-center gap-0.5 rounded-lg bg-ink-900/92 px-1.5 py-1 shadow-xl backdrop-blur">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                disabled={busy}
                onClick={() => {
                  setAgentPickAction(a.id)
                  // 该动作记过 Agent 就切过去，没记过保持当前
                  const remembered = agentByAction[a.id]
                  if (remembered && agents.some((x) => x.id === remembered)) setAgentId(remembered)
                  // 记住过就直接用；没记住才让选一次
                  const mem = promptMemory[a.id]
                  const selText = geo?.text ?? lastBubbleRef.current?.text ?? ''
                  if (!selText) {
                    showToast('没有可处理的选区，请重新划词后再试', 'error')
                    return
                  }
                  if (mem) void run(a.id, selText, undefined, { promptOverride: mem.content, promptName: mem.name })
                  else {
                    setPendingPick({ action: a.id, text: selText })
                    setPickerOpen(true)
                  }
                }}
                title={a.shortcut ? `${a.label}（${a.shortcut}）` : a.label}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-white/90 transition-colors hover:bg-white/15 disabled:opacity-40"
              >
                <span>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            ))}
            <button
              onClick={() => setShowPrompt((s) => !s)}
              title="查看/修改当前动作的提示词"
              className="ml-1 rounded px-1 py-1 text-[11px] text-white/70 hover:bg-white/15"
            >
              ⚙ 提示词
            </button>
            <button
              onClick={() => {
                if (!bubble) return
                setPendingPick({ action: agentPickAction as BubbleAction, text: bubble.text })
                setPickerOpen(true)
              }}
              title="换提示词（替换当前动作使用的模板，换后会被记住）"
              className="rounded px-1 py-1 text-[11px] text-white/70 hover:bg-white/15"
            >
              📚 换提示词
            </button>
            <button
              onClick={() => {
                const first = agents[0]?.id ?? ''
                const second = agents[1]?.id ?? agents[0]?.id ?? ''
                setCompareA((v) => v || first)
                setCompareB((v) => v || second)
                setComparing(true)
              }}
              title="用两个 Agent 跑同一段文字，结果并排对比"
              className="rounded px-1 py-1 text-[11px] text-white/70 hover:bg-white/15"
            >
              ⚖ 对比
            </button>
            {agents.length > 0 && (
              <select
                value={agentId}
                onChange={(e) => { e.stopPropagation(); setAgentId(e.target.value); rememberAgent(agentPickAction, e.target.value) }}
                onClick={(e) => e.stopPropagation()}
                title="选择 Agent（站点与提示词随它走）"
                className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-white/90 outline-none"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id} className="text-black">
                    {a.name}
                    {a.channel === 'api' ? '（API）' : '（网页）'}
                  </option>
                ))}
              </select>
            )}
            {(() => {
              const shown = promptMemory[agentPickAction]
              if (!shown) return null
              return (
                <button
                  onClick={() => {
                    if (!bubble) return
                    setPendingPick({ action: agentPickAction as BubbleAction, text: bubble.text })
                    setPickerOpen(true)
                  }}
                  title="点这里可更换该动作使用的提示词"
                  className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20"
                >
                  正在用：{shown.name}
                </button>
              )
            })()}
            {busy && (
            <span className="px-1.5 text-[11px] text-white/80">
              {chunkInfo && chunkInfo.total > 1
                ? `分块 ${chunkInfo.index}/${chunkInfo.total}（${chunkInfo.percent}%）…`
                : stage || '处理中…'}
            </span>
          )}
          </div>

          {/* 多 Agent 对比面板 */}
          {comparing && (
            <div className="mt-1.5 w-[520px] rounded-lg border bg-white p-2 shadow-2xl" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                <span className="font-medium">并排对比</span>
                <span className="wa-muted">同一段文字，两个 Agent 各出一版</span>
                <div className="flex-1" />
                <button onClick={() => { setComparing(false); setCompareResult(null) }} className="rounded px-1 hover:bg-black/5">✕</button>
              </div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <select value={compareA} onChange={(e) => setCompareA(e.target.value)} className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px]" style={{ borderColor: 'var(--wa-border)' }}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span className="text-[10px] wa-muted">vs</span>
                <select value={compareB} onChange={(e) => setCompareB(e.target.value)} className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px]" style={{ borderColor: 'var(--wa-border)' }}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button
                  disabled={busy || !bubble}
                  onClick={() => { if (bubble) void runCompare(agentPickAction as BubbleAction, bubble.text) }}
                  className="shrink-0 rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 disabled:opacity-40"
                >
                  开始对比
                </button>
              </div>
              {compareResult ? (
                <div className="grid grid-cols-2 gap-2">
                  {[compareResult.a, compareResult.b].map((r, i) => (
                    <div key={i} className="rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                      <div className="mb-0.5 flex items-center gap-1 text-[10px]">
                        <span className="font-medium">{r.agent}</span>
                        <span className="wa-muted">{r.text.length} 字</span>
                      </div>
                      <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-sans text-[10px] leading-relaxed">{r.text.slice(0, 1200)}</pre>
                      <div className="mt-0.5 flex gap-1">
                        <button
                          onClick={() => { onReplace(r.text); showToast('已替换为「' + r.agent + '」的版本', 'success'); setComparing(false); hideBubble() }}
                          className="rounded border px-1 py-0.5 text-[10px] hover:bg-black/5"
                          style={{ borderColor: 'var(--wa-border)' }}
                        >
                          用这版替换
                        </button>
                        <button
                          onClick={() => { onInsert(r.text); showToast('已插入', 'success') }}
                          className="rounded border px-1 py-0.5 text-[10px] hover:bg-black/5"
                          style={{ borderColor: 'var(--wa-border)' }}
                        >
                          插入
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed p-2 text-center text-[10px] wa-muted" style={{ borderColor: 'var(--wa-border)' }}>
                  选两个 Agent，点「开始对比」。串行执行，避免同时打站点。
                </div>
              )}
            </div>
          )}
          {/* 实时进度（扩写/润色等长任务时可见） */}
          {busy && (
            <div className="mt-1.5 w-[400px] rounded-lg border bg-white p-2 shadow-2xl" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--wa-accent)] wa-pulse" />
                <span className="font-medium">{stage || '处理中'}</span>
                {chunkInfo && chunkInfo.total > 1 && (
                  <span className="wa-muted">分块 {chunkInfo.index}/{chunkInfo.total} · {chunkInfo.percent}%</span>
                )}
                <span className="wa-muted">· 已收到 {streamText.length} 字</span>
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1.5 font-sans text-[11px] leading-relaxed wa-muted">
                {streamText ? streamText.slice(-800) : '等待模型开始输出…'}
              </pre>
              <div className="mt-0.5 text-[10px] wa-muted">实时输出（截取尾部）。完成后会显示对比结果。</div>
            </div>
          )}

          {/* 提示词快照 */}
          {showPrompt && (
            <div className="mt-1.5 w-[400px] rounded-lg border bg-white p-2 shadow-2xl">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium wa-muted">
                <span>当前提示词模板</span>
                <button
                  onClick={() => {
                    useUiStore.getState().setToolbarDialog('settings', 'prompts')
                    showToast('已打开设置→提示词', 'info')
                  }}
                  className="rounded px-1 text-[10px] hover:bg-black/5 wa-interactive"
                >
                  在设置中修改 ↗
                </button>
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1.5 text-[10px] leading-relaxed">{result?.promptPreview ?? '(尚未生成)'}</pre>
              <p className="mt-1 text-[10px] wa-muted">
                {ACTIONS.filter((a) => a.shortcut).map((a) => `${a.label}：${a.shortcut}`).join(' · ')}
              </p>
            </div>
          )}

          {/* 结果卡片：diff 对比视图 + 替换/插入/复制/重新生成 */}
          {result && (
            <div className="mt-1.5 max-h-[480px] w-[400px] overflow-y-auto rounded-lg border bg-white p-2 shadow-2xl">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium wa-muted">
                  {ACTIONS.find((a) => a.id === result.action)?.icon} {ACTIONS.find((a) => a.id === result.action)?.label}结果
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setSidePanelTab('history')
                      showToast('已在侧栏展开「改写记录」', 'info')
                    }}
                    title="在侧栏查看完整历史"
                    className="rounded px-1 text-[10px] hover:bg-black/5 wa-interactive"
                  >
                    侧栏 ↗
                  </button>
                  <button onClick={() => setResult(null)} className="rounded px-1 text-xs hover:bg-black/5 wa-interactive">✕</button>
                </div>
              </div>

              {/* diff 视图：原文做删除线，AI 结果做高亮 */}
              {bubble && (
                <div className="mb-1 rounded border bg-black/[0.02] p-1.5 text-[11px] leading-relaxed" style={{ borderColor: 'var(--wa-border)' }}>
                  <DiffView source={bubble.text} output={result.text} />
                </div>
              )}

              {/* 也提供纯净输出，方便复制整段 */}
              <details className="mb-1.5">
                <summary className="cursor-pointer text-[10px] wa-muted">查看完整结果</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1.5 text-[11px] leading-relaxed">{result.text}</pre>
              </details>

              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => applyResult('replace')}
                  className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 wa-interactive"
                >
                  替换原文
                </button>
                <button
                  onClick={() => applyResult('insert')}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  插入
                </button>
                <button
                  onClick={() => applyResult('copy')}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  仅复制
                </button>
                <button
                  onClick={() => void run(result.action, bubble!.text, result.action === 'ask' ? lastQuestion : undefined)}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  🔁 重新生成
                </button>
                <div className="flex-1" />
                <span className="self-center text-[10px] wa-muted">AI 生成，仅供参考</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 「问 AI」提问输入框 */}
      <InputDialog
        open={pendingAsk !== null}
        title="想对这个片段问什么？"
        defaultValue="这段文字的节奏是否合适？"
        placeholder="例如：这段对话是否自然？视角是否混乱？"
        confirmLabel="提问"
        multiline
        onCancel={() => setPendingAsk(null)}
        onConfirm={(q) => {
          const text = pendingAsk?.text ?? ''
          setPendingAsk(null)
          void run('ask', text, q)
        }}
      />

      {/* 提示词选择器：每个动作执行前都先经过这里 */}
      <PromptPicker
        open={pickerOpen}
        onClose={() => {
          // 关掉选择器 = 取消，不偷偷用默认提示词开跑
          setPickerOpen(false)
          setPendingPick(null)
        }}
        presetVars={{
          text: (pendingPick?.text ?? bubble?.text ?? lastBubbleRef.current?.text) || '',
          content: (pendingPick?.text ?? bubble?.text ?? lastBubbleRef.current?.text) || ''
        }}
        initialActionType={pendingPick?.action}
        onConfirm={(finalPrompt, item) => {
          const pend = pendingPickRef.current
          const text = pend?.text ?? bubble?.text ?? lastBubbleRef.current?.text ?? ''
          const action = pend?.action
          setPickerOpen(false)
          setPendingPick(null)
          if (!action || !text) {
            showToast('没有可处理的选区，请重新划词后再试', 'error')
            return
          }
          rememberPrompt(action, { id: item.id, name: item.name, content: finalPrompt })
          if (action === 'ask') {
            void sendCustomPrompt(item, finalPrompt, text)
            return
          }
          void run(action, text, undefined, { promptOverride: finalPrompt, promptName: item.name })
        }}
      />
    </>
  )

  async function sendCustomPrompt(item: PromptItem, finalPrompt: string, originalText: string): Promise<void> {
    const adapter = getAdapter(siteId)
    if (!adapter) {
      showToast('当前站点未适配', 'error')
      return
    }
    // 风控前置
    const siteState = useSiteStore.getState().sites[siteId]
    if (siteState?.status.kind === 'logged-out') {
      showToast('站点未登录', 'error')
      return
    }
    if (siteState?.status.kind === 'risk') {
      showToast('站点风控', 'error')
      return
    }

    setBusy(true)
    try {
      const res = await window.api.bg.start({
        task: 'ask',
        prompt: finalPrompt,
        siteId,
        skipCache: true,
        scripts: toScripts(adapter)
      })
      if (!res.ok) throw new Error(res.error)
      const cleaned = cleanModelOutput(res.data.text)
      setResult({ id: '', text: cleaned, action: 'ask', promptPreview: `（用户提示词库）${item.name}\n${item.content}` })
      // 入历史
      const entry = addHistory({
        kind: 'ask',
        chapterId: currentChapterId,
        workId: currentWorkId,
        source: cleanSelection(originalText),
        output: cleaned,
        promptPreview: `（${item.name}）\n${item.content}`
      })
      setResult((r) => (r ? { ...r, id: entry.id } : r))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理失败'
      showToast(interpretAiError(msg).toast, 'error')
      void refreshSiteStatus(siteId)
    } finally {
      setBusy(false)
    }
  }
}