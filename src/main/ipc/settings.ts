import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/settings'
import { appStore } from '../store'
import { handle, handleRaw } from './handle'

/** 阶段 7：设置持久化 + 阶段 8.5：清除所有数据 */
export function registerSettingsIpc(): void {
  handleRaw<[], AppSettings>(IPC.settingsGet, () => appStore.getSettings())

  handleRaw<[Partial<AppSettings>], AppSettings>(IPC.settingsSet, (_e, patch) => appStore.setSettings(patch ?? {}))

  handleRaw<[], { ok: boolean }>(IPC.settingsClearAll, () => {
    appStore.clearAll()
    return { ok: true }
  })
}
