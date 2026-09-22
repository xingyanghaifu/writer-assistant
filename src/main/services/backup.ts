/**
 * 多副本备份 + 快照 + 校验（阶段 7.5）。
 *
 * 副本：
 *   - 本地  userData/backups/          保留最近 30 天
 *   - 自定义目录（用户指定，可指向坚果云/OneDrive 同步目录）
 *   - 手动导出
 * 快照：
 *   - userData/snapshots/{workId}/{chapterId}/ 每章 5 个（自动保存前保留上一版）
 * 校验：
 *   - 每个备份带 SHA-256，恢复时校验；文件结构 { meta, hash, data }
 *
 * 约束：备份失败只记录日志，不影响正文；云盘只写目录不调 API。
 */
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Work } from '@shared/work'
import type { BackupEnvelope, BackupStatus, RestoreStrategy } from '@shared/settings'
import { appStore } from '../store'
import { atomicWrite } from './importer'
import { newId } from './work'

/** 备份保留天数 */
const RETENTION_DAYS = 30
/** 每章快照数 */
const MAX_SNAPSHOTS = 5
/** 导出提醒间隔：7 天 */
export const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000

function userData(): string {
  return app.getPath('userData')
}

export function backupDir(): string {
  const d = join(userData(), 'backups')
  mkdirSync(d, { recursive: true })
  return d
}

export function snapshotDir(workId: string, chapterId: string): string {
  const d = join(userData(), 'snapshots', workId, chapterId)
  mkdirSync(d, { recursive: true })
  return d
}

/** 计算数据 hash */
export function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

/** 构造带校验信封的备份内容 */
export function buildEnvelope(work: Work): BackupEnvelope {
  const chapters = work.volumes.flatMap((v) => v.chapters)
  return {
    meta: {
      workId: work.id,
      workTitle: work.title,
      createdAt: Date.now(),
      appVersion: app.getVersion(),
      schemaVersion: work.schemaVersion,
      chapterCount: chapters.length,
      wordCount: chapters.reduce((s, c) => s + c.wordCount, 0)
    },
    hash: hashData(work),
    data: work
  }
}

/** 写入单个备份文件（原子写） */
export function writeBackupFile(dir: string, work: Work): { path: string; error?: string } {
  try {
    mkdirSync(dir, { recursive: true })
    const env = buildEnvelope(work)
    const stamp = new Date(env.meta.createdAt).toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `${work.id}_${stamp}.json`)
    atomicWrite(file, JSON.stringify(env))
    return { path: file }
  } catch (err) {
    // 备份失败不影响正文
    console.error('[backup] 写入失败', err)
    return { path: '', error: (err as Error).message }
  }
}

/** 清理超过保留期的备份 */
export function pruneBackups(dir: string): number {
  let removed = 0
  try {
    if (!existsSync(dir)) return 0
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const full = join(dir, f)
      try {
        if (statSync(full).mtimeMs < cutoff) {
          rmSync(full, { force: true })
          removed++
        }
      } catch {
        /* 单个文件失败继续 */
      }
    }
  } catch (err) {
    console.error('[backup] 清理失败', err)
  }
  return removed
}

/** 备份所有作品到各副本 */
export function runBackup(): BackupStatus[] {
  const settings = appStore.getSettings()
  const works = appStore.getWorks()
  const statuses: BackupStatus[] = []

  // 本地副本
  if (settings.backup.localEnabled) {
    const dir = backupDir()
    let last: number | undefined
    let lastError: string | undefined
    for (const w of works) {
      const r = writeBackupFile(dir, w)
      if (r.error) lastError = r.error
      else last = Date.now()
    }
    const pruned = pruneBackups(dir)
    statuses.push({
      kind: 'local',
      label: '本地备份',
      path: dir,
      enabled: true,
      lastBackupAt: last,
      count: countJson(dir),
      lastError: lastError ? `${lastError}（已清理 ${pruned} 个过期备份）` : undefined
    })
  } else {
    statuses.push({ kind: 'local', label: '本地备份', enabled: false, count: 0 })
  }

  // 用户指定目录（可用于坚果云/OneDrive 同步目录）
  if (settings.backup.customDirEnabled && settings.backup.customDir) {
    const dir = settings.backup.customDir
    let last: number | undefined
    let lastError: string | undefined
    // 云盘不可用则跳过，不报错
    try {
      if (existsSync(dir)) {
        for (const w of works) {
          const r = writeBackupFile(dir, w)
          if (r.error) lastError = r.error
          else last = Date.now()
        }
        pruneBackups(dir)
      } else {
        lastError = '目录不存在（已跳过）'
      }
    } catch (err) {
      lastError = (err as Error).message
    }
    statuses.push({
      kind: 'custom',
      label: '自定义目录',
      path: dir,
      enabled: true,
      lastBackupAt: last,
      count: existsSync(dir) ? countJson(dir) : 0,
      lastError
    })
  } else {
    statuses.push({ kind: 'custom', label: '自定义目录', enabled: false, count: 0 })
  }

  // 记录备份时间（用于 7 天导出提醒）
  appStore.setSettings({ backup: { ...settings.backup, lastBackupAt: Date.now() } })
  return statuses
}

function countJson(dir: string): number {
  try {
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0
  } catch {
    return 0
  }
}

