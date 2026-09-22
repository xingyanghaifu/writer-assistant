/**
 * 桌面宠物 IPC（v3 模块二）。
 */
import { BrowserWindow, dialog } from 'electron'
import { IPC } from '@shared/ipc'
import { handleRaw } from './handle'
import {
  listPetAvatars,
  getPetSettings,
  setPetSettings,
  importPetAvatar,
  deletePetAvatar,
  switchPetAvatar,
  openPetWindow,
  closePetWindow,
  pickAvatarSourceDir,
  pushInspirationToPet
} from '../services/pet'

export function registerPetIpc(): void {
  handleRaw('pet:open' as never, () => openPetWindow())
  handleRaw('pet:close' as never, () => {
    closePetWindow()
    return { ok: true }
  })
  handleRaw('pet:list-avatars' as never, () => ({ ok: true, data: listPetAvatars() }))
  handleRaw('pet:get-settings' as never, () => getPetSettings())

  handleRaw('pet:import-avatar' as never, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const srcDir = await pickAvatarSourceDir(win)
    if (!srcDir) return { ok: false, error: '已取消' }
    const copy = await new Promise<'copy' | 'reference'>((resolve) => {
      dialog
        .showMessageBox(win!, {
          type: 'question',
          buttons: ['引用本地路径', '复制到应用数据', '取消'],
          defaultId: 0,
          cancelId: 2,
          title: '导入形象包',
          message: '如何放置形象包资源？',
          detail: '引用本地路径：不复制原始文件；删除应用内引用不影响原文件。\n复制到应用数据：把资源复制到 <userData>/pet-assets/<id>/，删除时一起清掉。'
        })
        .then((r) => {
          if (r.response === 0) resolve('reference')
          else if (r.response === 1) resolve('copy')
          else resolve('reference')
        })
    })
    if (copy === undefined) return { ok: false, error: '已取消' }
    const realCopy = copy === 'copy'
    return importPetAvatar(srcDir, realCopy)
  })

  handleRaw('pet:import-avatar-from-path' as never, (_e, srcDir: string, copy: boolean) =>
    importPetAvatar(srcDir, !!copy)
  )

  handleRaw('pet:switch-avatar' as never, (_e, id: string) => switchPetAvatar(id))
  handleRaw('pet:delete-avatar' as never, (_e, id: string) => deletePetAvatar(id))
  handleRaw('pet:update-settings' as never, (_e, s: unknown) => {
    setPetSettings((s ?? {}) as never)
    return { ok: true }
  })

  handleRaw('pet:push-inspiration' as never, (_e, item: unknown) => {
    pushInspirationToPet(item)
    return { ok: true }
  })

  void IPC
}