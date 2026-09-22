/**
 * 数据可视化计算（阶段 13）。
 *
 * 全部由本地数据计算，渲染层用 div+CSS 绘制，不引入图表库。
 */
import type {
  WritingCalendar,
  CalendarCell,
  WordTrend,
  TrendPoint,
  CharacterFrequency,
  ForeshadowRate,
  VizOverview
} from '@shared/viz'
import type { DailyStat, Character, Foreshadowing } from '@shared/material'
import type { Work } from '@shared/work'

/** YYYY-MM-DD（本地时区） */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 字数 -> 热度等级 */
function levelOf(words: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (words <= 0) return 0
  if (words < thresholds[0]) return 1
  if (words < thresholds[1]) return 2
  if (words < thresholds[2]) return 3
  return 4
}

/**
 * 构建写作日历（GitHub 贡献图风格）。
 * @param stats 每日统计
 * @param days 统计天数（默认 365）
 */
export function buildCalendar(stats: DailyStat[], days = 365): WritingCalendar {
  const byDay = new Map<string, { words: number; durationMs: number }>()
  for (const s of stats) {
    // DailyStat.date 已是 YYYY-MM-DD
    const key = s.date
    const cur = byDay.get(key) ?? { words: 0, durationMs: 0 }
    cur.words += s.words
    cur.durationMs += s.durationMs
    byDay.set(key, cur)
  }

  // 阈值取分位数（自适应），退化时用固定值
  const values = Array.from(byDay.values())
    .map((v) => v.words)
    .filter((w) => w > 0)
    .sort((a, b) => a - b)
  const q = (p: number): number => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : 1000)
  const thresholds: [number, number, number] = [q(0.25) || 500, q(0.6) || 1500, q(0.85) || 3000]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  // 回退到周一
  const dow = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - dow)

  const weeks: Array<Array<CalendarCell | null>> = []
  const monthLabels: Array<{ weekIndex: number; label: string }> = []
  let cursor = new Date(start)
  let totalWords = 0
  let activeDays = 0
  let bestDay: { date: string; words: number } | null = null
  const activeKeys: string[] = []

  while (cursor <= today) {
    const week: Array<CalendarCell | null> = []
    for (let d = 0; d < 7; d++) {
      if (cursor > today) {
        week.push(null)
        cursor.setDate(cursor.getDate() + 1)
        continue
      }
      const key = dayKey(cursor.getTime())
      const rec = byDay.get(key)
      const words = rec?.words ?? 0
      const cell: CalendarCell = {
        date: key,
        words,
        level: levelOf(words, thresholds),
        durationMs: rec?.durationMs ?? 0,
        future: false
      }
      if (words > 0) {
        activeDays++
        activeKeys.push(key)
        totalWords += words
        if (!bestDay || words > bestDay.words) bestDay = { date: key, words }
      }
      week.push(cell)
      cursor.setDate(cursor.getDate() + 1)
    }
    // 月份标签：该周第一天是月初附近则打标
    const firstOfWeek = week.find((c) => c)
    if (firstOfWeek) {
      const d = new Date(firstOfWeek.date)
      if (d.getDate() <= 7) {
        monthLabels.push({ weekIndex: weeks.length, label: `${d.getMonth() + 1}月` })
      }
    }
    weeks.push(week)
  }

  // 连续天数
  activeKeys.sort()
  let maxStreak = 0
  let run = 0
  let prev: string | null = null
  for (const k of activeKeys) {
    if (prev) {
      const pd = new Date(prev)
      pd.setDate(pd.getDate() + 1)
      run = dayKey(pd.getTime()) === k ? run + 1 : 1
    } else run = 1
    maxStreak = Math.max(maxStreak, run)
    prev = k
  }
  // 当前连续（从今天或昨天往前）
  let currentStreak = 0
  const todayKey = dayKey(today.getTime())
  const activeSet = new Set(activeKeys)
  let probe = new Date(today)
  if (!activeSet.has(todayKey)) probe.setDate(probe.getDate() - 1)
  for (;;) {
    const k = dayKey(probe.getTime())
    if (!activeSet.has(k)) break
    currentStreak++
    probe.setDate(probe.getDate() - 1)
  }

  return { weeks, monthLabels, totalWords, activeDays, maxStreak, currentStreak, bestDay }
}

/** 字数趋势（含 7 日滑动平均与累计） */
export function buildTrend(stats: DailyStat[], days = 30): WordTrend {
  const byDay = new Map<string, number>()
  for (const s of stats) {
    // DailyStat.date 已是 YYYY-MM-DD
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.words)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const points: TrendPoint[] = []
  const window: number[] = []
  let cumulative = 0

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = dayKey(d.getTime())
    const words = byDay.get(key) ?? 0
    cumulative += words
    window.push(words)
    if (window.length > 7) window.shift()
    const movingAvg = Math.round(window.reduce((a, b) => a + b, 0) / window.length)
    points.push({ date: key, words, movingAvg, cumulative })
  }

  const total = points.reduce((s, p) => s + p.words, 0)
  const average = Math.round(total / Math.max(1, points.length))
  const peak = points.reduce((m, p) => Math.max(m, p.words), 0)

  // 趋势：后半段 vs 前半段平均
  const half = Math.floor(points.length / 2)
  const firstHalf = points.slice(0, half)
  const secondHalf = points.slice(half)
  const avg = (arr: TrendPoint[]): number => (arr.length ? arr.reduce((s, p) => s + p.words, 0) / arr.length : 0)
  const a = avg(firstHalf)
  const b = avg(secondHalf)
  const direction: 'up' | 'down' | 'flat' = b > a * 1.1 ? 'up' : b < a * 0.9 ? 'down' : 'flat'

  return { points, average, peak, total, direction }
}

