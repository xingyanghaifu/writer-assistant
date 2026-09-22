/**
 * 阶段 11 进阶功能 + 阶段 13 数据可视化 IPC。
 *
 * 全部为本地计算（除一键生成章纲需要调用 AI，由渲染层发起），
 * 因此这些 handler 都是同步纯函数或轻量统计，不消耗 AI 额度。
 */
import { IPC } from '@shared/ipc'
import type { SensitiveWord, QualityFeedback } from '@shared/advanced'
import { handleRaw } from './handle'
import { appStore } from '../store'
import { detectSensitive, BUILTIN_SENSITIVE_WORDS } from '../services/sensitive'
import { analyzeStyle, checkConsistency } from '../services/style'
import {
  suggestSplits,
  goalProgress,
  healthStatus,
  parseOutlineDraft,
  DEFAULT_HEALTH_INTERVAL_MS
} from '../services/advanced'
import { buildOverview, buildCalendar, buildTrend } from '../services/viz'
import { findChapter } from '../services/work'
import { featureEnabled, featureDisabledError, FEATURE_LABELS } from './features'

/** 所有章节（含内容），供一致性检查与风格分析使用 */
function allChapters(workId: string): Array<{ id: string; title: string; content: string }> {
  const work = appStore.getWork(workId)
  if (!work) return []
  return work.volumes.flatMap((v) =>
    v.chapters.map((c) => ({ id: c.id, title: c.title, content: c.content }))
  )
}

/** 拼接整部作品正文（用于风格学习/敏感词全量扫描） */
function fullText(workId: string): string {
  return allChapters(workId)
    .map((c) => c.content)
    .join('\n\n')
}

