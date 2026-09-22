import { useEffect, useMemo, useState } from 'react'
import { useMaterialStore } from '../../store/material'
import { useUiStore } from '../../store/ui'

/**
 * 便签标签页（阶段 6）。
 *
 * 支持：新建、编辑、置顶、删除、搜索、拖拽到草稿（HTML5 拖拽）。
 * 便签只承载灵感碎片，不直接写入正文 —— 由草稿页消费拖拽内容。
 */
export function NoteTab({
  onOpenInspiration
}: {
  /** 打开灵感库（便签模块内的功能入口） */
  onOpenInspiration?: () => void
} = {}): JSX.Element {
  const notes = useMaterialStore((s) => s.notes)
  const workId = useMaterialStore((s) => s.workId)
  const addNote = useMaterialStore((s) => s.addNote)
  const updateNote = useMaterialStore((s) => s.updateNote)
  const deleteNote = useMaterialStore((s) => s.deleteNote)
  const toggleNotePinned = useMaterialStore((s) => s.toggleNotePinned)
  const setDraggingNote = useMaterialStore((s) => s.setDraggingNote)
  const showToast = useUiStore((s) => s.showToast)

  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  // 排序：置顶优先，其次按更新时间倒序
  const sorted = useMemo(() => {
    const q = query.trim()
    const list = q ? notes.filter((n) => n.content.includes(q)) : notes
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [notes, query])

  useEffect(() => {
    if (!workId) return
    // 便签与作品绑定，切换作品时清空编辑态
    setEditingId(null)
  }, [workId])

  async function submit(): Promise<void> {
    const t = text.trim()
    if (!t) return
    await addNote(t)
    setText('')
    showToast('便签已添加', 'success')
  }

  if (!workId) {
    return <div className="p-4 text-xs wa-muted">请先创建或选择一部作品</div>
  }

  return (
    <div className="flex h-full flex-col text-xs">
      {/* 新建 */}
      <div className="shrink-0 border-b p-2" style={{ borderColor: 'var(--wa-border)' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="记下灵感碎片…（Ctrl+Enter 保存）"
          rows={3}
          className="w-full resize-none rounded border bg-white px-2 py-1 outline-none"
          style={{ borderColor: 'var(--wa-border)' }}
        />
        <div className="mt-1 flex items-center gap-1">
          <button onClick={() => void submit()} disabled={!text.trim()} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-40">
            添加
          </button>
          {onOpenInspiration && (
            <button
              onClick={onOpenInspiration}
              title="让 AI 围绕当前章节发散点子"
              className="rounded px-2 py-0.5 text-amber-700 hover:bg-amber-50"
              style={{ border: '1px solid rgba(245,158,11,0.4)' }}
            >
              ✨ 找灵感
            </button>
          )}
          <div className="flex-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索"
            className="w-24 rounded border px-1.5 py-0.5 outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <div className="py-6 text-center wa-muted">{query ? '没有匹配的便签' : '还没有便签'}</div>
        ) : (
          <ul className="space-y-1.5">
            {sorted.map((n) => (
              <li
                key={n.id}
                draggable={editingId !== n.id}
                onDragStart={(e) => {
                  setDraggingNote(n.id)
                  e.dataTransfer.setData('text/plain', n.content)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => setDraggingNote(null)}
                className="group cursor-grab rounded border p-1.5 active:cursor-grabbing"
                style={{
                  borderColor: n.pinned ? 'var(--wa-accent, #f59e0b)' : 'var(--wa-border)',
                  background: n.pinned ? 'rgba(245,158,11,0.06)' : undefined
                }}
                title="可拖拽到草稿区插入"
              >
                {editingId === n.id ? (
                  <>
                    <textarea
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded border bg-white px-1.5 py-1 outline-none"
                      style={{ borderColor: 'var(--wa-border)' }}
                    />
                    <div className="mt-1 flex gap-1">
                      <button
                        onClick={() => {
                          void updateNote(n.id, { content: editingText })
                          setEditingId(null)
                        }}
                        className="rounded bg-ink-800 px-1.5 py-0.5 text-white"
                      >
                        保存
                      </button>
                      <button onClick={() => setEditingId(null)} className="rounded px-1.5 py-0.5 hover:bg-black/5">
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{n.content}</span>
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          title={n.pinned ? '取消置顶' : '置顶'}
                          onClick={() => void toggleNotePinned(n.id)}
                          className="rounded px-1 hover:bg-black/10"
                        >
                          {n.pinned ? '📌' : '📍'}
                        </button>
                        <button
                          title="编辑"
                          onClick={() => {
                            setEditingId(n.id)
                            setEditingText(n.content)
                          }}
                          className="rounded px-1 hover:bg-black/10"
                        >
                          ✏️
                        </button>
                        <button
                          title="删除"
                          onClick={() => {
                            if (window.confirm('删除这条便签？')) void deleteNote(n.id)
                          }}
                          className="rounded px-1 hover:bg-black/10"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    <div className="mt-0.5 text-[10px] wa-muted">
                      {new Date(n.updatedAt).toLocaleString()}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
