/**
 * 适配器脚本 -> 跨 IPC 可传递的脚本集合（阶段 2）。
 *
 * 主进程只执行脚本，不理解站点；这里把适配器生成脚本的过程收敛到一处。
 */
import type { SiteAdapter, AdapterScripts, ChunkingSpec } from '@shared/adapter'
import { PROMPT_SENTINEL } from '@shared/adapter'

/**
 * 生成脚本集合。
 *
 * insert 脚本需要"插入任意提示词"，但函数无法跨 IPC，
 * 因此 insertDraftScript 接收哨兵，把插入位置写成字面量 "__WA_PROMPT__"；
 * 主进程执行前替换为 JSON.stringify(实际提示词)。
 */
export function toScripts(adapter: SiteAdapter): AdapterScripts {
  return {
    insert: adapter.insertDraftScript(PROMPT_SENTINEL),
    submit: adapter.submitScript ? adapter.submitScript() : '',
    extractLastReply: adapter.extractLastReplyScript(),
    loginState: adapter.loginStateScript(),
    isStreaming: adapter.streamingObserverScript()
  }
}

/** 把 ChunkingProfile（含函数）降为可序列化的 ChunkingSpec */
export function toChunkingSpec(adapter: SiteAdapter): ChunkingSpec {
  const c = adapter.chunking
  return {
    mode: c.mode,
    maxChunkSize: c.maxChunkSize,
    overlap: c.overlap,
    requireSummary: c.requireSummary,
    chunkPrefix: c.chunkPrefix,
    chunkSuffix: c.chunkSuffix
  }
}
