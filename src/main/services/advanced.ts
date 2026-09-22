/**
 * 智能分章 + 章节目标字数 + 健康提醒（阶段 11）。
 */
import type {
  GoalProgress,
  HealthStatus,
  OutlineDraft
} from '@shared/advanced'
import type { SplitPoint } from '@shared/suggestion'

/**
 * 智能分章：在长文本中建议分章位置。
 *
 * 依据优先级：场景切换（时间/地点转换词）> 段落空行 > 字数阈值
 */
export function suggestSplits(
  text: string,
  options: { targetWords?: number; minWords?: number } = {}
): SplitPoint[] {
  const target = options.targetWords ?? 3000
  const minWords = options.minWords ?? Math.max(600, Math.floor(target * 0.35))

  const paragraphs = text.split(/\n{2,}/)
  const out: SplitPoint[] = []
  let words = 0
  let index = 0

  // 场景切换信号
  const sceneRe =
    /^(?:第[二三四五六七八九十]+天|次日|翌日|第二天|三天后|一周后|一个月后|半年后|多年后|与此同时|另一边|另一头|镜头转向|场景|地点|回到|回到家中|时间来到)/

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const pw = p.replace(/\s/g, '').length
    words += pw
    index += p.length + 2

    if (words < minWords) continue

    const next = paragraphs[i + 1]?.trim() ?? ''
    let kind: SplitPoint['kind'] | undefined
    if (sceneRe.test(next)) kind = 'scene'
    else if (pw > 0 && words >= target) kind = 'wordCount'
    else if (i + 1 < paragraphs.length && !paragraphs[i + 1].startsWith('　　') && words >= target * 0.8) {
      kind = 'transition'
    }

    if (kind) {
      out.push({
        offset: index,
        title: guessTitle(next || p),
        reason:
          kind === 'scene' ? '场景切换' : kind === 'wordCount' ? '已达目标字数' : '段落过渡处',
        kind,
        wordsBefore: words
      })
      words = 0
    }
  }

  return out
}

/** 从段落猜测标题（取首句前若干字） */
function guessTitle(p: string): string {
  const first = p.split(/[。！？\n]/)[0]?.trim() ?? ''
  const t = first.replace(/^[\s　]+/, '').slice(0, 14)
  return t || '新章节'
}

/** 计算章节目标进度 */
export function goalProgress(current: number, target: number): GoalProgress {
  const safeTarget = Math.max(1, target)
  const percent = Math.min(100, Math.round((current / safeTarget) * 100))
  return {
    chapterId: '',
    current,
    target: safeTarget,
    percent,
    reached: current >= safeTarget,
    remaining: Math.max(0, safeTarget - current)
  }
}

/** 健康提醒默认间隔：45 分钟 */
export const DEFAULT_HEALTH_INTERVAL_MS = 45 * 60 * 1000

/**
 * 健康状态计算。
 * @param continuousMs 本次连续写作时长
 * @param todayMs 今日累计
 * @param intervalMs 提醒间隔
 * @param enabled 是否开启
 * @param lastRemindedAt 上次提醒时间
 */
export function healthStatus(params: {
  continuousMs: number
  todayMs: number
  intervalMs: number
  enabled: boolean
  lastRemindedAt?: number
}): HealthStatus {
  const { continuousMs, todayMs, enabled } = params
  const intervalMs = params.intervalMs > 0 ? params.intervalMs : DEFAULT_HEALTH_INTERVAL_MS

  const sinceLast = params.lastRemindedAt ? Date.now() - params.lastRemindedAt : Infinity
  const shouldRest = enabled && continuousMs >= intervalMs && sinceLast >= intervalMs

  let message = ''
  if (!enabled) message = '健康提醒已关闭'
  else if (shouldRest) {
    const mins = Math.round(continuousMs / 60000)
    message = `已连续写作 ${mins} 分钟，起来活动一下、看看远处吧`
  } else {
    const remain = Math.max(0, intervalMs - continuousMs)
    message = `下次提醒约 ${Math.ceil(remain / 60000)} 分钟后`
  }

  return {
    continuousMs,
    todayMs,
    shouldRest,
    message,
    intervalMs,
    enabled,
    nextReminderAt: enabled && shouldRest ? Date.now() : enabled ? Date.now() + Math.max(0, intervalMs - continuousMs) : null
  }
}

/**
 * 从 AI 返回的章纲文本解析结构化结果（一键生成章纲）。
 * 容错：解析失败则整段作为 beats。
 */
export function parseOutlineDraft(raw: string, fallbackTitle: string): OutlineDraft {
  const text = raw.trim()
  const draft: OutlineDraft = {
    title: fallbackTitle,
    goal: '',
    beats: [],
    characters: [],
    foreshadowings: [],
    estimatedWords: 3000
  }

  // 尝试提取 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Partial<OutlineDraft>
      if (obj.title) draft.title = String(obj.title)
      if (obj.goal) draft.goal = String(obj.goal)
      if (Array.isArray(obj.beats)) draft.beats = obj.beats.map(String)
      if (Array.isArray(obj.characters)) draft.characters = obj.characters.map(String)
      if (Array.isArray(obj.foreshadowings)) draft.foreshadowings = obj.foreshadowings.map(String)
      if (typeof obj.estimatedWords === 'number') draft.estimatedWords = obj.estimatedWords
      return draft
    } catch {
      /* 落到文本解析 */
    }
  }

  // 文本解析：按行识别"标题/目标/情节点/角色/伏笔"
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^(?:标题|章名)[:：]/.test(line)) draft.title = line.replace(/^(?:标题|章名)[:：]\s*/, '')
    else if (/^(?:目标|本章目标)[:：]/.test(line)) draft.goal = line.replace(/^(?:目标|本章目标)[:：]\s*/, '')
    else if (/^(?:涉及角色|角色)[:：]/.test(line)) {
      draft.characters = line
        .replace(/^(?:涉及角色|角色)[:：]\s*/, '')
        .split(/[、,，\s]+/)
        .filter(Boolean)
    } else if (/^(?:伏笔|埋设伏笔|回收伏笔)[:：]/.test(line)) {
      draft.foreshadowings = line
        .replace(/^(?:伏笔|埋设伏笔|回收伏笔)[:：]\s*/, '')
        .split(/[；;、]+/)
        .filter(Boolean)
    } else if (/^(?:预计字数)[:：]/.test(line)) {
      const n = parseInt(line.replace(/[^\d]/g, ''), 10)
      if (!Number.isNaN(n) && n > 0) draft.estimatedWords = n
    } else if (/^[-*•·]|^\d+[.、)]|^第[一二三四五六七八九十]+[、.]/.test(line)) {
      draft.beats.push(line.replace(/^[-*•·]\s*|^\d+[.、)]\s*|^第[一二三四五六七八九十]+[、.]\s*/, ''))
    }
  }

  // 没解析出情节点则整段作为目标
  if (draft.beats.length === 0) {
    if (!draft.goal) draft.goal = text.slice(0, 200)
    draft.beats = lines.filter((l) => l.length > 4).slice(0, 8)
  }
  return draft
}
