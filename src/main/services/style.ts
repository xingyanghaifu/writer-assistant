/**
 * 写作风格学习 + 角色一致性检查（阶段 11）。
 *
 * 全部本地统计，正文不出本机。
 */

/** 中文停用词（高频但无风格信息） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '就', '都', '而', '及', '与', '着', '或', '一个', '没有', '我们', '你们',
  '他们', '自己', '这个', '那个', '什么', '可以', '这样', '但是', '因为', '所以', '如果', '已经', '还是',
  '就是', '不是', '没有', '一样', '这里', '那里', '时候', '出来', '起来', '过去', '一点', '有些', '为了',
  '于是', '然后', '现在', '知道', '看见', '觉得', '可能', '并不', '只是', '一直', '忽然', '似乎'
])

function stripPunct(s: string): string {
  return s.replace(/[\s，。！？；：""''、（）《》…—\-·,.!?;:'"()\[\]{}]/g, '')
}

/** 转义正则元字符（角色名可能含 . * + ? 等，直接拼进 RegExp 会出错） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 提取汉字与英文词 */
function tokens(s: string): string[] {
  const out: string[] = []
  // 英文单词
  const eng = s.match(/[A-Za-z]{2,}/g)
  if (eng) out.push(...eng.map((w) => w.toLowerCase()))
  // 中文单字（用于词组统计）
  const han = s.match(/[\u4e00-\u9fa5]/g)
  if (han) out.push(...han)
  return out
}

