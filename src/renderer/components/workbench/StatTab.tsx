import { useEffect, useState } from 'react'
import { useMaterialStore } from '../../store/material'
import { useUiStore } from '../../store/ui'
import { VizPanel } from '../viz/VizPanel'

type View = 'viz' | 'recent'

/**
 * 统计标签页（阶段 6 + 阶段 13）。
 *
 * 上：概览数字与近 7 天（来自 material store，子智能体 C）
 * 下：数据可视化（阶段 13 主智能体：写作日历 / 趋势 / 角色频次 / 伏笔回收率）
 */
export function StatTab(): JSX.Element {
  const workId = useMaterialStore((s) => s.workId)
  const weekStats = useMaterialStore((s) => s.weekStats)
  const allStats = useMaterialStore((s) => s.allStats)
  const loadStats = useMaterialStore((s) => s.loadStats)
  const showToast = useUiStore((s) => s.showToast)
  const [view, setView] = useState<View>('viz')

  useEffect(() => {
    if (!workId) return
    void loadStats().catch((err) => {
      showToast(err instanceof Error ? err.message : '加载统计失败', 'error')
    })
  }, [workId, loadStats, showToast])

  if (!workId) {
    return <div className="p-4 text-xs wa-muted">请先创建或选择一部作品</div>
  }

  const weekTotal = weekStats.reduce((s, d) => s + d.words, 0)
  const allTotal = allStats.reduce((s, d) => s + d.words, 0)
  const activeDays = allStats.filter((d) => d.words > 0).length
  const weekMax = Math.max(...weekStats.map((d) => d.words), 1)
  const totalMs = allStats.reduce((s, d) => s + (d.durationMs ?? 0), 0)

  return (
    <div className="flex h-full flex-col text-xs">
      {/* 视图切换 */}
      <div className="flex shrink-0 gap-0.5 border-b p-1.5" style={{ borderColor: 'var(--wa-border)' }}>
        <button
          onClick={() => setView('recent')}
          className={`rounded px-2 py-0.5 ${view === 'recent' ? 'bg-ink-800 text-white' : 'hover:bg-black/5'}`}
        >
          近期概览
        </button>
        <button
          onClick={() => setView('viz')}
          className={`rounded px-2 py-0.5 ${view === 'viz' ? 'bg-ink-800 text-white' : 'hover:bg-black/5'}`}
        >
          数据可视化
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'recent' ? (
          <div className="space-y-3 p-2">
            {/* 概览 */}
            <div className="grid grid-cols-2 gap-2">
              <Card label="本周字数" value={weekTotal.toLocaleString()} />
              <Card label="累计字数" value={allTotal.toLocaleString()} />
              <Card label="写作天数" value={`${activeDays} 天`} />
              <Card label="累计时长" value={`${Math.round(totalMs / 3600000)} 小时`} />
            </div>

            {/* 近 7 天柱状 */}
            <div className="rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="mb-1.5 font-semibold">近 7 天</div>
              <div className="flex h-24 items-end gap-1.5">
                {weekStats.map((d) => {
                  const h = Math.max(d.words > 0 ? 3 : 0, (d.words / weekMax) * 100)
                  return (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-[10px] tabular-nums wa-muted">{d.words || ''}</span>
                      <div
                        className="w-full rounded-t bg-ink-500"
                        style={{ height: `${h}%` }}
                        title={`${d.date}：${d.words} 字`}
                      />
                      <span className="text-[10px] wa-muted">{d.date.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 明细 */}
            <div className="rounded border" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="border-b px-2 py-1 font-semibold" style={{ borderColor: 'var(--wa-border)' }}>
                历史明细（近 30 条）
              </div>
              <ul className="divide-y" style={{ borderColor: 'var(--wa-border)' }}>
                {[...allStats]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 30)
                  .map((d) => (
                    <li key={d.date} className="flex items-center justify-between px-2 py-1">
                      <span>{d.date}</span>
                      <span className="wa-muted">
                        {d.words} 字
                        {d.durationMs ? ` · ${Math.round(d.durationMs / 60000)} 分` : ''}
                      </span>
                    </li>
                  ))}
                {allStats.length === 0 && (
                  <li className="px-2 py-3 text-center wa-muted">暂无记录</li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <VizPanel />
        )}
      </div>
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="wa-muted text-[10px]">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}