/** 角色出场频次 */
export function buildCharacterFrequency(work: Work, characters: Character[]): CharacterFrequency[] {
  const chapters = work.volumes.flatMap((v) => v.chapters)
  const out: CharacterFrequency[] = []

  for (const c of characters) {
    if (!c.name) continue
    const names = [c.name, ...(c.aliases ?? [])]
    let count = 0
    let firstAppearChapter = ''
    let lastAppearChapter = ''
    let chaptersPresent = 0
    const perChapter: Array<{ chapterId: string; title: string; count: number }> = []

    for (const ch of chapters) {
      let chCount = 0
      for (const n of names) {
        if (!n) continue
        let from = 0
        for (;;) {
          const idx = ch.content.indexOf(n, from)
          if (idx < 0) break
          chCount++
          from = idx + n.length
        }
      }
      if (chCount > 0) {
        count += chCount
        chaptersPresent++
        if (!firstAppearChapter) firstAppearChapter = ch.title
        lastAppearChapter = ch.title
        perChapter.push({ chapterId: ch.id, title: ch.title, count: chCount })
      }
    }

    out.push({ name: c.name, count, firstAppearChapter, lastAppearChapter, chaptersPresent, perChapter })
  }

  return out.sort((a, b) => b.count - a.count)
}

/** 伏笔回收率 */
export function buildForeshadowRate(work: Work, foreshadowings: Foreshadowing[]): ForeshadowRate {
  const chapters = work.volumes.flatMap((v) => v.chapters)
  const indexOf = new Map<string, number>()
  chapters.forEach((c, i) => indexOf.set(c.id, i))

  const total = foreshadowings.length
  let recovered = 0
  const distances: number[] = []
  const stale: ForeshadowRate['stale'] = []
  const lastIndex = chapters.length - 1

  for (const f of foreshadowings) {
    const isRecovered = f.status === 'recovered' || !!f.recoveredChapterId
    if (isRecovered) {
      recovered++
      const pi = f.chapterId ? indexOf.get(f.chapterId) : undefined
      const ri = f.recoveredChapterId ? indexOf.get(f.recoveredChapterId) : undefined
      if (pi !== undefined && ri !== undefined && ri >= pi) distances.push(ri - pi)
    } else {
      const pi = f.chapterId ? indexOf.get(f.chapterId) : undefined
      const plantedChapter = pi !== undefined ? chapters[pi].title : '未知'
      const chaptersSince = pi !== undefined ? lastIndex - pi : 0
      // 超过 10 章未回收视为长期未回收
      if (chaptersSince > 10) {
        stale.push({ id: f.id, content: f.content, plantedChapter, chaptersSince })
      }
    }
  }

  // 月度埋设/回收
  const monthlyMap = new Map<string, { planted: number; recovered: number }>()
  const monthOf = (ts?: number): string => {
    const d = ts ? new Date(ts) : new Date()
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`
  }
  for (const f of foreshadowings) {
    const pm = monthOf(f.createdAt)
    const rec = monthlyMap.get(pm) ?? { planted: 0, recovered: 0 }
    rec.planted++
    monthlyMap.set(pm, rec)
    if (f.status === 'recovered' || f.recoveredChapterId) {
      const rm = monthOf(f.updatedAt)
      const r = monthlyMap.get(rm) ?? { planted: 0, recovered: 0 }
      r.recovered++
      monthlyMap.set(rm, r)
    }
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)

  return {
    total,
    recovered,
    planted: total - recovered,
    rate: total > 0 ? Math.round((recovered / total) * 100) / 100 : 0,
    avgRecoverDistance: distances.length
      ? Math.round((distances.reduce((a, b) => a + b, 0) / distances.length) * 10) / 10
      : null,
    stale: stale.sort((a, b) => b.chaptersSince - a.chaptersSince),
    monthly
  }
}

/** 一次取全量可视化数据 */
export function buildOverview(
  work: Work,
  stats: DailyStat[],
  characters: Character[],
  foreshadowings: Foreshadowing[],
  days = 90
): VizOverview {
  return {
    calendar: buildCalendar(stats, Math.max(days, 365)),
    trend: buildTrend(stats, days),
    characters: buildCharacterFrequency(work, characters),
    foreshadow: buildForeshadowRate(work, foreshadowings),
    rangeDays: days
  }
}
