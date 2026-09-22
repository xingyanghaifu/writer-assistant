import Store from 'electron-store'
import { app } from 'electron'
import { existsSync, mkdirSync, copyFileSync, statSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_SETTINGS, type AppSettings, type StorageStatus } from '@shared/settings'
import type { Work } from '@shared/work'
import type { Character, Foreshadowing, Outline, Location, Setting, Note, DailyStat } from '@shared/material'
import type { CacheEntry, PromptTemplate } from '@shared/suggestion'

/** 当前数据结构版本 */
export const DATA_SCHEMA_VERSION = 3

/** 主数据文件名 */
const DATA_FILE_NAME = 'writer-assistant.json'
/** 引导文件名：只记录自定义数据目录，固定存放在默认 userData 下 */
const BOOTSTRAP_FILE_NAME = 'writer-assistant-bootstrap.json'

/**
 * 引导配置：记录数据目录指向。
 *
 * ⚠️ 为什么需要它：electron-store 必须在**构造时**就知道 cwd，
 * 而"数据目录"这个设置本身又存在 store 里 —— 鸡生蛋问题。
 * 因此用一个固定放在默认 userData 下的小文件来打破循环：
 * 先读它拿到用户选择的数据目录，再用该目录构造主 store。
 */
interface BootstrapConfig {
  customDirEnabled?: boolean
  customDir?: string
  /** 已写入但尚未重启生效的目录 */
  pendingDir?: string
  migrateMode?: 'migrate' | 'fresh'
}

function readBootstrap(): BootstrapConfig {
  try {
    const s = new Store<BootstrapConfig>({ name: BOOTSTRAP_FILE_NAME.replace(/\.json$/, '') })
    return s.store ?? {}
  } catch {
    return {}
  }
}

function writeBootstrap(patch: BootstrapConfig): void {
  const s = new Store<BootstrapConfig>({ name: BOOTSTRAP_FILE_NAME.replace(/\.json$/, '') })
  s.set({ ...(s.store ?? {}), ...patch })
}

/** 默认数据目录（app 未 ready 时不能调 getPath，否则主进程直接崩） */
function defaultDataDir(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      try {
        return app.getPath('userData')
      } catch {
        /* Electron 尚未 ready：继续走系统目录兜底 */
      }
    }
  } catch {
    /* fall through */
  }
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] || join(home, 'AppData', 'Roaming')
    return join(appData, 'writer-assistant')
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'writer-assistant')
  }
  return join(process.env['XDG_CONFIG_HOME'] || join(home, '.config'), 'writer-assistant')
}

/**
 * 解析当前应使用的数据目录。
 * 只有自定义目录存在且可写时才采用，否则回退默认目录（避免设置写坏导致应用打不开）。
 */
