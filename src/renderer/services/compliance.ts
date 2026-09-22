/**
 * 合规与版权（阶段 8 / 8.5）—— 主智能体负责。
 *
 * 1. 首次启动合规弹窗：仅用于个人写作辅助，遵守各 AI 平台条款，不高频滥用
 * 2. 首次使用 AI 功能：AI 版权说明
 * 3. 首次启动：隐私说明（不收集数据、数据本地）
 * 4. AI 卡片版权标注：在 SuggestionCard 中显示"AI 生成，仅供参考"
 */
import type { AppSettings } from '@shared/settings'

/** 合规声明文本（单一出处，UI 直接引用） */
export const COMPLIANCE_TEXT = {
  compliance: {
    title: '使用须知',
    body: [
      '本工具仅用于个人写作辅助。',
      '请遵守各 AI 平台的使用条款，不要高频自动化滥用。',
      '本工具不会绕过登录、验证码或风控机制。',
      '本工具不会自动发送你与 AI 的当前对话。'
    ]
  },
  aiCopyright: {
    title: 'AI 辅助创作说明',
    body: [
      'AI 生成的内容仅供参考，不构成最终创作成果。',
      '是否采用、如何署名及版权归属，由你自行判断并承担相应责任。',
      '建议在正式发表前对 AI 辅助部分进行充分的修改与润色。',
      '导出作品时可选择附加「AI 辅助创作」声明。'
    ]
  },
  privacy: {
    title: '隐私说明',
    body: [
      '本工具不收集、不上传任何个人数据。',
      '你的作品、素材、设置全部保存在本机（userData 目录），不会同步到任何服务器。',
      '除你主动使用的 AI 站点外，本工具不发起任何网络请求。',
      '你可随时在设置中「清除所有数据」，此操作需二次确认。'
    ]
  }
} as const

export type ConsentKind = 'compliance' | 'aiCopyright' | 'privacy'

/** 当前尚未确认的声明 */
export function pendingConsents(settings: AppSettings): ConsentKind[] {
  const out: ConsentKind[] = []
  if (!settings.consent.complianceAccepted) out.push('compliance')
  if (!settings.consent.privacyAccepted) out.push('privacy')
  return out
}

/** 是否需要弹出 AI 版权说明（首次使用 AI 功能时） */
export function needsAiCopyright(settings: AppSettings): boolean {
  return !settings.consent.aiCopyrightAccepted
}

/** 生成确认后的 consent 补丁 */
export function acceptConsent(kind: ConsentKind): Partial<AppSettings['consent']> {
  switch (kind) {
    case 'compliance':
      return { complianceAccepted: true }
    case 'privacy':
      return { privacyAccepted: true }
    case 'aiCopyright':
      return { aiCopyrightAccepted: true }
  }
}

/** AI 卡片统一标注文案 */
export const AI_NOTICE_SHORT = 'AI 生成，仅供参考'
