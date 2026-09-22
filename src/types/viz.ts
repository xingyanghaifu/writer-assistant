/**
 * 阶段 13 数据可视化类型。
 * 全部用 div + CSS 绘制，不引入图表库。
 */

/** 写作日历格子（一分钟热度） */
export interface CalendarCell {
  /** YYYY-MM-DD */
  date: string
  /** 当日字数 */
  words: number
  /** 0-4 热度等级 */
  level: 0 | 1 | 2 | 3 | 4
  /** 当日写作时长（毫秒） */
  durationMs: number
  /** 是否未来日期 */
  future: boolean
}

/** 写作日历 */
export interface WritingCalendar {
  /** 按周分组的格子（每周 7 天，周一起） */
  weeks: Array<Array<CalendarCell | null>>
  /** 月份标签（列索引 -> 月份） */
  monthLabels: Array<{ weekIndex: number; label: string }>
  /** 总字数 */
  totalWords: number
  /** 有记录的天数 */
  activeDays: number
  /** 最长连续写作天数 */
  maxStreak: number
  /** 当前连续天数 */
  currentStreak: number
  /** 单日最高 */
  bestDay: { date: string; words: number } | null
}

/** 字数趋势点 */
export interface TrendPoint {
  date: string
  words: number
  /** 7 日滑动平均 */
  movingAvg: number
  /** 累计字数 */
  cumulative: number
}

/** 字数趋势 */
export interface WordTrend {
  points: TrendPoint[]
  /** 日均 */
  average: number
  /** 峰值 */
  peak: number
  /** 总字数 */
  total: number
  /** 趋势方向 */
  direction: 'up' | 'down' | 'flat'
}

/** 角色出场频次 */
export interface CharacterFrequency {
  name: string
  /** 总出现次数 */
  count: number
  /** 首次出场章节标题 */
  firstAppearChapter: string
  /** 最后出场章节标题 */
  lastAppearChapter: string
  /** 出场章节数 */
  chaptersPresent: number
  /** 按章节的出现序列（用于趋势） */
  perChapter: Array<{ chapterId: string; title: string; count: number }>
}

/** 伏笔回收率 */
export interface ForeshadowRate {
  /** 总伏笔数 */
  total: number
  /** 已回收 */
  recovered: number
  /** 已埋设未回收 */
  planted: number
  /** 回收率 0-1 */
  rate: number
  /** 平均回收间隔（章） */
  avgRecoverDistance: number | null
  /** 长期未回收（超过 N 章） */
  stale: Array<{ id: string; content: string; plantedChapter: string; chaptersSince: number }>
  /** 按月埋设/回收趋势 */
  monthly: Array<{ month: string; planted: number; recovered: number }>
}

/** 可视化总览（一次请求取全部，减少 IPC 往返） */
export interface VizOverview {
  calendar: WritingCalendar
  trend: WordTrend
  characters: CharacterFrequency[]
  foreshadow: ForeshadowRate
  /** 统计区间天数 */
  rangeDays: number
}
