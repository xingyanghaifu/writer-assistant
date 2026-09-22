import { useMemo, useState } from 'react'
import type { PromptTemplate } from '@shared/suggestion'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'
import { useMaterialStore } from '../store/material'
import { useEditorStore } from '../store/editor'
import { getInspirationPrompts, render } from '@shared/prompts'
import { requestRaw } from '../services/suggest'

/** 单条灵感（AI 返回的 JSON 结构） */
interface Idea {
  title: string
  hook: string
  how: string
  impact: string
  feasibility?: string
}

/** 把 AI 回复解析成灵感列表；解析失败时降级为整段文本 */
function parseIdeas(text: string): { ideas: Idea[]; plain: string | null } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { ideas?: Idea[] }
      if (Array.isArray(obj.ideas) && obj.ideas.length) {
        return {
          ideas: obj.ideas.map((i) => ({
            title: String(i.title ?? ''),
            hook: String(i.hook ?? ''),
            how: String(i.how ?? ''),
            impact: String(i.impact ?? ''),
            feasibility: i.feasibility ? String(i.feasibility) : undefined
          })),
          plain: null
        }
      }
    } catch {
      /* 落到降级分支 */
    }
  }
  return { ideas: [], plain: text.trim() || null }
}

/**
 * 灵感库面板（多分类创意生成）。
 *
 * 与"润色/扩写"等改写类功能不同：这里**不改动正文**，
 * 只围绕当前章节发散点子；采纳后写入便签，由用户自己决定是否使用。
 *
 * 分类来自 DEFAULT_PROMPTS 中 task==='inspiration' 的模板，
 * 用户可在「设置 → 提示词」中自定义每一个分类的提问方式。
 */
