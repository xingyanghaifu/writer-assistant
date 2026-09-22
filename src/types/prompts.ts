/**
 * 内置提示词模板（阶段 12.5 + 13）。
 *
 * 全部提示词集中在此，支持占位符替换；用户可在设置中自定义/导入导出/恢复默认。
 * 模板带 version 与 minAppVersion，用于阶段 13 的版本迁移。
 */
import type { PromptTemplate } from './suggestion'

/** 应用版本（与 package.json 对齐），用于 minAppVersion 比较 */
export const APP_VERSION = '0.1.0'

/** 占位符替换：{name} 形式 */
export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? m : String(v)
  })
}

/** 默认模板集合 */
export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'suggest',
    name: '剧情走向建议',
    task: 'suggest',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前片段如下：

"""
{draft}
"""

请给出 3 条不同的剧情走向建议，分别代表不同方向。严格按以下 JSON 输出：
{"suggestions":[{"tag":"悬疑向","summary":"一句话","detail":"2-3句","effect":"效果"}]}`
  },
  {
    id: 'follow-up',
    name: '走向追问展开',
    task: 'follow-up',
    version: 1,
    minAppVersion: '0.1.0',
    template: '基于你刚才建议的「{tag}」走向，请展开写 500 字。'
  },
  {
    id: 'summarize',
    name: '章节摘要',
    task: 'summarize',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请为以下小说章节生成 100 字以内的摘要，概括主要剧情、出场角色和关键转折。只输出摘要：

{content}`
  },
  {
    id: 'summarize-merge',
    name: '分段摘要合并',
    task: 'summarize',
    version: 1,
    minAppVersion: '0.1.0',
    template: `以下是同一章的分段摘要，请合并为一段 100 字以内的完整摘要，概括主要剧情、出场角色和关键转折。只输出摘要：

{segments}`
  },
  {
    id: 'sync-extract',
    name: '写作模块同步提取',
    task: 'sync-extract',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请阅读以下小说章节，提取结构化信息。严格按以下 JSON 输出，不要输出任何其他内容：
{"characters":[{"name":"角色名","isNew":true,"intro":"简介","tags":["标签"],"appearances":1}],
 "outline":{"chapterSummary":"本章摘要","keyEvents":["关键事件"],"endingHook":"结尾钩子"},
 "foreshadowing":[{"content":"伏笔内容","type":"plant","relatedTo":"关联对象"}],
 "locations":[{"name":"地点名","isNew":true,"description":"描述"}],
 "settings":[{"name":"设定名","isNew":true,"description":"描述"}]}

章节正文：
{content}`
  },
  {
    id: 'polish',
    name: '润色',
    task: 'polish',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请润色以下文字，保持原意与风格，使表达更流畅生动。只输出润色后的文字，不要解释：

{text}`
  },
  {
    id: 'expand',
    name: '扩写',
    task: 'expand',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请扩写以下文字，补充细节与描写，使内容更丰富。只输出扩写后的文字，不要解释：

{text}`
  },
  {
    id: 'condense',
    name: '缩写',
    task: 'condense',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请缩写以下文字，保留关键信息与情节，删除冗余。只输出缩写后的文字，不要解释：

{text}`
  },
  {
    id: 'rewrite',
    name: '改写',
    task: 'rewrite',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请改写以下文字，换一种表达方式，保持原意。只输出改写后的文字，不要解释：

{text}`
  },
  {
    id: 'ask',
    name: '问 AI',
    task: 'ask',
    version: 1,
    minAppVersion: '0.1.0',
    template: `关于以下文字，我有一个问题：{question}

文字内容：
{text}`
  },
  {
    id: 'outline-gen',
    name: '一键生成章纲',
    task: 'outline-gen',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请阅读以下章节正文，生成章纲。严格按以下 JSON 输出：
{"chapterSummary":"本章摘要","keyEvents":["核心事件"],"characters":["出场角色"],"turningPoint":"关键转折","endingHook":"结尾钩子"}

章节正文：
{content}`
  },
  {
    id: 'consistency-check',
    name: '角色一致性检查',
    task: 'consistency-check',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请检查以下章节正文与角色设定是否一致，找出矛盾之处。严格按以下 JSON 输出（无问题则 issues 为空数组）：
{"issues":[{"severity":"high","character":"角色名","description":"问题描述","suggestion":"修改建议"}]}

角色设定：
{characters}

章节正文：
{content}`
  },
  {
    id: 'chapter-split',
    name: '智能分章',
    task: 'chapter-split',
    version: 1,
    minAppVersion: '0.1.0',
    template: `请分析以下正文，找出 3-5 个最合适的分章点。严格按以下 JSON 输出：
{"points":[{"offset":0,"title":"章节标题","reason":"分章理由"}]}

offset 为该分章点在正文中的字符偏移量。

正文：
{content}`
  },

  // ---------- 灵感库（多分类）----------
  {
    id: 'idea-plot',
    name: '情节灵感',
    task: 'inspiration',
    category: '情节',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前情节如下：

"""
{draft}
"""

请给出 6 个**情节走向**方向的灵感，覆盖不同可能性（例如：意外转折、误会升级、身份揭露、外部事件介入、内心转变、关系反转）。每个灵感必须与本段已有内容自然衔接，不要突兀。

严格按以下 JSON 输出：
{"ideas":[{"title":"8字以内标题","hook":"一句话核心点子","how":"如何展开（2-3句）","impact":"对后续剧情的影响"}]}`
  },
  {
    id: 'idea-character',
    name: '人设灵感',
    task: 'inspiration',
    category: '人设',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

已知角色：
{characters}

请基于当前剧情，给出 5 个**新角色或角色深化**的灵感。新角色要与现有角色形成张力（对立、镜像、催化等），不要凭空重复已有类型。

严格按以下 JSON 输出：
{"ideas":[{"title":"角色名/称号","hook":"一句话定位","how":"性格与动机（2-3句）","impact":"与现有角色的关系与张力"}]}`
  },
  {
    id: 'idea-conflict',
    name: '冲突灵感',
    task: 'inspiration',
    category: '冲突',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

请给出 5 个可以立刻加入本段的**冲突**灵感，覆盖不同层级（人际冲突、内心冲突、利益冲突、价值观冲突、环境/外部压力）。

每个冲突都要说明"谁和谁、争什么、为什么不能退让"。

严格按以下 JSON 输出：
{"ideas":[{"title":"8字以内","hook":"一句话冲突","how":"双方立场与不可退让的原因","impact":"升级路径"}]}`
  },
  {
    id: 'idea-twist',
    name: '反转灵感',
    task: 'inspiration',
    category: '反转',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

请给出 5 个**反转**灵感，要求：读者回头重读前文能发现伏笔，而不是生硬翻转。每个反转请标注可行性（高/中/低）和需要在前文补埋的伏笔。

严格按以下 JSON 输出：
{"ideas":[{"title":"8字以内","hook":"反转内容","how":"为什么合理","impact":"需要补埋的伏笔","feasibility":"高|中|低"}]}`
  },
  {
    id: 'idea-opening',
    name: '开篇灵感',
    task: 'inspiration',
    category: '开篇',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说。

作品名称：{workTitle}
简介/大纲：
{context}

请给出 5 个不同的**开篇**方案（第一段或第一章开头），覆盖不同切入方式（悬念式、场景式、对话式、倒叙式、日常反差式）。每个方案给出一段 100 字左右的示范开篇文字。

严格按以下 JSON 输出：
{"ideas":[{"title":"8字以内","hook":"切入方式","how":"100字示范开篇","impact":"留下的钩子"}]}`
  },
  {
    id: 'idea-title',
    name: '起名灵感',
    task: 'inspiration',
    category: '命名',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说。

作品名称：{workTitle}
当前内容：
"""
{draft}
"""

请给出 8 个**书名/章节名**候选，风格各异（写实、意象、悬念、口语、古典等），并简述每个的取向。

严格按以下 JSON 输出：
{"ideas":[{"title":"候选名","hook":"风格取向","how":"为什么合适","impact":"适合的读者群"}]}`
  },
  {
    id: 'idea-detail',
    name: '细节灵感',
    task: 'inspiration',
    category: '细节',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

请给出 8 个可以让这段更有质感的**细节**灵感，覆盖五感（视觉/听觉/嗅觉/触觉/味觉）、动作、环境、器物、时代特征。

每个细节要具体可写，避免"他很紧张"这类概述。

严格按以下 JSON 输出：
{"ideas":[{"title":"细节类型","hook":"一句话细节","how":"具体怎么写（2-3句）","impact":"营造的效果"}]}`
  },
  {
    id: 'idea-dialogue',
    name: '对话灵感',
    task: 'inspiration',
    category: '对话',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

请给出 5 段**对话**灵感，要求每段都有潜台词（人物说的和想的不一致），并标注说话双方的关系。

严格按以下 JSON 输出：
{"ideas":[{"title":"双方关系","hook":"冲突点","how":"示范对话（4-6句，含潜台词）","impact":"推动什么"}]}`
  },
  {
    id: 'idea-turning',
    name: '转折点灵感',
    task: 'inspiration',
    category: '结构',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

已知章节摘要：
{context}

请指出这个故事**接下来最需要的 5 个结构转折点**（例如：中点反转、至暗时刻、导师之死、假胜利、最终抉择），并说明每个应该安排在什么位置、为什么现在需要它。

严格按以下 JSON 输出：
{"ideas":[{"title":"结构节点名","hook":"一句话说明","how":"该发生什么（2-3句）","impact":"安排在什么位置"}]}`
  },
  {
    id: 'idea-foreshadow',
    name: '伏笔灵感',
    task: 'inspiration',
    category: '伏笔',
    version: 1,
    minAppVersion: '0.1.0',
    template: `我正在写一部小说，当前内容如下：

"""
{draft}
"""

已有伏笔：
{foreshadowings}

请给出 5 个**可埋设的伏笔**灵感。每个都要说明：埋在哪里、表面看起来是什么、后续如何回收、回收时的效果。

严格按以下 JSON 输出：
{"ideas":[{"title":"8字以内","hook":"表面是什么","how":"后续如何回收","impact":"回收效果"}]}`
  }
]

/** 灵感库分类（用于 UI 分组展示） */
export const INSPIRATION_CATEGORIES = [
  '情节',
  '人设',
  '冲突',
  '反转',
  '开篇',
  '命名',
  '细节',
  '对话',
  '结构',
  '伏笔'
] as const

/** 取全部灵感模板 */
export function getInspirationPrompts(): PromptTemplate[] {
  return DEFAULT_PROMPTS.filter((p) => p.task === 'inspiration')
}

/** 按 id 取默认模板 */
export function getDefaultPrompt(id: string): PromptTemplate | undefined {
  return DEFAULT_PROMPTS.find((p) => p.id === id)
}

/** 按任务类型取默认模板 */
export function getDefaultByTask(task: string): PromptTemplate | undefined {
  return DEFAULT_PROMPTS.find((p) => p.task === task)
}

/**
 * 简易 semver 比较：a >= b 返回 true。
 * 用于 minAppVersion 检查（阶段 13）。
 */
export function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}
