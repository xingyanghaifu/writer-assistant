import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  SensitiveReport,
  StyleProfile,
  FeedbackSummary,
  GoalProgress,
  HealthStatus
} from '@shared/advanced'
import type { ConsistencyReport, SplitPoint } from '@shared/suggestion'
import { useUiStore } from '../../store/ui'
import { useWorkStore } from '../../store/work'

type Tab = 'sensitive' | 'style' | 'consistency' | 'split' | 'goal' | 'health' | 'feedback'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sensitive', label: '敏感词' },
  { id: 'style', label: '风格' },
  { id: 'consistency', label: '一致性' },
  { id: 'split', label: '智能分章' },
  { id: 'goal', label: '目标字数' },
  { id: 'health', label: '健康' },
  { id: 'feedback', label: '建议反馈' }
]

/**
 * 进阶功能面板（阶段 11 八项）。
 *
 * 1 一键生成章纲在 DraftTab/OutlineTab 触发；此处覆盖其余 7 项 + 反馈汇总。
 * 所有检测均为本地计算，不消耗 AI 额度。
 */
export function AdvancedPanel(): JSX.Element {
  const [tab, setTab] = useState<Tab>('sensitive')
  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex flex-wrap gap-0.5 border-b px-1.5 py-1" style={{ borderColor: 'var(--wa-border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-1.5 py-0.5 ${tab === t.id ? 'bg-ink-800 text-white' : 'hover:bg-black/5'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'sensitive' && <SensitiveTab />}
        {tab === 'style' && <StyleTab />}
        {tab === 'consistency' && <ConsistencyTab />}
        {tab === 'split' && <SplitTab />}
        {tab === 'goal' && <GoalTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'feedback' && <FeedbackTab />}
      </div>
    </div>
  )
}

