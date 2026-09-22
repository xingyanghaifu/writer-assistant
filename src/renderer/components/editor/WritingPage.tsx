import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkStore } from '../../store/work'
import { useUiStore } from '../../store/ui'
import { useEditorStore, fontStack, applyTheme } from '../../store/editor'
import { useAiTraceStore } from '../../store/aiTrace'
import { useJobsStore } from '../../store/jobs'
import { BubbleMenu } from '../BubbleMenu'
import { InputDialog } from '../InputDialog'
import { FormatPanel } from './FormatPanel'
import { assembleContext } from '../../services/context'
import { requestSuggestions } from '../../services/suggest'
import { usePetPerception } from '../../hooks/usePetPerception'
import type { ThemeMode } from '@shared/settings'

/** 三栏宽度（阶段 9） */
const CHAPTER_TREE_WIDTH = 280
const AUX_PANEL_WIDTH = 320

type FontSize = number

/**
 * 写作页（阶段 9 三栏排版 + 9.5 气泡菜单）。
 *
 * 左：章节树 280px   中：编辑器   右：辅助面板 320px
 * 专注模式 Ctrl+3 隐藏两侧；F11 切换主题。
 */
export function WritingPage(): JSX.Element {
  const petHook = usePetPerception()
  const works = useWorkStore((s) => s.works)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)
  const draft = useWorkStore((s) => s.draft)
  const dirty = useWorkStore((s) => s.dirty)
  const saving = useWorkStore((s) => s.saving)
  const showToast = useUiStore((s) => s.showToast)
  const settings = useUiStore((s) => s.settings)
  const theme = useUiStore((s) => s.theme)

  // 专注模式的唯一来源是 ui store（与左侧工作台收起联动）
  const focusMode = useUiStore((s) => s.focusMode)
  const setFocusMode = useUiStore((s) => s.setFocusMode)
  const auxPanelOpen = useEditorStore((s) => s.auxPanelOpen)
  const toggleAuxPanel = useEditorStore((s) => s.toggleAuxPanel)
  const chapterTreeOpen = useEditorStore((s) => s.chapterTreeOpen)
  const toggleChapterTree = useEditorStore((s) => s.toggleChapterTree)
  const showBubble = useEditorStore((s) => s.showBubble)
  const hideBubble = useEditorStore((s) => s.hideBubble)
  const setTypingSpeed = useEditorStore((s) => s.setTypingSpeed)
  const traceEntries = useAiTraceStore((s) => s.entries)
  const tracePhase = useAiTraceStore((s) => s.phase)
  const traceAction = useAiTraceStore((s) => s.action)
  const clearTrace = useAiTraceStore((s) => s.clear)
  const allJobs = useJobsStore((s) => s.jobs)
  const runningJobs = useMemo(
    () => allJobs.filter((j) => j.status === 'running' || j.status === 'paused'),
    [allJobs]
  )

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [formatOpen, setFormatOpen] = useState(false)
  /** 待确认的伏笔（替代 window.prompt） */
  const [foreshadowDraft, setForeshadowDraft] = useState<{
    text: string
    from: number
    to: number
    desc: string
  } | null>(null)

  /**
   * 正文是否已含字面段首缩进（真实数据，不是 CSS 效果）。
   *
   * 按钮状态**直接由正文推导**，不用独立的 local state：
   * 早期用一个 `indentOn` 布尔量，结果标签显示"缩进开"而正文其实没有缩进
   * （实测：按钮写着"缩进开"，点一次却什么都没发生），状态与事实不符。
   */
  const hasLiteralIndent = useMemo(() => /(^|\n)[ \t\u3000]+[^\s]/.test(draft), [draft])

  /**
   * 切换段首缩进 —— 真正修改正文（导出后缩进仍在），非 CSS 视觉效果。
   *
   * 有缩进 → 全部去掉；无缩进 → 全部补上。
   */
  function toggleIndent(): void {
    const INDENT = '　　'
    let changed = 0
    const next = draft
      .split('\n')
      .map((line) => {
        if (line.trim() === '') return line // 空行不动
        if (hasLiteralIndent) {
          const stripped = line.replace(/^[ \t\u3000]+/, '')
          if (stripped !== line) changed++
          return stripped
        }
        if (!line.startsWith(INDENT)) {
          changed++
          return INDENT + line.replace(/^[ \t\u3000]+/, '')
        }
        return line
      })
      .join('\n')

    if (changed === 0) {
      showToast(hasLiteralIndent ? '没有需要取消的缩进' : '所有段落已有缩进', 'info')
      return
    }
    useWorkStore.getState().setDraft(next)
    showToast(hasLiteralIndent ? `已取消 ${changed} 段缩进` : `已为 ${changed} 段添加缩进`, 'success')
  }
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')

  const work = works.find((w) => w.id === currentWorkId)
  const chapter = useMemo(() => {
    if (!work || !currentChapterId) return undefined
    for (const v of work.volumes) {
      const c = v.chapters.find((x) => x.id === currentChapterId)
      if (c) return c
    }
    return undefined
  }, [work, currentChapterId])

  const ed = settings?.editor
  const wordCount = useMemo(() => draft.replace(/\s/g, '').length, [draft])
  const totalWords = useMemo(
    () => work?.volumes.reduce((s, v) => s + v.chapters.reduce((a, c) => a + c.wordCount, 0), 0) ?? 0,
    [work]
  )
  const todayWords = useMemo(() => 0, [])

  // 打字速度统计（字/分钟，滑动窗口）
  const samples = useRef<Array<{ t: number; n: number }>>([])
  useEffect(() => {
    samples.current.push({ t: Date.now(), n: draft.replace(/\s/g, '').length })
    const cutoff = Date.now() - 60_000
    samples.current = samples.current.filter((s) => s.t >= cutoff)
    const first = samples.current[0]
    if (first && samples.current.length > 1) {
      const dt = (Date.now() - first.t) / 60_000
      if (dt > 0.05) setTypingSpeed(Math.max(0, Math.round((wordCount - first.n) / dt)))
    }
  }, [draft, wordCount, setTypingSpeed])

  // 主题变化
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  // Ctrl+3 专注模式、F11 主题、Ctrl+F 查找
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && e.key === '3') {
        e.preventDefault()
        setFocusMode(!useUiStore.getState().focusMode)
      }
      if (e.key === 'F11') {
        e.preventDefault()
        const order: ThemeMode[] = ['light', 'dark', 'parchment']
        const cur = useUiStore.getState().theme
        const i = order.indexOf(cur as ThemeMode)
        const next = order[(i + 1) % order.length]
        useUiStore.getState().setTheme(next)
        void window.api.settings.set({ theme: next })
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        toggleIndent()
      }
      if (e.key === 'Escape') setFindOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusMode])

  /** 选区变化 -> 气泡菜单（选中 ≥5 字） */
  function onSelect(): void {
    const el = areaRef.current
    if (!el) return
    const from = el.selectionStart
    const to = el.selectionEnd
    const text = draft.slice(from, to)
    if (text.trim().length < 5) {
      hideBubble()
      return
    }
    // 定位到选区所在行
    const rect = el.getBoundingClientRect()
    const lineHeight = (ed?.fontSize ?? 17) * (ed?.lineHeight ?? 1.8)
    const before = draft.slice(0, from)
    const lineIndex = before.split('\n').length - 1
    // ⚠️ 必须把结果夹在元素可视范围内。
    // 早期写法 `rect.top + Math.min(lineIndex*lineHeight - scrollTop, rect.height - 40)`
    // 在滚动后会得到负值，气泡被推到视口上方（实测 y = -138），
    // 用户根本点不到按钮。
    const PAD_TOP = 32 // 编辑器 py-8
    const offsetInEl = PAD_TOP + lineIndex * lineHeight - el.scrollTop
    const y = rect.top + Math.max(0, Math.min(offsetInEl, rect.height - 8))
    const x = rect.left + rect.width / 2
    showBubble({ x, y, text, from, to })
  }

  /** 回车自动缩进（仅在新起段落时补全角空格） */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      const el = e.currentTarget
      const from = el.selectionStart
      // 段落结尾 -> 新段首行缩进两个全角空格
      const before = draft.slice(0, from)
      const atParagraphEnd = /\n\s*$/.test(before) || before === ''
      if (atParagraphEnd) {
        e.preventDefault()
        const indent = '　　'
        const next = draft.slice(0, from) + '\n' + indent + draft.slice(el.selectionEnd)
        useWorkStore.getState().setDraft(next)
        requestAnimationFrame(() => {
          const pos = from + 1 + indent.length
          el.setSelectionRange(pos, pos)
        })
      }
    }
  }

  /**
   * 替换选区。
   *
   * ⚠️ 不能依赖 textarea 的实时选区：点气泡/弹窗按钮时它已失焦，
   * 浏览器会把 selectionStart/End 归零，结果是"选中的文本没了"或改到开头。
   * 因此优先用气泡记录下来的 from/to。
   */
  function replaceSelection(text: string, range?: { from: number; to: number }): void {
    const el = areaRef.current
    const bubbleRange = useEditorStore.getState().bubble
    const from = range?.from ?? bubbleRange?.from ?? el?.selectionStart ?? 0
    const to = range?.to ?? bubbleRange?.to ?? el?.selectionEnd ?? from
    // 夹在正文范围内，避免越界切坏内容
    const a = Math.max(0, Math.min(from, draft.length))
    const b = Math.max(a, Math.min(to, draft.length))
    const next = draft.slice(0, a) + text + draft.slice(b)
    useWorkStore.getState().setDraft(next)
    requestAnimationFrame(() => el?.setSelectionRange(a, a + text.length))
  }

  /** 在光标处插入（同样不依赖失焦后的实时选区） */
  function insertAtCursor(text: string): void {
    const el = areaRef.current
    const bubbleRange = useEditorStore.getState().bubble
    const pos = bubbleRange?.to ?? el?.selectionStart ?? draft.length
    const p = Math.max(0, Math.min(pos, draft.length))
    const next = draft.slice(0, p) + text + draft.slice(p)
    useWorkStore.getState().setDraft(next)
    requestAnimationFrame(() => el?.setSelectionRange(p, p + text.length))
  }

  /**
   * 标记伏笔（阶段 6 联动）。
   *
   * ⚠️ 不能使用 `window.prompt` —— Electron 不支持，会抛
   * `Error: prompt() is not supported.`（实测），导致本功能完全失效。
   * 改为打开应用内输入对话框，确认后再写入。
   */
  function markForeshadow(text: string, from: number, to: number): void {
    if (!currentWorkId || !currentChapterId) return
    setForeshadowDraft({ text, from, to, desc: text.slice(0, 40) })
  }

  /** 确认写入伏笔 */
  function commitForeshadow(desc: string): void {
    if (!currentWorkId || !currentChapterId || !foreshadowDraft) return
    const { from, to } = foreshadowDraft
    setForeshadowDraft(null)
    void window.api.material
      .upsertForeshadowing(currentWorkId, {
        content: desc,
        type: 'plant',
        status: 'planted',
        chapterId: currentChapterId,
        anchor: { chapterId: currentChapterId, from, to }
      })
      .then(() => showToast('已标记伏笔', 'success'))
      .catch(() => showToast('标记失败', 'error'))
  }

  /** 查找替换 */
  function doFind(): void {
    if (!findText) return
    const el = areaRef.current
    if (!el) return
    const start = el.selectionEnd
    let idx = draft.indexOf(findText, start)
    if (idx < 0) idx = draft.indexOf(findText) // 回绕
    if (idx < 0) {
      showToast('未找到匹配内容', 'error')
      return
    }
    el.focus()
    el.setSelectionRange(idx, idx + findText.length)
  }

  function doReplace(): void {
    if (!findText) return
    const el = areaRef.current
    if (!el) return
    const { selectionStart: from, selectionEnd: to } = el
    if (draft.slice(from, to) !== findText) {
      doFind()
      return
    }
    const next = draft.slice(0, from) + replaceText + draft.slice(to)
    useWorkStore.getState().setDraft(next)
    requestAnimationFrame(() => el.setSelectionRange(from, from + replaceText.length))
  }

  async function onGetSuggestion(): Promise<void> {
    const s = useWorkStore.getState()
    if (s.draft.replace(/\s/g, '').length < 20) {
      showToast('草稿太短（少于 20 字）', 'error')
      return
    }
    if (!s.currentWorkId) return
    useUiStore.getState().setRequestStatus('running')
    try {
      const ctx = await assembleContext(s.draft, s.currentWorkId, s.currentChapterId ?? undefined)
      const siteId = useUiStore.getState().siteId
      const r = await requestSuggestions({ draft: s.draft, contextText: ctx.text, siteId })
      useUiStore.getState().pushBatch(r.batch)
      useUiStore.getState().setRequestStatus('idle')
      showToast('建议已生成', 'success')
    } catch (err) {
      useUiStore.getState().setRequestStatus('failed')
      showToast(err instanceof Error ? err.message : '获取建议失败', 'error')
    }
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col" style={{ background: 'var(--wa-bg)' }}>

      {/* 正文页顶栏：排版/查找/缩进等跟着正文走 */}
      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1 text-[11px]"
        style={{ borderColor: 'var(--wa-border)', background: 'var(--wa-panel)' }}
      >
        <span className="wa-muted">本章 {wordCount} 字</span>
        <span className="wa-muted">全书 {totalWords} 字</span>
        <span className="wa-muted">今日 {todayWords} 字</span>
        <span className="wa-muted">{useEditorStore.getState().typingSpeed} 字/分</span>
        <span className="wa-muted">{saving ? '保存中…' : dirty ? '未保存' : '已保存'}</span>
        <div className="flex-1" />
        <button type="button" onClick={() => setFindOpen((v) => !v)} className="rounded px-1.5 py-0.5 hover:bg-black/5">
          查找
        </button>
        <button
          type="button"
          onClick={toggleIndent}
          className="rounded px-1.5 py-0.5 hover:bg-black/5"
          title={
            hasLiteralIndent
              ? '段首缩进（真实数据，导出后保留）：点击取消全部段落缩进'
              : '段首缩进（真实数据，导出后保留）：点击为所有段落补上缩进'
          }
        >
          缩进{hasLiteralIndent ? '开' : '关'}
        </button>
        <button
          type="button"
          onClick={() => setFormatOpen(true)}
          className="rounded px-1.5 py-0.5 hover:bg-black/5"
          title="自动排版：规范缩进、标点、引号与空行（纯本地）"
        >
          排版
        </button>
        <FontSizeControl />
        <button type="button" onClick={toggleChapterTree} className="rounded px-1.5 py-0.5 hover:bg-black/5" title="收起或展开左侧章节列表">
          {chapterTreeOpen ? '收起章节栏' : '章节栏'}
        </button>
        <button type="button" onClick={toggleAuxPanel} className="rounded px-1.5 py-0.5 hover:bg-black/5">
          {auxPanelOpen ? '隐藏辅栏' : '辅助栏'}
        </button>
        <button type="button" onClick={() => setFocusMode(!focusMode)} className="rounded px-1.5 py-0.5 hover:bg-black/5">
          {focusMode ? '退出专注' : '专注'}
        </button>
        <button
          type="button"
          onClick={() => void onGetSuggestion()}
          className="rounded bg-ink-800 px-2 py-0.5 text-white hover:bg-ink-900"
        >
          获取建议
        </button>
      </div>
      {/* 查找替换条 */}
      {findOpen && (
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs" style={{ borderColor: 'var(--wa-border)' }}>
          <input
            autoFocus
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            placeholder="查找"
            className="w-32 rounded border bg-white px-1.5 py-0.5 outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="替换为"
            className="w-32 rounded border bg-white px-1.5 py-0.5 outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <button onClick={doFind} className="rounded px-1.5 py-0.5 hover:bg-black/5">
            查找
          </button>
          <button onClick={doReplace} className="rounded px-1.5 py-0.5 hover:bg-black/5">
            替换
          </button>
          <div className="flex-1" />
          <button onClick={() => setFindOpen(false)} className="rounded px-1.5 py-0.5 hover:bg-black/5">
            ✕
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左栏：章节树 280px（可收起） */}
        {!focusMode && chapterTreeOpen && (
          <aside className="shrink-0 overflow-y-auto border-r py-1" style={{ width: CHAPTER_TREE_WIDTH, borderColor: 'var(--wa-border)' }}>
            <div className="px-2 py-1 text-[11px] font-semibold wa-muted">章节</div>
            {work?.volumes.map((v) => {
              const open = expanded[v.id] !== false
              return (
                <div key={v.id} className="mb-0.5">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [v.id]: !open }))}
                    className="flex w-full items-center gap-1 px-2 py-0.5 text-xs font-medium hover:bg-black/5"
                  >
                    <span className="wa-muted">{open ? '▾' : '▸'}</span>
                    <span className="truncate">{v.title}</span>
                  </button>
                  {open &&
                    v.chapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => void useWorkStore.getState().selectChapter(c.id)}
                        className={`flex w-full items-center justify-between gap-1 px-2 py-0.5 pl-5 text-left text-xs hover:bg-black/5 ${
                          c.id === currentChapterId ? 'bg-black/10 font-medium' : ''
                        }`}
                        title={c.summary ?? ''}
                      >
                        <span className="truncate">{c.title}</span>
                        <span className="shrink-0 text-[10px] wa-muted">{c.wordCount}</span>
                      </button>
                    ))}
                  <button
                    onClick={() => void useWorkStore.getState().createChapter(v.id, '')}
                    className="w-full px-2 py-0.5 pl-5 text-left text-xs wa-muted hover:bg-black/5"
                  >
                    ＋ 新建章节
                  </button>
                </div>
              )
            })}
          </aside>
        )}

        {/* 章节栏收起时留一条竖向把手，点一下就能展开 */}
        {!focusMode && !chapterTreeOpen && (
          <button
            type="button"
            onClick={toggleChapterTree}
            title="展开章节栏"
            className="flex w-6 shrink-0 flex-col items-center gap-1 border-r pt-2 text-[10px] wa-muted hover:bg-black/5"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            <span>▸</span>
            <span className="[writing-mode:vertical-rl]">章节</span>
          </button>
        )}

        {/* 中栏：编辑器 */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--wa-paper)' }}>
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => {
                const v = e.target.value
                useWorkStore.getState().setDraft(v)
                petHook.onTextChange(v)
              }}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
              onBlur={() =>
                setTimeout(() => {
                  if (document.querySelector('.wa-modal-backdrop, [role="dialog"]')) return
                  hideBubble()
                }, 160)
              }
              placeholder="在此开始写作…"
              spellCheck={false}
              className="mx-auto block h-full w-full resize-none bg-transparent px-6 py-8 outline-none"
              style={{
                maxWidth: ed?.maxWidth ?? 720,
                fontFamily: ed ? fontStack(ed.fontFamily) : undefined,
                fontSize: ed?.fontSize ?? 17,
                lineHeight: ed?.lineHeight ?? 1.8,
                // ⚠️ 不使用 CSS text-indent 做段落缩进。
                // 实测（4 段文本）：text-indent 只影响**整个文本的第一行**
                // （lineStarts = [34, 0, 0, 0]），后续段落一律不缩进 ——
                // 结果是首段右移、其余段落顶格，视觉上参差不齐。
                // 且它只改变"看起来"，导出的文本没有缩进，破坏所见即所得。
                // 因此缩进一律使用字面全角空格（真实数据），
                // 由「排版」面板批量补齐、回车自动续接。
                background: 'transparent'
              }}
            />
          </div>

          {/* 走向卡片悬浮底部 */}
        </main>

        {/* 右栏：辅助面板 320px */}
        {!focusMode && auxPanelOpen && (
          <aside
            className="shrink-0 overflow-y-auto border-l p-2"
            style={{ width: AUX_PANEL_WIDTH, borderColor: 'var(--wa-border)' }}
          >
            <section className="rounded-lg border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1.5 text-[11px] font-semibold wa-muted">本章信息</div>
              {chapter ? (
                <div className="space-y-1 text-xs">
                  <div className="font-medium">{chapter.title}</div>
                  <div className="wa-muted">
                    字数 {chapter.wordCount} · 目标 {chapter.targetWordCount ?? settings?.defaultTargetWordCount ?? 3000}
                  </div>
                  <ProgressBar
                    value={chapter.wordCount}
                    target={chapter.targetWordCount ?? settings?.defaultTargetWordCount ?? 3000}
                  />
                  <div className="pt-1 text-[11px] font-semibold wa-muted">摘要</div>
                  <div className="whitespace-pre-wrap text-[11px] leading-relaxed">
                    {chapter.summary ?? '（尚未生成摘要）'}
                  </div>
                </div>
              ) : (
                <div className="text-xs wa-muted">未选择章节</div>
              )}
            </section>

            {/* AI 活动：让写作时看得见 AI 在做什么 */}
            <section className="mt-2 rounded-lg border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[11px] font-semibold wa-muted">AI 活动</span>
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    tracePhase === 'thinking' || tracePhase === 'requesting' || tracePhase === 'streaming'
                      ? 'bg-[var(--wa-accent)]'
                      : tracePhase === 'failed'
                        ? 'bg-[var(--wa-danger)]'
                        : 'bg-[var(--wa-muted)]'
                  }`}
                />
                <span className="text-[10px] wa-muted">
                  {tracePhase === 'idle' ? '空闲' : tracePhase === 'done' ? '刚完成' : tracePhase === 'failed' ? '失败' : traceAction || '进行中'}
                </span>
                <div className="flex-1" />
                {traceEntries.length > 0 && (
                  <button onClick={() => clearTrace()} className="rounded px-1 text-[10px] wa-muted hover:bg-black/5">清空</button>
                )}
              </div>
              {runningJobs.length > 0 && (
                <div className="mb-1.5 space-y-1">
                  {runningJobs.map((j) => (
                    <div key={j.id} className="rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'var(--wa-border)' }}>
                      <div className="flex items-center gap-1">
                        <span className="wa-pulse">●</span>
                        <span className="font-medium">{j.title}</span>
                        <div className="flex-1" />
                        <span className="wa-muted">{Math.round(j.progress * 100)}%</span>
                      </div>
                      <div className="wa-muted">{j.message}</div>
                    </div>
                  ))}
                </div>
              )}
              {traceEntries.length === 0 ? (
                <div className="rounded border border-dashed p-2 text-[10px] leading-relaxed wa-muted" style={{ borderColor: 'var(--wa-border)' }}>
                  选中正文后使用润色 / 扩写 / 改写，这里会显示每一步在做什么、耗时多久、输出多少字。
                </div>
              ) : (
                <ol className="max-h-[38vh] space-y-1.5 overflow-y-auto pr-0.5">
                  {traceEntries.slice().reverse().map((e) => (
                    <li
                      key={e.id}
                      className={`rounded border p-1.5 text-[10px] leading-relaxed ${
                        e.phase === 'failed' ? 'border-[var(--wa-danger)]/40 bg-[color-mix(in_srgb,var(--wa-danger)_8%,transparent)]' : ''
                      }`}
                      style={e.phase === 'failed' ? undefined : { borderColor: 'var(--wa-border)' }}
                    >
                      <div className="flex items-center gap-1">
                        <span>
                          {e.phase === 'done' ? '✓' : e.phase === 'failed' ? '✕' : e.phase === 'requesting' ? '↗' : '…'}
                        </span>
                        <span className="font-medium">{e.action}</span>
                        <div className="flex-1" />
                        <span className="wa-muted">
                          {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <div className="wa-muted">{e.detail}</div>
                      {e.preview && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer wa-muted">输出预览</summary>
                          <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1 font-sans text-[10px] leading-relaxed">
                            {e.preview}
                          </pre>
                        </details>
                      )}
                      {e.meta?.chars != null && (
                        <div className="wa-muted">
                          {e.meta.chars} 字
                          {e.meta.durationMs != null && ` · ${Math.round(e.meta.durationMs / 1000)}s`}
                          {e.meta.fromCache ? ' · 命中缓存' : ''}
                          {e.meta.siteId ? ` · ${e.meta.siteId}` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="mt-2 rounded-lg border p-2 text-[11px] wa-muted" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1 text-[11px] font-semibold">快捷键</div>
              <div className="space-y-0.5 leading-relaxed">
                <div>Ctrl+3 专注模式</div>
                <div>F11 切换主题</div>
                <div>Ctrl+I 段首缩进</div>
                <div>Ctrl+F 查找替换</div>
                <div>Ctrl+Enter 获取建议</div>
              </div>
            </section>
          </aside>
        )}
      </div>

      {/* 气泡菜单（阶段 9.5） */}
      <BubbleMenu onReplace={replaceSelection} onInsert={insertAtCursor} onMarkForeshadow={markForeshadow} />

      {formatOpen && (
        <FormatPanel
          source={draft}
          onClose={() => setFormatOpen(false)}
          onApply={(text) => {
            useWorkStore.getState().setDraft(text)
            setFormatOpen(false)
          }}
        />
      )}

      {/* 伏笔描述输入（替代 Electron 不支持的 window.prompt） */}
      <InputDialog
        open={foreshadowDraft !== null}
        title="伏笔描述"
        defaultValue={foreshadowDraft?.desc ?? ''}
        placeholder="简述这条伏笔，之后可在「伏笔」页追踪回收"
        confirmLabel="标记伏笔"
        multiline
        onCancel={() => setForeshadowDraft(null)}
        onConfirm={commitForeshadow}
      />
    </div>
  )
}

/** 目标字数进度条 */
function ProgressBar({ value, target }: { value: number; target: number }): JSX.Element {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  const done = pct >= 100
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-black/10">
        <div className={`h-full ${done ? 'bg-emerald-500' : 'bg-ink-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-[10px]">{pct}%{done ? ' 已达标 ✓' : ''}</div>
    </div>
  )
}

/** 字号控制 */
function FontSizeControl(): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  const [size, setSize] = useState<FontSize>(settings?.editor.fontSize ?? 17)

  async function update(next: number): Promise<void> {
    const clamped = Math.max(14, Math.min(22, next))
    setSize(clamped)
    const s = useUiStore.getState().settings
    if (!s) return
    const updated = await window.api.settings.set({ editor: { ...s.editor, fontSize: clamped } })
    useUiStore.getState().setSettings(updated)
  }

  return (
    <span className="flex items-center gap-0.5">
      <button onClick={() => void update(size - 1)} className="rounded px-1 hover:bg-black/5">
        A-
      </button>
      <span className="tabular-nums">{size}</span>
      <button onClick={() => void update(size + 1)} className="rounded px-1 hover:bg-black/5">
        A+
      </button>
    </span>
  )
}
