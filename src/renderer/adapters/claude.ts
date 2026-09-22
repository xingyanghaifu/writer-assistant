/**
 * Claude 适配器（阶段 10 / 11.5b）。
 *
 * 平台特性：对 XML 标签响应好，但多轮分块容易遗忘前文。
 * → receive-then-process + 强制摘要（每块都产出摘要并在后续块携带）。
 */
import type { ChunkingProfile } from '@shared/adapter'
import { createAdapter, genericFinalPrompt, genericChunkPrompt } from './common'

const INPUT = ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]', 'fieldset div[contenteditable="true"]']
const SEND = ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]', 'button[type="submit"]']
const REPLY = ['[data-testid="assistant-message"]', 'div.font-claude-message', '[class*="Message"] .prose']

/** Claude 偏好 XML 标签，用标签包裹每段以增强结构感知 */
const chunking: ChunkingProfile = {
  mode: 'receive-then-process',
  maxChunkSize: 4000,
  overlap: 200,
  requireSummary: true,
  chunkPrefix: '<segment-instruction>',
  chunkSuffix: '</segment-instruction>',
  buildChunkPrompt(index, total, text, prevSummary) {
    if (index === 1) {
      return `<task>我将分 ${total} 段发送文本。收到每段只回复"已收到第 X/${total} 段"，不要处理。我发送 <start/> 后再统一处理。</task>
<segment index="1" total="${total}">
${text}
</segment>`
    }
    const prev = prevSummary ? `\n<previous-summary>${prevSummary}</previous-summary>` : ''
    return `<segment index="${index}" total="${total}">${prev}
${text}
</segment>`
  },
  buildFinalPrompt(task, summaries) {
    const block = summaries.length
      ? `\n<chunk-summaries>\n${summaries.map((s, i) => `<summary index="${i + 1}">${s}</summary>`).join('\n')}\n</chunk-summaries>`
      : ''
    return `<start/>
<request>请综合所有段落，${task}。只输出结果，不要重复原文。</request>${block}`
  }
}

export const claudeAdapter = createAdapter({
  id: 'claude',
  name: 'Claude',
  url: 'https://claude.ai',
  matchPatterns: ['claude.ai'],
  inputSelectors: INPUT,
  sendButtonSelectors: SEND,
  assistantMessageSelectors: REPLY,
  chunking
})

export { genericChunkPrompt }
