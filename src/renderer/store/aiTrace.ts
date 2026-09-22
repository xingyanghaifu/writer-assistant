import { create } from 'zustand'

export type AiPhase = 'thinking' | 'requesting' | 'streaming' | 'done' | 'failed' | 'idle'

export interface AiTraceEntry {
  id: string
  phase: AiPhase
  action: string
  detail: string
  at: number
  /** 结果片段预览 */
  preview?: string
  meta?: { siteId?: string; fromCache?: boolean; chars?: number; durationMs?: number }
}

interface AiTraceState {
  phase: AiPhase
  action: string
  entries: AiTraceEntry[]
  visible: boolean
  push: (e: Omit<AiTraceEntry, 'id' | 'at'> & Partial<Pick<AiTraceEntry, 'id' | 'at'>>) => string
  update: (id: string, patch: Partial<AiTraceEntry>) => void
  setPhase: (phase: AiPhase, action?: string) => void
  markDone: (id: string, preview: string, meta?: AiTraceEntry['meta']) => void
  markFailed: (id: string, reason: string) => void
  clear: () => void
  setVisible: (v: boolean) => void
}

export const useAiTraceStore = create<AiTraceState>((set) => ({
  phase: 'idle',
  action: '',
  entries: [],
  visible: true,
  push: (e) => {
    const id = e.id ?? 'trace_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const entry: AiTraceEntry = {
      id,
      phase: e.phase,
      action: e.action,
      detail: e.detail,
      preview: e.preview,
      meta: e.meta,
      at: e.at ?? Date.now()
    }
    set((s) => ({ entries: [...s.entries, entry].slice(-60) }))
    return id
  },
  update: (id, patch) => {
    set((s) => ({ entries: s.entries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  },
  setPhase: (phase, action) => {
    set((s) => ({ phase, action: action ?? s.action }))
  },
  markDone: (id, preview, meta) => {
    set((s) => ({
      phase: 'done',
      entries: s.entries.map((x) => (x.id === id ? { ...x, phase: 'done', preview, meta: { ...x.meta, ...meta } } : x))
    }))
    // 短暂显示后回到 idle，避免一直"进行中"
    window.setTimeout(() => {
      set((s) => (s.phase === 'done' ? { phase: 'idle' } : {}))
    }, 2500)
  },
  markFailed: (id, reason) => {
    set((s) => ({
      phase: 'failed',
      entries: s.entries.map((x) => (x.id === id ? { ...x, phase: 'failed', detail: reason } : x))
    }))
    window.setTimeout(() => {
      set((s) => (s.phase === 'failed' ? { phase: 'idle' } : {}))
    }, 4000)
  },
  clear: () => set({ entries: [], phase: 'idle', action: '' }),
  setVisible: (v) => set({ visible: v })
}))
