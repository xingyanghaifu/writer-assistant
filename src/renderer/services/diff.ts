/**
 * 字符级 diff（最长公共子序列 + 回溯）。
 *
 * 用于润色/扩写后的对比视图：保留 (unchanged)、新增 (added)、删除 (deleted)
 * 三种状态。文本量在几千字以内 O(n·m)，足够日常交互使用；
 * 若以后需要处理万级，可以换成 Myers/Hirschberg，但此处不动。
 *
 * 输出形状：`DiffSegment[]`，按出现顺序排列，渲染端按 kind 上色即可。
 */

export type DiffKind = 'same' | 'add' | 'del'

export interface DiffSegment {
  kind: DiffKind
  text: string
}

export function diffChars(a: string, b: string): DiffSegment[] {
  // 极短文本或一边为空时直接走快路径
  if (!a) return [{ kind: 'add', text: b }]
  if (!b) return [{ kind: 'del', text: a }]

  const aChars = [...a] // 处理 surrogate pair / emoji 等
  const bChars = [...b]
  const n = aChars.length
  const m = bChars.length

  // dp[i][j] = aChars[0..i) 与 bChars[0..j) 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aChars[i - 1] === bChars[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // 回溯生成 segments
  const out: DiffSegment[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (aChars[i - 1] === bChars[j - 1]) {
      pushSeg(out, 'same', aChars[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      pushSeg(out, 'del', aChars[i - 1])
      i--
    } else {
      pushSeg(out, 'add', bChars[j - 1])
      j--
    }
  }
  while (i > 0) { pushSeg(out, 'del', aChars[i - 1]); i-- }
  while (j > 0) { pushSeg(out, 'add', bChars[j - 1]); j-- }
  return out.reverse()
}

function pushSeg(out: DiffSegment[], kind: DiffKind, ch: string): void {
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += ch
  else out.push({ kind, text: ch })
}

/** 简易统计：新增/删除字符数 + 重合字符数 */
export interface DiffSummary {
  added: number
  deleted: number
  same: number
  changeRatio: number // (added + deleted) / (added + deleted + same)，0~1
}

export function summarizeDiff(segments: DiffSegment[]): DiffSummary {
  let added = 0
  let deleted = 0
  let same = 0
  for (const s of segments) {
    const len = [...s.text].length
    if (s.kind === 'add') added += len
    else if (s.kind === 'del') deleted += len
    else same += len
  }
  const total = added + deleted + same
  return {
    added,
    deleted,
    same,
    changeRatio: total === 0 ? 0 : (added + deleted) / total
  }
}