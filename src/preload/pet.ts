/**
 * 宠物窗口的 preload 脚本。
 *
 * 安全约束：contextIsolation:true、sandbox:true、nodeIntegration:false。
 * 通过 window.api 暴露最小 API。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface InspirationItem {
  id: string
  source: 'local-rule' | 'local-random' | 'ai'
  title: string
  content: string
  severity: 'info' | 'suggest' | 'warn'
  chapterId: string
  createdAt: number
}

interface PetApi {
  getAvatars(): Promise<{ ok: boolean; data: { id: string; name: string }[] }>
  getSettings(): Promise<unknown>
  onInspiration(cb: (payload: InspirationItem) => void): () => void
  switchAvatar(id: string): Promise<void>
  /** 渲染层调用：推一条灵感（主进程会转发给本窗口） */
  pushInspiration(item: InspirationItem): Promise<void>
}

const api: PetApi = {
  getAvatars: () => ipcRenderer.invoke('pet:list-avatars' as never),
  getSettings: () => ipcRenderer.invoke('pet:get-settings' as never),
  switchAvatar: (id: string) => ipcRenderer.invoke('pet:switch-avatar' as never, id),
  pushInspiration: (item: InspirationItem) => ipcRenderer.invoke('pet:push-inspiration' as never, item),
  onInspiration: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: InspirationItem): void => cb(payload)
    ipcRenderer.on('pet:inspiration', listener)
    return () => {
      ipcRenderer.removeListener('pet:inspiration', listener)
    }
  }
}

contextBridge.exposeInMainWorld('petApi', api)