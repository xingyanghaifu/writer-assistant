/**
 * DeepSeek 适配器（阶段 2 / 11.5b）。
 *
 * ⚠️ 站点改版只需改本文件的选择器常量，其他代码不受影响。
 * 注入脚本由 common.ts 生成（统一容错），这里只声明选择器与分块策略。
 */
import type { ChunkingProfile } from '@shared/adapter'
import {
  createAdapter,
  buildInsertScript,
  buildSubmitScript,
  buildExtractReplyScript,
  buildLoginScript,
  buildStreamingScript
} from './common'

/**
 * 输入框选择器（2026-09 实测于 chat.deepseek.com，已登录）。
 *
 * ⚠️ DeepSeek 当前真实结构是一个 `<textarea name="search" placeholder="给 DeepSeek 发送消息">`，
 * 既没有 id="chat-input"，也没有 contenteditable。
 * 因此 `textarea[name="search"]` 必须排在第一位；
 * 其余为历史结构/兜底，站点再改版时优先按实测结果更新本数组。
 */
const INPUT_SELECTORS = [
  'textarea[name="search"]',
  'textarea[placeholder*="DeepSeek"]',
  'textarea[placeholder*="发送消息"]',
  '#chat-input',
  'textarea[data-testid="chat-input"]',
  'div[contenteditable][role="textbox"]',
  'textarea'
]

/**
 * 发送按钮选择器（实测）。
 *
 * DeepSeek 的发送键是 `<div class="ds-button ds-button--primary ds-button--filled ds-button--circle">`，
 * **不是 `<button>`**，也没有 aria-label，所以早期按 button/aria-label 写的一律命中不到。
 * 这里用 ds-button 类族特征匹配；找不到时由 common.ts 的启发式兜底接管。
 */
const SEND_SELECTORS = [
  'div.ds-button--circle.ds-button--primary',
  'div.ds-button--primary.ds-button--filled',
  'div[class*="ds-button"][class*="circle"]',
  'button[aria-label="Send message"]',
  '[data-testid="send-button"]',
  'button[type="submit"]'
]

/** 助手回复容器（实测为 .ds-markdown；若未命中则回退到通用 markdown 容器） */
const ASSISTANT_SELECTORS = [
  '.ds-markdown',
  '[class*="ds-markdown"]',
  '[data-message-author-role="assistant"]',
  '[class*="AssistantMessage"]'
]

/**
 * DeepSeek 分块策略（阶段 11.5b）。
 * DeepSeek 对 〖〗 结构化前缀响应好 → receive-then-process + 摘要。
 */
const deepseekChunking: ChunkingProfile = {
  mode: 'receive-then-process',
  maxChunkSize: 3000,
  overlap: 200,
  requireSummary: true,
  chunkPrefix: '〖接收〗',
  chunkSuffix: '〖仅回执〗',
  buildChunkPrompt(index, total, text, prevSummary) {
    if (index === 1) {
      return `〖接收〗我将分 ${total} 段发送文本，请按规则处理：收到每段只回复"已收到第 X/${total} 段"，不要处理。我发送"开始处理"后再统一处理。〖仅回执〗

第 1/${total} 段：
${text}`
    }
    const prev = prevSummary ? `（前文摘要：${prevSummary}）` : ''
    return `〖接收〗第 ${index}/${total} 段${prev}：
${text}〖仅回执〗`
  },
  buildFinalPrompt(task, summaries) {
    const block = summaries.length
      ? `\n\n各段摘要：\n${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : ''
    return `开始处理。请综合所有段落，${task}。只输出结果，不要重复原文。${block}`
  }
}

export const deepseekAdapter = createAdapter({
  id: 'deepseek',
  name: 'DeepSeek',
  url: 'https://chat.deepseek.com',
  matchPatterns: ['deepseek.com'],
  inputSelectors: INPUT_SELECTORS,
  sendButtonSelectors: SEND_SELECTORS,
  assistantMessageSelectors: ASSISTANT_SELECTORS,
  chunking: deepseekChunking
})

/** 供调试/测试直接取用（与适配器内部一致） */
export const deepseekSelectors = {
  INPUT_SELECTORS,
  SEND_SELECTORS,
  ASSISTANT_SELECTORS
}

/** 脚本构造器（与 common 一致，导出便于单测） */
export const deepseekScripts = {
  insert: (text: string): string => buildInsertScript(JSON.stringify(text), INPUT_SELECTORS),
  submit: (): string => buildSubmitScript(SEND_SELECTORS, INPUT_SELECTORS),
  extractLastReply: (): string => buildExtractReplyScript(ASSISTANT_SELECTORS),
  loginState: (): string => buildLoginScript(INPUT_SELECTORS),
  isStreaming: (): string => buildStreamingScript(ASSISTANT_SELECTORS)
}
