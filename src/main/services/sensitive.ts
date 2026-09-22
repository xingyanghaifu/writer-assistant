/**
 * 敏感词本地词库（阶段 11）。
 *
 * 设计原则：
 *  - 仅提示、不阻断，不替用户做内容审查决定
 *  - 纯本地匹配，正文不出本机
 *  - 分级别：block(需确认) / warn(建议修改) / info(提示)
 *
 * ⚠️ 内置词库仅覆盖常见风险类别的最小集合，用户可在设置中自行增删。
 */
import type { SensitiveWord, SensitiveLevel } from '@shared/advanced'

/** 政治敏感类（这类词一旦误用风险最高，仅提示） */
const POLITICAL = ['颠覆国家', '分裂国家', '煽动叛乱', '恐怖组织']

/** 色情低俗类 */
const ADULT = ['色情', '淫秽', '嫖娼', '卖淫']

/** 暴力血腥类 */
const VIOLENCE = ['肢解', '虐杀', '碎尸', '自残']

/** 违法违规类 */
const ILLEGAL = ['毒品交易', '制毒', '贩毒', '枪支买卖', '洗钱']

/** 广告导流类 */
const SPAM = ['加微信', '扫码进群', '点击链接', '代理加盟', '刷单']

function make(words: string[], level: SensitiveLevel, category: string): SensitiveWord[] {
  return words.map((word) => ({ word, level, category }))
}

/** 内置词库 */
export const BUILTIN_SENSITIVE_WORDS: SensitiveWord[] = [
  ...make(POLITICAL, 'block', '政治'),
  ...make(ADULT, 'block', '色情'),
  ...make(VIOLENCE, 'warn', '暴力'),
  ...make(ILLEGAL, 'block', '违法'),
  ...make(SPAM, 'info', '广告')
]

/**
 * 检测文本中的敏感词。
 * 用 indexOf 循环统计出现次数（避免正则元字符问题）。
 */
export function detectSensitive(
  text: string,
  dictionary: SensitiveWord[] = BUILTIN_SENSITIVE_WORDS
): import('@shared/advanced').SensitiveReport {
  const hits: import('@shared/advanced').SensitiveHit[] = []

  for (const entry of dictionary) {
    if (!entry.word) continue
    let count = 0
    let firstIndex = -1
    let from = 0
    for (;;) {
      const idx = text.indexOf(entry.word, from)
      if (idx < 0) break
      if (firstIndex < 0) firstIndex = idx
      count++
      from = idx + entry.word.length
    }
    if (count > 0) {
      hits.push({
        word: entry.word,
        level: entry.level,
        category: entry.category,
        count,
        firstIndex
      })
    }
  }

  hits.sort((a, b) => a.firstIndex - b.firstIndex)

  const byLevel: Record<SensitiveLevel, number> = { block: 0, warn: 0, info: 0 }
  let total = 0
  for (const h of hits) {
    byLevel[h.level] += h.count
    total += h.count
  }

  return { hits, total, byLevel, scanned: text.replace(/\s/g, '').length }
}

/** 在文本中标注命中位置，用于高亮（返回区间，不修改原文） */
export function sensitiveRanges(
  text: string,
  dictionary: SensitiveWord[] = BUILTIN_SENSITIVE_WORDS
): Array<{ from: number; to: number; level: SensitiveLevel; word: string }> {
  const out: Array<{ from: number; to: number; level: SensitiveLevel; word: string }> = []
  for (const entry of dictionary) {
    if (!entry.word) continue
    let from = 0
    for (;;) {
      const idx = text.indexOf(entry.word, from)
      if (idx < 0) break
      // 忽略重叠区间（保留先出现的）
      if (!out.some((r) => idx < r.to && idx + entry.word.length > r.from)) {
        out.push({ from: idx, to: idx + entry.word.length, level: entry.level, word: entry.word })
      }
      from = idx + entry.word.length
    }
  }
  return out.sort((a, b) => a.from - b.from)
}
