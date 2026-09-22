import { useJobsStore, type JobRecord, type JobStep } from '../store/jobs'

function kindLabel(kind: JobRecord['kind']): string {
  if (kind === 'imitate') return '细纲迭代'
  if (kind === 'breakdown') return '拆书流水线'
  if (kind === 'prompt-iterate') return '提示词迭代'
  return '任务'
}

function statusText(s: JobRecord['status']): string {
  if (s === 'running') return '进行中'
  if (s === 'paused') return '已暂停'
  if (s === 'done') return '完成'
  return '失败'
}

function stepMark(s: JobStep['status']): string {
  if (s === 'done') return '✓'
  if (s === 'running') return '●'
  if (s === 'failed') return '✕'
  if (s === 'skipped') return '–'
  return '○'
}

function JobCard({ job, onStop, onRemove }: { job: JobRecord; onStop?: () => void; onRemove?: () => void }): JSX.Element {
  const expandedId = useJobsStore((s) => s.expandedId)
  const setExpanded = useJobsStore((s) => s.setExpanded)
  const open = expandedId === job.id
  const pct = Math.round(Math.max(0, Math.min(1, job.progress)) * 100)
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--wa-glass-border)', background: 'var(--wa-glass-strong)' }}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(open ? null : job.id)}
      >
        <span className="text-[10px] wa-muted">{kindLabel(job.kind)}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{job.title}</span>
        <span className="text-[10px] wa-muted">{statusText(job.status)}</span>
        <span className="text-[10px] tabular-nums">{pct}%</span>
        {(job.status === 'running' || job.status === 'paused') && onStop && (
          <span
            role="button"
            title="停止"
            onClick={(e) => { e.stopPropagation(); onStop() }}
            className="rounded px-1 text-[10px] hover:bg-black/10"
          >停止</span>
        )}
        {(job.status === 'done' || job.status === 'failed') && onRemove && (
          <span
            role="button"
            title="移除"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="rounded px-1 text-[10px] hover:bg-black/10"
          >移除</span>
        )}
      </button>
      <div className="h-1 bg-black/10">
        <div
          className="h-full transition-all"
          style={{ width: pct + '%', background: job.status === 'failed' ? 'var(--wa-danger)' : 'var(--wa-accent)' }}
        />
      </div>
      {open && (
        <div className="space-y-2 px-3 py-2">
          <div className="text-[11px] leading-relaxed wa-muted">{job.message}</div>
          <ol className="space-y-1">
            {job.steps.map((st) => (
              <li key={st.id} className="flex items-start gap-2 text-[11px]">
                <span className={st.status === 'running' ? 'text-[var(--wa-accent)]' : 'wa-muted'}>{stepMark(st.status)}</span>
                <span className="min-w-0 flex-1">
                  <span className={st.status === 'running' ? 'font-medium' : ''}>{st.label}</span>
                  {typeof st.score === 'number' && <span className="ml-1 tabular-nums">{st.score}分</span>}
                  {st.detail && <div className="wa-muted">{st.detail}</div>}
                </span>
              </li>
            ))}
          </ol>
          {job.logs.length > 0 && (
            <div className="max-h-24 overflow-auto rounded border px-2 py-1 text-[10px] leading-relaxed wa-muted" style={{ borderColor: 'var(--wa-border)' }}>
              {job.logs.slice(-8).map((l, i) => (
                <div key={i}>{new Date(l.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {l.text}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 全局任务进度：细纲迭代 / 拆书流水线 / 提示词迭代。
 * 右下角浮层，默认收成一条，点开看步骤。
 */
export function JobProgressPanel(): JSX.Element | null {
  const jobs = useJobsStore((s) => s.jobs)
  const open = useJobsStore((s) => s.open)
  const setOpen = useJobsStore((s) => s.setOpen)
  const clearFinished = useJobsStore((s) => s.clearFinished)
  const remove = useJobsStore((s) => s.remove)

  async function stopJob(j: JobRecord): Promise<void> {
    if (j.kind === 'imitate') {
      const [, projectId, chapterId] = j.id.split(':')
      const { markImitationCancelled } = await import('../services/breakdownPipeline')
      markImitationCancelled(projectId, chapterId)
    } else if (j.kind === 'breakdown') {
      const [, projectId] = j.id.split(':')
      await window.api.bookBreakdown.pause(projectId)
    }
    useJobsStore.getState().patch(j.id, { status: 'paused', message: '已请求停止，将在当前请求结束后停下' })
  }
  if (jobs.length === 0) return null
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'paused').length
  const latest = jobs[0]
  const pct = Math.round((latest?.progress ?? 0) * 100)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] w-[min(380px,calc(100vw-2rem))]">
      {!open && (
        <button
          type="button"
          className="pointer-events-auto flex w-full items-center gap-2 rounded-full border px-3 py-2 text-left text-[12px] shadow-lg wa-panel"
          style={{ borderColor: 'var(--wa-glass-border)' }}
          onClick={() => setOpen(true)}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: running ? 'var(--wa-accent)' : 'var(--wa-muted)' }} />
          <span className="min-w-0 flex-1 truncate">{latest?.message || latest?.title}</span>
          <span className="tabular-nums wa-muted">{pct}%</span>
        </button>
      )}
      {open && (
        <div className="pointer-events-auto space-y-2 rounded-2xl border p-2 shadow-2xl wa-panel" style={{ borderColor: 'var(--wa-glass-border)' }}>
          <div className="flex items-center gap-2 px-1">
            <span className="text-[12px] font-semibold">任务进度</span>
            <span className="text-[10px] wa-muted">{running ? running + ' 个进行中' : '全部结束'}</span>
            <div className="flex-1" />
            <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-black/5" onClick={clearFinished}>清除已完成</button>
            <button type="button" className="rounded px-1.5 py-0.5 text-[10px] hover:bg-black/5" onClick={() => setOpen(false)}>收起</button>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-auto">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} onStop={() => { void stopJob(j) }} onRemove={() => remove(j.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
