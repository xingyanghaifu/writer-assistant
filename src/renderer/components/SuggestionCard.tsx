import { useState } from 'react'
import type { Card } from '@shared/suggestion'
import { useUiStore } from '../store/ui'
import { AI_NOTICE_SHORT } from '../services/compliance'

/** tag 对应颜色 */
const TAG_COLORS: Record<string, string> = {
  悬疑向: 'bg-purple-100 text-purple-800',
  热血向: 'bg-red-100 text-red-800',
  温情向: 'bg-pink-100 text-pink-800',
  反转向: 'bg-amber-100 text-amber-800',
  日常向: 'bg-emerald-100 text-emerald-800',
  暗黑向: 'bg-slate-200 text-slate-800',
  权谋向: 'bg-indigo-100 text-indigo-800'
}

function tagClass(tag: string): string {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag]
  // 稳定散列到一组颜色
  const palette = [
    'bg-purple-100 text-purple-800',
    'bg-red-100 text-red-800',
    'bg-amber-100 text-amber-800',
    'bg-emerald-100 text-emerald-800',
    'bg-indigo-100 text-indigo-800',
    'bg-pink-100 text-pink-800'
  ]
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

/**
 * 走向卡片（阶段 4 / 4.5 / 11 / 12.5）。
 * 操作：插入（不自动发送）、追问、收藏、重新生成、质量反馈。
 */
export function SuggestionCard({
  card,
  onFollowUp,
  onRegenerate
}: {
  card: Card
  onFollowUp: (card: Card) => void
  onRegenerate: () => void
}): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const siteId = useUiStore((s) => s.siteId)
  const [busy, setBusy] = useState(false)

  async function onInsert(): Promise<void> {
    setBusy(true)
    try {
      const { insertToSite } = await import('../services/suggest')
      const text = `${card.summary}\n\n${card.detail}`
      const ok = await insertToSite(siteId, text)
      showToast(ok ? '已插入右侧输入框（未发送）' : '插入失败，请确认右侧页面已加载', ok ? 'success' : 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onFavorite(): Promise<void> {
    // 收藏：存入 electron-store 的建议批次（通过 settings 之外的独立记录）
    try {
      const key = `favorite:${card.id}`
      await window.api.cache.set(key, JSON.stringify(card))
      showToast('已收藏', 'success')
    } catch {
      showToast('收藏失败', 'error')
    }
  }

  /** 找到"获取建议"对应的提示词条目，让赞踩能落到自迭代上 */
  async function resolvePromptId(): Promise<string> {
    try {
      const list = await window.api.promptLibrary.list()
      const bySuggest = list.find((x) => x.id === 'suggest' || x.actionType === 'custom' && x.name.includes('建议'))
      if (bySuggest) return bySuggest.id
      const byName = list.find((x) => x.name.includes('建议') || x.name.includes('走向'))
      if (byName) return byName.id
      if (list[0]) return list[0].id
    } catch {
      /* ignore */
    }
    return 'suggest'
  }

  async function onFeedback(value: 'up' | 'down'): Promise<void> {
    try {
      await window.api.advanced.submitFeedback({ tag: card.tag, value, siteId, createdAt: Date.now() })
      const promptId = await resolvePromptId()
      await window.api.promptLibrary.recordUsage({
        promptId,
        action: 'suggest',
        value,
        note: card.tag + (card.summary ? '：' + card.summary.slice(0, 60) : ''),
        siteId
      })
      showToast(value === 'up' ? '已记入提示词迭代' : '已记录点踩，迭代时会收紧')
    } catch {
      showToast('反馈写入失败', 'error')
    }
  }

  return (
    <div className="wa-slide-up rounded border bg-white p-2.5 shadow-sm" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagClass(card.tag)}`}>{card.tag}</span>
        {card.isFollowUp && <span className="rounded bg-black/5 px-1 py-0.5 text-[10px] wa-muted">追问</span>}
        {card.plainText && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">纯文本</span>}
        {card.modelLabel && (
          <span className="rounded bg-black/5 px-1 py-0.5 text-[10px] wa-muted">{card.modelLabel}</span>
        )}
      </div>

      <div className="mb-1 text-sm font-semibold leading-snug">{card.summary}</div>
      {card.detail && (
        <div className="mb-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-700">{card.detail}</div>
      )}
      {card.effect && <div className="mb-1.5 text-[11px] wa-muted">效果：{card.effect}</div>}

      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => void onInsert()}
          disabled={busy}
          className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 disabled:opacity-50"
        >
          插入
        </button>
        <button
          onClick={() => onFollowUp(card)}
          disabled={busy}
          className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-50"
        >
          追问
        </button>
        <button onClick={() => void onFavorite()} className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive">
          收藏
        </button>
        <button onClick={onRegenerate} className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive">
          重新生成
        </button>
        <div className="flex-1" />
        <button
          onClick={() => void onFeedback('up')}
          title="有用"
          className="rounded px-1 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
        >
          👍
        </button>
        <button
          onClick={() => void onFeedback('down')}
          title="无用"
          className="rounded px-1 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
        >
          👎
        </button>
      </div>

      {/* 阶段 8.5：AI 版权标注 */}
      <div className="mt-1.5 text-right text-[10px] wa-muted">{AI_NOTICE_SHORT}</div>
    </div>
  )
}