/** 各副本状态 */
export function getBackupStatus(): BackupStatus[] {
  const settings = appStore.getSettings()
  const out: BackupStatus[] = []
  const dir = join(userData(), 'backups')
  out.push({
    kind: 'local',
    label: '本地备份',
    path: dir,
    enabled: settings.backup.localEnabled,
    lastBackupAt: settings.backup.lastBackupAt,
    count: countJson(dir),
    lastError: existsSync(dir) ? undefined : '尚未创建'
  })
  if (settings.backup.customDir) {
    out.push({
      kind: 'custom',
      label: '自定义目录',
      path: settings.backup.customDir,
      enabled: settings.backup.customDirEnabled,
      count: existsSync(settings.backup.customDir) ? countJson(settings.backup.customDir) : 0,
      lastError: existsSync(settings.backup.customDir) ? undefined : '目录不存在'
    })
  }
  return out
}

/** 列出所有备份文件的元信息 */
export function listBackups(): Array<{ path: string; meta: BackupEnvelope['meta'] }> {
  const dirs = [join(userData(), 'backups'), appStore.getSettings().backup.customDir].filter(
    (d): d is string => !!d && existsSync(d)
  )
  const out: Array<{ path: string; meta: BackupEnvelope['meta'] }> = []
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue
        const full = join(dir, f)
        try {
          const env = JSON.parse(readFileSync(full, 'utf8')) as BackupEnvelope
          if (env?.meta) out.push({ path: full, meta: env.meta })
        } catch {
          /* 跳过损坏文件 */
        }
      }
    } catch {
      /* 目录不可读则跳过 */
    }
  }
  return out.sort((a, b) => b.meta.createdAt - a.meta.createdAt)
}

/** 校验备份文件；返回 meta 或抛错 */
export function verifyBackup(filePath: string): BackupEnvelope['meta'] {
  if (!existsSync(filePath)) throw new Error('E_IO_BUSY')
  let env: BackupEnvelope
  try {
    env = JSON.parse(readFileSync(filePath, 'utf8')) as BackupEnvelope
  } catch {
    throw new Error('E_BACKUP_CORRUPTED')
  }
  if (!env || !env.meta || env.hash === undefined || !env.data) {
    throw new Error('E_BACKUP_CORRUPTED')
  }
  // 版本校验
  if (env.meta.schemaVersion > appStore.getSettings().schemaVersion) {
    throw new Error('E_BACKUP_VERSION')
  }
  // hash 校验
  const actual = hashData(env.data)
  if (actual !== env.hash) throw new Error('E_BACKUP_CORRUPTED')
  return env.meta
}

/** 按策略恢复备份 */
export function restoreBackup(filePath: string, strategy: RestoreStrategy): Work {
  const meta = verifyBackup(filePath)
  const env = JSON.parse(readFileSync(filePath, 'utf8')) as BackupEnvelope
  const incoming = env.data as Work
  void meta

  if (strategy === 'overwrite') {
    const existing = appStore.getWork(incoming.id)
    if (existing) {
      appStore.upsertWork({ ...incoming, updatedAt: Date.now() })
      appStore.setSettings({ currentWorkId: incoming.id })
      return incoming
    }
    appStore.upsertWork(incoming)
    appStore.setSettings({ currentWorkId: incoming.id })
    return incoming
  }

  if (strategy === 'new') {
    const fresh: Work = {
      ...incoming,
      id: newId('work'),
      title: `${incoming.title}（恢复）`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    appStore.upsertWork(fresh)
    appStore.setSettings({ currentWorkId: fresh.id })
    return fresh
  }

  // merge：把备份中的章节并入同 id 作品（不存在则新建）
  const target = appStore.getWork(incoming.id)
  if (!target) {
    appStore.upsertWork(incoming)
    appStore.setSettings({ currentWorkId: incoming.id })
    return incoming
  }
  let volume = target.volumes[0]
  if (!volume) {
    target.volumes.push(...incoming.volumes)
  } else {
    for (const v of incoming.volumes) {
      for (const c of v.chapters) {
        if (!volume.chapters.some((x) => x.id === c.id || x.title === c.title)) {
          volume.chapters.push(c)
        }
      }
    }
  }
  target.updatedAt = Date.now()
  appStore.upsertWork(target)
  appStore.setSettings({ currentWorkId: target.id })
  return target
}

/** 为某章保留快照（自动保存前调用），每章最多 5 个 */
export function snapshotChapter(workId: string, chapterId: string, content: string): void {
  try {
    const dir = snapshotDir(workId, chapterId)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `${stamp}.txt`)
    writeFileSync(file, content, 'utf8')

    // 清理超出上限的快照（保留最新 5 个）
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(MAX_SNAPSHOTS)) {
      rmSync(join(dir, f), { force: true })
    }
  } catch (err) {
    // 快照失败不阻塞编辑
    console.error('[backup] 快照失败', err)
  }
}

/** 是否需要提醒导出（7 天未导出） */
export function needsExportReminder(): boolean {
  const s = appStore.getSettings()
  const last = s.backup.lastExportAt
  if (!last) return true
  return Date.now() - last > EXPORT_REMINDER_MS
}

/** 标记已导出 */
export function markExported(): void {
  const s = appStore.getSettings()
  appStore.setSettings({ backup: { ...s.backup, lastExportAt: Date.now() } })
}
