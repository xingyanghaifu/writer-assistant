/**
 * 角色标签页（阶段 6，子智能体 C）。
 *
 * 功能：
 *  - 角色卡片：姓名 / 简介 / 标签，标签可编辑
 *  - 提及次数自动统计（由主进程按正文实时汇总，只读展示）
 *  - 点击卡片展开「出场章节」列表，点击章节可跳转
 *  - 手写新增 / 编辑 / 删除角色
 *  - 阶段 5.6：单章同步分析（把本章新角色并入素材库）
 */
import { useEffect, useMemo, useState } from 'react'
import type { Character } from '@shared/material'
import { SYNC_MIN_CHARS, jumpToChapter, useMaterialStore } from '../../store/material'
import { useUiStore } from '../../store/ui'
import { useWorkStore } from '../../store/work'
import { Empty, ProgressBar } from './OutlineTab'
import { SyncUndoBar } from '../SyncConfirmDialog'
import { CharacterGraph } from '../CharacterGraph'

export function CharacterTab(): JSX.Element {
  const workId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)

  const characters = useMaterialStore((s) => s.characters)
  const chapters = useMaterialStore((s) => s.chapters)
  const activeId = useMaterialStore((s) => s.activeCharacterId)
  const syncBusy = useMaterialStore((s) => s.syncBusy)
  const batchProgress = useMaterialStore((s) => s.batchProgress)

  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void useMaterialStore.getState().setWork(workId)
  }, [workId])

  /**
   * 当前章节的字数。
   *
   * ⚠️ 同步分析有 200 字门槛（SYNC_MIN_CHARS），不足时**直接静默返回**，
   * 用户看到的是"点了没反应 / 一直转圈"。
   * 实测：用户作品的第一章「前言」只有 13 字，
   * 若默认停在第一章，点「同步分析」永远没有任何反应。
   * 因此这里提前把门槛显示出来。
   */
  const currentChapterLen = useMemo(() => {
    if (!currentChapterId) return null
    const c = chapters.find((x) => x.id === currentChapterId)
    if (!c) return null
    return String(c.content ?? '').replace(/\s/g, '').length
  }, [chapters, currentChapterId])

  const tooShort = currentChapterLen !== null && currentChapterLen < SYNC_MIN_CHARS

  /** 全书正文总量，决定"一键建立画像"是否可用 */
  const totalChars = useMemo(
    () => chapters.reduce((s, c) => s + String(c.content ?? '').replace(/\s/g, '').length, 0),
    [chapters]
  )

  const [profiling, setProfiling] = useState(false)

  async function buildProfiles(): Promise<void> {
    setProfiling(true)
    try {
      await useMaterialStore.getState().buildCharacterProfiles({ maxChars: 12000 })
    } finally {
      setProfiling(false)
    }
  }

  /** 全部标签（用于筛选） */
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const c of characters) for (const t of c.tags) set.add(t)
    return Array.from(set).sort()
  }, [characters])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return characters.filter((c) => {
      if (tagFilter && !c.tags.includes(tagFilter)) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.intro.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [characters, query, tagFilter])

  const chapterTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of chapters) map.set(c.id, c.title || '未命名章节')
    return map
  }, [chapters])

  if (!workId) return <Empty text="请先在「草稿」标签页创建或选择作品" />

  return (
    <div className="flex h-full flex-col">
      {characters.length > 0 && (
        <div className="shrink-0 border-b p-2">
          <CharacterGraph
            characters={characters.map((c) => ({
              id: c.id,
              name: c.name,
              intro: c.intro,
              relationships: ((c as unknown as { relationships?: Array<{ targetId: string; relation: string }> }).relationships) ?? [],
              appearances: c.appearances ?? []
            }))}
            currentChapterId={currentChapterId ?? undefined}
            onSelect={(id) => useMaterialStore.getState().setActiveCharacter(id)}
            size={320}
          />
        </div>
      )}
      {/* 工具栏 */}
      <div className="shrink-0 space-y-1 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索姓名 / 简介 / 标签"
            className="min-w-0 flex-1 rounded border bg-white px-1.5 py-0.5 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <button
            onClick={() => setAdding((v) => !v)}
            className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {adding ? '收起' : '+ 角色'}
          </button>
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
              // ⚠️ 旧实现 disabled={!currentChapterId} 会让按钮"点了没反应"，
              // 用户以为是功能坏了。改为可点击 + 明确提示。
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
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 ${
              currentChapterId && !tooShort ? '' : 'opacity-60'
            }`}
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {syncBusy ? '分析中…' : '同步分析'}
          </button>
        </div>

        {/* 一键建立人物画像：跨章节归纳，不需要用户逐章点 */}
        <div className="flex items-center gap-1">
          <button
            title={
              totalChars === 0
                ? '当前作品还没有正文'
                : '让 AI 通读正文，自动归纳所有主要人物的画像（身份/性格/经历）'
            }
            disabled={profiling || syncBusy || totalChars === 0}
            onClick={() => void buildProfiles()}
            className="min-w-0 flex-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-50"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {profiling ? '⏳ AI 归纳中…' : '✨ AI 建立人物画像'}
          </button>
          {characters.length > 0 && (
            <button
              title="仅补充缺简介的角色，不新增"
              disabled={profiling || syncBusy}
              onClick={() => {
                setProfiling(true)
                void useMaterialStore
                  .getState()
                  .buildCharacterProfiles({ maxChars: 12000, onlyEmpty: true })
                  .finally(() => setProfiling(false))
              }}
              className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-50"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              仅补全
            </button>
          )}
        </div>
        <p className="text-[10px] wa-muted">
          画像基于前 {Math.min(totalChars, 12000).toLocaleString()} 字正文（共 {totalChars.toLocaleString()} 字），
          同名角色只扩充、不覆盖你手写的简介。
        </p>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setTagFilter('')}
              className={`rounded px-1.5 py-px text-[10px] ${tagFilter === '' ? 'bg-black/10 font-medium' : 'hover:bg-black/5'}`}
            >
              全部
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => setTagFilter(tagFilter === t ? '' : t)}
                className={`rounded px-1.5 py-px text-[10px] ${tagFilter === t ? 'bg-black/10 font-medium' : 'hover:bg-black/5'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 同步分析前置条件提示：不足 200 字时分析会静默跳过 */}
      {tooShort && (
        <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          当前章节「
          {chapters.find((c) => c.id === currentChapterId)?.title || '未命名'}」仅 {currentChapterLen} 字，
          不足 {SYNC_MIN_CHARS} 字，无法同步分析。请切换到字数更多的章节。
        </div>
      )}

      {batchProgress?.kind === 'sync' && (
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

      {adding && <NewCharacterForm onDone={() => setAdding(false)} />}

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <Empty text={characters.length === 0 ? '还没有角色。手写添加，或用「同步分析」从正文自动提取。' : '没有匹配的角色'} />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((c) => (
              <CharacterCard
                key={c.id}
                character={c}
                expanded={activeId === c.id}
                chapterTitle={chapterTitle}
                onToggle={() =>
                  useMaterialStore.getState().setActiveCharacter(activeId === c.id ? null : c.id)
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t px-2 py-1 text-[10px] wa-muted">
        共 {characters.length} 个角色 · 提及次数按正文实时统计
      </div>

      <SyncUndoBar />
    </div>
  )
}

// ------------------------------------------------------------------ 卡片

function CharacterCard({
  character,
  expanded,
  chapterTitle,
  onToggle
}: {
  character: Character
  expanded: boolean
  chapterTitle: Map<string, string>
  onToggle: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [intro, setIntro] = useState(character.intro)
  const [tagText, setTagText] = useState(character.tags.join('/'))

  const supplements = character.supplements ?? []

  async function save(): Promise<void> {
    const tags = tagText
      .split(/[/、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    await useMaterialStore.getState().saveCharacter({ id: character.id, name: character.name, intro, tags })
    setEditing(false)
  }

  return (
    <li className="rounded border" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left" title="点击查看出场章节">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold">{character.name}</span>
            <span
              className="shrink-0 rounded px-1 py-px text-[10px]"
              style={{ background: 'var(--wa-border)' }}
              title="累计提及次数"
            >
              {character.mentions}
            </span>
          </span>
          {!editing && character.intro && (
            <span className="mt-0.5 block text-[11px] wa-muted">{character.intro}</span>
          )}
          {!editing && character.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {character.tags.map((t) => (
                <span key={t} className="rounded px-1 py-px text-[10px]" style={{ background: 'rgba(0,0,0,0.06)' }}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </button>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded px-1 py-px text-[10px] hover:bg-black/10"
            title="编辑"
          >
            {editing ? '取消' : '编辑'}
          </button>
          <button
            onClick={() => {
              if (window.confirm(`删除角色「${character.name}」？`)) {
                void useMaterialStore.getState().deleteCharacter(character.id)
              }
            }}
            className="rounded px-1 py-px text-[10px] hover:bg-black/10"
            title="删除"
          >
            删除
          </button>
        </span>
      </div>

      {editing && (
        <div className="border-t px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
          <label className="mb-1 block text-[10px] wa-muted">简介</label>
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            className="mb-1.5 w-full resize-none rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <label className="mb-1 block text-[10px] wa-muted">标签（用 / 分隔）</label>
          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="主角/剑修"
            className="mb-1.5 w-full rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          />
          <div className="flex justify-end">
            <button
              onClick={() => void save()}
              className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
          <p className="mb-1 text-[10px] font-medium wa-muted">
            出场章节（{character.appearances.length}）
          </p>
          {character.appearances.length === 0 ? (
            <p className="text-[11px] wa-muted">暂无记录</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {character.appearances.map((cid) => (
                <button
                  key={cid}
                  onClick={() => void jumpToChapter(cid)}
                  className="max-w-full truncate rounded border px-1.5 py-px text-[10px] hover:bg-black/5"
                  style={{ borderColor: 'var(--wa-border)' }}
                  title="跳转到该章节"
                >
                  {chapterTitle.get(cid) ?? cid}
                </button>
              ))}
            </div>
          )}

          {supplements.length > 0 && (
            <>
              <p className="mb-1 mt-2 text-[10px] font-medium wa-muted">补充信息（自动同步追加）</p>
              <ul className="space-y-0.5">
                {supplements.map((s, i) => (
                  <li key={`${i}-${s.slice(0, 8)}`} className="text-[11px] wa-muted">
                    · {s}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  )
}

// ------------------------------------------------------------------ 新增

function NewCharacterForm({ onDone }: { onDone: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const [intro, setIntro] = useState('')
  const [tags, setTags] = useState('')

  async function submit(): Promise<void> {
    const n = name.trim()
    if (!n) return
    await useMaterialStore.getState().saveCharacter({
      name: n,
      intro: intro.trim(),
      tags: tags
        .split(/[/、,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    })
    setName('')
    setIntro('')
    setTags('')
    onDone()
  }

  return (
    <div className="shrink-0 border-b px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="角色名（必填）"
        className="mb-1 w-full rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        rows={2}
        placeholder="简介"
        className="mb-1 w-full resize-none rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="标签，用 / 分隔"
        className="mb-1.5 w-full rounded border bg-white px-1.5 py-1 text-[11px] outline-none"
        style={{ borderColor: 'var(--wa-border)' }}
      />
      <div className="flex justify-end gap-1">
        <button onClick={onDone} className="rounded px-2 py-0.5 text-[11px] hover:bg-black/5">
          取消
        </button>
        <button
          onClick={() => void submit()}
          disabled={!name.trim()}
          className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </div>
  )
}
