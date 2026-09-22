import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import type { PetSettings, PetAvatarRef } from '@shared/pet'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'

const ASSET_HINT = `形象包目录结构：
  <dir>/
    manifest.json
    frames/<id>_<n>.png
或者
    spritesheet.png
    spritesheet.json

manifest 示例字段：
  id, name, license, states.idle.frames[]

⚠️ 仅从本地导入，不内置任何素材。` + '\n提示词：缺 license 字段时仅限个人本地使用，请勿分发。'

export function PetSettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [avatars, setAvatars] = useState<PetAvatarRef[]>([])
  const [settings, setSettings] = useState<PetSettings>(DEFAULT_PET_SETTINGS)
  const [busy, setBusy] = useState(false)

  async function load(): Promise<void> {
    const [a, s] = await Promise.all([
      window.api.pet.listAvatars(),
      window.api.pet.getSettings()
    ])
    if (a.ok) setAvatars(a.data as PetAvatarRef[])
    if (s) setSettings(s as PetSettings)
  }
  useEffect(() => {
    void load()
  }, [])

  async function update(patch: Partial<PetSettings>): Promise<void> {
    const next = { ...settings, ...patch }
    setSettings(next)
    await window.api.pet.updateSettings(patch)
  }

  async function importAvatar(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.api.pet.importAvatar()
      if (r.ok) {
        showToast('已导入形象', 'success')
        await load()
        const data = r.data as PetAvatarRef
        if (!settings.avatarId && data?.id) await update({ avatarId: data.id, enabled: true })
      } else if (r.error !== '已取消') showToast(r.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function switchTo(id: string): Promise<void> {
    const r = await window.api.pet.switchAvatar(id)
    if (r.ok) {
      await update({ avatarId: id, enabled: true })
      showToast('已切换形象', 'success')
    }
  }

  async function removeAvatar(id: string): Promise<void> {
    const a = avatars.find((x) => x.id === id)
    if (!a) return
    const txt = a.copied
      ? `删除形象「${a.name}」？\n将同时删除应用内复制的资源（不影响你的原文件）。`
      : `删除形象「${a.name}」的引用？\n（资源路径指向你的本地原文件，不会删除原文件。）`
    if (!window.confirm(txt)) return
    const r = await window.api.pet.deleteAvatar(id)
    if (r.ok) {
      showToast('已删除', 'success')
      await load()
    } else showToast(r.error, 'error')
  }

  async function toggleWindow(): Promise<void> {
    if (settings.enabled) {
      await window.api.pet.close()
      showToast('宠物窗口已关闭', 'info')
    } else {
      if (!settings.avatarId) {
        showToast('请先导入并选择一个形象包', 'error')
        return
      }
      await window.api.pet.open()
      showToast('宠物窗口已打开', 'success')
    }
  }

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wa-modal flex max-h-[92vh] w-[min(48rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">🐾 桌面宠物</h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3 text-[12px]">
          <div>
            <h3 className="mb-1 text-[11px] font-medium">已导入形象</h3>
            <div className="max-h-56 overflow-y-auto rounded border" style={{ borderColor: 'var(--wa-border)' }}>
              {avatars.length === 0 ? (
                <div className="p-3 text-center text-[11px] wa-muted">暂无形象</div>
              ) : (
                avatars.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 border-b px-2 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{a.name}</span>
                        {settings.avatarId === a.id && <span className="rounded bg-ink-800 px-1 text-[9px] text-white">当前</span>}
                        {a.copied ? <span className="text-[10px] text-blue-600">·已复制</span> : <span className="text-[10px] text-amber-600">·仅引用</span>}
                      </div>
                      <div className="text-[10px] wa-muted">{a.author ?? '匿名'} · {a.license ?? '⚠ 仅个人使用'}</div>
                    </div>
                    <button
                      onClick={() => switchTo(a.id)}
                      className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                      style={{ borderColor: 'var(--wa-border)' }}
                    >
                      切到此
                    </button>
                    <button
                      onClick={() => removeAvatar(a.id)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 wa-interactive"
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-2 flex gap-1">
              <button
                onClick={importAvatar}
                disabled={busy}
                className="rounded border px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-40 wa-interactive"
                style={{ borderColor: 'var(--wa-border)' }}
              >
                📥 从本地导入
              </button>
              <button
                onClick={toggleWindow}
                className="rounded bg-ink-800 px-2 py-1 text-[11px] text-white hover:bg-ink-900 wa-interactive"
              >
                {settings.enabled ? '关闭窗口' : '打开窗口'}
              </button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-black/[0.04] p-2 font-mono text-[10px] leading-relaxed">{ASSET_HINT}</pre>
          </div>

          <div>
            <h3 className="mb-1 text-[11px] font-medium">行为设置</h3>
            <div className="space-y-2 rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                启用宠物
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.allowAiInspiration}
                  onChange={(e) => update({ allowAiInspiration: e.target.checked })}
                />
                允许 AI 灵感（仍走网页版；不在本地缓存原始章节正文）
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.onlyFavoritePrompts}
                  onChange={(e) => update({ onlyFavoritePrompts: e.target.checked })}
                />
                只使用收藏提示词
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.silent}
                  onChange={(e) => update({ silent: e.target.checked })}
                />
                静默模式（只改表情，不显示气泡）
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.animationsEnabled}
                  onChange={(e) => update({ animationsEnabled: e.target.checked })}
                />
                启用动画
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={settings.honorReducedMotion}
                  onChange={(e) => update({ honorReducedMotion: e.target.checked })}
                />
                遵守系统「减少动效」
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                触发频率
                <select
                  value={settings.triggerFrequency}
                  onChange={(e) => update({ triggerFrequency: e.target.value as 'low' | 'normal' | 'high' })}
                  className="rounded border px-1 py-0.5"
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  <option value="low">低</option>
                  <option value="normal">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                停顿（秒）
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.perceptionIdleSeconds}
                  onChange={(e) => update({ perceptionIdleSeconds: Math.max(1, Number(e.target.value) || 2) })}
                  className="w-16 rounded border px-1 py-0.5"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                触发字数
                <input
                  type="number"
                  min={10}
                  max={500}
                  step={10}
                  value={settings.perceptionMinChars}
                  onChange={(e) => update({ perceptionMinChars: Math.max(10, Number(e.target.value) || 50) })}
                  className="w-20 rounded border px-1 py-0.5"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
              </label>
            </div>

            <h3 className="mt-3 mb-1 text-[11px] font-medium">合规说明</h3>
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900" style={{ borderColor: 'var(--wa-border)' }}>
              • 不内置 / 打包 / 上传任何形象素材<br />
              • 不扫描全盘；用户主动选择目录<br />
              • 不与 AI 网站直接通信；仍走现有 BackgroundWebview<br />
              • 缺 license 字段视为「仅限个人本地使用，请勿分发」<br />
              • 删除形象时只清应用内副本，不动原文件
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <button onClick={onClose} className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 wa-interactive">关闭</button>
        </div>
      </div>
    </div>
  )
}