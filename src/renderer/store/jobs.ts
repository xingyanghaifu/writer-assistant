import { create } from 'zustand'

export type JobKind = 'imitate' | 'breakdown' | 'prompt-iterate' | 'generic'
export type JobStatus = 'running' | 'paused' | 'done' | 'failed'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface JobStep {
  id: string
  label: string
  status: StepStatus
  detail?: string
  score?: number
}

export interface JobLog {
  at: number
  text: string
}

export interface JobRecord {
  id: string
  kind: JobKind
  title: string
  status: JobStatus
  progress: number
  message: string
  steps: JobStep[]
  logs: JobLog[]
  startedAt: number
  updatedAt: number
  canPause?: boolean
}

interface JobsState {
  jobs: JobRecord[]
  open: boolean
  expandedId: string | null
  start: (job: Omit<JobRecord, 'logs' | 'startedAt' | 'updatedAt' | 'status' | 'progress'> & Partial<Pick<JobRecord, 'status' | 'progress' | 'logs'>>) => string
  patch: (id: string, patch: Partial<Pick<JobRecord, 'status' | 'progress' | 'message' | 'canPause' | 'title'>>) => void
  setStep: (id: string, stepId: string, patch: Partial<JobStep>) => void
  log: (id: string, text: string) => void
  finish: (id: string, status: 'done' | 'failed' | 'paused', message?: string) => void
  setOpen: (v: boolean) => void
  setExpanded: (id: string | null) => void
  clearFinished: () => void
  remove: (id: string) => void
}

function now(): number { return Date.now() }

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  open: false,
  expandedId: null,
  start: (job) => {
    const id = job.id
    const rec: JobRecord = {
      ...job,
      status: job.status ?? 'running',
      progress: job.progress ?? 0,
      logs: job.logs ?? [{ at: now(), text: job.message || '开始' }],
      startedAt: now(),
      updatedAt: now()
    }
    set((s) => ({
      jobs: [rec, ...s.jobs.filter((j) => j.id !== id)].slice(0, 8),
      open: true,
      expandedId: id
    }))
    return id
  },
  patch: (id, patch) => {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: now() } : j))
    }))
  },
  setStep: (id, stepId, patch) => {
    set((s) => ({
      jobs: s.jobs.map((j) => {
        if (j.id !== id) return j
        const steps = j.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st))
        return { ...j, steps, updatedAt: now() }
      })
    }))
  },
  log: (id, text) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, logs: [...j.logs, { at: now(), text }].slice(-40), message: text, updatedAt: now() } : j
      )
    }))
  },
  finish: (id, status, message) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id
          ? {
              ...j,
              status,
              progress: status === 'done' ? 1 : j.progress,
              message: message ?? j.message,
              updatedAt: now(),
              logs: message ? [...j.logs, { at: now(), text: message }].slice(-40) : j.logs
            }
          : j
      )
    }))
  },
  setOpen: (v) => set({ open: v }),
  setExpanded: (id) => set({ expandedId: id, open: true }),
  clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'running' || j.status === 'paused') })),
  remove: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
}))

export function activeJobCount(): number {
  return useJobsStore.getState().jobs.filter((j) => j.status === 'running' || j.status === 'paused').length
}