// ---------- 1. 敏感词检测 ----------
function SensitiveTab(): JSX.Element {
  const draft = useWorkStore((s) => s.draft)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const [report, setReport] = useState<SensitiveReport | null>(null)
  const [scope, setScope] = useState<'chapter' | 'work'>('chapter')
  const [busy, setBusy] = useState(false)

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      let text = draft
      if (scope === 'work' && currentWorkId) {
        const w = await window.api.work.get(currentWorkId)
        if (w) {
          text = w.volumes.flatMap((v) => v.chapters.map((c) => c.content)).join('\n\n')
        }
      }
      setReport(await window.api.advanced.checkSensitive(text))
    } finally {
      setBusy(false)
    }
  }

  const levelLabel: Record<string, string> = { block: '需确认', warn: '建议修改', info: '提示' }
  const levelColor: Record<string, string> = {
    block: 'text-red-600',
    warn: 'text-amber-600',
    info: 'text-blue-600'
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button onClick={() => void scan()} disabled={busy} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-50">
          {busy ? '检测中…' : '开始检测'}
        </button>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'chapter' | 'work')}
          className="rounded border px-1 py-0.5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <option value="chapter">当前章节</option>
          <option value="work">整部作品</option>
        </select>
      </div>

      <p className="wa-muted text-[11px]">
        本地词库匹配，正文不会离开本机。结果仅供提示，不代替平台审核。
      </p>

      {report && (
        <>
          <div className="rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
            扫描 <b>{report.scanned}</b> 字，命中 <b>{report.total}</b> 处
            <div className="mt-0.5 flex gap-2">
              <span className="text-red-600">需确认 {report.byLevel.block}</span>
              <span className="text-amber-600">建议修改 {report.byLevel.warn}</span>
              <span className="text-blue-600">提示 {report.byLevel.info}</span>
            </div>
          </div>
          {report.hits.length === 0 ? (
            <div className="text-emerald-600">未发现敏感词 ✓</div>
          ) : (
            <ul className="space-y-1">
              {report.hits.map((h) => (
                <li key={h.word} className="flex items-center justify-between rounded border px-2 py-1" style={{ borderColor: 'var(--wa-border)' }}>
                  <span className="truncate">
                    <b>{h.word}</b>
                    <span className="wa-muted"> · {h.category}</span>
                  </span>
                  <span className={`shrink-0 ${levelColor[h.level]}`}>
                    {levelLabel[h.level]} × {h.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// ---------- 6. 写作风格学习 ----------
function StyleTab(): JSX.Element {
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const draft = useWorkStore((s) => s.draft)
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    if (!currentWorkId) return
    void window.api.advanced.getStyle(currentWorkId).then(setProfile)
  }, [currentWorkId])

  async function analyze(scope: 'chapter' | 'work'): Promise<void> {
    setBusy(true)
    try {
      const text = scope === 'chapter' ? draft : ''
      const p = await window.api.advanced.analyzeStyle(text, currentWorkId ?? undefined)
      setProfile(p)
      showToast('风格画像已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '分析失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <button onClick={() => void analyze('chapter')} disabled={busy} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-50">
          分析当前章节
        </button>
        <button onClick={() => void analyze('work')} disabled={busy || !currentWorkId} className="rounded px-2 py-0.5 hover:bg-black/5 disabled:opacity-50">
          分析整部作品
        </button>
      </div>

      {!profile ? (
        <div className="wa-muted">尚无风格画像（样本需 ≥300 字才有参考价值）</div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="平均句长" value={`${profile.avgSentenceLength} 字`} />
            <Metric label="平均段长" value={`${profile.avgParagraphLength} 字`} />
            <Metric label="对话占比" value={`${Math.round(profile.dialogueRatio * 100)}%`} />
          </div>

          <div>
            <div className="mb-1 font-semibold">高频词</div>
            {profile.topWords.length === 0 ? (
              <div className="wa-muted">样本不足</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {profile.topWords.map((w) => (
                  <span key={w.word} className="rounded bg-black/5 px-1.5 py-0.5" title={`出现 ${w.count} 次`}>
                    {w.word}
                    <span className="wa-muted"> {w.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 font-semibold">标点偏好</div>
            <div className="space-y-0.5">
              {Object.entries(profile.punctuation)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([p, ratio]) => (
                  <div key={p} className="flex items-center gap-1">
                    <span className="w-4 text-center">{p}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-black/5">
                      <div className="h-full bg-ink-500" style={{ width: `${Math.round(ratio * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right wa-muted">{Math.round(ratio * 100)}%</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="wa-muted text-[11px]">
            样本 {profile.sampleWords} 字 · 更新于 {new Date(profile.updatedAt).toLocaleString()}
            <br />
            该画像会自动作为"风格约束"注入 AI 请求，帮助保持文风一致。
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- 7. 角色一致性检查 ----------
function ConsistencyTab(): JSX.Element {
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const [report, setReport] = useState<ConsistencyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlySeverity, setOnlySeverity] = useState<'all' | 'high'>('all')
  const [charCount, setCharCount] = useState<number | null>(null)
  const showToast = useUiStore((s) => s.showToast)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  // 读取当前作品的角色数量：没有角色时检查必然无结果，必须提前提示
  useEffect(() => {
    let alive = true
    if (!currentWorkId) {
      setCharCount(null)
      return
    }
    void window.api.material
      .characters(currentWorkId)
      .then((list) => {
        if (alive) setCharCount(list.length)
      })
      .catch(() => {
        if (alive) setCharCount(null)
      })
    return () => {
      alive = false
    }
  }, [currentWorkId])

  async function run(): Promise<void> {
    if (!currentWorkId) return
    setBusy(true)
    try {
      const rep = await window.api.advanced.checkConsistency(currentWorkId)
      setReport(rep)
      // 开关被关掉时 issues 也是空的，必须与"检查过、没问题"区分开
      if (rep.disabled) {
        showToast('「角色一致性检查」已在设置 → 功能中关闭', 'error')
      } else if (rep.checkedCharacters === 0) {
        // ⚠️ 无角色时报告恒为"0 问题"，会被误认为"检查正常"。
        // 实测：materials 为空 -> checkedCharacters=0 -> issues=0，
        // 用户看到的却是一片空白，以为功能坏了。
        showToast('当前作品还没有角色，先在「角色」页添加角色后再检查', 'info')
      } else if (rep.issues.length === 0) {
        showToast(`已检查 ${rep.checkedCharacters} 个角色，未发现问题`, 'success')
      } else {
        showToast(`发现 ${rep.issues.length} 处可能的不一致`, 'info')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '检查失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const issues = useMemo(
    () => (report ? (onlySeverity === 'high' ? report.issues.filter((i) => i.severity === 'high') : report.issues) : []),
    [report, onlySeverity]
  )

  const sevColor = { high: 'text-red-600', medium: 'text-amber-600', low: 'wa-muted' }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button onClick={() => void run()} disabled={busy || !currentWorkId} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-50">
          {busy ? '检查中…' : '开始检查'}
        </button>
        <select
          value={onlySeverity}
          onChange={(e) => setOnlySeverity(e.target.value as 'all' | 'high')}
          className="rounded border px-1 py-0.5"
          style={{ borderColor: 'var(--wa-border)' }}
        >
          <option value="all">全部问题</option>
          <option value="high">仅严重</option>
        </select>
      </div>

      <p className="wa-muted text-[11px]">
        基于角色表的本地规则检查：状态冲突、特征矛盾、名字形近误写。非 AI 检测，不消耗额度。
      </p>

      {/* 前置条件提示：没有角色时检查必然无结果 */}
      {currentWorkId && charCount === 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          <div className="font-medium">当前作品还没有角色</div>
          <p className="mt-0.5">
            一致性检查需要先有角色表（姓名、特征、状态、别名）才能比对，
            否则检查结果恒为空，看起来像"功能没反应"。
          </p>
          <button
            onClick={() => setActiveTab('character')}
            className="mt-1 rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700"
          >
            去「角色」页添加角色 →
          </button>
        </div>
      )}

      {charCount !== null && charCount > 0 && (
        <div className="text-[11px] wa-muted">当前作品共有 {charCount} 个角色</div>
      )}

      {report && (
        <>
          <div className="rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
            扫描 {report.scannedChapters} 章 / {report.checkedCharacters} 个角色，发现{' '}
            <b className={report.issues.length ? 'text-amber-600' : 'text-emerald-600'}>{report.issues.length}</b> 处问题
            <span className="wa-muted">（{report.durationMs}ms）</span>
          </div>

          {/* 关键：区分"没问题"与"没得查" */}
          {report.checkedCharacters === 0 ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
              本次没有可比对的对象：该作品尚未建立角色表。
              请先在「角色」页添加角色（含姓名与特征），再回到这里检查。
            </div>
          ) : issues.length === 0 ? (
            <div className="text-emerald-600">未发现一致性问题 ✓</div>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((issue, i) => (
                <li key={i} className="rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                  <div className="flex items-center justify-between">
                    <b>{issue.character}</b>
                    <span className={sevColor[issue.severity]}>
                      {issue.severity === 'high' ? '严重' : issue.severity === 'medium' ? '中等' : '轻微'}
                    </span>
                  </div>
                  <div className="mt-0.5">{issue.description}</div>
                  {issue.excerpt && <div className="mt-0.5 wa-muted">…{issue.excerpt}…</div>}
                  <div className="mt-0.5 text-[11px] text-blue-600">建议：{issue.suggestion}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// ---------- 4. 智能分章 ----------
function SplitTab(): JSX.Element {
  const draft = useWorkStore((s) => s.draft)
  const [points, setPoints] = useState<SplitPoint[] | null>(null)
  const [target, setTarget] = useState(3000)
  const [busy, setBusy] = useState(false)

  async function run(): Promise<void> {
    setBusy(true)
    try {
      setPoints(await window.api.advanced.suggestSplits(draft, target))
    } finally {
      setBusy(false)
    }
  }

  const words = draft.replace(/\s/g, '').length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button onClick={() => void run()} disabled={busy} className="rounded bg-ink-800 px-2 py-0.5 text-white disabled:opacity-50">
          {busy ? '分析中…' : '分析分章点'}
        </button>
        <span className="wa-muted">目标每章</span>
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(Math.max(500, Number(e.target.value) || 3000))}
          className="w-20 rounded border px-1 py-0.5"
          style={{ borderColor: 'var(--wa-border)' }}
        />
        <span className="wa-muted">字</span>
      </div>

      <div className="wa-muted">
        当前草稿 {words} 字
        {points && ` · 建议分成 ${points.length + 1} 章`}
      </div>

      {points &&
        (points.length === 0 ? (
          <div className="text-emerald-600">当前长度无需分章 ✓</div>
        ) : (
          <ul className="space-y-1">
            {points.map((p, i) => (
              <li key={i} className="rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                <div className="flex items-center justify-between">
                  <b>{p.title}</b>
                  <span className="wa-muted">
                    {p.reason} · 前 {p.wordsBefore} 字
                  </span>
                </div>
                <div className="mt-0.5 wa-muted">
                  位置 {p.offset}
                  <button
                    onClick={() => {
                      const ta = document.querySelector('textarea')
                      if (ta) {
                        ta.focus()
                        ta.setSelectionRange(p.offset, p.offset)
                        ta.scrollTop = (p.offset / Math.max(1, draft.length)) * ta.scrollHeight
                      }
                    }}
                    className="ml-2 rounded px-1 text-blue-600 hover:bg-black/5"
                  >
                    定位
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

// ---------- 3. 章节目标字数 ----------
function GoalTab(): JSX.Element {
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)
  const wordCount = useWorkStore((s) => s.draft.replace(/\s/g, '').length)
  const [progress, setProgress] = useState<GoalProgress | null>(null)
  const [target, setTarget] = useState(3000)
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    if (!currentWorkId || !currentChapterId) return
    void window.api.advanced.goalProgress(currentWorkId, currentChapterId).then((p) => {
      setProgress(p)
      setTarget(p.target)
    })
  }, [currentWorkId, currentChapterId, wordCount])

  async function save(): Promise<void> {
    if (!currentWorkId || !currentChapterId) return
    const r = await window.api.advanced.setGoal(currentWorkId, currentChapterId, target)
    if (r.ok) {
      showToast('目标已更新', 'success')
      setProgress(await window.api.advanced.goalProgress(currentWorkId, currentChapterId))
    } else showToast(r.error, 'error')
  }

  if (!currentChapterId) return <div className="wa-muted">请先选择章节</div>

  const pct = progress?.percent ?? 0
  const reached = progress?.reached ?? false

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="wa-muted">本章目标</span>
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
          className="w-24 rounded border px-1 py-0.5"
          style={{ borderColor: 'var(--wa-border)' }}
        />
        <span className="wa-muted">字</span>
        <button onClick={() => void save()} className="rounded bg-ink-800 px-2 py-0.5 text-white">
          保存
        </button>
      </div>

      {progress && (
        <>
          <div className="text-2xl font-semibold tabular-nums">
            {progress.current}
            <span className="text-sm wa-muted"> / {progress.target} 字</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-black/10">
            <div className={`h-full ${reached ? 'bg-emerald-500' : 'bg-ink-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className={reached ? 'text-emerald-600' : 'wa-muted'}>
            {reached ? `已达标 ✓ 超出 ${progress.current - progress.target} 字` : `完成 ${pct}%，还差 ${progress.remaining} 字`}
          </div>
        </>
      )}

      <p className="wa-muted text-[11px]">到达 80% / 100% 时会自动提示（可在设置里关闭）。</p>
    </div>
  )
}

// ---------- 8. 健康提醒 ----------
function HealthTab(): JSX.Element {
  const [status, setStatus] = useState<HealthStatus | null>(null)
  const startRef = useRef(Date.now())
  const lastActivityRef = useRef(Date.now())
  const draft = useWorkStore((s) => s.draft)

  // 用户继续打字 -> 重置"连续写作"计时（短暂停顿不算休息）
  useEffect(() => {
    lastActivityRef.current = Date.now()
  }, [draft])

  useEffect(() => {
    let timer: number
    async function poll(): Promise<void> {
      const continuous = Date.now() - startRef.current
      setStatus(await window.api.advanced.health(continuous))
      timer = window.setTimeout(() => void poll(), 30_000)
    }
    void poll()
    return () => window.clearTimeout(timer)
  }, [])

  function resetTimer(): void {
    startRef.current = Date.now()
    void window.api.advanced.health(0).then(setStatus)
  }

  return (
    <div className="space-y-2">
      {status && (
        <>
          <div className={`rounded border p-2 ${status.shouldRest ? 'border-amber-400 bg-amber-50' : ''}`} style={status.shouldRest ? {} : { borderColor: 'var(--wa-border)' }}>
            <div className="font-medium">{status.message}</div>
            <div className="mt-1 wa-muted">
              连续写作 {Math.round(status.continuousMs / 60000)} 分钟 · 今日累计{' '}
              {Math.round(status.todayMs / 60000)} 分钟
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={resetTimer} className="rounded px-2 py-0.5 hover:bg-black/5">
              我休息过了，重新计时
            </button>
            <span className="wa-muted">提醒间隔 {Math.round(status.intervalMs / 60000)} 分钟</span>
          </div>

          <p className="wa-muted text-[11px]">
            写作重要，身体更重要。建议每 45 分钟起身活动、眺望远处。
          </p>
        </>
      )}
    </div>
  )
}

// ---------- 5. 建议质量反馈 ----------
function FeedbackTab(): JSX.Element {
  const [summary, setSummary] = useState<FeedbackSummary[]>([])
  const [busy, setBusy] = useState(false)

  async function load(): Promise<void> {
    setBusy(true)
    try {
      setSummary(await window.api.advanced.feedbackSummary())
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const totalUp = summary.reduce((s, x) => s + x.up, 0)
  const totalDown = summary.reduce((s, x) => s + x.down, 0)
  const overall =
    totalUp + totalDown > 0 ? Math.round((totalUp / (totalUp + totalDown)) * 100) : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button onClick={() => void load()} disabled={busy} className="rounded px-2 py-0.5 hover:bg-black/5">
          刷新
        </button>
        {overall !== null && <span className="wa-muted">整体好评率 {overall}%</span>}
      </div>

      <p className="wa-muted text-[11px]">
        在建议卡片上点👍/👎 会记录在此。好评率低的模板会在下次生成时自动调整语气与详细程度。
      </p>

      {summary.length === 0 ? (
        <div className="wa-muted">暂无反馈记录</div>
      ) : (
        <ul className="space-y-1">
          {summary.map((s) => (
            <li key={s.tag} className="rounded border p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="flex items-center justify-between">
                <b>{s.tag}</b>
                <span className="wa-muted">
                  👍 {s.up} · 👎 {s.down}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-black/10">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${s.rate === null ? 0 : Math.round(s.rate * 100)}%` }}
                />
              </div>
              {s.rate !== null && s.rate < 0.5 && (
                <div className="mt-0.5 text-amber-600 text-[11px]">
                  好评率偏低，建议编辑该模板的提示词
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="wa-muted text-[10px]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
