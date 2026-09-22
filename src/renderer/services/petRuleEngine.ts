/**
 * 桌面宠物：本地灵感规则引擎（v3 P0-3.1）。
 *
 * 7 条规则：
 *  1. 连续无对话：最近 200 字无引号/对话标记 → "这里可以插一句对话"
 *  2. 连续描写：最近 300 字无动作动词 → "可加一个动作/冲突"
 *  3. 角色久未出现：某角色 > N 章未提及 → "XX 已 N 章未出场"
 *  4. 伏笔未回收：planted 超 5 章 → "伏笔 XX 待回收"
 *  5. 词频重复：同词 200 字内 ≥5 次 → "XX 重复偏高"
 *  6. 章节完成：chapter status = done → "本章完成，可生成章纲"
 *  7. 随机灵感卡：用户点击宠物 → 从灵感库随机抽
 *
 * 设计约束：
 *  - 纯函数，便于单测
 *  - 每条规则独立 cooldown（毫秒）
 *  - 默认开启 1、3、4、7（其余关）
 *  - 不阻塞编辑器输入；调用方在 setTimeout/requestIdleCallback 中跑
 */
import type { InspirationItem, PetPerceptionContext, PetRule, InspirationBank } from '@shared/pet'
import { DEFAULT_INSPIRATION_BANK } from '@shared/pet'

function mkLocalRule(ruleId: string, title: string, content: string, severity: 'info' | 'suggest' | 'warn', chapterId: string): InspirationItem {
  return { id: '', source: 'local-rule' as const, ruleId, title, content, severity, chapterId, createdAt: 0 }
}

