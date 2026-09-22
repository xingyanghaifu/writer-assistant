/**
 * 大纲标签页（阶段 6，子智能体 C）。
 *
 * 功能：
 *  - 树形展示 总纲 → 分卷 → 章纲，可展开/折叠
 *  - 点击章纲跳转到对应章节正文
 *  - 原生 HTML5 拖拽调整顺序 / 层级（不引入任何拖拽库）
 *  - 就地编辑标题、摘要、关键事件、结尾钩子
 *  - 阶段 5.5 单章摘要生成 + 批量摘要（带进度）
 *  - 阶段 5.6 单章同步分析（按设置的模式落地）
 */
import { useEffect, useMemo, useState } from 'react'
import type { Outline } from '@shared/material'
import {
  bookSummaries,
  flattenOutline,
  jumpToChapter,
  useMaterialStore
} from '../../store/material'
import { useWorkStore } from '../../store/work'
import { SyncUndoBar } from '../SyncConfirmDialog'

type DropPosition = 'before' | 'after' | 'inside'

export function OutlineTab(): JSX.Element {
  const workId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)

  const outlines = useMaterialStore((s) => s.outlines)
  const chapters = useMaterialStore((s) => s.chapters)
  const expanded = useMaterialStore((s) => s.expandedOutline)
  const summaryBusy = useMaterialStore((s) => s.summaryBusy)
  const batchProgress = useMaterialStore((s) => s.batchProgress)
  const syncBusy = useMaterialStore((s) => s.syncBusy)

  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<'tree' | 'summary'>('tree')

  // 作品切换时加载素材
  useEffect(() => {
    void useMaterialStore.getState().setWork(workId)
    return () => useMaterialStore.getState().cancelAutoSummary()
  }, [workId])

  const summaries = useMemo(() => bookSummaries({ outlines, chapters }), [outlines, chapters])
  const missingSummary = summaries.filter((s) => !s.hasSummary).length

  if (!workId) {
    return <Empty text="请先在「草稿」标签页创建或选择作品" />
  }

  // ---------------------------------------------------------------- 拖拽

  function onDragStart(e: React.DragEvent, id: string): void {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // 部分环境需要设置数据才会触发 drop
    e.dataTransfer.setData('text/plain', id)
  }

  function onDragOver(e: React.DragEvent, id: string): void {
    if (!dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    // 上下 25% 为同级前/后插入，中间 50% 为变为子节点
    const position: DropPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
    setDropTarget({ id, position })
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    const target = dropTarget
    const source = dragId
    setDragId(null)
    setDropTarget(null)
    if (!source || !target || source === target.id) return
    await useMaterialStore.getState().moveOutlineNode(source, target.id, target.position)
  }

  // ---------------------------------------------------------------- 渲染

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <button
          onClick={() => void useMaterialStore.getState().addOutlineNode('master', null)}
          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          + 总纲
        </button>
        <button
          onClick={() => void useMaterialStore.getState().addOutlineNode('volume', null)}
          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          + 分卷
        </button>
        <div className="ml-auto flex items-center gap-0.5 rounded border p-0.5" style={{ borderColor: 'var(--wa-border)' }}>
          <button
            onClick={() => setView('tree')}
            className={`rounded px-1.5 py-0.5 text-[11px] ${view === 'tree' ? 'bg-black/10 font-medium' : 'hover:bg-black/5'}`}
          >
            大纲树
          </button>
          <button
            onClick={() => setView('summary')}
            className={`rounded px-1.5 py-0.5 text-[11px] ${view === 'summary' ? 'bg-black/10 font-medium' : 'hover:bg-black/5'}`}
          >
            章节摘要{missingSummary > 0 ? ` (${missingSummary} 待生成)` : ''}
          </button>
        </div>
      </div>

      {/* 批量进度 */}
      {batchProgress && (
        <div className="shrink-0 border-b px-2 py-1.5 text-[11px]">
          <div className="mb-1 flex justify-between wa-muted">
            <span>{batchProgress.label}</span>
            <span>
              {batchProgress.current}/{batchProgress.total}
            </span>
          </div>
          <ProgressBar value={batchProgress.current} total={batchProgress.total} />
        </div>
      )}

      {/* 正文区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {view === 'tree' ? (
          outlines.length === 0 ? (
            <Empty text="还没有大纲。点击上方「+ 总纲」开始，或在「草稿」中生成章节后回来。" />
          ) : (
            <ul className="space-y-0.5">
              {outlines.map((n) => (
                <OutlineNode
                  key={n.id}
                  node={n}
                  depth={0}
                  currentChapterId={currentChapterId}
                  expanded={expanded}
                  dragId={dragId}
                  dropTarget={dropTarget}
                  editingId={editingId}
                  summaryBusy={summaryBusy}
                  syncBusy={syncBusy}
                  onToggle={(id) => useMaterialStore.getState().toggleOutlineExpanded(id)}
                  onEdit={setEditingId}
                  onJump={(chapterId) => void jumpToChapter(chapterId)}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropTarget(null)
                  }}
                />
              ))}
            </ul>
          )
        ) : (
          <ul className="space-y-1.5">
            {summaries.map((s) => (
              <li
                key={s.chapterId}
                className="rounded border px-2 py-1.5"
                style={{
                  borderColor: s.chapterId === currentChapterId ? 'var(--wa-muted)' : 'var(--wa-border)'
                }}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void jumpToChapter(s.chapterId)}
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
                    title="跳转到该章节"
                  >
                    {s.title}
                  </button>
                  <button
                    onClick={() => void useMaterialStore.getState().generateSummary(s.chapterId)}
                    disabled={summaryBusy.includes(s.chapterId)}
                    className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    {summaryBusy.includes(s.chapterId) ? '生成中…' : s.hasSummary ? '重新生成' : '生成摘要'}
                  </button>
                  <button
                    title="让 AI 生成完整章纲：摘要 + 关键事件 + 出场角色 + 转折 + 结尾钩子"
                    onClick={() => void useMaterialStore.getState().generateChapterOutline(s.chapterId)}
                    disabled={syncBusy}
                    className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    {syncBusy ? '…' : '⚡ 章纲'}
                  </button>
                </div>
                <p className={`mt-0.5 text-[11px] ${s.hasSummary ? '' : 'wa-muted'}`}>
                  {s.hasSummary ? s.summary : '（暂无摘要）'}
                </p>
              </li>
            ))}
            {summaries.length === 0 && <Empty text="还没有章节" />}
          </ul>
        )}
      </div>

      {/* 批量操作 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1.5">
        <button
          title="为当前章节生成完整章纲（摘要 / 关键事件 / 出场角色 / 转折 / 结尾钩子），并写入大纲与本章信息"
          disabled={syncBusy || !currentChapterId}
          onClick={() =>
            currentChapterId &&
            void useMaterialStore.getState().generateChapterOutline(currentChapterId)
          }
          className="rounded border px-2 py-0.5 text-[11px] font-medium hover:bg-black/5 disabled:opacity-40"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          {syncBusy ? '生成中…' : '⚡ 一键生成章纲'}
        </button>
        <button
          disabled={Boolean(batchProgress) || summaries.length === 0}
          onClick={() =>
            void useMaterialStore
              .getState()
              .generateSummaryBatch(summaries.filter((s) => !s.hasSummary).map((s) => s.chapterId))
          }
          className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          批量生成摘要
        </button>
        <button
          disabled={Boolean(batchProgress) || summaries.length === 0}
          onClick={() =>
            void useMaterialStore.getState().runSyncBatch(
              summaries.filter((s) => s.hasSummary).map((s) => s.chapterId).slice(0, 20)
            )
          }
          className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          批量同步分析（前 20 章）
        </button>
      </div>

      <SyncUndoBar />
    </div>
  )
}

// ------------------------------------------------------------------ 树节点

interface NodeProps {
  node: Outline
  depth: number
  currentChapterId: string | null
  expanded: string[]
  dragId: string | null
  dropTarget: { id: string; position: DropPosition } | null
  editingId: string | null
  summaryBusy: string[]
  syncBusy: boolean
  onToggle: (id: string) => void
  onEdit: (id: string | null) => void
  onJump: (chapterId: string) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string) => void
  onDrop: (e: React.DragEvent) => Promise<void>
  onDragEnd: () => void
}

const LEVEL_META: Record<Outline['level'], { label: string; icon: string; indent: number }> = {
  master: { label: '总纲', icon: '📕', indent: 0 },
  volume: { label: '分卷', icon: '📂', indent: 10 },
  chapter: { label: '章纲', icon: '📄', indent: 20 }
}

function OutlineNode(props: NodeProps): JSX.Element {
  const { node, depth, expanded, dragId, dropTarget, currentChapterId } = props
  const isOpen = expanded.includes(node.id)
  const hasChildren = (node.children ?? []).length > 0
  const meta = LEVEL_META[node.level]
  const isDropTarget = dropTarget?.id === node.id
  const isActive = Boolean(node.chapterId && node.chapterId === currentChapterId)

  return (
    <li>
      <div
        draggable
        onDragStart={(e) => props.onDragStart(e, node.id)}
        onDragOver={(e) => props.onDragOver(e, node.id)}
        onDrop={(e) => void props.onDrop(e)}
        onDragEnd={props.onDragEnd}
        className="group relative rounded px-1.5 py-1 hover:bg-black/5"
        style={{
          marginLeft: meta.indent + depth * 10,
          background: isActive ? 'rgba(0,0,0,0.06)' : undefined,
          outline: isDropTarget ? '1px dashed var(--wa-muted)' : undefined,
          opacity: dragId === node.id ? 0.4 : 1
        }}
      >
        {/* 插入位置指示线 */}
        {isDropTarget && dropTarget?.position === 'before' && (
          <span className="absolute left-1 right-1 -top-px border-t-2 border-ink-600" />
        )}
        {isDropTarget && dropTarget?.position === 'after' && (
          <span className="absolute left-1 right-1 -bottom-px border-b-2 border-ink-600" />
        )}

        <div className="flex items-center gap-1">
          {/* 展开箭头 */}
          <button
            onClick={() => props.onToggle(node.id)}
            className={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] ${hasChildren ? 'hover:bg-black/10' : 'opacity-0'}`}
            title={hasChildren ? (isOpen ? '折叠' : '展开') : ''}
          >
            {isOpen ? '▼' : '▶'}
          </button>

          <span className="shrink-0 text-[11px]" title={meta.label}>
            {meta.icon}
          </span>

          {props.editingId === node.id ? (
            <input
              autoFocus
              defaultValue={node.title}
              onBlur={(e) => {
                void useMaterialStore.getState().updateOutlineNode(node.id, { title: e.target.value.trim() || node.title })
                props.onEdit(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') props.onEdit(null)
              }}
              className="min-w-0 flex-1 rounded border bg-white px-1 py-0.5 text-xs outline-none"
              style={{ borderColor: 'var(--wa-border)' }}
            />
          ) : (
            <button
              onDoubleClick={() => props.onEdit(node.id)}
              onClick={() => {
                if (node.chapterId) props.onJump(node.chapterId)
                else props.onToggle(node.id)
              }}
              className="min-w-0 flex-1 truncate text-left text-xs"
              title={node.chapterId ? '点击跳转到该章节，双击重命名' : '双击重命名'}
            >
              {node.title || '未命名'}
              {node.level === 'chapter' && !node.chapterSummary && (
                <span className="ml-1 text-[10px] wa-muted">无摘要</span>
              )}
            </button>
          )}

          {/* 节点操作 */}
          <NodeActions node={node} summaryBusy={props.summaryBusy} syncBusy={props.syncBusy} />
        </div>

        {/* 章纲详情（展开或选中时） */}
        {node.level === 'chapter' && (isOpen || isActive) && (
          <div className="mt-1 pl-5">
            {node.chapterSummary && <p className="mb-0.5 text-[11px]">{node.chapterSummary}</p>}
            {node.keyEvents.length > 0 && (
              <p className="text-[11px] wa-muted">关键事件：{node.keyEvents.join('；')}</p>
            )}
            {node.endingHook && <p className="text-[11px] wa-muted">结尾钩子：{node.endingHook}</p>}
            {node.characters.length > 0 && (
              <p className="text-[11px] wa-muted">出场：{node.characters.join('、')}</p>
            )}
          </div>
        )}

        {node.level !== 'chapter' && (node.chapterSummary || node.turningPoint) && isOpen && (
          <div className="mt-1 pl-5">
            {node.chapterSummary && <p className="text-[11px] wa-muted">{node.chapterSummary}</p>}
            {node.turningPoint && <p className="text-[11px] wa-muted">核心转折：{node.turningPoint}</p>}
          </div>
        )}
      </div>

      {isOpen &&
        (node.children ?? []).map((c) => (
          <OutlineNode {...props} key={c.id} node={c} depth={depth + 1} />
        ))}
    </li>
  )
}

function NodeActions({
  node,
  summaryBusy,
  syncBusy
}: {
  node: Outline
  summaryBusy: string[]
  syncBusy: boolean
}): JSX.Element {
  const busy = node.chapterId ? summaryBusy.includes(node.chapterId) : false
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      {node.chapterId && (
        <>
          <button
            title="生成摘要（阶段 5.5）"
            disabled={busy}
            onClick={() => void useMaterialStore.getState().generateSummary(node.chapterId!)}
            className="rounded px-1 py-px text-[10px] hover:bg-black/10 disabled:opacity-40"
          >
            {busy ? '…' : '摘要'}
          </button>
          <button
            title="同步分析本章素材（阶段 5.6）"
            disabled={syncBusy}
            onClick={() => void useMaterialStore.getState().runSync(node.chapterId!)}
            className="rounded px-1 py-px text-[10px] hover:bg-black/10 disabled:opacity-40"
          >
            同步
          </button>
        </>
      )}
      <button
        title="添加子节点"
        onClick={() =>
          void useMaterialStore
            .getState()
            .addOutlineNode(node.level === 'master' ? 'volume' : 'chapter', node.id)
        }
        className="rounded px-1 py-px text-[10px] hover:bg-black/10"
      >
        ＋
      </button>
      <button
        title="删除该节点及其子节点"
        onClick={() => {
          if (window.confirm(`删除「${node.title}」及其子节点？`)) {
            void useMaterialStore.getState().removeOutlineNode(node.id)
          }
        }}
        className="rounded px-1 py-px text-[10px] hover:bg-black/10"
      >
        ✕
      </button>
    </span>
  )
}

// ------------------------------------------------------------------ 小组件

export function ProgressBar({ value, total }: { value: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--wa-border)' }}>
      <div className="h-full rounded-full bg-ink-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Empty({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <span className="text-lg">🗂</span>
      <p className="text-[11px] wa-muted">{text}</p>
    </div>
  )
}

export { flattenOutline }
