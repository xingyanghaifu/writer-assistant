/**
 * 功能开关（设置 → 功能）的真实执行点。
 *
 * ⚠️ 背景：设置页提供了 8 个功能开关，但此前除了 healthReminder 之外
 * **没有任何代码读取它们** —— 用户关掉「敏感词检测」，它照样运行；
 * 开关纯粹是装饰。这里提供统一的读取入口，让开关真正生效。
 *
 * 设计取舍：
 *  - 默认值来自 DEFAULT_SETTINGS，缺失时按"开启"处理，
 *    避免新增开关时老数据意外关闭功能；
 *  - 只在**主进程执行点**拦截，渲染层按钮保持可见但会收到明确错误，
 *    这样用户知道是开关关掉了，而不是功能坏了。
 */
import type { AppSettings } from '@shared/settings'
import { appStore } from '../store'

export type FeatureKey = keyof AppSettings['features']

/** 读取单个功能开关状态（缺失视为开启） */
export function featureEnabled(key: FeatureKey): boolean {
  const features = appStore.getSettings()?.features
  if (!features || typeof features !== 'object') return true
  const v = (features as Record<string, unknown>)[key]
  return v === undefined ? true : !!v
}

/** 面向用户的统一关闭提示 */
export function featureDisabledError(key: FeatureKey, label: string): { ok: false; error: string } {
  return { ok: false, error: `「${label}」功能已在设置中关闭（设置 → 功能）` }
}

/** 功能中文名，用于错误提示 */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  outlineGenerate: '一键生成章纲',
  sensitiveWord: '敏感词检测',
  chapterGoal: '章节目标字数',
  smartSplit: '智能分章',
  qualityFeedback: '建议质量反馈',
  styleLearning: '写作风格学习',
  consistencyCheck: '角色一致性检查',
  healthReminder: '健康提醒'
}
