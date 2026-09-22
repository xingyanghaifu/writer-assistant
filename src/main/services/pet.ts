/**
 * 桌面宠物服务（v3 模块二）。
 *
 * 范围（本会话实现）：
 *  - 形象包管理：导入 / 复制 / 删除 / 切换 / 列引用
 *  - 设置存储（PetSettings）
 *  - 窗口创建（透明置顶无边框）+ 拖拽 + 位置记忆
 *  - 灵感事件（占位：先发出空心跳，规则引擎在 Phase 4 接入）
 *
 * ⚠️ 安全/合规约束：
 *  - 不内置 / 打包 / 上传任何形象素材
 *  - 不扫描全盘；用户主动选择目录
 *  - 默认"引用本地路径"（copied=false），删除时不删原文件
 *  - 缺 license 强制个人使用提示
 *  - 不与 AI 网站直接通信（仍走 BackgroundWebview）
 */
import { app, BrowserWindow, dialog, screen } from 'electron'
import { join, basename, dirname } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync } from 'node:fs'
import { appStore } from '../store'
import { DEFAULT_PET_SETTINGS, type PetAvatarRef, type PetSettings, type AvatarManifest } from '@shared/pet'
import { listLibrary } from './promptLibrary'
import type { Res } from '@shared/ipc'

const STORE_KEY_AVATARS = 'petAvatars'
const STORE_KEY_SETTINGS = 'petSettings'

function ok<T>(data: T): Res<T> {
  return { ok: true, data }
}
function fail<T = never>(error: string): Res<T> {
  return { ok: false, error }
}

function getAvatars(): PetAvatarRef[] {
  const list = appStore.getRaw<PetAvatarRef[]>(STORE_KEY_AVATARS)
  if (Array.isArray(list)) return list
  appStore.setRaw(STORE_KEY_AVATARS, [])
  return []
}

function writeAvatars(list: PetAvatarRef[]): void {
  appStore.setRaw(STORE_KEY_AVATARS, list)
}

export function listPetAvatars(): PetAvatarRef[] {
  return getAvatars()
}

export function getPetSettings(): PetSettings {
  const stored = appStore.getRaw<Partial<PetSettings>>(STORE_KEY_SETTINGS) ?? {}
  return { ...DEFAULT_PET_SETTINGS, ...stored }
}

export function setPetSettings(s: Partial<PetSettings>): PetSettings {
  const next = { ...getPetSettings(), ...s }
  appStore.setRaw(STORE_KEY_SETTINGS, next)
  return next
}

/**
 * 导入形象包：从用户选择的目录读取 manifest + 资源。
 * 默认"引用本地路径"，不复制。
 */
export function importPetAvatar(srcDir: string, copy: boolean): Res<PetAvatarRef> {
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    return fail('目录不存在')
  }
  const manifestPath = join(srcDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return fail('目录中找不到 manifest.json')
  }
  let manifest: AvatarManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    return fail('manifest.json 解析失败：' + (err as Error).message)
  }
  if (!manifest.id || !manifest.name || !manifest.states?.idle?.frames?.length) {
    return fail('manifest 缺少必要字段 (id/name/states.idle.frames)')
  }

  // 验证帧文件存在
  for (const f of manifest.states.idle.frames) {
    if (!existsSync(join(srcDir, f))) return fail(`缺帧文件：${f}`)
  }

  let assetDir = srcDir
  let copied = false
  if (copy) {
    const root = join(app.getPath('userData'), 'pet-assets')
    const dst = join(root, manifest.id)
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    copyDir(srcDir, dst)
    assetDir = dst
    copied = true
  }

  const ref: PetAvatarRef = {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    license: manifest.license,
    assetDir,
    copied,
    importedAt: Date.now(),
    manifest
  }
  const list = getAvatars().filter((x) => x.id !== ref.id)
  list.unshift(ref)
  writeAvatars(list)
  return ok(ref)
}

export function deletePetAvatar(id: string): Res<void> {
  const list = getAvatars()
  const item = list.find((x) => x.id === id)
  if (!item) return fail('形象包不存在')
  // 只删 copied=true 的目录
  if (item.copied && existsSync(item.assetDir)) {
    // 防止误删应用外路径
    const root = join(app.getPath('userData'), 'pet-assets')
    if (item.assetDir.startsWith(root)) {
      try {
        rmDir(item.assetDir)
      } catch (err) {
        return fail('清理资源失败：' + (err as Error).message)
      }
    }
  }
  writeAvatars(list.filter((x) => x.id !== id))
  if (getPetSettings().avatarId === id) setPetSettings({ avatarId: null })
  return ok(undefined)
}

export function switchPetAvatar(id: string): Res<void> {
  const list = getAvatars()
  if (!list.find((x) => x.id === id)) return fail('形象包不存在')
  setPetSettings({ avatarId: id, enabled: true })
  return ok(undefined)
}

/** 让用户选择目录的对话框 */
export async function pickAvatarSourceDir(parent: BrowserWindow | null): Promise<string | null> {
  const r = parent
    ? await dialog.showOpenDialog(parent, {
        title: '选择形象包目录（需含 manifest.json）',
        properties: ['openDirectory']
      })
    : await dialog.showOpenDialog({
        title: '选择形象包目录（需含 manifest.json）',
        properties: ['openDirectory']
      })
  if (r.canceled || r.filePaths.length === 0) return null
  return r.filePaths[0]
}

// -------------------- 窗口 --------------------

let petWindow: BrowserWindow | null = null

export function openPetWindow(): Res<void> {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show()
    return ok(undefined)
  }
  const settings = getPetSettings()
  const avatar = getAvatars().find((x) => x.id === settings.avatarId) ?? null
  const display = screen.getPrimaryDisplay()
  const startX = Math.min(settings.position.x, display.workArea.width - 200)
  const startY = Math.min(settings.position.y, display.workArea.height - 200)

  petWindow = new BrowserWindow({
    width: 200,
    height: 240,
    x: startX,
    y: startY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  petWindow.setIgnoreMouseEvents(false)
  petWindow.loadFile(join(__dirname, '../renderer/pet/index.html'))
  petWindow.once('ready-to-show', () => {
    petWindow?.show()
  })

  // 位置记忆：移动结束时写回 store
  const savePos = (): void => {
    if (!petWindow || petWindow.isDestroyed()) return
    const [x, y] = petWindow.getPosition()
    setPetSettings({ position: { x, y } })
  }
  petWindow.on('moved', savePos)
  petWindow.on('close', () => {
    savePos()
    petWindow = null
  })
  void avatar // 后续：把 avatar 数据通过 IPC 推给 pet 窗口
  return ok(undefined)
}

export function closePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.close()
  petWindow = null
}

export function isPetWindowOpen(): boolean {
  return petWindow !== null && !petWindow.isDestroyed()
}

export function pushInspirationToPet(payload: unknown): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.webContents.send('pet:inspiration', payload)
}

// -------------------- helpers --------------------

function copyDir(src: string, dst: string): void {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}
function rmDir(p: string): void {
  // 简化实现：递归删除
  for (const entry of readdirSync(p)) {
    const child = join(p, entry)
    if (statSync(child).isDirectory()) rmDir(child)
    else require('node:fs').unlinkSync(child)
  }
  require('node:fs').rmdirSync(p)
}
void basename
void dirname
void listLibrary