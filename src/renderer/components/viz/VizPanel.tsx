import { useEffect, useMemo, useState } from 'react'
import type { VizOverview, CalendarCell } from '@shared/viz'
import { useUiStore } from '../../store/ui'
import { useWorkStore } from '../../store/work'

/** 热度色阶（与主题无关的绿色渐变，类似贡献图） */
const LEVEL_BG = ['bg-black/5', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700']
const LEVEL_DARK_BG = ['bg-white/5', 'bg-emerald-900', 'bg-emerald-700', 'bg-emerald-500', 'bg-emerald-400']

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 数据可视化面板（阶段 13）。
 *
 * 全部用 div + CSS 绘制，不引入任何图表库：
 *  - 写作日历（贡献图）
 *  - 字数趋势（柱状 + 滑动平均折线用分段 div 模拟）
 *  - 角色出场频次（横向条）
 *  - 伏笔回收率（环形用 conic-gradient）
 */
export function VizPanel(): JSX.Element {
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const showToast = useUiStore((s) => s.showToast)
  const [data, setData] = useState<VizOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState(90)
  const [tip, setTip] = useState<string | null>(null)

  useEffect(() => {
    if (!currentWorkId) return
    let cancelled = false
    setLoading(true)
    void window.api.viz
      .overview(currentWorkId, range)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) showToast(err instanceof Error ? err.message : '加载统计失败', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentWorkId, range, showToast])

  if (!currentWorkId) {
    return <div className="p-4 text-sm wa-muted">请先创建或选择一部作品</div>
  }
  if (loading && !data) {
    return <div className="p-4 text-sm wa-muted">统计中…</div>
  }
  if (!data) {
    return <div className="p-4 text-sm wa-muted">暂无统计数据</div>
  }

  return (
    <div className="space-y-4 p-3 text-xs">
      {/* 区间切换 */}
      <div className="flex items-center gap-1">
        {[30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setRange(d)}
            className={`rounded px-2 py-0.5 ${range === d ? 'bg-ink-800 text-white' : 'hover:bg-black/5'}`}
          >
            {d === 365 ? '一年' : `${d} 天`}
          </button>
        ))}
        <div className="flex-1" />
        {tip && <span className="wa-muted">{tip}</span>}
      </div>

      {/* 概览数字 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="总字数" value={formatNum(data.trend.total)} />
        <Stat label="日均" value={formatNum(data.trend.average)} />
        <Stat label="活跃天数" value={`${data.calendar.activeDays}`} />
        <Stat
          label="连续天数"
          value={`${data.calendar.currentStreak}`}
          hint={`最长 ${data.calendar.maxStreak} 天`}
        />
      </div>

      {/* 写作日历 */}
      <Section title="写作日历">
        <CalendarHeatmap
          weeks={data.calendar.weeks}
          monthLabels={data.calendar.monthLabels}
          onHover={(c) => setTip(c ? `${c.date}：${c.words} 字` : null)}
        />
        <div className="mt-1.5 flex items-center gap-1 wa-muted">
          <span>少</span>
          {LEVEL_BG.map((c, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-sm ${c}`} />
          ))}
          <span>多</span>
          {data.calendar.bestDay && (
            <span className="ml-2">
              最高：{data.calendar.bestDay.date}（{formatNum(data.calendar.bestDay.words)} 字）
            </span>
          )}
        </div>
      </Section>

      {/* 字数趋势 */}
      <Section
        title="字数趋势"
        right={
          <span className={data.trend.direction === 'up' ? 'text-emerald-600' : data.trend.direction === 'down' ? 'text-red-500' : 'wa-muted'}>
            {data.trend.direction === 'up' ? '↑ 上升' : data.trend.direction === 'down' ? '↓ 下降' : '→ 持平'}
          </span>
        }
      >
        <BarChart points={data.trend.points} />
        <div className="mt-1 flex justify-between wa-muted">
          <span>{data.trend.points[0]?.date.slice(5)}</span>
          <span>峰值 {formatNum(data.trend.peak)}</span>
          <span>{data.trend.points[data.trend.points.length - 1]?.date.slice(5)}</span>
        </div>
      </Section>

      {/* 角色出场频次 */}
      <Section title="角色出场频次">
        {data.characters.length === 0 ? (
          <div className="wa-muted">尚未建立角色表</div>
        ) : (
          <div className="space-y-1.5">
            {data.characters.slice(0, 12).map((c) => {
              const max = data.characters[0].count || 1
              const pct = Math.max(2, Math.round((c.count / max) * 100))
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="wa-muted">
                      {c.count} 次 · {c.chaptersPresent} 章
                    </span>
                  </div>
                  <div className="mt-0.5 h-2 w-full overflow-hidden rounded bg-black/5">
                    <div className="h-full bg-ink-600 rounded" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="wa-muted text-[10px]">
                    {c.firstAppearChapter && `首次：${c.firstAppearChapter}`}
                    {c.lastAppearChapter && c.lastAppearChapter !== c.firstAppearChapter
                      ? ` · 最近：${c.lastAppearChapter}`
                      : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* 伏笔回收率 */}
      <Section title="伏笔回收率">
        <div className="flex items-center gap-3">
          <Donut rate={data.foreshadow.rate} />
          <div className="space-y-0.5">
            <div>
              总伏笔 <b>{data.foreshadow.total}</b>
            </div>
            <div className="text-emerald-600">已回收 {data.foreshadow.recovered}</div>
            <div className="text-amber-600">待回收 {data.foreshadow.planted}</div>
            {data.foreshadow.avgRecoverDistance !== null && (
              <div className="wa-muted">平均跨 {data.foreshadow.avgRecoverDistance} 章回收</div>
            )}
          </div>
        </div>

        {data.foreshadow.monthly.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 wa-muted">近月埋设 / 回收</div>
            <div className="flex items-end gap-1.5">
              {data.foreshadow.monthly.map((m) => {
                const max = Math.max(
                  ...data.foreshadow.monthly.map((x) => Math.max(x.planted, x.recovered)),
                  1
                )
                return (
                  <div key={m.month} className="flex flex-col items-center gap-0.5">
                    <div className="flex h-16 items-end gap-0.5">
                      <div
                        className="w-2 rounded-t bg-amber-400"
                        style={{ height: `${(m.planted / max) * 100}%` }}
                        title={`${m.month} 埋设 ${m.planted}`}
                      />
                      <div
                        className="w-2 rounded-t bg-emerald-500"
                        style={{ height: `${(m.recovered / max) * 100}%` }}
                        title={`${m.month} 回收 ${m.recovered}`}
                      />
                    </div>
                    <span className="text-[9px] wa-muted">{m.month.slice(5)}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex gap-2 wa-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-amber-400" />
                埋设
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                回收
              </span>
            </div>
          </div>
        )}

        {data.foreshadow.stale.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-amber-700">长期未回收（超过 10 章）</div>
            <ul className="space-y-0.5">
              {data.foreshadow.stale.slice(0, 8).map((s) => (
                <li key={s.id} className="truncate">
                  · {s.content}
                  <span className="wa-muted">（{s.plantedChapter}，已过 {s.chaptersSince} 章）</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  )
}

function formatNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return `${n}`
}


function Section({
  title,
  right,
  children
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="wa-muted text-[10px]">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="wa-muted text-[10px]">{hint}</div>}
    </div>
  )
}

/** 贡献图式日历 */
function CalendarHeatmap({
  weeks,
  monthLabels,
  onHover
}: {
  weeks: Array<Array<CalendarCell | null>>
  monthLabels: Array<{ weekIndex: number; label: string }>
  onHover: (c: CalendarCell | null) => void
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        {/* 星期标签 */}
        <div className="flex flex-col gap-[3px] pr-1 pt-3.5">
          {WEEKDAYS.map((d, i) => (
            <span key={d} className="h-2.5 text-[9px] leading-[10px] wa-muted">
              {i % 2 === 0 ? d : ''}
            </span>
          ))}
        </div>
        {/* 周列 */}
        <div className="flex flex-col">
          {/* 月份标签 */}
          <div className="flex h-3">
            {weeks.map((_, wi) => {
              const label = monthLabels.find((m) => m.weekIndex === wi)
              return (
                <span key={wi} className="w-[13px] text-[9px] wa-muted">
                  {label ? label.label : ''}
                </span>
              )
            })}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell, di) =>
                  cell ? (
                    <div
                      key={di}
                      onMouseEnter={() => onHover(cell)}
                      onMouseLeave={() => onHover(null)}
                      title={`${cell.date}：${cell.words} 字`}
                      className={`h-2.5 w-2.5 rounded-sm ${LEVEL_BG[cell.level]}`}
                    />
                  ) : (
                    <div key={di} className="h-2.5 w-2.5" />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 纯 CSS 柱状图 + 滑动平均折线（用分段 div 近似） */
function BarChart({
  points
}: {
  points: Array<{ date: string; words: number; movingAvg: number }>
}): JSX.Element {
  const max = useMemo(() => Math.max(...points.map((p) => p.words), 1), [points])
  const avgMax = useMemo(() => Math.max(...points.map((p) => p.movingAvg), 1), [points])

  // 控制柱子数量，避免过密（最多 120 根）
  const step = Math.max(1, Math.ceil(points.length / 120))
  const shown = points.filter((_, i) => i % step === 0)

  return (
    <div className="relative">
      <div className="flex h-24 items-end gap-[1px]">
        {shown.map((p, i) => {
          const h = Math.max(p.words > 0 ? 2 : 0, (p.words / max) * 100)
          return (
            <div
              key={i}
              className="flex-1 rounded-t bg-ink-500/70 hover:bg-ink-700"
              style={{ height: `${h}%` }}
              title={`${p.date}：${p.words} 字`}
            />
          )
        })}
      </div>
      {/* 滑动平均线：用绝对定位的小段拼接 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24">
        {shown.map((p, i) => {
          if (i === 0) return null
          const prev = shown[i - 1]
          const y1 = 100 - (prev.movingAvg / avgMax) * 100
          const y2 = 100 - (p.movingAvg / avgMax) * 100
          const w = 100 / shown.length
          // 用一条细线近似连接两点
          return (
            <div
              key={i}
              className="absolute bg-amber-500"
              style={{
                left: `${i * w}%`,
                top: `${y2}%`,
                width: `${w}%`,
                height: '1.5px',
                transform: `rotate(${Math.atan2(y1 - y2, 100 / shown.length) * (180 / Math.PI)}deg)`,
                transformOrigin: 'left center'
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** 纯 CSS 环形图（conic-gradient） */
function Donut({ rate }: { rate: number }): JSX.Element {
  const pct = Math.round(rate * 100)
  return (
    <div
      className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--wa-accent, #10b981) ${pct * 3.6}deg, rgba(0,0,0,0.08) 0deg)`
      }}
      title={`回收率 ${pct}%`}
    >
      <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-[13px] font-semibold">
        {pct}%
      </div>
    </div>
  )
}

