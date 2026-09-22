/**
 * Gemini 适配器（阶段 10 / 11.5b）。
 *
 * 平台特性：多消息场景下可能压缩或忘记早期消息。
 * → 默认 summary-first；效果不佳时可降级为 per-chunk-independent。
 */
import type { ChunkingProfile } from '@shared/adapter'
import { createAdapter } from './common'

const INPUT = ['rich-textarea div[contenteditable="true"]', 'rich-textarea textarea', 'div[contenteditable="true"][role="textbox"]']
const SEND = ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]', 'button.send-button']
const REPLY = ['[data-test-id="model-response"]', 'model-response .markdown', '.model-response-text']

/**
 * Gemini 分块策略：summary-first。
 * 每块先只产出摘要，最后基于全部摘要统一处理，规避早期消息被遗忘。
 */
const chunking: ChunkingProfile = {
  mode: 'summary-first',
  maxChunkSize: 3000,
  overlap: 100,
  requireSummary: true,
  buildChunkPrompt(index, total, text, prevSummary) {
    // summary-first：发送每块时就要求只回摘要（不回执）
    const prev = prevSummary ? `\n（已知前文摘要：${prevSummary}）` : ''
    return `这是第 ${index}/${total} 段文本。请只输出该段 100 字以内的摘要，不要做其他处理。${prev}

${text}`
  },
  buildFinalPrompt(task, summaries) {
    const block = summaries.length
      ? `\n\n各段摘要：\n${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : ''
    return `以下是全部段落的摘要，请基于这些摘要${task}。只输出结果，不要重复原文。${block}`
  }
}

export const geminiAdapter = createAdapter({
  id: 'gemini',
  name: 'Gemini',
  url: 'https://gemini.google.com',
  matchPatterns: ['gemini.google.com', 'bard.google.com'],
  inputSelectors: INPUT,
  sendButtonSelectors: SEND,
  assistantMessageSelectors: REPLY,
  chunking
})
