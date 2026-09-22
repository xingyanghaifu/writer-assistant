import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, EditorSettings, ThemeMode, StorageStatus } from '@shared/settings'
import type { PromptTemplate } from '@shared/suggestion'
import { useUiStore } from '../store/ui'
import { fontStack } from '../store/editor'
import { COMPLIANCE_TEXT } from '../services/compliance'
import { AdapterProbe } from './AdapterProbe'
import { PromptsLibraryTab } from './PromptsLibraryTab'

type Tab = 'editor' | 'prompts' | 'advanced' | 'data' | 'diagnose' | 'about'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'editor', label: '编辑器' },
  { id: 'prompts', label: '提示词' },
  { id: 'advanced', label: '功能开关' },
  { id: 'data', label: '数据' },
  { id: 'diagnose', label: '适配器自检' },
  { id: 'about', label: '关于' }
]

/**
 * 设置对话框（阶段 7 / 8.5 / 12.5）。
 *
 * 编辑器排版、提示词管理（编辑/重置/导入/导出/检查更新）、
 * 八项功能开关、数据管理（清空数据）、合规声明。
 */
export function SettingsDialog({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const showToast = useUiStore((s) => s.showToast)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'editor')

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <div className="rounded bg-white px-4 py-3 text-xs">加载设置中…</div>
      </div>
    )
  }

  /** 局部更新并落库 */
  async function patch(p: Partial<AppSettings>): Promise<void> {
    try {
      const updated = await window.api.settings.set(p)
      setSettings(updated)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error')
    }
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="wa-modal flex max-h-[92vh] w-[min(48rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">设置</h2>
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧标签 */}
          <nav className="w-28 shrink-0 border-r p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                  tab === t.id ? 'bg-ink-800 text-white' : 'hover:bg-black/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
            {tab === 'editor' && (
              <EditorSettingsTab
                settings={settings}
                theme={theme}
                onTheme={(t) => {
                  setTheme(t)
                  void patch({ theme: t })
                }}
                onEditor={(e) => void patch({ editor: e })}
                onAutoWatch={(v) => void patch({ autoWatch: v })}
                onAutosave={(ms) => void patch({ autosaveDebounceMs: ms })}
              />
            )}
            {tab === 'prompts' && <PromptsLibraryTab />}
            {tab === 'advanced' && (
              <AdvancedSettingsTab settings={settings} onPatch={(p) => void patch(p)} />
            )}
            {tab === 'data' && <DataTab onClose={onClose} />}
            {tab === 'diagnose' && <AdapterProbe onClose={onClose} embedded />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-2.5">
          <button onClick={onClose} className="rounded bg-ink-800 px-3 py-1 text-xs text-white">
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- 编辑器 ----------
function EditorSettingsTab({
  settings,
  theme,
  onTheme,
  onEditor,
  onAutoWatch,
  onAutosave
}: {
  settings: AppSettings
  theme: ThemeMode
  onTheme: (t: ThemeMode) => void
  onEditor: (e: EditorSettings) => void
  onAutoWatch: (v: boolean) => void
  onAutosave: (ms: number) => void
}): JSX.Element {
  const ed = settings.editor
  const set = (p: Partial<EditorSettings>): void => onEditor({ ...ed, ...p })

  return (
    <div className="space-y-4">
      <Field label="主题">
        <div className="flex gap-1.5">
          {(
            [
              ['light', '明亮'],
              ['dark', '暗色'],
              ['parchment', '羊皮纸'],
              ['system', '跟随系统']
            ] as Array<[ThemeMode, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onTheme(id)}
              className={`rounded border px-2 py-1 ${theme === id ? 'border-ink-600 bg-ink-800/5 font-medium' : 'hover:bg-black/5'}`}
              style={theme === id ? {} : { borderColor: 'var(--wa-border)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="字体">
        <select
          value={ed.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value as EditorSettings['fontFamily'] })}
          className="rounded border px-2 py-1 outline-none"
          style={{ borderColor: 'var(--wa-border)', fontFamily: fontStack(ed.fontFamily) }}
        >
          <option value="song">宋体（默认）</option>
          <option value="kai">楷体</option>
          <option value="lora">Lora（西文衬线）</option>
        </select>
      </Field>

      <Field label={`字号：${ed.fontSize}px`}>
        <input
          type="range"
          min={14}
          max={22}
          value={ed.fontSize}
          onChange={(e) => set({ fontSize: Number(e.target.value) })}
          className="w-48"
        />
      </Field>

      <Field label={`行距：${ed.lineHeight}`}>
        <input
          type="range"
          min={1.4}
          max={2.4}
          step={0.1}
          value={ed.lineHeight}
          onChange={(e) => set({ lineHeight: Number(e.target.value) })}
          className="w-48"
        />
      </Field>

      <Field label={`版心宽度：${ed.maxWidth}px`}>
        <input
          type="range"
          min={560}
          max={900}
          step={20}
          value={ed.maxWidth}
          onChange={(e) => set({ maxWidth: Number(e.target.value) })}
          className="w-48"
        />
      </Field>

      <Field label={`首行缩进：${ed.indent} 字符`}>
        <input
          type="range"
          min={0}
          max={4}
          value={ed.indent}
          onChange={(e) => set({ indent: Number(e.target.value) })}
          className="w-48"
        />
      </Field>

      <Field label="自动监听">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.autoWatch} onChange={(e) => onAutoWatch(e.target.checked)} />
          <span className="wa-muted">草稿停止输入后自动请求建议（默认关闭，避免打扰）</span>
        </label>
      </Field>

      <Field label="自动保存防抖">
        <select
          value={settings.autosaveDebounceMs}
          onChange={(e) => void onAutosave(Number(e.target.value))}
          className="rounded border px-2 py-1 outline-none"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <option value={1000}>1 秒</option>
          <option value={2000}>2 秒（推荐）</option>
          <option value={5000}>5 秒</option>
          <option value={10000}>10 秒</option>
        </select>
      </Field>

      {/* 预览 */}
      <div className="rounded border p-3" style={{ borderColor: 'var(--wa-border)' }}>
        <div className="mb-1 wa-muted text-[10px]">预览</div>
        <div
          style={{
            fontFamily: fontStack(ed.fontFamily),
            fontSize: ed.fontSize,
            lineHeight: ed.lineHeight,
            textIndent: `${ed.indent}em`,
            maxWidth: ed.maxWidth
          }}
        >
          他推开那扇门，风从走廊尽头灌进来。十年前的那个下午忽然又清晰起来——同样的雨，同样的沉默。
        </div>
      </div>
    </div>
  )
}

// ---------- 提示词（阶段 12.5 / 13）----------
function PromptsTab(): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(): Promise<void> {
    const list = await window.api.prompts.list()
    setPrompts(list)
    if (list.length && !selected) {
      setSelected(list[0].id)
      setDraft(list[0].template)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = prompts.find((p) => p.id === selected)

  function select(id: string): void {
    setSelected(id)
    setDraft(prompts.find((p) => p.id === id)?.template ?? '')
  }

  async function save(): Promise<void> {
    if (!current) return
    setBusy(true)
    try {
      const r = await window.api.prompts.save({ ...current, template: draft, custom: true })
      if (r.ok) {
        showToast('模板已保存', 'success')
        await load()
      } else showToast(r.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reset(): Promise<void> {
    if (!current) return
    if (!window.confirm(`恢复「${current.name}」为默认模板？`)) return
    const list = await window.api.prompts.reset(current.id)
    setPrompts(list)
    const def = list.find((p) => p.id === current.id)
    setDraft(def?.template ?? '')
    showToast('已恢复默认', 'success')
  }

  async function checkUpdate(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.api.prompts.checkUpdate()
      if (r.ok) {
        showToast(r.data.message, 'success')
        await load()
      } else showToast(r.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function exportPrompts(): Promise<void> {
    const r = await window.api.prompts.export()
    showToast(r.ok ? `已导出到 ${r.data}` : r.error, r.ok ? 'success' : 'error')
  }

  async function importPrompts(): Promise<void> {
    const r = await window.api.prompts.import()
    if (r.ok) {
      setPrompts(r.data)
      showToast('已导入', 'success')
    } else showToast(r.error, 'error')
  }

  return (
    <div className="flex h-full min-h-[360px] gap-2">
      {/* 模板列表 */}
      <div className="w-40 shrink-0 overflow-y-auto rounded border" style={{ borderColor: 'var(--wa-border)' }}>
        {prompts.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={`block w-full truncate px-2 py-1 text-left ${
              selected === p.id ? 'bg-ink-800 text-white' : 'hover:bg-black/5'
            }`}
            title={p.name}
          >
            {p.name}
            {p.custom && <span className="ml-1 text-[10px] opacity-70">·改</span>}
          </button>
        ))}
      </div>

      {/* 编辑区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{current.name}</span>
              <span className="wa-muted">
                v{current.version} · {current.custom ? '已自定义' : '默认'}
              </span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded border p-2 font-mono text-[11px] leading-relaxed outline-none"
              style={{ borderColor: 'var(--wa-border)' }}
            />
            <div className="mt-1 wa-muted text-[10px]">
              可用变量：{'{{text}}'} 正文 · {'{{context}}'} 上下文 · {'{{question}}'} 提问 ·{' '}
              {'{{chapterTitle}}'} 章节名
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <button onClick={() => void save()} disabled={busy} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-50">
                保存
              </button>
              <button onClick={() => void reset()} className="rounded px-2 py-0.5 hover:bg-black/5 wa-interactive">
                恢复默认
              </button>
              <button onClick={() => setDraft(current.template)} className="rounded px-2 py-0.5 hover:bg-black/5 wa-interactive">
                撤销修改
              </button>
              <div className="flex-1" />
              <button onClick={() => void checkUpdate()} disabled={busy} className="rounded px-2 py-0.5 hover:bg-black/5 wa-interactive">
                检查更新
              </button>
              <button onClick={() => void importPrompts()} className="rounded px-2 py-0.5 hover:bg-black/5 wa-interactive">
                导入
              </button>
              <button onClick={() => void exportPrompts()} className="rounded px-2 py-0.5 hover:bg-black/5 wa-interactive">
                导出
              </button>
            </div>
          </>
        ) : (
          <div className="wa-muted">加载中…</div>
        )}
      </div>
    </div>
  )
}

// ---------- 功能开关（阶段 11）----------
function AdvancedSettingsTab({
  settings,
  onPatch
}: {
  settings: AppSettings
  onPatch: (p: Partial<AppSettings>) => void
}): JSX.Element {
  const f = settings.features

  const ITEMS: Array<[keyof AppSettings['features'], string, string]> = [
    ['outlineGenerate', '一键生成章纲', '根据章节摘要与大纲，让 AI 产出本章情节点'],
    ['sensitiveWord', '敏感词检测', '本地词库扫描，仅提示不阻断'],
    ['chapterGoal', '章节目标字数', '设置每章目标并显示进度'],
    ['smartSplit', '智能分章', '在场景切换处建议分章点'],
    ['qualityFeedback', '建议质量反馈', '对建议点赞/点踩，用于优化提示词'],
    ['styleLearning', '写作风格学习', '统计你的句长/用词偏好并注入提示词'],
    ['consistencyCheck', '角色一致性检查', '检查状态冲突、特征矛盾、名字误写'],
    ['healthReminder', '健康提醒', '连续写作超时后提醒休息']
  ]

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {ITEMS.map(([key, label, desc]) => (
          <label key={key} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={f[key]}
              onChange={(e) => onPatch({ features: { ...f, [key]: e.target.checked } })}
              className="mt-0.5"
            />
            <span>
              {label}
              <span className="wa-muted">（{desc}）</span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t pt-3" style={{ borderColor: 'var(--wa-border)' }}>
        <Field label={`默认章节目标字数：${settings.defaultTargetWordCount} 字`}>
          <input
            type="range"
            min={500}
            max={10000}
            step={100}
            value={settings.defaultTargetWordCount}
            onChange={(e) => onPatch({ defaultTargetWordCount: Number(e.target.value) })}
            className="w-56"
          />
        </Field>

        <Field label={`健康提醒间隔：${Math.round(settings.healthReminderMs / 60000)} 分钟`}>
          <input
            type="range"
            min={15}
            max={120}
            step={5}
            value={Math.round(settings.healthReminderMs / 60000)}
            onChange={(e) => onPatch({ healthReminderMs: Number(e.target.value) * 60000 })}
            className="w-56"
          />
        </Field>

        <Field label="同步模式（AI 自动提取素材时）">
          <select
            value={settings.syncMode}
            onChange={(e) => onPatch({ syncMode: e.target.value as AppSettings['syncMode'] })}
            className="rounded border px-2 py-1 outline-none"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            <option value="confirm">每次确认（推荐）</option>
            <option value="auto">自动写入</option>
            <option value="manual">仅手动</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

// ---------- 数据（阶段 8.5）----------
function DataTab({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [confirmText, setConfirmText] = useState('')
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [migrateMode, setMigrateMode] = useState<'migrate' | 'fresh'>('migrate')
  const [pendingDir, setPendingDir] = useState<string | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.storage.status()
      setStatus(s)
    } catch {
      /* 读取失败保持上一次状态 */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function chooseDir(): Promise<void> {
    try {
      const dir = await window.api.storage.pickDir()
      if (!dir) return
      if (dir === status?.currentDir) {
        showToast('该目录就是当前数据目录', 'info')
        return
      }
      setPendingDir(dir)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '选择目录失败', 'error')
    }
  }

  async function applyDir(): Promise<void> {
    if (!pendingDir) return
    setBusy(true)
    try {
      const r = await window.api.storage.setDir(pendingDir, migrateMode)
      if (r.ok) {
        showToast(
          r.data.migrated
            ? '已切换数据目录并迁移现有数据，重启后生效'
            : '已切换数据目录（新目录从空开始），重启后生效',
          'success'
        )
        await refresh()
      } else {
        showToast(r.error, 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '设置失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resetDir(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.api.storage.resetDir()
      if (r.ok) {
        showToast('已恢复默认数据目录，重启后生效', 'success')
        await refresh()
      } else {
        showToast(r.error, 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重置失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function restartNow(): Promise<void> {
    try {
      await window.api.storage.restart()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重启失败，请手动关闭并重新打开', 'error')
    }
  }

  function fmtSize(bytes: number): string {
    if (bytes < 0) return '未知'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  async function clearAll(): Promise<void> {
    if (confirmText !== '清空数据') {
      showToast('请输入「清空数据」以确认', 'error')
      return
    }
    try {
      const r = await window.api.settings.clearAll()
      if (r.ok) {
        showToast('数据已清空，应用将重新加载', 'success')
        setTimeout(() => window.location.reload(), 800)
      } else showToast(r.error, 'error')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '清空失败', 'error')
    }
  }

  return (
    <div className="space-y-3">
      {/* 数据存储位置 */}
      <div className="rounded border p-2.5" style={{ borderColor: 'var(--wa-border)' }}>
        <div className="flex items-center gap-2">
          <span className="font-medium">数据存储位置</span>
          {status && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                status.usingCustom ? 'bg-blue-100 text-blue-700' : 'bg-black/5 wa-muted'
              }`}
            >
              {status.usingCustom ? '自定义目录' : '默认目录'}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={() => void refresh()} className="text-[11px] hover:underline wa-muted">
            刷新
          </button>
        </div>

        <p className="mt-1 wa-muted">
          作品、素材、备份均保存在本机此目录，不会上传到任何服务器。
          AI 请求仅包含你主动发送的正文片段，且通过你自己的浏览器登录态发起。
        </p>

        {/* 当前路径 */}
        <div className="mt-2">
          <div className="text-[11px] wa-muted">当前目录</div>
          <div className="mt-0.5 flex items-center gap-1">
            <code
              className="min-w-0 flex-1 truncate rounded bg-black/[0.04] px-1.5 py-1 text-[11px]"
              title={status?.currentDir ?? ''}
            >
              {status?.currentDir ?? '读取中…'}
            </code>
            <button
              onClick={() => void window.api.storage.openDir()}
              className="shrink-0 rounded px-2 py-1 text-[11px] hover:bg-black/5 wa-interactive"
              style={{ border: '1px solid var(--wa-border)' }}
              title="在文件管理器中打开"
            >
              打开
            </button>
          </div>
          <div className="mt-1 flex gap-3 text-[11px] wa-muted">
            <span>可写：{status ? (status.writable ? '是' : '否') : '—'}</span>
            <span>数据大小：{status ? fmtSize(status.sizeBytes) : '—'}</span>
            <span>文件：{status?.fileName ?? '—'}</span>
          </div>
        </div>

        {/* 回退提示 */}
        {fallbackReason && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            自定义目录不可用，已回退到默认目录：{fallbackReason}
          </div>
        )}

        {/* 待重启提示 */}
        {status?.pendingRestart && (
          <div className="mt-2 rounded border border-blue-300 bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800">
            <div className="font-medium">新目录需要重启后生效</div>
            <div className="mt-0.5">
              数据仍保存在原目录，重启后才会切换到新目录。建议先关闭应用再重新打开。
            </div>
            <button
              onClick={() => void restartNow()}
              className="mt-1 rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
            >
              立即重启
            </button>
          </div>
        )}

        {/* 迁移方式 */}
        <div className="mt-2.5 border-t pt-2" style={{ borderColor: 'var(--wa-border)' }}>
          <div className="text-[11px] font-medium">切换目录时</div>
          <label className="mt-1 flex items-start gap-1.5">
            <input
              type="radio"
              checked={migrateMode === 'migrate'}
              onChange={() => setMigrateMode('migrate')}
              className="mt-0.5"
            />
            <span>
              <span className="text-[11px]">迁移现有数据（推荐）</span>
              <span className="block text-[10px] wa-muted">
                把当前数据复制到新目录；若新目录已有数据则不覆盖
              </span>
            </span>
          </label>
          <label className="mt-1 flex items-start gap-1.5">
            <input
              type="radio"
              checked={migrateMode === 'fresh'}
              onChange={() => setMigrateMode('fresh')}
              className="mt-0.5"
            />
            <span>
              <span className="text-[11px]">新目录从空开始</span>
              <span className="block text-[10px] wa-muted">
                旧数据保留在原目录，不会被删除，可手动找回
              </span>
            </span>
          </label>
        </div>

        {/* 操作按钮 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => void chooseDir()}
            className="rounded bg-ink-800 px-2.5 py-1 text-[11px] text-white hover:bg-ink-900"
          >
            选择目录…
          </button>
          {pendingDir && (
            <>
              <button
                onClick={() => void applyDir()}
                disabled={busy}
                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50"
              >
                应用此目录
              </button>
              <button
                onClick={() => setPendingDir(null)}
                className="rounded px-2 py-1 text-[11px] hover:bg-black/5 wa-interactive"
              >
                取消
              </button>
            </>
          )}
          {status?.usingCustom && (
            <button
              onClick={() => void resetDir()}
              disabled={busy}
              className="rounded px-2.5 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50"
              style={{ border: '1px solid var(--wa-border)' }}
            >
              恢复默认目录
            </button>
          )}
        </div>

        {/* 待应用的目录 */}
        {pendingDir && (
          <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
            <div className="font-medium">将切换到：</div>
            <code className="mt-0.5 block break-all">{pendingDir}</code>
            <div className="mt-1">
              方式：{migrateMode === 'migrate' ? '迁移现有数据' : '新目录从空开始'} · 需重启生效
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-red-300 bg-red-50 p-2.5">
        <div className="font-medium text-red-700">清空所有数据</div>
        <p className="mt-0.5 text-red-700/80">
          将删除全部作品、章节、版本历史、素材、备份与设置。此操作不可撤销，建议先导出备份。
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="输入「清空数据」以确认"
          className="mt-1.5 w-48 rounded border border-red-300 px-2 py-1 outline-none"
        />
        <button
          onClick={() => void clearAll()}
          disabled={confirmText !== '清空数据'}
          className="ml-1.5 rounded bg-red-600 px-2.5 py-1 text-white disabled:opacity-40"
        >
          确认清空
        </button>
      </div>
    </div>
  )
}

// ---------- 关于 ----------
function AboutTab(): JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.app.version().then(setVersion)
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-3xl">✍️</span>
        <div>
          <div className="text-base font-semibold">写作副驾</div>
          <div className="wa-muted">版本 {version || '…'}</div>
        </div>
      </div>

      <div className="rounded border p-2.5" style={{ borderColor: 'var(--wa-border)' }}>
        <div className="font-medium">合规声明</div>
        <div className="mt-1 space-y-2">
          {(
            [COMPLIANCE_TEXT.compliance, COMPLIANCE_TEXT.aiCopyright, COMPLIANCE_TEXT.privacy] as const
          ).map((sec) => (
            <div key={sec.title}>
              <div className="font-medium wa-muted">{sec.title}</div>
              <ul className="mt-0.5 space-y-0.5 leading-relaxed wa-muted">
                {sec.body.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="wa-muted text-[11px]">
        本应用通过你本人的浏览器登录态访问 AI 网页，不绕过任何登录、验证码或风控机制；
        不会自动发送你的当前对话；所有 AI 生成内容仅供参考，请自行判断与修改。
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1 wa-muted">{label}</div>
      {children}
    </div>
  )
}