export function resolveDataDir(): { dir: string; usingCustom: boolean; fallbackReason?: string } {
  const boot = readBootstrap()
  if (!boot.customDirEnabled || !boot.customDir) {
    return { dir: defaultDataDir(), usingCustom: false }
  }
  try {
    if (!existsSync(boot.customDir)) mkdirSync(boot.customDir, { recursive: true })
    accessSync(boot.customDir, constants.W_OK)
    return { dir: boot.customDir, usingCustom: true }
  } catch (err) {
    return {
      dir: defaultDataDir(),
      usingCustom: false,
      fallbackReason: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 目录是否可写 */
function isWritable(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** electron-store 单例。所有持久化都经由这里，渲染进程不直接接触。 */
class AppStore {
  private store: Store<Record<string, unknown>>
  /** 当前生效的数据目录 */
  readonly dataDir: string
  readonly usingCustom: boolean
  /** 自定义目录不可用时的回退原因 */
  private readonly fallbackReason?: string

  constructor() {
    const resolved = resolveDataDir()
    this.dataDir = resolved.dir
    this.usingCustom = resolved.usingCustom
    this.fallbackReason = resolved.fallbackReason

    this.store = new Store<Record<string, unknown>>({
      name: 'writer-assistant',
      cwd: this.dataDir,
      // 版本号用于迁移（阶段 7）
      migrations: {
        // v1 -> v2：补齐 settings 新增字段
        '>=0.1.0': (s) => {
          const cur = (s.get('settings') as Partial<AppSettings>) ?? {}
          s.set('settings', { ...DEFAULT_SETTINGS, ...cur, schemaVersion: DATA_SCHEMA_VERSION })
        },
        // v2 -> v3：新增 storage 配置段
        '>=0.2.0': (s) => {
          const cur = (s.get('settings') as Partial<AppSettings>) ?? {}
          s.set('settings', {
            ...DEFAULT_SETTINGS,
            ...cur,
            storage: { ...DEFAULT_SETTINGS.storage, ...(cur.storage ?? {}) },
            schemaVersion: DATA_SCHEMA_VERSION
          })
        }
      }
    })
    this.ensureDefaults()
  }

  private ensureDefaults(): void {
    if (!this.store.has('settings')) this.store.set('settings', DEFAULT_SETTINGS)
    if (!this.store.has('works')) this.store.set('works', [])
    if (!this.store.has('materials')) this.store.set('materials', {})
    if (!this.store.has('notes')) this.store.set('notes', {})
    if (!this.store.has('stats')) this.store.set('stats', {})
    if (!this.store.has('prompts')) this.store.set('prompts', [])
    if (!this.store.has('cache')) this.store.set('cache', [])
    if (!this.store.has('feedback')) this.store.set('feedback', [])
    if (!this.store.has('promptLibrary')) this.store.set('promptLibrary', [])
    if (!this.store.has('petAvatars')) this.store.set('petAvatars', [])
    if (!this.store.has('petSettings')) this.store.set('petSettings', {})
    if (!this.store.has('bookBreakdowns')) this.store.set('bookBreakdowns', [])
  }

  /** 通用读写：用于新增的命名空间键，不与具体 schema 耦合 */
  getRaw<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }
  setRaw<T>(key: string, value: T): void {
    this.store.set(key, value)
  }

  // ---- settings ----
  getSettings(): AppSettings {
    const stored = (this.store.get('settings') as Partial<AppSettings>) ?? {}
    // ⚠️ 必须是**深合并**：features 是嵌套对象，浅合并会让仅存了部分键的
    // 老数据把整个默认 features 覆盖掉，导致新增开关读出来是 undefined。
    // 实测本机存储里 features 只有 5 个键（缺 outlineGenerate/smartSplit/
    // chapterGoal），设置页显示为"未勾选"，而代码按 undefined 当"开启"跑，
    // 界面与实际行为不一致。
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      features: { ...DEFAULT_SETTINGS.features, ...(stored.features ?? {}) }
    }
  }

  /**
   * 当前站点状态（只读副本，不强制类型）。
   * 站点状态由 renderer 端的 useSiteStore 维护；主进程需要在 BackgroundWebview
   * 兜底时知道当前站点。这里我们用一个简化的 view：
   *  - 读 settings.siteId
   *  - 状态默认 unknown（信任渲染层做风控拦截）；拆书流水线在主进程有兜底逻辑
   */
  getSiteStatus(_siteId: string): { kind: 'unknown' | 'online' | 'logged-out' | 'risk' | 'offline' } {
    void _siteId
    return { kind: 'unknown' }
  }
  /** 选择下一个 available 站点；若 renderer 已有数据，会通过 IPC 传过来。这里 fallback = 同站点 */
  pickNextSite(_current: string): string | null {
    return _current
  }
  setSiteId(_id: string): void {
    void _id
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch, schemaVersion: DATA_SCHEMA_VERSION }
    this.store.set('settings', next)
    return next
  }

  // ---- works ----
  getWorks(): Work[] {
    return (this.store.get('works') as Work[]) ?? []
  }

  setWorks(works: Work[]): void {
    this.store.set('works', works)
  }

  getWork(id: string): Work | undefined {
    return this.getWorks().find((w) => w.id === id)
  }

  upsertWork(work: Work): void {
    const works = this.getWorks()
    const i = works.findIndex((w) => w.id === work.id)
    if (i >= 0) works[i] = work
    else works.push(work)
    this.setWorks(works)
  }

  deleteWork(id: string): void {
    this.setWorks(this.getWorks().filter((w) => w.id !== id))
  }

  // ---- 素材（按 workId 隔离）----
  private getMaterialMap<T>(key: string): Record<string, T[]> {
    const m = (this.store.get('materials') as Record<string, Record<string, T[]>>) ?? {}
    return (m[key] as Record<string, T[]>) ?? {}
  }

  private setMaterialMap<T>(key: string, workId: string, list: T[]): void {
    const m = (this.store.get('materials') as Record<string, Record<string, unknown>>) ?? {}
    m[key] = { ...(m[key] ?? {}), [workId]: list }
    this.store.set('materials', m)
  }

  /**
   * 向作品素材库添加一条；按 name 去重（同名则更新已存在的）。
   * 用于拆书结果入库 / 用户手动导入等场景。
   */
  addMaterial<T extends { id?: string; name?: string; title?: string }>(
    workId: string,
    kind: 'characters' | 'foreshadowings' | 'outlines' | 'locations' | 'settings-list' | 'notes',
    item: T
  ): T {
    const key = kind
    const cur = (this.getMaterialMap<T>(key)[workId] ?? []) as T[]
    const matchKey = (x: T): string => (x.name ?? x.title ?? x.id ?? '').trim()
    const incomingKey = matchKey(item)
    const idx = cur.findIndex((x) => matchKey(x) === incomingKey)
    const id = item.id ?? `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const next = { ...item, id } as T
    if (idx >= 0) {
      // 保留 id 不变
      next.id = cur[idx].id
      cur[idx] = next
    } else {
      cur.push(next)
    }
    this.setMaterialMap<T>(key, workId, cur)
    return next
  }


  /**
   * 把 srcId 维度下的素材（角色/伏笔/outlines/locations/notes/stats）合并到 dstId 下。
   * 合并规则：同名按 createdAt 早者胜出；不同名追加。
   * 合并完成后删除 srcId 维度数据。**不会动 works 列表本身**，由调用方决定是否删除 src。
   */
  migrateWork(srcId: string, dstId: string): { characters: number; foreshadowings: number; outlines: number; locations: number; notes: number; stats: number } {
    const out = { characters: 0, foreshadowings: 0, outlines: 0, locations: 0, notes: 0, stats: 0 }
    if (!srcId || !dstId || srcId === dstId) return out
    const materials = (this.store.get('materials') as Record<string, Record<string, unknown[]>>) ?? {}
    const list = (k: string): unknown[] => ((materials[k] ?? {})[srcId] ?? []) as unknown[]
    const set = (k: string, dst: unknown[]): void => {
      materials[k] = { ...(materials[k] ?? {}), [dstId]: dst, [srcId]: [] }
    }
    const mergeBy = <T extends { name?: string; title?: string; createdAt?: number; id: string }>(
      dstList: T[],
      srcList: T[]
    ): number => {
      let added = 0
      const byKey = new Map<string, T>()
      for (const x of dstList) {
        const k = (x.name ?? x.title ?? x.id).trim()
        if (k) byKey.set(k, x)
      }
      for (const x of srcList) {
        const k = (x.name ?? x.title ?? x.id).trim()
        const existing = byKey.get(k)
        if (!existing) { dstList.push(x); byKey.set(k, x); added++ }
        else if ((x.createdAt ?? 0) < (existing.createdAt ?? 0)) {
          // 同名更早的覆盖现有
          Object.assign(existing, x, { id: existing.id })
        }
      }
      return added
    }
    const mergeStats = (dstList: Array<{ id: string; day: string; words: number }>, srcList: Array<{ id: string; day: string; words: number }>): number => {
      const map = new Map<string, typeof dstList[number]>()
      for (const x of dstList) map.set(x.day, x)
      let added = 0
      for (const x of srcList) {
        const ex = map.get(x.day)
        if (ex) ex.words += x.words
        else { dstList.push(x); map.set(x.day, x); added++ }
      }
      return added
    }

    {
      const dst = (this.getCharacters(dstId) as Array<{ id: string; name?: string; createdAt?: number }>).slice()
      const src = list('characters') as Array<{ id: string; name?: string; createdAt?: number }>
      out.characters = mergeBy(dst, src)
      set('characters', dst)
    }
    {
      const dst = (this.getForeshadowings(dstId) as Array<{ id: string; name?: string; createdAt?: number }>).slice()
      const src = list('foreshadowings') as Array<{ id: string; name?: string; createdAt?: number }>
      out.foreshadowings = mergeBy(dst, src)
      set('foreshadowings', dst)
    }
    {
      const dst = (this.getOutlines(dstId) as Array<{ id: string; title?: string; createdAt?: number; children?: unknown[] }>).slice()
      const src = list('outlines') as Array<{ id: string; title?: string; createdAt?: number; children?: unknown[] }>
      out.outlines = mergeBy(dst, src)
      set('outlines', dst)
    }
    {
      const dst = (this.getLocations(dstId) as Array<{ id: string; name?: string; createdAt?: number }>).slice()
      const src = list('locations') as Array<{ id: string; name?: string; createdAt?: number }>
      out.locations = mergeBy(dst, src)
      set('locations', dst)
    }
    {
      const dst = (this.getNotes(dstId) as Array<{ id: string; title?: string; createdAt?: number }>).slice()
      const src = list('notes') as Array<{ id: string; title?: string; createdAt?: number }>
      out.notes = mergeBy(dst, src)
      set('notes', dst)
    }
    {
      const dst = (this.getStats(dstId) as unknown as Array<{ id: string; day: string; words: number }>).slice()
      const src = list('stats') as unknown as Array<{ id: string; day: string; words: number }>
      out.stats = mergeStats(dst, src)
      set('stats', dst)
    }

    this.store.set('materials', materials)
    return out
  }

  getCharacters(workId: string): Character[] {
    return this.getMaterialMap<Character>('characters')[workId] ?? []
  }
  setCharacters(workId: string, list: Character[]): void {
    this.setMaterialMap('characters', workId, list)
  }

  getForeshadowings(workId: string): Foreshadowing[] {
    return this.getMaterialMap<Foreshadowing>('foreshadowings')[workId] ?? []
  }
  setForeshadowings(workId: string, list: Foreshadowing[]): void {
    this.setMaterialMap('foreshadowings', workId, list)
  }

  getOutlines(workId: string): Outline[] {
    return this.getMaterialMap<Outline>('outlines')[workId] ?? []
  }
  setOutlines(workId: string, list: Outline[]): void {
    this.setMaterialMap('outlines', workId, list)
  }

  getLocations(workId: string): Location[] {
    return this.getMaterialMap<Location>('locations')[workId] ?? []
  }
  setLocations(workId: string, list: Location[]): void {
    this.setMaterialMap('locations', workId, list)
  }

  getSettingsList(workId: string): Setting[] {
    return this.getMaterialMap<Setting>('settings-list')[workId] ?? []
  }
  setSettingsList(workId: string, list: Setting[]): void {
    this.setMaterialMap('settings-list', workId, list)
  }

  // ---- 便签 ----
  getNotes(workId: string): Note[] {
    const m = (this.store.get('notes') as Record<string, Note[]>) ?? {}
    return m[workId] ?? []
  }
  setNotes(workId: string, list: Note[]): void {
    const m = (this.store.get('notes') as Record<string, Note[]>) ?? {}
    m[workId] = list
    this.store.set('notes', m)
  }

  // ---- 统计 ----
  getStats(workId: string): DailyStat[] {
    const m = (this.store.get('stats') as Record<string, DailyStat[]>) ?? {}
    return m[workId] ?? []
  }
  setStats(workId: string, list: DailyStat[]): void {
    const m = (this.store.get('stats') as Record<string, DailyStat[]>) ?? {}
    m[workId] = list
    this.store.set('stats', m)
  }

  // ---- 提示词 ----
  getPrompts(): PromptTemplate[] {
    return (this.store.get('prompts') as PromptTemplate[]) ?? []
  }
  setPrompts(list: PromptTemplate[]): void {
    this.store.set('prompts', list)
  }

  // ---- 缓存 ----
  getCache(): CacheEntry[] {
    return (this.store.get('cache') as CacheEntry[]) ?? []
  }
  setCache(list: CacheEntry[]): void {
    this.store.set('cache', list)
  }

  // ---- 建议质量反馈 ----
  getFeedback(): Array<{ tag: string; value: 'up' | 'down'; siteId: string; createdAt: number }> {
    return (
      (this.store.get('feedback') as Array<{ tag: string; value: 'up' | 'down'; siteId: string; createdAt: number }>) ?? []
    )
  }
  setFeedback(list: Array<{ tag: string; value: 'up' | 'down'; siteId: string; createdAt: number }>): void {
    this.store.set('feedback', list)
  }

  // ---- 阶段 11：敏感词自定义词库 ----
  getSensitiveDict(): Array<{ word: string; level: 'block' | 'warn' | 'info'; category: string }> {
    return (
      (this.store.get('sensitiveDict') as Array<{
        word: string
        level: 'block' | 'warn' | 'info'
        category: string
      }>) ?? []
    )
  }
  setSensitiveDict(list: Array<{ word: string; level: 'block' | 'warn' | 'info'; category: string }>): void {
    this.store.set('sensitiveDict', list)
  }

  // ---- 阶段 11：写作风格画像缓存（按 workId）----
  getStyleProfile(workId: string): import('@shared/advanced').StyleProfile | null {
    const map =
      (this.store.get('styleProfiles') as Record<string, import('@shared/advanced').StyleProfile>) ?? {}
    return map[workId] ?? null
  }
  setStyleProfile(workId: string, profile: import('@shared/advanced').StyleProfile): void {
    const map =
      (this.store.get('styleProfiles') as Record<string, import('@shared/advanced').StyleProfile>) ?? {}
    map[workId] = profile
    this.store.set('styleProfiles', map)
  }

  // ---- 阶段 11：健康提醒 ----
  getLastHealthReminder(): number | undefined {
    return this.store.get('lastHealthReminder') as number | undefined
  }
  setLastHealthReminder(ts: number): void {
    this.store.set('lastHealthReminder', ts)
  }

  /** 今日累计写作时长（毫秒） */
  getTodayDuration(): number {
    const today = new Date()
    const key = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
    const all = (this.store.get('stats') as Record<string, DailyStat[]>) ?? {}
    let ms = 0
    for (const list of Object.values(all)) {
      for (const s of list) if (s.date === key) ms += s.durationMs ?? 0
    }
    return ms
  }

  /** 按天数过滤的每日统计（阶段 13 可视化） */
  getStatsSince(workId: string, days = 365): DailyStat[] {
    const list = this.getStats(workId)
    if (!list.length) return []
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return list.filter((s) => {
      const t = new Date(s.date).getTime()
      return Number.isFinite(t) ? t >= cutoff : true
    })
  }

  /** 清除所有数据（阶段 8.5） */
  clearAll(): void {
    this.store.clear()
    this.ensureDefaults()
  }

  // ---- 数据存储位置 ----

  /** 当前数据目录状态 */
  getStorageStatus(): StorageStatus {
    const boot = readBootstrap()
    const path = join(this.dataDir, DATA_FILE_NAME)
    let sizeBytes = -1
    try {
      sizeBytes = existsSync(path) ? statSync(path).size : 0
    } catch {
      sizeBytes = -1
    }
    return {
      currentDir: this.dataDir,
      defaultDir: defaultDataDir(),
      usingCustom: this.usingCustom,
      writable: isWritable(this.dataDir),
      sizeBytes,
      fileName: DATA_FILE_NAME,
      pendingRestart: !!boot.pendingDir && boot.pendingDir !== this.dataDir
    }
  }

  /** 设置中记录的 storage 段（可能与实际生效目录不同，需重启后一致） */
  getStorageConfig(): AppSettings['storage'] {
    return this.getSettings().storage
  }

  /**
   * 切换数据目录。
   *
   * 流程：
   *  1. 校验目标目录可写
   *  2. 若选择迁移且目标无数据文件，把当前数据文件复制过去
   *  3. 写入引导文件（下次启动即生效）
   *
   * ⚠️ 不在这里重建 store —— 运行中切换目录会导致数据错乱，
   * 必须重启应用才真正生效。
   */
  setStorageDir(
    dir: string,
    migrateMode: 'migrate' | 'fresh'
  ): { ok: true; needsRestart: true; migrated: boolean } | { ok: false; error: string } {
    if (!dir || typeof dir !== 'string') return { ok: false, error: '目录无效' }
    if (!isWritable(dir)) return { ok: false, error: `目录不可写：${dir}` }

    const src = join(this.dataDir, DATA_FILE_NAME)
    const dst = join(dir, DATA_FILE_NAME)
    let migrated = false

    if (migrateMode === 'migrate' && existsSync(src)) {
      try {
        // 目标已有数据时不覆盖，避免毁掉用户已有数据
        if (!existsSync(dst)) {
          copyFileSync(src, dst)
          migrated = true
        }
      } catch (err) {
        return { ok: false, error: `数据迁移失败：${err instanceof Error ? err.message : String(err)}` }
      }
    }

    writeBootstrap({
      customDirEnabled: true,
      customDir: dir,
      pendingDir: dir,
      migrateMode
    })
    // 同步写入设置，便于 UI 展示与导出
    this.setSettings({ storage: { customDirEnabled: true, customDir: dir, migrateMode } })
    return { ok: true, needsRestart: true, migrated }
  }

  /** 恢复默认数据目录 */
  resetStorageDir(migrateMode: 'migrate' | 'fresh' = 'migrate'): {
    ok: true
    needsRestart: true
    migrated: boolean
  } {
    const def = defaultDataDir()
    const src = join(this.dataDir, DATA_FILE_NAME)
    const dst = join(def, DATA_FILE_NAME)
    let migrated = false
    if (migrateMode === 'migrate' && existsSync(src) && this.dataDir !== def) {
      try {
        if (!existsSync(dst)) {
          copyFileSync(src, dst)
          migrated = true
        }
      } catch {
        /* 迁移失败不阻塞回退，原数据仍在旧目录 */
      }
    }
    writeBootstrap({ customDirEnabled: false, pendingDir: def, migrateMode })
    this.setSettings({
      storage: { customDirEnabled: false, customDir: undefined, migrateMode }
    })
    return { ok: true, needsRestart: true, migrated }
  }

  get userDataPath(): string {
    return defaultDataDir()
  }

  /** 自定义目录不可用时的回退说明（用于 UI 提示） */
  get storageFallbackReason(): string | undefined {
    return this.fallbackReason
  }
}

export const appStore = new AppStore()