export function registerAdvancedIpc(): void {
  // ---- 敏感词 ----
  // 开关关闭时返回空结果集而非报错：调用点遍布编辑器，
  // 报错会打断写作流；空结果的表现就是"不高亮"，正是用户想要的。
  handleRaw(IPC.sensitiveCheck, (_e, text: string) => {
    if (!featureEnabled('sensitiveWord')) {
      return { hits: [], total: 0, byLevel: { block: 0, warn: 0, info: 0 } }
    }
    return detectSensitive(text ?? '', effectiveDict())
  })

  handleRaw(IPC.sensitiveDict, () => effectiveDict())

  handleRaw(IPC.sensitiveDictSet, (_e, words: SensitiveWord[]) => {
    if (!Array.isArray(words)) return { ok: false, error: '格式错误' }
    // 只保存用户自定义部分（内置词库不落库）
    const builtin = new Set(BUILTIN_SENSITIVE_WORDS.map((w) => w.word))
    const custom = words
      .filter((w) => w && typeof w.word === 'string' && w.word.trim() && !builtin.has(w.word))
      .map((w) => ({
        word: w.word.trim(),
        level: w.level ?? 'info',
        category: w.category || '自定义'
      }))
    appStore.setSensitiveDict(custom)
    return { ok: true }
  })

  // ---- 风格学习 ----
  handleRaw(IPC.styleAnalyze, (_e, text: string, workId?: string) => {
    if (!featureEnabled('styleLearning')) return null
    const source = text || (workId ? fullText(workId) : '')
    const profile = analyzeStyle(source)
    if (workId) appStore.setStyleProfile(workId, profile)
    return profile
  })

  handleRaw(IPC.styleGet, (_e, workId?: string) => {
    if (!workId) return null
    if (!featureEnabled('styleLearning')) return null
    return appStore.getStyleProfile(workId) ?? null
  })

  // ---- 角色一致性检查 ----
  handleRaw(IPC.consistencyCheck, (_e, workId: string) => {
    if (!featureEnabled('consistencyCheck')) {
      return { issues: [], checkedCharacters: 0, checkedChapters: 0, disabled: true }
    }
    const chapters = allChapters(workId)
    const characters = appStore.getCharacters(workId)
    return checkConsistency(chapters, characters)
  })

  // ---- 智能分章 ----
  handleRaw(IPC.smartSplit, (_e, text: string, targetWords?: number) => {
    // 关闭时返回空数组（类型契约就是 SplitPoint[]），表现为"未检测到分章点"
    if (!featureEnabled('smartSplit')) return []
    const target = targetWords ?? appStore.getSettings().defaultTargetWordCount
    return suggestSplits(text ?? '', { targetWords: target })
  })

  // ---- 章节目标字数 ----
  handleRaw(IPC.goalProgress, (_e, workId: string, chapterId: string) => {
    const found = findChapter(workId, chapterId)
    const settings = appStore.getSettings()
    const current = found?.chapter.wordCount ?? 0
    // 开关关闭时不显示目标（target=0 → 进度条隐藏），但字数仍然返回
    const rawTarget = found?.chapter.targetWordCount ?? settings.defaultTargetWordCount
    const target = featureEnabled('chapterGoal') ? rawTarget : 0
    return { ...goalProgress(current, target), chapterId, disabled: !featureEnabled('chapterGoal') }
  })

  handleRaw(IPC.goalSet, (_e, workId: string, chapterId: string, target: number) => {
    if (!featureEnabled('chapterGoal')) {
      return featureDisabledError('chapterGoal', FEATURE_LABELS.chapterGoal)
    }
    const found = findChapter(workId, chapterId)
    if (!found) return { ok: false, error: '章节不存在' }
    found.chapter.targetWordCount = Math.max(0, Math.floor(target))
    found.chapter.updatedAt = Date.now()
    found.work.updatedAt = Date.now()
    appStore.upsertWork(found.work)
    return { ok: true }
  })

  // ---- 健康提醒 ----
  handleRaw(IPC.healthStatus, (_e, continuousMs: number) => {
    const settings = appStore.getSettings()
    return healthStatus({
      continuousMs: Math.max(0, continuousMs ?? 0),
      todayMs: appStore.getTodayDuration(),
      intervalMs: settings.healthReminderMs || DEFAULT_HEALTH_INTERVAL_MS,
      enabled: settings.features.healthReminder,
      lastRemindedAt: appStore.getLastHealthReminder()
    })
  })

  // ---- 建议质量反馈 ----
  handleRaw(IPC.feedbackSubmit, (_e, fb: QualityFeedback) => {
    if (!featureEnabled('qualityFeedback')) {
      return featureDisabledError('qualityFeedback', FEATURE_LABELS.qualityFeedback)
    }
    if (!fb?.tag) return { ok: false, error: '缺少 tag' }
    const list = appStore.getFeedback()
    // 同一 tag + siteId 只保留最新一条，避免刷票
    const next = list.filter((x) => !(x.tag === fb.tag && x.siteId === fb.siteId))
    next.push({ ...fb, createdAt: Date.now() })
    appStore.setFeedback(next)
    return { ok: true, data: summarize(next) }
  })

  handleRaw(IPC.feedbackSummary, () => summarize(appStore.getFeedback()))

  // ---- 一键生成章纲：解析 AI 返回 ----
  handleRaw(IPC.outlineParse, (_e, raw: string, fallbackTitle: string) => {
    return parseOutlineDraft(raw ?? '', fallbackTitle ?? '新章节')
  })

  // ---- 阶段 13 可视化 ----
  handleRaw(IPC.vizOverview, (_e, workId: string, days?: number) => {
    const work = appStore.getWork(workId)
    if (!work) return null
    const stats = appStore.getStatsSince(workId, days ?? 365)
    const characters = appStore.getCharacters(workId)
    const foreshadowings = appStore.getForeshadowings(workId)
    return buildOverview(work, stats, characters, foreshadowings, days ?? 90)
  })

  handleRaw(IPC.vizCalendar, (_e, workId: string, days?: number) => {
    return buildCalendar(appStore.getStatsSince(workId, days ?? 365), days ?? 365)
  })

  handleRaw(IPC.vizTrend, (_e, workId: string, days?: number) => {
    return buildTrend(appStore.getStatsSince(workId, days ?? 30), days ?? 30)
  })
}

/** 生效词库：内置 + 用户自定义 */
function effectiveDict(): SensitiveWord[] {
  const map = new Map<string, SensitiveWord>()
  for (const w of BUILTIN_SENSITIVE_WORDS) map.set(w.word, w)
  for (const w of appStore.getSensitiveDict()) map.set(w.word, w)
  return Array.from(map.values())
}

/** 反馈汇总 */
function summarize(
  list: Array<{ tag: string; value: 'up' | 'down'; siteId: string; createdAt: number }>
): import('@shared/advanced').FeedbackSummary[] {
  const map = new Map<string, { up: number; down: number }>()
  for (const f of list) {
    const rec = map.get(f.tag) ?? { up: 0, down: 0 }
    rec[f.value]++
    map.set(f.tag, rec)
  }
  return Array.from(map.entries())
    .map(([tag, v]) => ({
      tag,
      up: v.up,
      down: v.down,
      rate: v.up + v.down > 0 ? Math.round((v.up / (v.up + v.down)) * 100) / 100 : null
    }))
    .sort((a, b) => b.up + b.down - (a.up + a.down))
}
