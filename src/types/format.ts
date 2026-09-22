/**
 * 中文正文自动排版（本地纯文本处理，不调用 AI）。
 *
 * 设计原则：
 * - **只处理空白与标点，不改动任何文字内容** —— 排版不应有创作风险
 * - 每一项都可独立开关，用户可在「工具 → 自动排版」里自行组合
 * - 幂等：对已排版文本再跑一次不会产生变化
 */

/** 排版选项 */
export interface FormatOptions {
  /** 段首统一缩进两个全角空格 */
  indent: boolean
  /** 去除段首原有的空白（与 indent 配合，避免重复缩进） */
  trimLeading: boolean
  /** 删除行尾空白 */
  trimTrailing: boolean
  /** 合并连续空行为单个空行 */
  collapseBlankLines: boolean
  /** 中文段落内多余的半角空格转全角（如"他 说"→"他　说"不做，仅去多余空格） */
  squeezeSpaces: boolean
  /** 英文/数字与中文之间补空格（提升可读性） */
  cjkLatinSpace: boolean
  /** 全角标点规范化：连续标点合并、省略号统一 */
  normalizePunctuation: boolean
  /** 引号规范化：直引号转中文弯引号 */
  normalizeQuotes: boolean
  /** 删除段间多余空行（空行仅用于分隔，不保留连续多行） */
  removeExtraBlankBetween: boolean
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  indent: true,
  trimLeading: true,
  trimTrailing: true,
  collapseBlankLines: true,
  squeezeSpaces: true,
  cjkLatinSpace: false,
  normalizePunctuation: true,
  normalizeQuotes: true,
  removeExtraBlankBetween: true
}

/** 排版结果 */
export interface FormatResult {
  text: string
  /** 改动统计，用于提示用户 */
  stats: {
    indented: number
    trimmed: number
    blanksCollapsed: number
    punctuationFixed: number
    quotesFixed: number
    spacesSqueezed: number
  }
  changed: boolean
}

/** 全角空格（两个） */
const INDENT = '　　'

/**
 * 中文弯引号转换。
 *
 * ⚠️ 两个关键点（都踩过坑）：
 * 1. **不能按句号重置引号状态**：句号常在引号内部（`“我来了。”`），
 *    重置会把结尾右引号误判为左引号，产出 `“我来了。“`。
 * 2. **纯英文行必须跳过**：否则 `don't` 会变成 `don’t` 之外的错误形态，
 *    英文 `"quoted"` 也会被塞进中文弯引号。
 */
function convertQuotes(line: string): { line: string; count: number } {
  // 不含中文的行不改引号
  if (!/[\u4e00-\u9fa5]/.test(line)) return { line, count: 0 }

  let count = 0
  let out = ''
  let inDouble = false
  let inSingle = false
  for (const ch of line) {
    if (ch === '"') {
      out += inDouble ? '”' : '“'
      inDouble = !inDouble
      count++
    } else if (ch === "'") {
      out += inSingle ? '’' : '‘'
      inSingle = !inSingle
      count++
    } else {
      out += ch
    }
  }
  return { line: out, count }
}

/** 标点规范化 */
function normalizePunct(line: string): { line: string; count: number } {
  let count = 0
  let out = line

  // ① 先把英文省略号整体转成中文省略号。
  //    ⚠️ 必须放在"半角句号转全角"**之前**：否则 `......` 的首个 `.`
  //    会被先转成 `。`，产出 `。.....` 这种四不像（实测踩过）。
  const before0 = out
  out = out.replace(/\.{3,}/g, '……')
  if (out !== before0) count++

  // ② 连续同类标点合并：。。。→……  ！！！→！  ？？？→？
  const before1 = out
  out = out.replace(/。{2,}/g, '……')
  out = out.replace(/…{3,}/g, '……')
  out = out.replace(/！{2,}/g, '！')
  out = out.replace(/？{2,}/g, '？')
  out = out.replace(/，{2,}/g, '，')
  out = out.replace(/、{2,}/g, '、')
  if (out !== before1) count++

  // ③ 半角标点转全角（仅在中文字符之后触发，避免影响英文句子）
  //    此时残留的 `.` 必定是句末单点（省略号已在上一步处理完）
  const before2 = out
  out = out
    .replace(/([\u4e00-\u9fa5])\s*,\s*/g, '$1，')
    .replace(/([\u4e00-\u9fa5])\s*\.\s*(?![0-9])/g, '$1。')
    .replace(/([\u4e00-\u9fa5])\s*;\s*/g, '$1；')
    .replace(/([\u4e00-\u9fa5])\s*:\s*/g, '$1：')
    .replace(/([\u4e00-\u9fa5])\s*\?\s*/g, '$1？')
    .replace(/([\u4e00-\u9fa5])\s*!\s*/g, '$1！')
  if (out !== before2) count++

  return { line: out, count }
}

