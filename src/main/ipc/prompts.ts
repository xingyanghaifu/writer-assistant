/**
 * 提示词管理 / 缓存 / 网络状态 IPC（阶段 12.5 / 13）。
 */
import { BrowserWindow, net } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import type { PromptTemplate } from '@shared/suggestion'
import { DEFAULT_PROMPTS, versionGte, APP_VERSION } from '@shared/prompts'
import { handleRaw } from './handle'
import { appStore } from '../store'
import { getCache, setCache, clearCache, cacheStats } from '../services/cache'
import { needsExportReminder } from '../services/backup'
import { atomicWrite } from '../services/importer'

/** 合并默认模板与用户自定义（用户优先级更高） */
function effectivePrompts(): PromptTemplate[] {
  const user = appStore.getPrompts()
  const map = new Map<string, PromptTemplate>()
  for (const d of DEFAULT_PROMPTS) map.set(d.id, d)
  for (const u of user) {
    const base = map.get(u.id)
    // 锁定的模板不被默认值覆盖
    map.set(u.id, base ? { ...base, ...u, template: u.custom ? u.template : base.template } : u)
  }
  return Array.from(map.values())
}

export function registerPromptsIpc(): void {
  // ---- 提示词 ----
  handleRaw(IPC.promptList, () => effectivePrompts())

  handleRaw(IPC.promptSave, (_e, t: PromptTemplate) => {
    if (!t || !t.id) return { ok: false, error: '无效模板' }
    const list = appStore.getPrompts().filter((x) => x.id !== t.id)
    list.push({ ...t, custom: true })
    appStore.setPrompts(list)
    return { ok: true, data: t }
  })

  handleRaw(IPC.promptReset, (_e, id?: string) => {
    if (id) {
      appStore.setPrompts(appStore.getPrompts().filter((x) => x.id !== id))
    } else {
      appStore.setPrompts([])
    }
    return effectivePrompts()
  })

  handleRaw(IPC.promptExport, () => {
    try {
      const file = `${appStore.userDataPath}/prompts-export.json`
      atomicWrite(file, JSON.stringify(effectivePrompts(), null, 2))
      return { ok: true, data: file }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  handleRaw(IPC.promptImport, () => {
    try {
      const file = `${appStore.userDataPath}/prompts-import.json`
      if (!existsSync(file)) return { ok: false, error: '未找到 prompts-import.json' }
      const list = JSON.parse(readFileSync(file, 'utf8')) as PromptTemplate[]
      if (!Array.isArray(list)) return { ok: false, error: '格式错误' }
      appStore.setPrompts(list)
      return { ok: true, data: effectivePrompts() }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  /**
   * 提示词版本迁移（阶段 13）。
   * 检查内置模板是否需要升级；远程拉取失败不影响本地。
   */
  handleRaw(IPC.promptCheckUpdate, async () => {
    let updated = 0
    const user = appStore.getPrompts()
    const next: PromptTemplate[] = []
    for (const u of user) {
      const def = DEFAULT_PROMPTS.find((d) => d.id === u.id)
      // 用户锁定或自定义的不自动更新
      if (!def || u.locked || u.custom) {
        next.push(u)
        continue
      }
      // 需要满足最低应用版本要求
      if (def.minAppVersion && !versionGte(APP_VERSION, def.minAppVersion)) {
        next.push(u)
        continue
      }
      if (def.version > u.version) {
        updated++
        next.push({ ...u, version: def.version, template: def.template })
      } else {
        next.push(u)
      }
    }
    if (updated > 0) appStore.setPrompts(next)

    // 尝试远程更新（失败静默降级，不影响本地）
    let message = updated > 0 ? `已更新 ${updated} 个模板` : '模板已是最新'
    try {
      const remote = await fetchRemotePrompts()
      if (remote && remote.length) {
        // 仅补充本地没有的新模板
        const have = new Set(effectivePrompts().map((p) => p.id))
        const added = remote.filter((r) => !have.has(r.id))
        if (added.length) {
          appStore.setPrompts([...appStore.getPrompts(), ...added])
          message += `，新增 ${added.length} 个远程模板`
        }
      }
    } catch {
      message += '（远程更新不可用，已跳过）'
    }
    return { ok: true, data: { updated, message } }
  })

  // ---- 缓存 ----
  handleRaw(IPC.cacheGet, (_e, key: string) => getCache(key))
  handleRaw(IPC.cacheSet, (_e, key: string, value: string) => {
    setCache(key, value)
    return { ok: true }
  })
  handleRaw(IPC.cacheClear, () => {
    clearCache()
    return { ok: true }
  })
  handleRaw(IPC.cacheStats, () => cacheStats())

  // ---- 网络状态（离线写作，阶段 12.5）----
  handleRaw(IPC.networkState, () => (net.isOnline() ? 'online' : 'offline'))

  // ---- 导出提醒（阶段 7.5）----
  handleRaw('backup:needs-reminder' as never, () => needsExportReminder())

  // 网络变化监听 -> 推送给渲染进程（离线写作：联网后补做）
  let lastOnline: boolean | null = null
  setInterval(() => {
    const online = net.isOnline()
    if (lastOnline !== null && lastOnline !== online) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.networkChanged, online ? 'online' : 'offline')
      }
    }
    lastOnline = online
  }, 10000)
}

/** 从远程拉取提示词（阶段 13）。失败返回 null。 */
async function fetchRemotePrompts(): Promise<PromptTemplate[] | null> {
  const url = 'https://raw.githubusercontent.com/writer-assistant/prompts/main/prompts.json'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as PromptTemplate[]
    return Array.isArray(json) ? json : null
  } catch {
    return null
  }
}
