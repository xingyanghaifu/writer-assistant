/**
 * 伏笔标签页（阶段 6，子智能体 C）。
 *
 * 功能：
 *  - 从正文选中文字标记伏笔（读取当前焦点元素的选区，兼容 textarea 与 contentEditable）
 *  - 手写伏笔内容 / 类型 / 关联对象，保存进列表
 *  - 展示全部伏笔，**未回收的高亮显示**
 *  - 标记回收、关联到已有伏笔（匹配失败时手动关联）、跳转到埋设/回收章节
 *  - 阶段 5.6：单章同步分析自动补全伏笔
 */
import { useEffect, useMemo, useState } from 'react'
import type { Foreshadowing, ForeshadowingType } from '@shared/material'
import { SYNC_MIN_CHARS, jumpToChapter, useMaterialStore } from '../../store/material'
import { useUiStore } from '../../store/ui'
import { useWorkStore } from '../../store/work'
import { Empty } from './OutlineTab'
import { SyncUndoBar } from '../SyncConfirmDialog'

const TYPE_LABEL: Record<ForeshadowingType, string> = {
  plant: '埋设',
  recover: '回收',
  item: '物品',
  identity: '身份',
  event: '事件',
  other: '其他'
}

const TYPE_ORDER: ForeshadowingType[] = ['plant', 'recover', 'item', 'identity', 'event', 'other']

/**
 * 读取正文里当前选中的文字。
 * 优先使用当前焦点元素（草稿 textarea / 富文本编辑器），
 * 回退到页面级 Selection；只做读取，绝不修改正文。
 */
export function readDraftSelection(): string {
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (end > start) return el.value.slice(start, end)
  }
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return String(sel.toString())
  return ''
}

