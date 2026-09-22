/**
 * ChatGPT 适配器（阶段 10 / 11.5b）。
 *
 * 平台特性：粘贴超 10000 字符会转附件，且对"接收-处理分离"指令服从度高。
 * → 模式 receive-then-process，块大小保守（5000），必须要求摘要。
 */
import type { ChunkingProfile } from '@shared/adapter'
import { createAdapter, genericChunkPrompt, genericFinalPrompt } from './common'

const INPUT = ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea[data-id]']
const SEND = ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', '#composer-submit-button']
const REPLY = ['[data-message-author-role="assistant"]', '[data-testid^="conversation-turn"] .markdown', '.markdown']

const chunking: ChunkingProfile = {
  mode: 'receive-then-process',
  // ChatGPT 粘贴超 10000 字符会转为附件，块大小需保守
  maxChunkSize: 5000,
  overlap: 200,
  requireSummary: true,
  chunkPrefix: '【分段接收指令】',
  chunkSuffix: '【仅回执】',
  buildChunkPrompt: genericChunkPrompt,
  buildFinalPrompt: genericFinalPrompt
}

export const chatgptAdapter = createAdapter({
  id: 'chatgpt',
  name: 'ChatGPT',
  url: 'https://chat.openai.com',
  matchPatterns: ['chat.openai.com', 'chatgpt.com'],
  inputSelectors: INPUT,
  sendButtonSelectors: SEND,
  assistantMessageSelectors: REPLY,
  chunking
})
