/**
 * 自动同步确认对话框（阶段 5.6，子智能体 C）。
 *
 * 三种模式：
 *  - confirm（默认）：列出全部变更，用户勾选后点「确认更新」
 *  - auto：不弹此对话框（store 直接写入），30 秒内可用撤销条回退
 *  - manual：此对话框只作预览，需用户点击才写入
 *
 * 冲突项默认不勾选，并给出「合并到已有 / 新建」或「手动关联」的候选列表。
 */
import { useEffect, useMemo, useState } from 'react'
import { useMaterialStore, type SyncChangeItem, type SyncDomain } from '../store/material'

const DOMAIN_META: Record<SyncDomain, { label: string; icon: string }> = {
  character: { label: '角色', icon: '🧑' },
  foreshadowing: { label: '伏笔', icon: '🎯' },
  location: { label: '地点', icon: '📍' },
  setting: { label: '设定', icon: '⚙️' },
  outline: { label: '章纲', icon: '🗂' }
}

const ACTION_LABEL: Record<SyncChangeItem['action'], string> = {
  create: '新建',
  update: '更新',
  conflict: '冲突'
}

const ACTION_CLASS: Record<SyncChangeItem['action'], string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-sky-100 text-sky-700',
  conflict: 'bg-amber-100 text-amber-800'
}

