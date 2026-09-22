import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkStore } from '../../store/work'
import { useUiStore } from '../../store/ui'
import { useEditorStore } from '../../store/editor'
import { VersionHistoryPanel } from '../VersionHistoryPanel'
import { AdvancedPanel } from '../advanced/AdvancedPanel'
import { LibraryPanel } from '../LibraryPanel'
import { assembleContext } from '../../services/context'
import { requestSuggestions } from '../../services/suggest'
import { needsAiCopyright, COMPLIANCE_TEXT, acceptConsent } from '../../services/compliance'

/**
 * 草稿标签页（阶段 5 / 5.7 / 5.8）。
 * 章节树（卷→章）+ 编辑器 + 自动保存（防抖 2 秒）+ 字数统计 + 版本历史。
 */
export function DraftTab(): JSX.Element {
  const works = useWorkStore((s) => s.works)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)
  const draft = useWorkStore((s) => s.draft)
  const dirty = useWorkStore((s) => s.dirty)
  const saving = useWorkStore((s) => s.saving)
  const lastSavedAt = useWorkStore((s) => s.lastSavedAt)
  const historyOpen = useWorkStore((s) => s.historyOpen)
  const showToast = useUiStore((s) => s.showToast)
  const requestStatus = useUiStore((s) => s.requestStatus)
  const setRequestStatus = useUiStore((s) => s.setRequestStatus)
  const features = useUiStore((s) => s.settings?.features)

  const [showCreateWork, setShowCreateWork] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAuthor, setNewAuthor] = useState('')
  const [newIntro, setNewIntro] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** 作品库（卡片式管理所有作品） */
  const [libraryOpen, setLibraryOpen] = useState(false)

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const work = works.find((w) => w.id === currentWorkId)
  /** 当前章节（用于概览展示） */
  const currentChapter = work?.volumes
    .flatMap((v) => v.chapters)
    .find((c) => c.id === currentChapterId)

  // 启动加载
  useEffect(() => {
    if (works.length === 0 && !currentWorkId) void useWorkStore.getState().init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动保存：防抖 2 秒
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      void useWorkStore.getState().save('autosave')
    }, 2000)
    return () => clearTimeout(t)
  }, [dirty, draft])

  // 崩溃恢复：每 5 秒上报临时草稿（不阻塞；失败静默）
  useEffect(() => {
    if (!currentWorkId || !currentChapterId) return
    const timer = setInterval(() => {
      const s = useWorkStore.getState()
      if (!s.dirty) return
      void window.api.recovery
        .write({
          workId: s.currentWorkId!,
          chapterId: s.currentChapterId!,
          content: s.draft,
          cursorPosition: areaRef.current?.selectionStart ?? 0,
          updatedAt: Date.now()
        })
        .catch(() => undefined)
    }, 5000)
    return () => clearInterval(timer)
  }, [currentWorkId, currentChapterId])

  // Ctrl+S 手动保存 / Ctrl+Enter 获取建议
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void useWorkStore.getState().save('manual')
        showToast('已保存', 'success')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void onGetSuggestion()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast])

  /**
   * 获取建议（阶段 3）。
   * 草稿 <20 字时提示；组装上下文后发起后台请求。
   */
  async function onGetSuggestion(): Promise<void> {
    const s = useWorkStore.getState()
    const text = s.draft
    if (text.replace(/\s/g, '').length < 20) {
      showToast('草稿太短（少于 20 字），请先写一些内容', 'error')
      return
    }
    if (!s.currentWorkId) {
      showToast('请先创建作品', 'error')
      return
    }
    if (useUiStore.getState().requestStatus === 'running') {
      showToast('正在生成中，请稍候…')
      return
    }

    // 首次使用 AI 功能：版权说明（阶段 8.5）
    const settings = useUiStore.getState().settings
    if (settings && needsAiCopyright(settings)) {
      const ok = window.confirm(
        `${COMPLIANCE_TEXT.aiCopyright.title}\n\n${COMPLIANCE_TEXT.aiCopyright.body.join('\n')}\n\n点击"确定"表示已知悉。`
      )
      if (!ok) return
      const next = await window.api.settings.set({
        consent: { ...settings.consent, ...acceptConsent('aiCopyright') }
      })
      useUiStore.getState().setSettings(next)
    }

    setRequestStatus('running')
    try {
      const ctx = await assembleContext(text, s.currentWorkId, s.currentChapterId ?? undefined)
      const siteId = useUiStore.getState().siteId
      const enabled = useUiStore.getState().settings?.multiModelEnabled
      const { buildSuggestPrompt, requestMultiModel } = await import('../../services/suggest')

      if (enabled) {
        // 多模型对比（阶段 12.5）：并排显示多个站点结果
        const batches = await requestMultiModel(
          { draft: text, contextText: ctx.text, siteId },
          ['deepseek']
        )
        batches.forEach((b) => useUiStore.getState().pushBatch(b))
        showToast(`已生成 ${batches.length} 组建议`, 'success')
      } else {
        const r = await requestSuggestions({ draft: text, contextText: ctx.text, siteId })
        useUiStore.getState().pushBatch(r.batch)
        showToast(r.fromCache ? '已使用缓存结果' : '建议已生成', 'success')
      }
      setRequestStatus('idle')
    } catch (err) {
      setRequestStatus('failed')
      const msg = err instanceof Error ? err.message : '获取建议失败'
      showToast(msg, 'error')
    }
  }

  const wordCount = useMemo(() => draft.replace(/\s/g, '').length, [draft])
  const totalWords = useMemo(
    () => work?.volumes.reduce((sum, v) => sum + v.chapters.reduce((s2, c) => s2 + c.wordCount, 0), 0) ?? 0,
    [work]
  )

  async function onCreateWork(): Promise<void> {
    if (!newTitle.trim()) {
      showToast('请输入书名', 'error')
      return
    }
    await useWorkStore.getState().createWork({ title: newTitle, author: newAuthor, intro: newIntro })
    setNewTitle('')
    setNewAuthor('')
    setNewIntro('')
    setShowCreateWork(false)
    showToast('作品已创建', 'success')
  }

  async function onDeleteWork(): Promise<void> {
    if (!work) return
    if (!window.confirm(`确定删除《${work.title}》？此操作不可撤销。`)) return
    await useWorkStore.getState().removeWork(work.id)
    showToast('作品已删除')
  }

  // 无作品：引导创建
  if (!currentWorkId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="text-sm wa-muted">还没有作品</div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateWork(true)}
            className="rounded bg-ink-800 px-3 py-1.5 text-xs text-white hover:bg-ink-900"
          >
            ＋ 新建作品
          </button>
          <button
            onClick={() => setLibraryOpen(true)}
            className="rounded border px-3 py-1.5 text-xs hover:bg-black/5"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            📚 作品库
          </button>
        </div>
        {showCreateWork && (
          <WorkCreateForm
            title={newTitle}
            author={newAuthor}
            intro={newIntro}
            onTitle={setNewTitle}
            onAuthor={setNewAuthor}
            onIntro={setNewIntro}
            onCancel={() => setShowCreateWork(false)}
            onConfirm={() => void onCreateWork()}
          />
        )}
        {libraryOpen && <LibraryPanel onClose={() => setLibraryOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 作品切换 */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <select
          value={currentWorkId}
          onChange={(e) => void useWorkStore.getState().selectWork(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-transparent px-1 py-0.5 text-xs"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => setLibraryOpen(true)}
          title="打开作品库（卡片式管理所有作品）"
          className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          📚 作品库
        </button>
        <button
          onClick={() => setShowCreateWork(true)}
          title="新建作品"
          className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5"
        >
          ＋
        </button>
        <button
          onClick={() => void onDeleteWork()}
          title="删除当前作品"
          className="rounded px-1.5 py-0.5 text-xs hover:bg-red-50"
        >
          🗑
        </button>
      </div>

      {showCreateWork && (
        <WorkCreateForm
          title={newTitle}
          author={newAuthor}
          intro={newIntro}
          onTitle={setNewTitle}
          onAuthor={setNewAuthor}
          onIntro={setNewIntro}
          onCancel={() => setShowCreateWork(false)}
          onConfirm={() => void onCreateWork()}
        />
      )}

      {/* 章节树 */}
      <div className="max-h-40 shrink-0 overflow-y-auto border-b px-1 py-1">
        {work?.volumes.map((v) => {
          const open = expanded[v.id] !== false
          return (
            <div key={v.id} className="mb-0.5">
              <button
                onClick={() => setExpanded((e) => ({ ...e, [v.id]: !open }))}
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-medium hover:bg-black/5"
              >
                <span className="wa-muted">{open ? '▾' : '▸'}</span>
                <span className="truncate">{v.title}</span>
                <span className="wa-muted">({v.chapters.length})</span>
              </button>
              {open && (
                <div className="ml-3">
                  {v.chapters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => void useWorkStore.getState().selectChapter(c.id)}
                      className={`flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-black/5 ${
                        c.id === currentChapterId ? 'bg-black/10 font-medium' : ''
                      }`}
                    >
                      <span className="truncate">{c.title}</span>
                      <span className="shrink-0 wa-muted">{c.wordCount}字</span>
                    </button>
                  ))}
                  <button
                    onClick={() => void useWorkStore.getState().createChapter(v.id, '')}
                    className="w-full rounded px-1 py-0.5 text-left text-xs wa-muted hover:bg-black/5"
                  >
                    ＋ 新建章节
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 章节概览与预览（只读）。
          中间栏才是正文编辑区，这里**不再放第二个编辑器** ——
          早期两边都绑定 useWorkStore.draft，导致在正文输入会同步改动草稿、
          看起来像"两个一模一样的编辑框"。现改为只读概览。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-xs">
          <InfoRow label="当前章节" value={currentChapter?.title || '未选择章节'} />
          <InfoRow label="本章字数" value={`${wordCount} 字`} />
          <InfoRow label="全书字数" value={`${totalWords} 字`} />
          <InfoRow
            label="保存状态"
            value={saving ? '保存中…' : dirty ? '未保存' : lastSavedAt ? '已保存' : '已同步'}
          />

          {currentChapter?.summary ? (
            <>
              <div className="mt-3 mb-1 font-medium wa-muted">章节摘要</div>
              <p className="leading-relaxed">{currentChapter.summary}</p>
            </>
          ) : null}

          <div className="mt-3 mb-1 flex items-center gap-1">
            <span className="font-medium wa-muted">正文预览</span>
            <button
              onClick={() => useEditorStore.getState().setCenterView('write')}
              className="text-[11px] text-blue-600 hover:underline"
            >
              去中间栏编辑 →
            </button>
          </div>
          <p
            className="whitespace-pre-wrap rounded border p-2 leading-[1.9]"
            style={{ borderColor: 'var(--wa-border)', background: 'var(--wa-paper)' }}
          >
            {draft.trim() ? draft : <span className="wa-muted">（本章还没有内容）</span>}
          </p>
        </div>

        {/* 状态栏 */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-2 py-1 text-xs wa-muted">
          <span>
            本章 {wordCount} 字 · 全书 {totalWords} 字
          </span>
          <div className="flex items-center gap-2">
            <span>
              {saving ? '保存中…' : dirty ? '未保存' : lastSavedAt ? '已保存' : '已同步'}
            </span>
            <button
              onClick={() => void useWorkStore.getState().openHistory()}
              className="rounded px-1.5 py-0.5 hover:bg-black/5"
              title="历史版本"
            >
              🕘 历史版本
            </button>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="rounded px-1.5 py-0.5 hover:bg-black/5"
              title="进阶工具：敏感词 / 风格 / 一致性 / 分章 / 目标"
            >
              🧰 工具
            </button>
            {/* 阶段 3：手动触发（Ctrl+Enter） */}
            <button
              onClick={() => void onGetSuggestion()}
              disabled={requestStatus === 'running'}
              title="获取建议（Ctrl+Enter）"
              className={`rounded px-2 py-0.5 font-medium text-white disabled:opacity-60 ${
                requestStatus === 'failed' ? 'bg-red-600' : 'bg-ink-800 hover:bg-ink-900'
              }`}
            >
              {requestStatus === 'running' ? '生成中…' : requestStatus === 'failed' ? '重试建议' : '获取建议'}
            </button>
          </div>
        </div>
      </div>

      {/* 写作页/AI 页由 WritingPage 统一挂载走向卡片，此处不再重复挂载 */}

      {/* 阶段 5.7：版本历史面板 */}
      {historyOpen && <VersionHistoryPanel />}

      {/* 作品库（参考作家助手的书架式管理） */}
      {libraryOpen && <LibraryPanel onClose={() => setLibraryOpen(false)} />}

      {/* 阶段 11：进阶工具面板 */}
      {advancedOpen && (
        <div className="absolute inset-x-0 bottom-0 top-8 z-20 border-t bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b px-2 py-1">
            <span className="text-xs font-semibold">进阶工具</span>
            <button onClick={() => setAdvancedOpen(false)} className="rounded px-1.5 text-xs hover:bg-black/5">
              ✕
            </button>
          </div>
          <div className="h-[calc(100%-2rem)]">
            <AdvancedPanel />
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="wa-muted">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  )
}

function WorkCreateForm({
  title,
  author,
  intro,
  onTitle,
  onAuthor,
  onIntro,
  onCancel,
  onConfirm
}: {
  title: string
  author: string
  intro: string
  onTitle: (v: string) => void
  onAuthor: (v: string) => void
  onIntro: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <div className="shrink-0 border-b bg-black/[0.03] p-2">
      <div className="mb-1.5 text-xs font-medium">新建作品</div>
      <input
        autoFocus
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="书名 *"
        className="mb-1 w-full rounded border bg-white px-1.5 py-1 text-xs outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <input
        value={author}
        onChange={(e) => onAuthor(e.target.value)}
        placeholder="作者"
        className="mb-1 w-full rounded border bg-white px-1.5 py-1 text-xs outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <textarea
        value={intro}
        onChange={(e) => onIntro(e.target.value)}
        placeholder="简介"
        rows={2}
        className="mb-1.5 w-full resize-none rounded border bg-white px-1.5 py-1 text-xs outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="rounded px-2 py-0.5 text-xs hover:bg-black/5">
          取消
        </button>
        <button
          onClick={onConfirm}
          className="rounded bg-ink-800 px-2 py-0.5 text-xs text-white hover:bg-ink-900"
        >
          创建
        </button>
      </div>
    </div>
  )
}