export function ForeshadowTab(): JSX.Element {
  const workId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)

  const foreshadowings = useMaterialStore((s) => s.foreshadowings)
  const chapters = useMaterialStore((s) => s.chapters)
  const syncBusy = useMaterialStore((s) => s.syncBusy)

  const [filter, setFilter] = useState<'all' | 'planted' | 'recovered'>('all')
  const [content, setContent] = useState('')
  const [type, setType] = useState<ForeshadowingType>('plant')
  const [relatedTo, setRelatedTo] = useState('')
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    void useMaterialStore.getState().setWork(workId)
  }, [workId])

  /** 同步分析有 200 字门槛，不足时静默跳过 —— 提前显示原因，避免"点了没反应" */
  const currentChapterLen = useMemo(() => {
    if (!currentChapterId) return null
    const c = chapters.find((x) => x.id === currentChapterId)
    if (!c) return null
    return String(c.content ?? '').replace(/\s/g, '').length
  }, [chapters, currentChapterId])

  const tooShort = currentChapterLen !== null && currentChapterLen < SYNC_MIN_CHARS

  const chapterTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of chapters) map.set(c.id, c.title || '未命名章节')
    return map
  }, [chapters])

  const plantedCount = foreshadowings.filter((f) => f.status === 'planted').length

  const filtered = useMemo(() => {
    if (filter === 'all') return foreshadowings
    return foreshadowings.filter((f) => f.status === filter)
  }, [foreshadowings, filter])

  if (!workId) return <Empty text="请先在「草稿」标签页创建或选择作品" />

  async function submit(): Promise<void> {
    const text = content.trim()
    if (!text) return
    await useMaterialStore.getState().saveForeshadowing({
      content: text,
      type,
      status: type === 'recover' ? 'recovered' : 'planted',
      chapterId: currentChapterId ?? undefined,
      recoveredChapterId: type === 'recover' ? currentChapterId ?? undefined : undefined,
      relatedTo: relatedTo.trim() || undefined
    })
    setContent('')
    setRelatedTo('')
    setType('plant')
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 space-y-1 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded border p-0.5" style={{ borderColor: 'var(--wa-border)' }}>
            {(
              [
                ['all', `全部 ${foreshadowings.length}`],
                ['planted', `未回收 ${plantedCount}`],
                ['recovered', '已回收']
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded px-1.5 py-0.5 text-[11px] ${filter === k ? 'bg-black/10 font-medium' : 'hover:bg-black/5'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            title={
              !currentChapterId
                ? '请先选择一章，同步分析需要针对具体章节'
                : tooShort
                  ? `本章仅 ${currentChapterLen} 字，不足 ${SYNC_MIN_CHARS} 字，无法分析`
                  : '对当前章节执行同步分析（阶段 5.6）'
            }
            disabled={syncBusy}
            onClick={() => {
              // 与「角色」页同样的问题：disabled 会让用户以为功能坏了
              if (!currentChapterId) {
                useUiStore.getState().showToast('请先选择一章，再执行同步分析', 'info')
                return
              }
              if (tooShort) {
                useUiStore
                  .getState()
                  .showToast(
                    `本章仅 ${currentChapterLen} 字，不足 ${SYNC_MIN_CHARS} 字，请换一章或先补充正文`,
                    'error'
                  )
                return
              }
              void useMaterialStore.getState().runSync(currentChapterId)
            }}
            className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 ${
              currentChapterId && !tooShort ? '' : 'opacity-60'
            }`}
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {syncBusy ? '分析中…' : '同步分析'}
          </button>
        </div>

        {tooShort && (
          <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800">
            当前章节仅 {currentChapterLen} 字，不足 {SYNC_MIN_CHARS} 字，无法同步分析。
          </p>
        )}

        {plantedCount > 0 && (
          <p className="text-[10px] text-amber-700">⚠ 有 {plantedCount} 条伏笔尚未回收（下方高亮显示）</p>
        )}
      </div>

      {/* 标记表单 */}
      <div className="shrink-0 border-b px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
        <div className="mb-1 flex items-center gap-1">
          <span className="text-[10px] wa-muted">伏笔内容</span>
          <button
            onClick={() => setContent(readDraftSelection())}
            className="ml-auto rounded border px-1.5 py-px text-[10px] hover:bg-black/5"
            style={{ borderColor: 'var(--wa-border)' }}
            title="读取正文中当前选中的文字"
          >
            读取选中文字
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="在正文中选中文字后点「读取选中文字」，或直接输入伏笔描述"
          className="mb-1 w-full resize-none rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
          style={{ borderColor: 'var(--wa-border)' }}
        />
        <div className="mb-1.5 flex items-center gap-1">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ForeshadowingType)}
            className="rounded border bg-white px-1 py-0.5 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            value={relatedTo}
            onChange={(e) => setRelatedTo(e.target.value)}
            placeholder="关联对象（角色/地点/物品）"
            className="min-w-0 flex-1 rounded border bg-white px-1.5 py-0.5 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <button
            onClick={() => void submit()}
            disabled={!content.trim()}
            className="shrink-0 rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 disabled:opacity-40"
          >
            标记
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <Empty
            text={
              foreshadowings.length === 0
                ? '还没有伏笔。在正文里选中线索文字，标记为伏笔。'
                : '该分类下没有伏笔'
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((f) => (
              <ForeshadowItem
                key={f.id}
                item={f}
                chapterTitle={chapterTitle}
                linking={linking === f.id}
                planted={foreshadowings.filter((x) => x.status === 'planted' && x.id !== f.id)}
                onToggleLink={() => setLinking(linking === f.id ? null : f.id)}
                currentChapterId={currentChapterId}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t px-2 py-1 text-[10px] wa-muted">
        共 {foreshadowings.length} 条 · 未回收 {plantedCount} 条
      </div>

      <SyncUndoBar />
    </div>
  )
}

// ------------------------------------------------------------------ 单条伏笔

function ForeshadowItem({
  item,
  chapterTitle,
  linking,
  planted,
  onToggleLink,
  currentChapterId
}: {
  item: Foreshadowing
  chapterTitle: Map<string, string>
  linking: boolean
  planted: Foreshadowing[]
  onToggleLink: () => void
  currentChapterId: string | null
}): JSX.Element {
  const unrecovered = item.status === 'planted'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.content)

  async function saveText(): Promise<void> {
    const v = text.trim()
    setEditing(false)
    if (!v || v === item.content) return
    await useMaterialStore.getState().saveForeshadowing({ ...item, content: v, id: item.id })
  }

  return (
    <li
      className="rounded border px-2 py-1.5"
      style={{
        borderColor: unrecovered ? '#d9a441' : 'var(--wa-border)',
        background: unrecovered ? 'rgba(217,164,65,0.08)' : 'transparent'
      }}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void saveText()}
              rows={2}
              className="mb-1 w-full resize-none rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
              style={{ borderColor: 'var(--wa-border)' }}
            />
          ) : (
            <p
              className="cursor-text text-[11px] font-medium"
              onDoubleClick={() => setEditing(true)}
              title="双击编辑"
            >
              {item.content}
            </p>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
            <span
              className="rounded px-1 py-px"
              style={{
                background: unrecovered ? 'rgba(217,164,65,0.25)' : 'rgba(0,0,0,0.06)'
              }}
            >
              {TYPE_LABEL[item.type]}
            </span>
            <span className="rounded px-1 py-px" style={{ background: 'rgba(0,0,0,0.06)' }}>
              {unrecovered ? '未回收' : '已回收'}
            </span>
            {item.relatedTo && <span className="wa-muted">关联：{item.relatedTo}</span>}
          </div>

          {/* 章节跳转 */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.chapterId && (
              <button
                onClick={() => void jumpToChapter(item.chapterId!)}
                className="max-w-[140px] truncate rounded border px-1.5 py-px text-[10px] hover:bg-black/5"
                style={{ borderColor: 'var(--wa-border)' }}
                title="跳转到埋设章节"
              >
                埋设：{chapterTitle.get(item.chapterId) ?? '未知'}
              </button>
            )}
            {item.recoveredChapterId && (
              <button
                onClick={() => void jumpToChapter(item.recoveredChapterId!)}
                className="max-w-[140px] truncate rounded border px-1.5 py-px text-[10px] hover:bg-black/5"
                style={{ borderColor: 'var(--wa-border)' }}
                title="跳转到回收章节"
              >
                回收：{chapterTitle.get(item.recoveredChapterId) ?? '未知'}
              </button>
            )}
          </div>
        </div>

        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {unrecovered ? (
            <>
              <button
                onClick={() =>
                  void useMaterialStore.getState().recoverForeshadowing(item.id, currentChapterId ?? undefined)
                }
                className="rounded border px-1.5 py-px text-[10px] hover:bg-black/10"
                style={{ borderColor: '#d9a441' }}
                title="把当前章节标记为回收章节"
              >
                标记回收
              </button>
              <button
                onClick={onToggleLink}
                className="rounded px-1 py-px text-[10px] hover:bg-black/10"
                title="关联到另一条伏笔"
              >
                {linking ? '取消' : '关联'}
              </button>
            </>
          ) : (
            <button
              onClick={() =>
                void useMaterialStore.getState().saveForeshadowing({
                  ...item,
                  id: item.id,
                  status: 'planted',
                  type: 'plant',
                  recoveredChapterId: undefined
                })
              }
              className="rounded px-1 py-px text-[10px] hover:bg-black/10"
              title="撤销回收标记"
            >
              撤销回收
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm('删除该伏笔？')) void useMaterialStore.getState().deleteForeshadowing(item.id)
            }}
            className="rounded px-1 py-px text-[10px] hover:bg-black/10"
          >
            删除
          </button>
        </span>
      </div>

      {/* 手动关联 */}
      {linking && (
        <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: 'var(--wa-border)' }}>
          <p className="mb-1 text-[10px] wa-muted">把「{item.content.slice(0, 16)}」关联为以下伏笔的回收：</p>
          {planted.length === 0 ? (
            <p className="text-[11px] wa-muted">没有其他未回收伏笔可关联</p>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {planted.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={async () => {
                      await useMaterialStore.getState().linkForeshadowing(item.id, p.id)
                      onToggleLink()
                    }}
                    className="w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:bg-black/10"
                    title={p.content}
                  >
                    {p.content.slice(0, 40)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
