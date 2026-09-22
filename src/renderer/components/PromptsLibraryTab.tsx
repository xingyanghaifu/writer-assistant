import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '../store/ui'
import { useJobsStore } from '../store/jobs'
import { BUILTIN_VARS, type PromptItem, type PromptCategory, extractVariables } from '@shared/promptLibrary'
import { renderTemplate } from '@shared/promptLibrary'
import { EmptyState } from './ui'

const CATEGORIES: Array<{ id: PromptCategory | '全部'; label: string }> = [
  { id: '全部', label: '全部' },
  { id: '润色改写', label: '润色改写' },
  { id: '扩写缩写', label: '扩写缩写' },
  { id: '角色人物', label: '角色' },
  { id: '伏笔剧情', label: '伏笔剧情' },
  { id: '大纲结构', label: '大纲' },
  { id: '风格分析', label: '风格' },
  { id: '一致性', label: '一致性' },
  { id: '灵感', label: '灵感' },
  { id: '工具', label: '工具' },
  { id: '其他', label: '其他' }
]

/**
 * 设置 → 提示词库 tab。
 *
 * 三栏：
 *  - 左：分类 / 搜索
 *  - 中：提示词列表
 *  - 右：编辑 / 变量测试 / 预览
 */
export function PromptsLibraryTab(): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [items, setItems] = useState<PromptItem[]>([])
  const [cat, setCat] = useState<PromptCategory | '全部'>('全部')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PromptItem | null>(null)
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<Array<{ version: number; reason: string; changelog: string[]; gaps?: string[]; score?: number; at: number }>>([])
  const [requireText, setRequireText] = useState('')
  /** 粘贴导入 */
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importCategory, setImportCategory] = useState('其他')
  const [requireTone, setRequireTone] = useState('')
  const [requireLength, setRequireLength] = useState<'shorter' | 'same' | 'longer'>('same')

  async function load(): Promise<void> {
    const list = await window.api.promptLibrary.list()
    setItems(list)
    if (!selectedId && list[0]) {
      setSelectedId(list[0].id)
      setDraft(list[0])
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (cat !== '全部' && it.category !== cat) return false
      if (query && !it.name.includes(query) && !it.content.includes(query) && !it.tags.join(' ').includes(query))
        return false
      return true
    })
  }, [items, cat, query])

  async function save(): Promise<void> {
    if (!draft) return
    // 内置项需要先 duplicate
    const target = items.find((x) => x.id === draft.id)
    if (target && !target.custom) {
      const r = await window.api.promptLibrary.duplicate(draft.id)
      if (r.ok) {
        const newId = r.data.id
        const newDraft = { ...draft, id: newId, custom: true, name: draft.name + ' · 副本' }
        const r2 = await window.api.promptLibrary.save(newDraft)
        if (r2.ok) {
          showToast('已复制为自定义项', 'success')
          await load()
          setSelectedId(newId)
          setDraft(r2.data)
        }
      }
      return
    }
    const r = await window.api.promptLibrary.save(draft)
    if (r.ok) {
      showToast('已保存', 'success')
      await load()
      setDraft(r.data)
    } else {
      showToast(r.error, 'error')
    }
  }

  async function remove(): Promise<void> {
    if (!draft) return
    if (!window.confirm(`删除「${draft.name}」？此操作不可撤销。`)) return
    const r = await window.api.promptLibrary.remove(draft.id)
    if (r.ok) {
      showToast('已删除', 'success')
      setSelectedId(null)
      setDraft(null)
      await load()
    }
  }

  async function reorderItems(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) return
    const ids = items.map((x) => x.id)
    const fromIdx = ids.indexOf(fromId)
    const toIdx = ids.indexOf(toId)
    if (fromIdx < 0 || toIdx < 0) return
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, fromId)
    setItems((prev) => {
      const next = prev.slice()
      const [m] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, m)
      return next
    })
    void window.api.promptLibrary.reorder(ids)
  }
  const [dragId, setDragId] = useState<string | null>(null)

  async function duplicate(): Promise<void> {
    if (!draft) return
    const r = await window.api.promptLibrary.duplicate(draft.id)
    if (r.ok) {
      showToast('已复制', 'success')
      await load()
      setSelectedId(r.data.id)
      setDraft(r.data)
    }
  }

  async function importFile(): Promise<void> {
    const r = await window.api.promptLibrary.import()
    if (r.ok) {
      showToast(`已导入 ${r.data.length} 项`, 'success')
      await load()
    } else showToast(r.error, 'error')
  }

  /** 粘贴文本导入（自动识别 JSON / 分节 / 整段） */
  async function importFromPaste(): Promise<void> {
    const text = importText.trim()
    if (!text) {
      showToast('先把内容粘进来', 'error')
      return
    }
    const r = await window.api.promptLibrary.importText(text, importCategory)
    if (r.ok) {
      showToast(`已导入 ${r.data.length} 条`, 'success')
      setImportOpen(false)
      setImportText('')
      await load()
    } else {
      showToast(r.error || '导入失败', 'error')
    }
  }

  /** 按用户写的要求迭代提示词 */
  async function iterateByRequirement(): Promise<void> {
    if (!draft) return
    const instruction = requireText.trim()
    if (!instruction) {
      showToast('先写清你的要求，例如"更口语、少排比、对话多一点"', 'error')
      return
    }
    const jobs = useJobsStore.getState()
    const jobId = 'prompt-req:' + draft.id + ':' + Date.now().toString(36)
    jobs.start({
      id: jobId,
      kind: 'prompt-iterate',
      title: draft.name + ' · 按要求',
      message: '按要求生成新版提示词',
      steps: [
        { id: 'req', label: '整理你的要求', status: 'done', detail: instruction.slice(0, 60) },
        { id: 'apply', label: '写入提示词并升版', status: 'running' }
      ]
    })
    const r = await window.api.promptLibrary.iterateByInstruction(draft.id, {
      instruction,
      tone: requireTone.trim() || undefined,
      length: requireLength
    })
    if (!r.ok) {
      jobs.finish(jobId, 'failed', r.error || '迭代失败')
      showToast(r.error || '迭代失败', 'error')
      return
    }
    jobs.setStep(jobId, 'apply', { status: 'done', detail: 'v' + r.data.item.version })
    jobs.finish(jobId, 'done', '已生成 v' + r.data.item.version + (r.data.cloned ? '（已复制为自定义）' : ''))
    showToast('已按要求生成 v' + r.data.item.version, 'success')
    setRequireText('')
    await load()
    setSelectedId(r.data.item.id)
    setDraft(r.data.item)
    void window.api.promptLibrary.iterationHistory(r.data.item.id).then((h) => setHistory(h ?? []))
  }

  async function iteratePrompt(): Promise<void> {
    if (!draft) return
    const jobs = useJobsStore.getState()
    const jobId = 'prompt:' + draft.id
    jobs.start({
      id: jobId,
      kind: 'prompt-iterate',
      title: draft.name,
      message: '读取使用与反馈记录',
      steps: [
        { id: 'preview', label: '归纳赞踩与使用记录', status: 'running' },
        { id: 'apply', label: '生成下一版提示词', status: 'pending' }
      ]
    })
    const prev = await window.api.promptLibrary.iteratePreview(draft.id)
    if (!prev.ok) {
      jobs.finish(jobId, 'failed', prev.error || '还不能迭代')
      showToast(prev.error || '还不能迭代', 'error')
      return
    }
    jobs.setStep(jobId, 'preview', {
      status: 'done',
      detail: prev.data.evidence.up + '赞 / ' + prev.data.evidence.down + '踩 / ' + prev.data.evidence.use + '次'
    })
    jobs.log(jobId, prev.data.changelog.join('；'))
    const msg = '将根据 ' + prev.data.evidence.up + ' 赞 / ' + prev.data.evidence.down + ' 踩 / ' + prev.data.evidence.use + ' 次使用，生成新版本：\n- ' + prev.data.changelog.join('\n- ') + '\n\n内置项会复制为自定义后再改，可随时回滚。'
    if (!window.confirm(msg)) {
      jobs.finish(jobId, 'paused', '已取消')
      return
    }
    jobs.setStep(jobId, 'apply', { status: 'running' })
    const r = await window.api.promptLibrary.iterate(draft.id)
    if (!r.ok) {
      jobs.finish(jobId, 'failed', r.error || '迭代失败')
      showToast(r.error || '迭代失败', 'error')
      return
    }
    jobs.setStep(jobId, 'apply', { status: 'done', detail: 'v' + r.data.item.version })
    jobs.finish(jobId, 'done', '已迭代到 v' + r.data.item.version)
    showToast('已迭代到 v' + r.data.item.version, 'success')
    await load()
    setSelectedId(r.data.item.id)
    setDraft(r.data.item)
  }
  async function exportFile(): Promise<void> {
    const r = await window.api.promptLibrary.export()
    if (r.ok) showToast(`已导出到 ${r.data}`, 'success')
    else showToast(r.error, 'error')
  }

  function selectItem(it: PromptItem): void {
    setSelectedId(it.id)
    setDraft(it)
    setPreviewVars({})
    void window.api.promptLibrary.iterationHistory(it.id).then((h) => setHistory(h ?? []))
  }

  const rendered = useMemo(() => {
    if (!draft) return null
    return renderTemplate(draft.content, previewVars)
  }, [draft, previewVars])

  return (
    <div className="flex h-full min-h-[420px] gap-2">
      {/* 左：分类 + 搜索 */}
      <div className="flex w-40 shrink-0 flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {['自迭代', '按需迭代'].map((tag) => (
            <button
              key={tag}
              onClick={() => setQuery(query === tag ? '' : tag)}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${query === tag ? 'border-ink-800 bg-black/5 font-medium' : 'hover:bg-black/5'}`}
              style={{ borderColor: 'var(--wa-border)' }}
              title={'只看打了「' + tag + '」标签的提示词'}
            >
              {tag}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索"
          className="rounded border px-2 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--wa-border)' }}
        />
        <div className="flex flex-col gap-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: 'var(--wa-border)' }}>
          {CATEGORIES.map((c) => {
            const count = c.id === '全部' ? items.length : items.filter((x) => x.category === c.id).length
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`flex items-center justify-between rounded px-2 py-1 text-left text-[11px] wa-interactive ${cat === c.id ? 'bg-ink-800 text-white' : 'hover:bg-black/5'}`}
              >
                <span>{c.label}</span>
                <span className="text-[10px] opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={importFile} className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }} title="从 JSON 文件导入">📥 导入文件</button>
          <button onClick={() => setImportOpen(true)} className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }} title="粘贴文本导入，自动识别格式">📋 粘贴导入</button>
          <button onClick={exportFile} className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }}>📤 导出</button>
        </div>
      </div>

      {/* 中：列表 */}
      <div className="flex w-56 shrink-0 flex-col overflow-y-auto rounded border" style={{ borderColor: 'var(--wa-border)' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="🗒" title="无匹配提示词" description="试试调整搜索关键词或分类筛选" className="!p-6" />
        ) : (
          filtered.map((it) => (
            <button
              key={it.id}
              draggable
              onDragStart={(e) => {
                setDragId(it.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== it.id) void reorderItems(dragId, it.id)
                setDragId(null)
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => selectItem(it)}
              className={`flex w-full flex-col items-start gap-0.5 border-b px-2 py-1.5 text-left text-[11px] hover:bg-black/5 wa-interactive ${selectedId === it.id ? 'bg-ink-800/10' : ''} ${dragId === it.id ? 'opacity-50' : ''}`}
              style={{ borderColor: 'var(--wa-border)' }}
            >
              <div className="flex w-full items-center gap-1">
                <span className="truncate font-medium">{it.name}</span>
                <div className="flex-1" />
                {it.favorite && <span className="text-amber-500">★</span>}
                {!it.enabled && <span className="text-zinc-400">·停</span>}
                {it.custom && <span className="text-[9px] text-blue-600">·改</span>}
              </div>
              <div className="flex w-full items-center gap-1 text-[10px] wa-muted">
                <span className="truncate">{it.category}</span>
                {it.lastUsedAt && (
                  <span title={new Date(it.lastUsedAt).toLocaleString()}>
                    ·用{it.useCount ?? 0}次
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 右：编辑 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {!draft ? (
          <div className="flex h-full items-center justify-center text-[11px] wa-muted">选择一个提示词</div>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                disabled={!draft.custom}
                placeholder="名称"
                className="min-w-0 flex-1 rounded border px-2 py-0.5 text-[12px]"
                style={{ borderColor: 'var(--wa-border)' }}
              />
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as PromptCategory })}
                disabled={!draft.custom}
                className="rounded border px-1 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--wa-border)' }}
              >
                {CATEGORIES.filter((c) => c.id !== '全部').map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value, variables: extractVariables(e.target.value) })}
              disabled={!draft.custom}
              className="min-h-[120px] flex-1 resize-none rounded border p-2 font-mono text-[11px] leading-relaxed"
              style={{ borderColor: 'var(--wa-border)' }}
              placeholder="提示词正文，使用 {text} {content} 等占位符"
            />

            {/* 变量测试 */}
            <div className="rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1 text-[10px] wa-muted">变量值（仅本机测试，不会保存）</div>
              <div className="grid grid-cols-2 gap-1">
                {BUILTIN_VARS.map((v) => (
                  <label key={v.key} className="flex items-center gap-1 text-[10px]">
                    <span className="w-20 shrink-0 wa-muted">{v.label}</span>
                    <input
                      value={previewVars[v.key] ?? ''}
                      onChange={(e) => setPreviewVars({ ...previewVars, [v.key]: e.target.value })}
                      placeholder={v.description}
                      className="min-w-0 flex-1 rounded border px-1.5 py-0.5"
                      style={{ borderColor: 'var(--wa-border)' }}
                    />
                  </label>
                ))}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] wa-muted">预览</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-1.5 text-[10px] leading-relaxed">{rendered?.text ?? ''}</pre>
                {rendered?.missing && rendered.missing.length > 0 && (
                  <div className="mt-1 text-[10px] text-amber-700">未填充：{rendered.missing.join(', ')}</div>
                )}
              </details>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}
                className={`rounded px-1.5 py-0.5 text-[11px] wa-interactive ${draft.favorite ? 'bg-amber-100 text-amber-900' : 'border hover:bg-black/5'}`}
                style={draft.favorite ? undefined : { borderColor: 'var(--wa-border)' }}
              >
                {draft.favorite ? '★ 已收藏' : '☆ 收藏'}
              </button>
              <button
                onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
                className={`rounded px-1.5 py-0.5 text-[11px] wa-interactive ${draft.enabled ? 'border hover:bg-black/5' : 'bg-rose-50 text-rose-700'}`}
                style={{ borderColor: 'var(--wa-border)' }}
              >
                {draft.enabled ? '启用' : '已停用'}
              </button>
              {draft.custom && (
                <button onClick={save} className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 wa-interactive">保存</button>
              )}
              <button onClick={duplicate} className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }}>复制</button>
              <button onClick={() => void iteratePrompt()} className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }} title="根据点赞/点踩/使用记录生成下一版提示词">自迭代</button>
              <button onClick={() => void window.api.promptLibrary.iterationHistory(draft.id).then((h) => setHistory(h ?? []))} className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive" style={{ borderColor: 'var(--wa-border)' }} title="查看每次迭代改了什么">历史</button>
              {draft.custom && (
                <button onClick={remove} className="rounded px-1.5 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 wa-interactive">删除</button>
              )}
              {!draft.custom && (
                <span className="text-[10px] wa-muted">内置项；先复制再修改</span>
              )}
              <div className="flex-1" />
              <span className="text-[10px] wa-muted">变量：{draft.variables.length ? draft.variables.join(', ') : '无'}</span>
            </div>

            <div className="mt-2 rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1 text-[10px] font-medium wa-muted">按要求迭代</div>
              <textarea
                value={requireText}
                onChange={(e) => setRequireText(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="写清要求，例如：更口语、少排比、对话占比提高、描写更克制"
                className="mb-1 w-full resize-none rounded border px-2 py-1 text-[11px] outline-none"
                style={{ borderColor: 'var(--wa-border)' }}
              />
              <div className="mb-1 flex items-center gap-1.5">
                <input
                  value={requireTone}
                  onChange={(e) => setRequireTone(e.target.value)}
                  placeholder="风格（可选）：如冷静克制"
                  className="min-w-0 flex-1 rounded border px-2 py-0.5 text-[11px] outline-none"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
                <select
                  value={requireLength}
                  onChange={(e) => setRequireLength(e.target.value as 'shorter' | 'same' | 'longer')}
                  className="rounded border px-1 py-0.5 text-[11px]"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  <option value="shorter">更短</option>
                  <option value="same">长度不变</option>
                  <option value="longer">更充分</option>
                </select>
                <button
                  onClick={() => void iterateByRequirement()}
                  className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900"
                >
                  按要求迭代
                </button>
              </div>
              <div className="text-[10px] wa-muted">只改这条提示词，不联网；内置项会先复制为自定义。</div>
            </div>

            {history.length > 0 && (
              <div className="mt-2 rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
                <div className="mb-1 text-[10px] font-medium wa-muted">迭代历史（{history.length}）</div>
                <ol className="max-h-40 space-y-1 overflow-y-auto">
                  {history.map((h, i) => (
                    <li key={i} className="text-[10px] leading-relaxed">
                      <span className="font-medium">v{h.version}</span>
                      <span className="wa-muted"> · {h.reason === 'imitate-gap' ? '细纲迭代' : h.reason === 'feedback' ? '按反馈迭代' : '基线'}</span>
                      {typeof h.score === 'number' && <span className="wa-muted"> · {h.score}分</span>}
                      <span className="wa-muted"> · {new Date(h.at).toLocaleString('zh-CN')}</span>
                      <div className="wa-muted">{h.changelog.join('；')}</div>
                      {h.gaps && h.gaps.length > 0 && <div className="wa-muted">缺口：{h.gaps.slice(0, 3).join('；')}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>

      {importOpen && (
        <div
          className="wa-modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/40 p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setImportOpen(false)
          }}
        >
          <div className="wa-modal flex max-h-[92vh] w-[min(44rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
              <span className="text-sm font-semibold">粘贴导入提示词</span>
              <span className="text-[10px] wa-muted">自动识别 JSON / --- 分节 / Markdown 标题 / 整段</span>
              <div className="flex-1" />
              <button onClick={() => setImportOpen(false)} className="rounded px-1.5 text-sm hover:bg-black/5">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-[11px]">
              <textarea
                autoFocus
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={12}
                placeholder={'把提示词粘在这里。支持三种写法：\n\n① 导出过的 JSON\n② 用 --- 分隔多条\n   ---\n   润色医生\n   你的提示词…\n   ---\n   扩写师\n   你的提示词…\n③ 直接一大段（作为一条导入）'}
                className="w-full resize-none rounded border px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none"
                style={{ borderColor: 'var(--wa-border)' }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  <span className="wa-muted">归类到</span>
                  <select
                    value={importCategory}
                    onChange={(e) => setImportCategory(e.target.value)}
                    className="rounded border px-1.5 py-0.5"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    {['润色改写','扩写缩写','角色人物','伏笔剧情','大纲结构','风格分析','一致性','灵感','工具','其他'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <span className="wa-muted">内容重复的条目会自动跳过</span>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
              <button onClick={() => setImportOpen(false)} className="rounded border px-3 py-1 text-xs hover:bg-black/5" style={{ borderColor: 'var(--wa-border)' }}>取消</button>
              <button onClick={() => void importFromPaste()} className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900">导入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}