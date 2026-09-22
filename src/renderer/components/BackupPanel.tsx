import { useEffect, useState } from 'react'
import type { BackupStatus, RestoreStrategy } from '@shared/settings'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'

/**
 * 备份面板（阶段 7.5）。
 *
 * 三个副本：本地 / 自定义目录（可指向坚果云等同步盘）/ 手动导出
 * 支持：立即备份、查看列表、校验（SHA-256）、恢复（覆盖/新建/合并）
 */
export function BackupPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const refreshWorks = useWorkStore((s) => s.init)

  const [statuses, setStatuses] = useState<BackupStatus[]>([])
  const [list, setList] = useState<Array<{ path: string; meta: { workTitle: string; createdAt: number; chapterCount: number; wordCount: number } }>>([])
  const [busy, setBusy] = useState(false)
  const [customDir, setCustomDir] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<RestoreStrategy>('merge')

  async function load(): Promise<void> {
    const [s, l] = await Promise.all([window.api.backup.status(), window.api.backup.list()])
    setStatuses(s)
    setList(l as never)
    const settings = useUiStore.getState().settings
    setCustomDir(settings?.backup.customDir ?? '')
  }

  useEffect(() => {
    void load()
  }, [])

  async function runBackup(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.api.backup.runNow()
      if (r.ok) {
        await load()
        showToast('备份完成', 'success')
      } else showToast(r.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function pickDir(): Promise<void> {
    const dir = await window.api.io.pickDirectory()
    if (!dir) return
    const settings = useUiStore.getState().settings
    if (!settings) return
    const updated = await window.api.settings.set({
      backup: { ...settings.backup, customDir: dir, customDirEnabled: true }
    })
    useUiStore.getState().setSettings(updated)
    setCustomDir(dir)
    showToast('自定义备份目录已设置', 'success')
    await load()
  }

  async function verify(filePath: string): Promise<void> {
    const r = await window.api.backup.verify(filePath)
    if (r.ok) {
      showToast(`校验通过：${r.data.chapterCount} 章 / ${r.data.wordCount} 字`, 'success')
    } else {
      const msg =
        r.error === 'E_BACKUP_CORRUPTED'
          ? '备份已损坏（SHA-256 校验失败）'
          : r.error === 'E_BACKUP_VERSION'
            ? '备份版本高于当前应用'
            : r.error
      showToast(msg, 'error')
    }
  }

  async function restore(): Promise<void> {
    if (!restoreTarget) return
    setBusy(true)
    try {
      const r = await window.api.backup.restore({ filePath: restoreTarget, strategy })
      if (r.ok) {
        await refreshWorks()
        showToast('恢复完成', 'success')
        setRestoreTarget(null)
        await load()
      } else {
        showToast(r.error === 'E_BACKUP_CORRUPTED' ? '备份已损坏，无法恢复' : r.error, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="flex max-h-[92vh] w-[min(48rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">备份与恢复</h2>
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* 副本状态 */}
          <div>
            <div className="mb-1.5 font-medium">备份副本</div>
            <div className="space-y-1.5">
              {statuses.map((s) => (
                <div key={s.kind} className="flex items-center justify-between rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                  <div className="min-w-0">
                    <div className="font-medium">
                      {s.label}
                      {!s.enabled && <span className="ml-1 wa-muted">（未启用）</span>}
                    </div>
                    {s.path && <div className="truncate wa-muted" title={s.path}>{s.path}</div>}
                    <div className="wa-muted">
                      {s.count} 个备份
                      {s.lastBackupAt ? ` · 上次 ${new Date(s.lastBackupAt).toLocaleString()}` : ' · 从未备份'}
                    </div>
                    {s.lastError && <div className="text-amber-600">{s.lastError}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => void runBackup()} disabled={busy} className="rounded bg-ink-800 px-2.5 py-1 text-white disabled:opacity-50">
                {busy ? '备份中…' : '立即备份'}
              </button>
              <button onClick={() => void pickDir()} className="rounded px-2.5 py-1 hover:bg-black/5 wa-interactive">
                设置自定义目录
              </button>
              {customDir && <span className="min-w-0 flex-1 truncate wa-muted">{customDir}</span>}
            </div>
            <p className="mt-1 wa-muted">
              提示：把自定义目录设为坚果云 / OneDrive 同步文件夹，即可自动获得云端副本（应用不直接调用云盘 API）。
            </p>
          </div>

          {/* 备份列表 */}
          <div>
            <div className="mb-1.5 font-medium">备份列表（最近 20 个）</div>
            {list.length === 0 ? (
              <div className="wa-muted">暂无备份文件</div>
            ) : (
              <ul className="divide-y rounded border" style={{ borderColor: 'var(--wa-border)' }}>
                {list.slice(0, 20).map((b) => (
                  <li key={b.path} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.meta.workTitle}</div>
                      <div className="truncate wa-muted" title={b.path}>
                        {new Date(b.meta.createdAt).toLocaleString()} · {b.meta.chapterCount} 章 ·{' '}
                        {b.meta.wordCount.toLocaleString()} 字
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => void verify(b.path)} className="rounded px-1.5 py-0.5 hover:bg-black/5 wa-interactive">
                        校验
                      </button>
                      <button
                        onClick={() => setRestoreTarget(b.path)}
                        className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-black/5 wa-interactive"
                      >
                        恢复
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 恢复确认 */}
          {restoreTarget && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2.5">
              <div className="mb-1.5 font-medium text-amber-800">选择恢复方式</div>
              <div className="space-y-1">
                {(
                  [
                    ['merge', '合并', '把备份中的章节并入现有作品，不删除你已有的内容（最安全）'],
                    ['new', '作为新作品导入', '创建一份副本，保留两者'],
                    ['overwrite', '覆盖现有作品', '用备份完全替换同 id 作品，现有内容会丢失']
                  ] as Array<[RestoreStrategy, string, string]>
                ).map(([id, label, desc]) => (
                  <label key={id} className="flex items-start gap-2">
                    <input
                      type="radio"
                      checked={strategy === id}
                      onChange={() => setStrategy(id)}
                      className="mt-0.5"
                    />
                    <span>
                      {label}
                      <span className="wa-muted">（{desc}）</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => void restore()}
                  disabled={busy}
                  className={`rounded px-2.5 py-1 text-white disabled:opacity-50 ${
                    strategy === 'overwrite' ? 'bg-red-600' : 'bg-ink-800'
                  }`}
                >
                  {busy ? '恢复中…' : strategy === 'overwrite' ? '确认覆盖恢复' : '确认恢复'}
                </button>
                <button onClick={() => setRestoreTarget(null)} className="rounded px-2.5 py-1 hover:bg-black/5 wa-interactive">
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t px-4 py-2.5">
          <button onClick={onClose} className="rounded px-3 py-1 text-xs hover:bg-black/5 wa-interactive">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
