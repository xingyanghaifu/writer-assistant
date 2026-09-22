/**
 * 通用分块发送引擎 —— 纯函数部分（阶段 11.5a）。
 *
 * 分块优先级：章节边界 > 段落边界 > 场景切换 > 硬切。
 * 默认块大小 3000 字，重叠 200 字。
 */

export interface TextChunk {
  index: number
  text: string
  /** 是否以语义边界结束 */
  semantic: boolean
}

export interface ChunkOptions {
  /** 块大小（字） */
  size?: number
  /** 重叠字数 */
  overlap?: number
}

/** 章节标题模式（与导入分章共用语义） */
const CHAPTER_RE = /^(第[〇零一二三四五六七八九十百千0-9]+[章节回卷幕]|Chapter\s+\d+|序章|楔子|尾声|后记|番外|前言|引子)/

/** 场景切换标记 */
const SCENE_RE = /^(\s*[*＊\-—=＝]{3,}\s*|\s*◇+\s*|\s*◆+\s*)$/

/**
 * 把长文本切分为若干块。
 *
 * 策略：
 *  1. 先按段落（空行）切成单元
 *  2. 贪心累加单元直到接近 size
 *  3. 相邻块之间保留 overlap 字的重叠（从上一块结尾取）
 *  4. 优先在章节边界断开；其次段落/场景边界；最后硬切
 */
export function splitIntoChunks(text: string, options: ChunkOptions = {}): TextChunk[] {
  const size = Math.max(200, options.size ?? 3000)
  const overlap = Math.max(0, Math.min(options.overlap ?? 200, Math.floor(size / 4)))

  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized.length <= size) {
    return normalized ? [{ index: 1, text: normalized, semantic: true }] : []
  }

  // 段落单元（保留分隔符）
  const units = normalized.split(/(?<=\n)\s*\n/).filter((u) => u.length > 0)

  const chunks: string[] = []
  let buf = ''

  const flush = (): void => {
    if (buf.length > 0) {
      chunks.push(buf)
      buf = ''
    }
  }

  for (const unit of units) {
    // 单元本身超过 size：硬切
    if (unit.length > size) {
      flush()
      let rest = unit
      while (rest.length > size) {
        // 尽量在句末切
        const window = rest.slice(0, size)
        const cut = Math.max(
          window.lastIndexOf('。'),
          window.lastIndexOf('！'),
          window.lastIndexOf('？'),
          window.lastIndexOf('\n')
        )
        const at = cut > size * 0.5 ? cut + 1 : size
        chunks.push(rest.slice(0, at))
        rest = rest.slice(at)
      }
      if (rest) buf = rest
      continue
    }

    // 章节标题：优先作为新块开头
    const isChapterStart = CHAPTER_RE.test(unit.trim())
    if (isChapterStart && buf.length > size * 0.5) {
      flush()
      buf = unit
      continue
    }

    if (buf.length + unit.length > size) {
      flush()
      // 场景切换标记也可作为块边界
      const isScene = SCENE_RE.test(unit.trim())
      buf = isScene ? '' : unit
      if (isScene) continue
    } else {
      buf += unit
    }
  }
  flush()

  // 合并过小的尾块到前一块，避免产生极短块
  if (chunks.length > 1 && chunks[chunks.length - 1].length < size * 0.15) {
    const tail = chunks.pop()!
    chunks[chunks.length - 1] += tail
  }

  // 加重叠：第 n 块的头部拼接上一块结尾的 overlap 字
  return chunks.map((c, i) => {
    if (i === 0) return { index: 1, text: c, semantic: true }
    const prev = chunks[i - 1]
    const head = prev.slice(Math.max(0, prev.length - overlap))
    return {
      index: i + 1,
      text: head ? `${head}\n${c}` : c,
      semantic: true
    }
  })
}

/** 重叠去重合并：用于把多块结果拼接时去掉重复片段 */
export function mergeOverlapping(parts: string[], overlapChars = 200): string {
  let out = ''
  for (const p of parts) {
    if (!out) {
      out = p
      continue
    }
    const tail = out.slice(Math.max(0, out.length - overlapChars))
    // 找到最长的 tail 后缀 == p 前缀
    let best = 0
    for (let len = Math.min(tail.length, p.length); len > 0; len--) {
      if (tail.slice(tail.length - len) === p.slice(0, len)) {
        best = len
        break
      }
    }
    out += p.slice(best)
  }
  return out
}

/** 估算总块数（用于进度显示） */
export function estimateChunkCount(text: string, size = 3000): number {
  return Math.max(1, Math.ceil(text.length / size))
}