export function SyncConfirmDialog(): JSX.Element | null {
  const open = useMaterialStore((s) => s.syncDialogOpen)
  const plan = useMaterialStore((s) => s.syncPlan)
  const close = useMaterialStore((s) => s.closeSyncDialog)
  const toggle = useMaterialStore((s) => s.toggleSyncChange)
  const setChecked = useMaterialStore((s) => s.setSyncChangeChecked)
  const applyPlan = useMaterialStore((s) => s.applySyncPlan)
  const linkForeshadowing = useMaterialStore((s) => s.linkForeshadowing)
  const mode = useMaterialStore((s) => s.syncMode())

  /** 冲突项的候选选择（本地 UI 状态，不写入 plan） */
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState(false)

  const grouped = useMemo(() => {
    const map = new Map<SyncDomain, SyncChangeItem[]>()
    for (const c of plan?.changes ?? []) {
      const list = map.get(c.domain) ?? []
      list.push(c)
      map.set(c.domain, list)
    }
    return Array.from(map.entries())
  }, [plan])

  const checkedCount = (plan?.changes ?? []).filter((c) => c.checked).length

  if (!open || !plan) return null

  async function onConfirm(): Promise<void> {
    if (!plan) return
    setApplying(true)
    try {
      // 冲突项若用户选了候选目标，先做关联
      for (const c of plan.changes) {
        if (c.action !== 'conflict' || !c.checked) continue
        const target = picked[c.id]
        if (!target) continue
        if (c.domain === 'foreshadowing' && c.targetId !== target) {
          await linkForeshadowing(c.targetId ?? c.payload.id, target)
        }
      }
      await applyPlan(plan)
      close()
    } finally {
      setApplying(false)
    }
  }

  function toggleAll(checked: boolean): void {
    if (!plan) return
    setChecked(
      plan.changes.map((c) => c.id),
      checked
    )
  }

  return (
    <div className="wa-modal-backdrop absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-3">
      <div className="wa-modal flex max-h-[90vh] w-[min(35rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border shadow-xl wa-panel">
        {/* 头部 */}
        <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <div>
            <h2 className="text-sm font-semibold">同步分析结果</h2>
            <p className="mt-0.5 text-[11px] wa-muted">
              {plan.chapterTitle} · 新建 {plan.counts.create} / 更新 {plan.counts.update} / 冲突{' '}
              {plan.counts.conflict}
              {mode === 'manual' ? ' · 手动模式（点击后更新）' : ''}
            </p>
          </div>
          <button onClick={close} className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5 wa-interactive" title="关闭">
            ✕
          </button>
        </header>

        {/* 全选 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]">
          <button onClick={() => toggleAll(true)} className="rounded px-1.5 py-0.5 hover:bg-black/5 wa-interactive">
            全选
          </button>
          <button onClick={() => toggleAll(false)} className="rounded px-1.5 py-0.5 hover:bg-black/5 wa-interactive">
            全不选
          </button>
          <span className="wa-muted">已选 {checkedCount} / {plan.changes.length}</span>
        </div>

        {/* 变更列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {plan.changes.length === 0 && <p className="py-6 text-center text-xs wa-muted">没有可更新的内容</p>}

          {grouped.map(([domain, list]) => (
            <section key={domain} className="mb-3">
              <h3 className="mb-1 text-[11px] font-semibold wa-muted">
                {DOMAIN_META[domain].icon} {DOMAIN_META[domain].label}（{list.length}）
              </h3>
              <ul className="space-y-1">
                {list.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border px-2 py-1.5"
                    style={{
                      borderColor: c.action === 'conflict' ? '#d9a441' : 'var(--wa-border)',
                      background: c.action === 'conflict' ? 'rgba(217,164,65,0.07)' : 'transparent'
                    }}
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={c.checked}
                        onChange={() => toggle(c.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1 py-px text-[10px] font-medium ${ACTION_CLASS[c.action]}`}
                          >
                            {ACTION_LABEL[c.action]}
                          </span>
                          <span className="truncate text-xs font-medium">{c.label}</span>
                        </span>
                        {c.detail && <span className="mt-0.5 block text-[11px] wa-muted">{c.detail}</span>}
                      </span>
                    </label>

                    {/* 冲突处理 */}
                    {c.action === 'conflict' && (
                      <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                        <p className="mb-1 text-[11px] text-amber-700">{c.conflictMessage}</p>
                        {c.candidates.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {c.candidates.map((cand) => (
                              <label key={cand.id} className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                                <input
                                  type="radio"
                                  name={`conflict-${c.id}`}
                                  checked={picked[c.id] === cand.id}
                                  onChange={() => {
                                    setPicked((p) => ({ ...p, [c.id]: cand.id }))
                                    setChecked([c.id], true)
                                  }}
                                />
                                <span className="truncate">合并到「{cand.label}」</span>
                              </label>
                            ))}
                            <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                              <input
                                type="radio"
                                name={`conflict-${c.id}`}
                                checked={!picked[c.id]}
                                onChange={() => setPicked((p) => ({ ...p, [c.id]: '' }))}
                              />
                              <span>不处理（保持现有）</span>
                            </label>
                          </div>
                        ) : (
                          <p className="text-[11px] wa-muted">暂无可关联项，可取消勾选后手动处理。</p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* 底部 */}
        <footer className="flex shrink-0 items-center justify-between border-t px-3 py-2">
          <span className="text-[11px] wa-muted">
            {mode === 'auto' ? '自动模式：已直接更新' : '仅写入被勾选的项，正文不会被修改'}
          </span>
          <div className="flex gap-1.5">
            <button onClick={close} className="rounded px-2.5 py-1 text-xs hover:bg-black/5 wa-interactive">
              取消
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={applying || checkedCount === 0}
              className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 disabled:opacity-40"
            >
              {applying ? '更新中…' : `确认更新（${checkedCount}）`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/**
 * 自动模式下的撤销条（30 秒有效）。
 * 挂在各素材标签页底部；到点自动隐藏。
 */
export function SyncUndoBar(): JSX.Element | null {
  const [, setTick] = useState(0)
  const canUndo = useMaterialStore((s) => s.canUndo())
  const undo = useMaterialStore((s) => s.undoLastSync)

  // 每 5 秒刷新一次可用性（30 秒窗口）
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  if (!canUndo) return null
  return (
    <div className="sticky bottom-0 flex items-center justify-between border-t px-3 py-1.5 text-[11px] wa-panel">
      <span>素材已自动同步（30 秒内可撤销）</span>
      <button
        onClick={() => void undo()}
        className="rounded border px-2 py-0.5 hover:bg-black/5 wa-interactive"
        style={{ borderColor: 'var(--wa-border)' }}
      >
        撤销
      </button>
    </div>
  )
}
