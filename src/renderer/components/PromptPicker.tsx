import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BUILTIN_VARS, renderTemplate, type PromptItem } from '@shared/promptLibrary'

/**
 * 提示词选择器：在气泡菜单点「选择提示词」后弹出。
 *
 * 设计目标：
 *  - 三步：选择提示词 → 填变量 → 预览最终提示词 → 确认
 *  - 变量缺失时弹窗不阻塞，可一键补全
 *  - 操作历史：上次选择的提示词 id 记录在 component state，启动时拉列表
 */
export interface PromptPickerProps {
  open: boolean
  onClose: () => void
  /** 已知的变量值（外部传入：text/content/question/chapterSummary/characters 等） */
  presetVars: Record<string, string>
  /** 默认按当前气泡 actionType 过滤 */
  initialActionType?: string
  /** 用户点「使用」后回调，参数：最终提示词 + 提示词 id */
  onConfirm: (finalPrompt: string, item: PromptItem) => void
}

export function PromptPicker(props: PromptPickerProps): JSX.Element | null {
  const { open, onClose, presetVars, onConfirm, initialActionType } = props
  const [items, setItems] = useState<PromptItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vars, setVars] = useState<Record<string, string>>(presetVars)
  const [rendered, setRendered] = useState<{ text: string; missing: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 就地编辑：直接改提示词正文，不必去提示词库 */
  const [editOpen, setEditOpen] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saveToLib, setSaveToLib] = useState(false)

  useEffect(() => {
    if (!open) return
    setVars(presetVars)
    let cancelled = false
    void window.api.promptLibrary.list().then((list) => {
      if (cancelled) return
      const enabled = list.filter((x) => x.enabled)
      // 与当前动作同类的排前面，方便直接用
      const matched = initialActionType
        ? enabled.filter((x) => x.actionType === initialActionType)
        : []
      const rest = initialActionType
        ? enabled.filter((x) => x.actionType !== initialActionType)
        : enabled
      const filtered = [...matched, ...rest]
      setItems(filtered)
      setSelectedId((prev) => {
        if (prev && matched.some((x) => x.id === prev)) return prev
        if (matched[0]) return matched[0].id
        if (prev && filtered.some((x) => x.id === prev)) return prev
        return filtered[0]?.id ?? null
      })
    })
    return () => {
      cancelled = true
    }
    // presetVars 每次父组件渲染都是新对象，不能当依赖，否则会把刚选的项打回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialActionType])

  const selected = useMemo(() => items.find((x) => x.id === selectedId) ?? null, [items, selectedId])

  // 切换选中项时同步编辑区
  useEffect(() => {
    setEditContent(selected?.content ?? '')
    setSaveToLib(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, open])

  useEffect(() => {
    if (!selected) {
      setRendered(null)
      return
    }
    const source = editContent || selected.content
    setRendered(renderTemplate(source, vars))
  }, [selected, editContent, vars])

  if (!open) return null

  const missingBuiltIn = rendered?.missing.filter((k) => BUILTIN_VARS.some((v) => v.key === k)) ?? []
  const missingCustom = rendered?.missing.filter((k) => !BUILTIN_VARS.some((v) => v.key === k)) ?? []

  async function confirm(): Promise<void> {
    if (!selected || !rendered) return
    setBusy(true)
    try {
      const changed = editContent && editContent !== selected.content
      let target = selected
      // 另存到库：新建一条自定义项，不动原来的
      if (changed && saveToLib) {
        const created = await window.api.promptLibrary.save({
          ...selected,
          id: 'prompt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          name: selected.name + ' · 改',
          content: editContent,
          custom: true,
          isDefault: false,
          version: 1,
          tags: Array.from(new Set([...(selected.tags ?? []), '就地编辑'])),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          useCount: 0
        } as never)
        if (created.ok) target = created.data
      }
      await window.api.promptLibrary.touch(target.id)
      // 用编辑后的正文渲染结果（renderTemplate 已在 rendered 里体现）
      onConfirm(rendered.text, target)
    } finally {
      setBusy(false)
    }
  }

  const modal = (
    <div
      className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/40 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wa-modal flex h-[min(42rem,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[min(48rem,calc(100vw-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">选择提示词</h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive">✕</button>
        </div>

        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
          {/* 左：列表 */}
          <div className="flex w-52 shrink-0 flex-col overflow-y-auto rounded border" style={{ borderColor: 'var(--wa-border)' }}>
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className={`flex w-full flex-col items-start gap-0.5 border-b px-2 py-1.5 text-left text-[11px] hover:bg-black/5 wa-interactive ${
                  selectedId === it.id ? 'bg-ink-800/10' : ''
                }`}
                style={{ borderColor: 'var(--wa-border)' }}
              >
                <div className="flex w-full items-center gap-1">
                  <span className="truncate font-medium">{it.name}</span>
                  <div className="flex-1" />
                  {it.favorite && <span className="text-amber-500">★</span>}
                </div>
                <span className="text-[10px] wa-muted">{it.category}</span>
              </button>
            ))}
            {items.length === 0 && <div className="p-2 text-center text-[11px] wa-muted">无提示词</div>}
          </div>

          {/* 右：预览 + 变量 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
            {selected ? (
              <>
                <div className="text-[11px]">
                  <strong>{selected.name}</strong>
                  {selected.description && <span className="ml-1 wa-muted">— {selected.description}</span>}
                </div>
                <div className="text-[10px] wa-muted">
                  变量：{selected.variables.length ? selected.variables.join(', ') : '无'}
                </div>

                {/* 已知变量可填 */}
                <div className="grid grid-cols-2 gap-1 rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                  {BUILTIN_VARS.filter((v) => selected.variables.includes(v.key)).map((v) => (
                    <label key={v.key} className="flex items-center gap-1 text-[10px]">
                      <span className="w-20 shrink-0 wa-muted">{v.label}</span>
                      <input
                        value={vars[v.key] ?? ''}
                        onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })}
                        placeholder={v.description}
                        className="min-w-0 flex-1 rounded border px-1.5 py-0.5"
                        style={{ borderColor: 'var(--wa-border)' }}
                      />
                    </label>
                  ))}
                </div>

                {/* 自定义变量填表 */}
                {missingCustom.length > 0 && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                    <div className="mb-1 text-[10px] text-amber-800">自定义变量：</div>
                    <div className="grid grid-cols-2 gap-1">
                      {missingCustom.map((k) => (
                        <label key={k} className="flex items-center gap-1 text-[10px]">
                          <span className="w-16 shrink-0">{k}</span>
                          <input
                            value={vars[k] ?? ''}
                            onChange={(e) => setVars({ ...vars, [k]: e.target.value })}
                            placeholder={`填 ${k}`}
                            className="min-w-0 flex-1 rounded border px-1.5 py-0.5"
                            style={{ borderColor: 'var(--wa-border)' }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 就地编辑：直接改提示词，不用跑去提示词库 */}
                <div className="rounded border" style={{ borderColor: 'var(--wa-border)' }}>
                  <button
                    onClick={() => setEditOpen((v) => !v)}
                    className="flex w-full items-center gap-1 px-2 py-1 text-left text-[10px] hover:bg-black/5"
                  >
                    <span>{editOpen ? '▾' : '▸'}</span>
                    <span className="font-medium">就地编辑提示词</span>
                    <span className="wa-muted">（改完直接用；可另存到库）</span>
                    <div className="flex-1" />
                    {selected && editContent !== selected.content && (
                      <span className="rounded bg-amber-100 px-1 text-[9px] text-amber-800">已改动</span>
                    )}
                  </button>
                  {editOpen && (
                    <div className="space-y-1 border-t p-2" style={{ borderColor: 'var(--wa-border)' }}>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={7}
                        className="w-full resize-none rounded border px-2 py-1 font-mono text-[11px] leading-relaxed outline-none"
                        style={{ borderColor: 'var(--wa-border)' }}
                        placeholder="直接改提示词正文，支持 {text} {content} 等变量"
                      />
                      {editContent !== selected.content && (
                        <div className="rounded border p-1.5 text-[10px] leading-relaxed" style={{ borderColor: 'var(--wa-border)' }}>
                          <div className="mb-0.5 font-medium wa-muted">改动对照</div>
                          {(() => {
                            const beforeSet = new Set(selected.content.split('\n'))
                            const afterSet = new Set(editContent.split('\n'))
                            const add = editContent.split('\n').filter((l) => !beforeSet.has(l) && l.trim())
                            const del = selected.content.split('\n').filter((l) => !afterSet.has(l) && l.trim())
                            return (
                              <>
                                {add.slice(0, 6).map((l, i) => (
                                  <div key={'a' + i} className="truncate bg-emerald-50 text-emerald-800">+ {l}</div>
                                ))}
                                {del.slice(0, 6).map((l, i) => (
                                  <div key={'d' + i} className="truncate bg-rose-50 text-rose-700 line-through">- {l}</div>
                                ))}
                                {add.length === 0 && del.length === 0 && <div className="wa-muted">仅空白变化</div>}
                                <div className="wa-muted">共 +{add.length} 行 / -{del.length} 行</div>
                              </>
                            )
                          })()}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[10px]">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={saveToLib} onChange={(e) => setSaveToLib(e.target.checked)} />
                          另存到提示词库（新建一条，不影响原有）
                        </label>
                        <div className="flex-1" />
                        <button
                          onClick={() => { setEditContent(selected.content); setSaveToLib(false) }}
                          className="rounded border px-1.5 py-0.5 hover:bg-black/5"
                          style={{ borderColor: 'var(--wa-border)' }}
                        >
                          还原
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 预览 */}
                <div className="min-h-[100px] flex-1 overflow-auto rounded border bg-black/[0.03] p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--wa-border)' }}>
                  <pre className="whitespace-pre-wrap font-mono">{rendered?.text ?? '...'}</pre>
                </div>
                {missingBuiltIn.length > 0 && (
                  <div className="text-[10px] text-amber-700">未填充内置变量：{missingBuiltIn.join(', ')}</div>
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] wa-muted">选择一个提示词</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <button onClick={onClose} className="rounded border px-3 py-1 text-xs hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }}>取消</button>
          <button
            disabled={!selected || !rendered || busy}
            onClick={confirm}
            className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 disabled:opacity-40 wa-interactive"
          >
            使用
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