const CJK_QUOTE_RE = /["“”「」『』]|[\u2014\u2013\-\u2026]/
const ACTION_HINTS = ['跑', '走', '跳', '打', '推', '拉', '扔', '笑', '喊', '叫', '站', '坐', '蹲', '转', '握', '看', '听', '想', '说', '哭', '笑', '怒']

/** 1. 连续无对话 */
const ruleNoDialogue: PetRule = {
  id: 'no-dialogue',
  name: '建议加对话',
  enabled: true,
  cooldownMs: 60_000,
  evaluate(ctx) {
    const tail = ctx.recentText.slice(-200)
    if (tail.length < 100) return null
    if (CJK_QUOTE_RE.test(tail)) return null
    return mkLocalRule('no-dialogue', '加点对话？', '最近 200 字没有对话标记。这里加一句角色对白能立刻拉近距离。', 'suggest', ctx.chapterId)
  }
}

/** 2. 连续描写 */
const ruleStaticDescription: PetRule = {
  id: 'static-description',
  name: '加动作/冲突',
  enabled: false,
  cooldownMs: 60_000,
  evaluate(ctx) {
    const tail = ctx.recentText.slice(-300)
    if (tail.length < 150) return null
    const hasAction = ACTION_HINTS.some((c) => tail.includes(c))
    if (hasAction) return null
    return mkLocalRule('static-description', '来点动作？', '最近 300 字没有动作动词。静态描写堆多了容易疲劳，加一个动作/冲突能起节奏。', 'suggest', ctx.chapterId)
  }
}

/** 3. 角色久未出现 */
const ruleAbsentCharacter: PetRule = {
  id: 'absent-character',
  name: '角色久未出场',
  enabled: true,
  cooldownMs: 90_000,
  evaluate(ctx) {
    for (const c of ctx.characters) {
      const idx = ctx.chapterIndexMap[ctx.chapterId] ?? ctx.currentChapterIndex
      if (idx - c.lastSeenChapterIndex >= 3) {
        return mkLocalRule(
          'absent-character',
          `${c.name} 许久未出场`,
          `${c.name} 已经 ${idx - c.lastSeenChapterIndex} 章没有提到，是否要安排一个场景？`,
          'info',
          ctx.chapterId
        )
      }
    }
    return null
  }
}

/** 4. 伏笔未回收 */
const ruleStaleForeshadowing: PetRule = {
  id: 'stale-foreshadowing',
  name: '伏笔长期未回收',
  enabled: true,
  cooldownMs: 90_000,
  evaluate(ctx) {
    for (const f of ctx.foreshadowings) {
      if (f.status !== 'planted') continue
      const plantedIdx = ctx.chapterIndexMap[f.plantedChapterId]
      if (plantedIdx === undefined) continue
      const cur = ctx.chapterIndexMap[ctx.chapterId] ?? ctx.currentChapterIndex
      if (cur - plantedIdx >= 5) {
        return mkLocalRule(
          'stale-foreshadowing',
          '伏笔待回收',
          `伏笔「${f.content.slice(0, 30)}${f.content.length > 30 ? '…' : ''}」已埋伏 ${cur - plantedIdx} 章，建议本章或后续章节回收。`,
          'warn',
          ctx.chapterId
        )
      }
    }
    return null
  }
}

/** 5. 词频重复 */
const ruleWordRepeat: PetRule = {
  id: 'word-repeat',
  name: '词频偏高',
  enabled: false,
  cooldownMs: 90_000,
  evaluate(ctx) {
    const window = ctx.recentText.slice(-200)
    if (window.length < 100) return null
    // 中文 2-gram + 词频统计
    const counts = new Map<string, number>()
    for (let i = 0; i < window.length - 1; i++) {
      const c = window[i]
      // 仅统计汉字
      if (!/[\u4e00-\u9fa5]/.test(c)) continue
      const g = window.substr(i, 2)
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    let top: { g: string; n: number } | null = null
    for (const [g, n] of counts) {
      if (n >= 5 && (!top || n > top.n)) top = { g, n }
    }
    if (!top) return null
    return mkLocalRule('word-repeat', '词频偏高', `最近 200 字里「${top.g}」出现 ${top.n} 次，建议换一种说法避免读感疲劳。`, 'suggest', ctx.chapterId)
  }
}

/** 6. 章节完成（外部触发；evaluate 始终返回 null，由 triggerChapterDone 主动 push） */
const ruleChapterDone: PetRule = {
  id: 'chapter-done',
  name: '章节完成',
  enabled: true,
  cooldownMs: 0,
  evaluate() {
    return null
  }
}

/** 7. 随机灵感卡 */
function ruleRandomInspiration(bank: InspirationBank): PetRule {
  return {
    id: 'random-inspiration',
    name: '随机灵感',
    enabled: true,
    cooldownMs: 5_000,
    evaluate(ctx) {
      const items = bank.items
      if (items.length === 0) return null
      const pick = items[Math.floor(Math.random() * items.length)]
      return {
        id: '',
        source: 'local-random' as const,
        ruleId: 'random-inspiration',
        title: `灵感：${pick.category}`,
        content: pick.content,
        severity: 'info' as const,
        chapterId: ctx.chapterId,
        createdAt: 0
      }
    }
  }
}

/** 全部规则（顺序：低 → 高 cooldownMs） */
export function buildRules(bank: InspirationBank = DEFAULT_INSPIRATION_BANK): PetRule[] {
  return [
    ruleNoDialogue,
    ruleStaticDescription,
    ruleAbsentCharacter,
    ruleStaleForeshadowing,
    ruleWordRepeat,
    ruleChapterDone,
    ruleRandomInspiration(bank)
  ]
}

export interface RuleEngineState {
  /** 每条规则上次触发时间 */
  lastFired: Record<string, number>
  /** 用户在设置里开关过的规则覆盖（true=开，false=关，undefined=默认） */
  ruleOverrides: Record<string, boolean>
}

/** 创建初始引擎状态 */
export function initEngineState(overrides?: Record<string, boolean>): RuleEngineState {
  return { lastFired: {}, ruleOverrides: overrides ?? {} }
}

/**
 * 评估规则；返回首个满足 cooldown 的命中。
 * cooldown 用最近 firedAt + cooldownMs < now 判断。
 */
export function evaluateRules(
  ctx: PetPerceptionContext,
  rules: PetRule[],
  state: RuleEngineState,
  now = Date.now()
): { item: InspirationItem; nextState: RuleEngineState } | null {
  for (const r of rules) {
    const enabled = state.ruleOverrides[r.id] ?? r.enabled
    if (!enabled) continue
    const last = state.lastFired[r.id] ?? 0
    if (now - last < r.cooldownMs) continue
    const item = r.evaluate(ctx)
    if (!item) continue
    item.id = `insp_${now}_${Math.random().toString(36).slice(2, 6)}`
    item.createdAt = now
    const next: RuleEngineState = {
      lastFired: { ...state.lastFired, [r.id]: now },
      ruleOverrides: state.ruleOverrides
    }
    return { item, nextState: next }
  }
  return null
}