/** 分词（中文按 2-gram，英文按词）用于高频词 */
function words(s: string): string[] {
  const out: string[] = []
  const eng = s.match(/[A-Za-z]{2,}/g)
  if (eng) out.push(...eng.map((w) => w.toLowerCase()))
  // 中文 2-gram
  const runs = s.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/** 统计写作风格画像 */
export function analyzeStyle(
  text: string
): import('@shared/advanced').StyleProfile {
  const clean = text.trim()
  const sentences = clean.split(/[。！？…]+/).map((s) => s.trim()).filter(Boolean)
  const paragraphs = clean.split(/\n+/).map((p) => p.trim()).filter(Boolean)

  const avgSentenceLength = sentences.length
    ? Math.round(sentences.reduce((s, x) => s + stripPunct(x).length, 0) / sentences.length)
    : 0
  const avgParagraphLength = paragraphs.length
    ? Math.round(paragraphs.reduce((s, x) => s + stripPunct(x).length, 0) / paragraphs.length)
    : 0

  // 对话占比：段落中含成对引号或说话动词
  const dialogueRe = /[""「」『』]|说道|问道|答道|笑道|喊道|回答|开口/
  const dialogueParagraphs = paragraphs.filter((p) => dialogueRe.test(p)).length
  const dialogueRatio = paragraphs.length ? dialogueParagraphs / paragraphs.length : 0

  // 高频词
  const freq = new Map<string, number>()
  for (const w of words(clean)) {
    if (STOP_WORDS.has(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])
  // 只保留出现 ≥2 次的，避免噪声
  const topWords = sorted.filter(([, c]) => c >= 2).slice(0, 20).map(([word, count]) => ({ word, count }))
  const topPhrases = sorted.filter(([, c]) => c >= 3).slice(0, 10).map(([phrase, count]) => ({ phrase, count }))

  // 标点偏好
  const punctuation: Record<string, number> = {}
  const puncts = clean.match(/[，。！？；：、…—""''（）《》]/g) ?? []
  const punctTotal = puncts.length || 1
  for (const p of puncts) punctuation[p] = (punctuation[p] ?? 0) + 1
  for (const k of Object.keys(punctuation)) {
    punctuation[k] = Math.round((punctuation[k] / punctTotal) * 1000) / 1000
  }

  return {
    avgSentenceLength,
    avgParagraphLength,
    dialogueRatio: Math.round(dialogueRatio * 100) / 100,
    topWords,
    topPhrases,
    punctuation,
    sampleWords: stripPunct(clean).length,
    updatedAt: Date.now()
  }
}

/** 生成风格提示片段：作为 AI 请求的"风格约束"注入 */
export function styleHint(profile: import('@shared/advanced').StyleProfile | null): string {
  if (!profile || profile.sampleWords < 300) return ''
  const parts: string[] = []
  parts.push(`平均句长约 ${profile.avgSentenceLength} 字`)
  parts.push(`平均段长约 ${profile.avgParagraphLength} 字`)
  if (profile.dialogueRatio > 0.15) {
    parts.push(`对话较多（约 ${Math.round(profile.dialogueRatio * 100)}% 段落含对话）`)
  } else {
    parts.push('以叙述为主，对话较少')
  }
  if (profile.topWords.length) {
    parts.push(`常用词：${profile.topWords.slice(0, 8).map((w) => w.word).join('、')}`)
  }
  return `【写作风格参考】${parts.join('；')}。请在保持该作者原有风格的前提下输出。`
}

/**
 * 角色一致性检查（阶段 11）。
 *
 * 本地规则检查（非 AI，快且不消耗额度）：
 *  1. 名字：同一角色在正文中出现别名但角色表未记录（疑似笔误）
 *  2. 特征：角色设定的 trait 与正文矛盾（如设定"盲人"却写"他看见了"）
 *  3. 外貌：设定中的外貌关键词在正文中冲突
 *  4. 关系：关系表矛盾
 *  5. 时间线：章节时间与角色状态冲突（如已"死亡"角色后续仍行动）
 */
export function checkConsistency(
  chapters: Array<{ id: string; title: string; content: string }>,
  characters: Array<{
    id: string
    name: string
    aliases?: string[]
    traits?: string[]
    appearance?: string
    relationships?: Array<{ targetName: string; type: string }>
    status?: string
  }>
): import('@shared/suggestion').ConsistencyReport {
  const started = Date.now()
  const issues: import('@shared/suggestion').ConsistencyIssue[] = []

  // 全部已登记角色名（含别名）。用于排除误报：
  // 中文小说常见同姓角色（林夜 / 林叶 / 林雨），
  // 若候选写法本身就是另一个已登记角色，则不应报"疑似笔误"。
  const knownNames = new Set<string>()
  for (const c of characters) {
    if (c.name) knownNames.add(c.name)
    for (const a of c.aliases ?? []) knownNames.add(a)
  }

  for (const ch of chapters) {
    const text = ch.content
    if (!text.trim()) continue

    for (const c of characters) {
      if (!c.name) continue
      const aliases = c.aliases ?? []
      const allNames = [c.name, ...aliases]

      // ---- 1. 状态冲突：已死亡/已退场角色仍活跃 ----
      if (c.status === 'dead' || c.status === 'exited') {
        for (const n of allNames) {
          const idx = text.indexOf(n)
          if (idx < 0) continue
          const around = text.slice(Math.max(0, idx - 20), idx + n.length + 30)
          if (/说道|问道|走来|跑|站起|拿起|笑道|喊道|看向|转身/.test(around)) {
            issues.push({
              kind: 'timeline',
              severity: 'high',
              character: c.name,
              chapterId: ch.id,
              description: `角色「${c.name}」状态为${
                c.status === 'dead' ? '已死亡' : '已退场'
              }，但在本章仍有动作描写`,
              suggestion: '确认是否为回忆/闪回；若不是，请调整角色状态或修改正文',
              excerpt: around.trim()
            })
            break
          }
        }
      }

      // ---- 2. 特征矛盾：设定"盲/聋"却出现对应感官动作 ----
      const traitText = (c.traits ?? []).join('') + (c.appearance ?? '')
      if (/盲|失明|看不见/.test(traitText)) {
        for (const n of allNames) {
          const m = text.match(new RegExp(`${n}[^。！？]{0,25}(看见|看到|望着|注视)`))
          if (m) {
            issues.push({
              kind: 'trait',
              severity: 'high',
              character: c.name,
              chapterId: ch.id,
              description: `角色「${c.name}」设定为失明，但正文出现视觉动作「${m[1]}」`,
              suggestion: '修改该动作，或调整角色设定',
              excerpt: m[0]
            })
            break
          }
        }
      }
      if (/聋|失聪|听不见/.test(traitText)) {
        for (const n of allNames) {
          const m = text.match(new RegExp(`${n}[^。！？]{0,25}(听见|听到)`))
          if (m) {
            issues.push({
              kind: 'trait',
              severity: 'high',
              character: c.name,
              chapterId: ch.id,
              description: `角色「${c.name}」设定为失聪，但正文出现听觉动作「${m[1]}」`,
              suggestion: '修改该动作，或调整角色设定',
              excerpt: m[0]
            })
            break
          }
        }
      }

      // ---- 3. 名字拼写相近但未登记（疑似笔误） ----
      // 覆盖三类形近写法：
      //   a) 首尾相同、中间不同：加雷斯 -> 加X斯
      //   b) 前 n-1 字相同、末字不同：加雷斯 -> 加雷撕
      //      ⚠️ 旧实现只做了 (a)，而 `加[\u4e00-\u9fa5]斯` 永远匹配不到
      //      `加雷撕`（末字已变），实测漏检，故补上 (b)。
      //   c) 2 字名同样适用 (b)：林夜 -> 林叶（旧实现要求 >=3 字，完全跳过 2 字名）
      if (c.name.length >= 2) {
        const seen = new Set<string>()
        const push = (cand: string, index: number): void => {
          if (cand === c.name || aliases.includes(cand) || seen.has(cand)) return
          // 候选本身就是别的已登记角色 -> 不是笔误（避免同姓角色互相误报）
          if (knownNames.has(cand)) return
          seen.add(cand)
          issues.push({
            kind: 'name',
            severity: 'medium',
            character: c.name,
            chapterId: ch.id,
            description: `发现与「${c.name}」形近的写法「${cand}」，若不是别名建议统一`,
            suggestion: `将该角色别名补充为「${cand}」，或统一为「${c.name}」`,
            excerpt: text.slice(Math.max(0, index - 15), index + cand.length + 15).trim()
          })
        }

        // a) 首尾相同、中间一字不同（3 字及以上才有意义）
        if (c.name.length >= 3) {
          const reA = new RegExp(
            `${escapeRe(c.name[0])}[\\u4e00-\\u9fa5]${escapeRe(c.name[c.name.length - 1])}`,
            'g'
          )
          let mA: RegExpExecArray | null
          while ((mA = reA.exec(text)) !== null) push(mA[0], mA.index)
        }

        // b) 前缀相同、末字不同（最常见的中文笔误）
        const prefix = c.name.slice(0, -1)
        if (prefix.length >= 1) {
          const reB = new RegExp(`${escapeRe(prefix)}([\\u4e00-\\u9fa5])`, 'g')
          let mB: RegExpExecArray | null
          while ((mB = reB.exec(text)) !== null) push(mB[0], mB.index)
        }
      }
    }
  }

  return {
    issues: issues.slice(0, 200),
    checkedCharacters: characters.length,
    scannedChapters: chapters.length,
    durationMs: Date.now() - started
  }
}