export function InspirationPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const siteId = useUiStore((s) => s.siteId)
  const draft = useWorkStore((s) => s.draft)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)
  const works = useWorkStore((s) => s.works)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const addNote = useMaterialStore((s) => s.addNote)
  const characters = useMaterialStore((s) => s.characters)
  const foreshadowings = useMaterialStore((s) => s.foreshadowings)
  const setCenterView = useEditorStore((s) => s.setCenterView)

  const templates = useMemo(() => getInspirationPrompts(), [])
  const [activeId, setActiveId] = useState<string>(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<Idea[]>([])

  const active: PromptTemplate | undefined = templates.find((t) => t.id === activeId)
  const work = works.find((w) => w.id === currentWorkId)
  const chapter = work?.volumes.flatMap((v) => v.chapters).find((c) => c.id === currentChapterId)

  async function generate(): Promise<void> {
    if (!active) return
    if (draft.replace(/\s/g, '').length < 10) {
      showToast('草稿太短，先写几句再来找灵感', 'error')
      return
    }
    setBusy(true)
    setIdeas([])
    setRaw(null)
    try {
      const prompt = render(active.template, {
        draft: draft.slice(-3000),
        context: buildContext(),
        characters:
          characters.map((c) => `${c.name}：${c.intro || ''}`).join('\n') || '（暂无）',
        foreshadowings: foreshadowings.map((f) => f.content).join('\n') || '（暂无）',
        workTitle: work?.title ?? '',
        chapterTitle: chapter?.title ?? ''
      })
      const text = await requestRaw({ prompt, task: 'inspiration', siteId })
      if (!text) {
        showToast('未获得回复，请重试', 'error')
        return
      }
      const parsed = parseIdeas(text)
      setIdeas(parsed.ideas)
      setRaw(parsed.plain)
      if (parsed.plain) showToast('AI 未返回结构化结果，已按纯文本展示', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 拼装轻量上下文：作品名 + 章节摘要 + 大纲 */
  function buildContext(): string {
    const parts: string[] = []
    if (work) parts.push(`作品：${work.title}`)
    if (chapter?.summary) parts.push(`本章摘要：${chapter.summary}`)
    const outlines = useMaterialStore.getState().outlines
    if (outlines.length) {
      parts.push(
        '大纲：\n' +
          outlines
            .slice(0, 10)
            .map((o) => `- ${o.title}${o.chapterSummary ? `：${o.chapterSummary}` : ''}`)
            .join('\n')
      )
    }
    return parts.join('\n') || '（暂无）'
  }

  /** 采纳为便签（不直接改正文） */
  async function adoptAsNote(idea: Idea): Promise<void> {
    const body = [
      idea.hook && `【点子】${idea.hook}`,
      idea.how && `【展开】${idea.how}`,
      idea.impact && `【影响】${idea.impact}`,
      idea.feasibility && `【可行性】${idea.feasibility}`
    ]
      .filter(Boolean)
      .join('\n')
    await addNote(`[${active?.category ?? '灵感'}] ${idea.title}\n${body}`)
    showToast('已存入便签', 'success')
  }

  /** 全部采纳 */
  async function adoptAll(): Promise<void> {
    if (!ideas.length) return
    for (const i of ideas) await adoptAsNote(i)
    showToast(`已存入 ${ideas.length} 条便签`, 'success')
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="flex max-h-[92vh] w-[min(56rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">💡 灵感库</h2>
          <span className="wa-muted text-[11px]">
            围绕当前章节发散点子，不改动正文；采纳后存入便签
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧分类 */}
          <nav
            className="w-24 shrink-0 overflow-y-auto border-r p-1.5"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveId(t.id)
                  setIdeas([])
                  setRaw(null)
                }}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                  activeId === t.id ? 'bg-ink-800 text-white' : 'hover:bg-black/5'
                }`}
              >
                {t.category ?? t.name}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 flex-1 flex-col">
            {/* 操作区 */}
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              <span className="text-xs font-medium">{active?.name}</span>
              <div className="flex-1" />
              {ideas.length > 0 && (
                <button
                  onClick={() => void adoptAll()}
                  className="rounded px-2 py-1 text-[11px] hover:bg-black/5 wa-interactive"
                >
                  全部存入便签
                </button>
              )}
              <button
                onClick={() => void generate()}
                disabled={busy}
                className="rounded bg-ink-800 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                {busy ? '生成中…' : ideas.length || raw ? '再来一批' : '生成灵感'}
              </button>
            </div>

            {/* 结果区 */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs">
              {busy && (
                <div className="py-8 text-center wa-muted">
                  正在向 {siteId} 请求灵感…（首次可能需要 10-30 秒）
                </div>
              )}

              {!busy && !ideas.length && !raw && (
                <div className="py-8 text-center wa-muted">
                  选择左侧分类后点「生成灵感」。
                  <br />
                  当前章节正文将被作为依据，点子不会自动写入正文。
                </div>
              )}

              {ideas.map((idea, i) => (
                <div
                  key={i}
                  className="rounded border p-2.5"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] wa-muted">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {idea.title}
                        {idea.feasibility && (
                          <span className="ml-2 text-[10px] wa-muted">
                            可行性：{idea.feasibility}
                          </span>
                        )}
                      </div>
                      {idea.hook && <div className="mt-0.5">{idea.hook}</div>}
                      {idea.how && (
                        <div className="mt-1 leading-relaxed wa-muted">{idea.how}</div>
                      )}
                      {idea.impact && (
                        <div className="mt-1 text-[11px] wa-muted">→ {idea.impact}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => void adoptAsNote(idea)}
                      className="rounded px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                      style={{ border: '1px solid var(--wa-border)' }}
                    >
                      存入便签
                    </button>
                  </div>
                </div>
              ))}

              {raw && (
                <div
                  className="whitespace-pre-wrap rounded border p-2.5 leading-relaxed"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  {raw}
                </div>
              )}
            </div>

            <div
              className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-[11px] wa-muted"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              <span>依据：本章 {draft.replace(/\s/g, '').length} 字</span>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setCenterView('split')
                  onClose()
                }}
                className="hover:underline"
              >
                在「边写边看」中查看 AI 面板 →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