/**
 * 中英文之间补空格。
 *
 * 只在"中文 ↔ 连续英文/数字串"交界处补一个空格；
 * 已存在空格的不会再补（避免出现两个空格）。
 * 不处理小数点（`3.14` 内部由 `\.` 不在字符类中自然跳过）。
 */
function addCjkLatinSpace(line: string): string {
  return line
    .replace(/([\u4e00-\u9fa5])([A-Za-z0-9]+)/g, '$1 $2')
    .replace(/([A-Za-z0-9]+)([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/[ \t]{2,}/g, ' ')
}

/**
 * 执行排版。
 *
 * 逐行处理，**不合并真正的段落内容**：只有空行会被折叠。
 */
export function formatManuscript(input: string, opts: FormatOptions = DEFAULT_FORMAT_OPTIONS): FormatResult {
  const stats = {
    indented: 0,
    trimmed: 0,
    blanksCollapsed: 0,
    punctuationFixed: 0,
    quotesFixed: 0,
    spacesSqueezed: 0
  }

  // 统一换行符（Windows CRLF → LF），排版输出统一 LF
  const normalized = input.replace(/\r\n?/g, '\n')
  const rawLines = normalized.split('\n')

  const outLines: string[] = []
  let lastWasBlank = false

  for (const raw of rawLines) {
    let line = raw

    // 1) 行尾空白
    if (opts.trimTrailing) {
      const t = line.replace(/[ \t\u3000]+$/, '')
      if (t !== line) {
        stats.trimmed++
        line = t
      }
    }

    // 2) 空行处理
    if (line.trim() === '') {
      if (opts.collapseBlankLines && lastWasBlank) {
        stats.blanksCollapsed++
        continue // 跳过连续空行
      }
      outLines.push('')
      lastWasBlank = true
      continue
    }
    lastWasBlank = false

    // 3) 去掉段首空白（缩进会重新加）
    if (opts.trimLeading) {
      const t = line.replace(/^[ \t\u3000]+/, '')
      if (t !== line) {
        stats.trimmed++
        line = t
      }
    }

    // 4) 段内多余空格压缩（保留单个半角空格，用于英文词间隔）
    if (opts.squeezeSpaces) {
      const t = line.replace(/[ \t]{2,}/g, ' ').replace(/\u3000{1,}/g, '')
      if (t !== line) {
        stats.spacesSqueezed++
        line = t
      }
    }

    // 5) 标点规范化
    if (opts.normalizePunctuation) {
      const r = normalizePunct(line)
      line = r.line
      stats.punctuationFixed += r.count
    }

    // 6) 引号规范化
    if (opts.normalizeQuotes) {
      const r = convertQuotes(line)
      line = r.line
      stats.quotesFixed += r.count
    }

    // 7) 中英文之间补空格
    if (opts.cjkLatinSpace) line = addCjkLatinSpace(line)

    // 8) 段首缩进
    if (opts.indent) {
      if (!line.startsWith(INDENT)) {
        line = INDENT + line
        stats.indented++
      }
    }

    outLines.push(line)
  }

  // 去掉尾部多余空行
  while (outLines.length && outLines[outLines.length - 1] === '') outLines.pop()

  const text = outLines.join('\n')
  return {
    text,
    stats,
    changed: text !== input
  }
}

/** 生成改动摘要（用于 toast 提示） */
export function describeFormat(stats: FormatResult['stats']): string {
  const parts: string[] = []
  if (stats.indented) parts.push(`缩进 ${stats.indented} 段`)
  if (stats.trimmed) parts.push(`清理空白 ${stats.trimmed} 处`)
  if (stats.quotesFixed) parts.push(`引号 ${stats.quotesFixed} 处`)
  if (stats.punctuationFixed) parts.push(`标点 ${stats.punctuationFixed} 处`)
  if (stats.spacesSqueezed) parts.push(`压缩空格 ${stats.spacesSqueezed} 处`)
  if (stats.blanksCollapsed) parts.push(`合并空行 ${stats.blanksCollapsed} 处`)
  return parts.length ? parts.join('，') : '无需改动'
}
