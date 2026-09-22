import { useState } from 'react'
import type { Card, SuggestionBatch } from '@shared/suggestion'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'
import { SuggestionCard } from './SuggestionCard'
import { requestFollowUp, requestMultiModel } from '../services/suggest'
import { assembleContext } from '../services/context'
import { needsAiCopyright, COMPLIANCE_TEXT, acceptConsent } from '../services/compliance'
import { listSiteMeta } from '../adapters/registry'

function fmt(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 走向卡片面板（阶段 4 / 4.5）。
 * 悬浮在草稿标签页底部，滑出式，可关闭；批次可折叠；保留最近 5 个批次。
 */
export function CardPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.cardPanelOpen)
  const batches = useUiStore((s) => s.batches)
  const setOpen = useUiStore((s) => s.setCardPanelOpen)
  const pushBatch = useUiStore((s) => s.pushBatch)
  const toggleBatch = useUiStore((s) => s.toggleBatchCollapsed)
  const removeBatch = useUiStore((s) => s.removeBatch)
  const showToast = useUiStore((s) => s.showToast)
  const settings = useUiStore((s) => s.settings)
  const [aiNoticeShown, setAiNoticeShown] = useState(false)
  const [multiBusy, setMultiBusy] = useState(false)
  /** 多模型对比：选中的站点（默认前两个已适配站点） */
  const availableSites = listSiteMeta().filter((s) => s.available)
  const [multiTargets, setMultiTargets] = useState<string[]>(() =>
    availableSites.slice(0, 2).map((s) => s.id)
  )

  // 无建议时也让面板可用（多模型对比入口在此），仅在有面板打开时渲染
  if (!open) return null

  /** 首次使用 AI 功能时弹出 AI 版权说明（阶段 8.5） */
  async function ensureAiCopyright(): Promise<boolean> {
    if (!settings || !needsAiCopyright(settings)) return true
    if (!aiNoticeShown) {
      const ok = window.confirm(
        `${COMPLIANCE_TEXT.aiCopyright.title}\n\n${COMPLIANCE_TEXT.aiCopyright.body.join('\n')}\n\n点击"确定"表示已知悉。`
      )
      if (!ok) return false
      const next = await window.api.settings.set({
        consent: { ...settings.consent, ...acceptConsent('aiCopyright') }
      })
      useUiStore.getState().setSettings(next)
      setAiNoticeShown(true)
    }
    return true
  }

  async function onFollowUp(card: Card): Promise<void> {
    if (!(await ensureAiCopyright())) return
    const siteId = useUiStore.getState().siteId
    showToast('追问中…')
    try {
      const newCard = await requestFollowUp(card, siteId)
      // 追加到该卡片所在批次（不覆盖）
      const s = useUiStore.getState()
      const target = s.batches.find((b) => b.cards.some((c) => c.id === card.id))
      if (target) {
        const updated: SuggestionBatch = { ...target, cards: [...target.cards, newCard] }
        // 用 pushBatch 会置顶并可能打乱顺序，这里直接改
        useUiStore.setState({
          batches: s.batches.map((b) => (b.id === target.id ? updated : b))
        })
      } else {
        pushBatch({
          id: `batch_${Date.now().toString(36)}`,
          draftSnapshot: '',
          cards: [newCard],
          createdAt: Date.now(),
          collapsed: false
        })
      }
      showToast('追问完成', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '追问失败', 'error')
    }
  }

  function onRegenerate(): void {
    // 重新生成：清空当前批次，由外部触发新的请求
    const s = useUiStore.getState()
    const latest = s.batches[0]
    if (latest) removeBatch(latest.id)
    showToast('已丢弃当前批次，请重新点击「获取建议」')
  }

  /**
   * 多模型对比（阶段 12.5）：同一次草稿并发请求多个站点。
   * 每个站点的结果作为独立批次推入，便于横向对照。
   */
  async function onMultiModel(): Promise<void> {
    if (!(await ensureAiCopyright())) return
    const draft = useWorkStore.getState().draft
    const workId = useWorkStore.getState().currentWorkId
    const chapterId = useWorkStore.getState().currentChapterId
    if (!workId || draft.replace(/\s/g, '').length < 20) {
      showToast('草稿太短（少于 20 字）', 'error')
      return
    }
    // 仅对已适配的站点发起
    const targets = multiTargets
    if (targets.length < 2) {
      showToast('至少需要选择 2 个站点', 'error')
      return
    }

    setMultiBusy(true)
    // 先打开面板，让用户能看到"请求中"状态与陆续到达的结果
    setOpen(true)
    showToast(`正在向 ${targets.length} 个站点并发请求…`)
    try {
      const ctx = await assembleContext(draft, workId, chapterId ?? undefined)
      const results = await requestMultiModel(
        { draft, contextText: ctx.text, siteId: targets[0] },
        targets
      )
      for (const b of results) pushBatch(b)
      showToast(
        results.length > 0 ? `已收到 ${results.length} 个站点的建议` : '所有站点均未返回结果',
        results.length > 0 ? 'success' : 'error'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : '多模型请求失败', 'error')
    } finally {
      setMultiBusy(false)
    }
  }

  return (
    <div
      className="wa-slide-up absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto border-t bg-white/95 backdrop-blur"
      style={{ borderColor: 'var(--wa-border)' }}
    >
      <div className="sticky top-0 flex flex-wrap items-center gap-1.5 border-b bg-white/95 px-2 py-1.5">
        <span className="text-xs font-semibold">剧情走向建议（{batches.length} 批）</span>

        {/* 阶段 12.5：多模型对比 */}
        <div className="flex items-center gap-0.5 rounded bg-black/5 px-1 py-0.5">
          <span className="text-[10px] wa-muted">对比</span>
          {availableSites.map((s) => {
            const on = multiTargets.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() =>
                  setMultiTargets((prev) =>
                    on ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                  )
                }
                className={`rounded px-1 py-0.5 text-[10px] ${
                  on ? 'bg-ink-800 text-white' : 'hover:bg-black/10'
                }`}
                title={`${s.name}${on ? '（已选中）' : ''}`}
              >
                {s.name}
              </button>
            )
          })}
          <button
            onClick={() => void onMultiModel()}
            disabled={multiBusy || multiTargets.length < 2}
            className="ml-0.5 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-40"
            title="并发请求选中的站点，结果分别成批展示"
          >
            {multiBusy ? '请求中…' : '并发请求'}
          </button>
        </div>

        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5 wa-interactive">
          ✕
        </button>
      </div>

      {batches.length === 0 && (
        <div className="p-4 text-center text-xs wa-muted">
          暂无建议。点击「获取建议」生成，或在上方勾选多个站点后点「并发请求」做多模型对比。
        </div>
      )}

      {batches.map((b) => (
        <div key={b.id} className="border-b last:border-b-0">
          {/* 批次头（可折叠） */}
          <button
            onClick={() => toggleBatch(b.id)}
            className="flex w-full items-center gap-1.5 bg-black/[0.03] px-2 py-1 text-left text-[11px] $& wa-interactive"
          >
            <span className="wa-muted">{b.collapsed ? '▸' : '▾'}</span>
            <span className="font-medium">{fmt(b.createdAt)}</span>
            <span className="wa-muted">{b.cards.length} 条</span>
            {b.draftSnapshot && (
              <span className="min-w-0 flex-1 truncate wa-muted">· {b.draftSnapshot.slice(0, 24)}…</span>
            )}
            <span className="flex-1" />
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                removeBatch(b.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') removeBatch(b.id)
              }}
              className="rounded px-1 hover:bg-black/10"
            >
              删除
            </span>
          </button>

          {!b.collapsed && (
            <div className="space-y-2 p-2">
              {b.cards.map((c) => (
                <SuggestionCard
                  key={c.id}
                  card={c}
                  onFollowUp={(card) => void onFollowUp(card)}
                  onRegenerate={onRegenerate}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
