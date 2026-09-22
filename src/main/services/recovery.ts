import { app } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { RecoverySnapshot, RecoveryCandidate } from '@shared/work'
import { appStore } from '../store'

/** 临时草稿目录：userData/recovery */
function recoveryDir(): string {
  const dir = join(app.getPath('userData'), 'recovery')
  mkdirSync(dir, { recursive: true })
  return dir
}

function runtimeMarkerPath(): string {
  return join(app.getPath('userData'), '.running')
}

/** 保留时长：24 小时 */
const RETENTION_MS = 24 * 60 * 60 * 1000

/** 启动时写运行标记；正常退出时删除。启动时发现标记即说明上次异常退出。 */
export function markRunning(): void {
  try {
    writeFileSync(runtimeMarkerPath(), String(Date.now()), 'utf8')
  } catch {
    /* 降级：标记失败不影响启动 */
  }
}

export function markCleanExit(): void {
  try {
    rmSync(runtimeMarkerPath(), { force: true })
  } catch {
    /* ignore */
  }
}

/** 上次是否为异常退出 */
export function hadUncleanExit(): boolean {
  return existsSync(runtimeMarkerPath())
}

/**
 * 写入临时草稿（阶段 5.8）。
 * 约束：不阻塞编辑 —— 调用方用 fire-and-forget；失败静默降级。
 */
export function writeRecovery(snapshot: RecoverySnapshot): { ok: boolean; error?: string } {
  try {
    const file = join(recoveryDir(), `${snapshot.chapterId}.tmp`)
    writeFileSync(file, JSON.stringify(snapshot), 'utf8')
    return { ok: true }
  } catch (err) {
    // 降级：临时写入失败不阻塞编辑
    return { ok: false, error: (err as Error).message }
  }
}

/** 正常保存后删除临时文件 */
export function clearRecovery(chapterId: string): void {
  try {
    rmSync(join(recoveryDir(), `${chapterId}.tmp`), { force: true })
  } catch {
    /* ignore */
  }
}

function readSnapshot(file: string): RecoverySnapshot | null {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as RecoverySnapshot
    if (!parsed || typeof parsed.content !== 'string' || !parsed.chapterId) return null
    return parsed
  } catch {
    return null
  }
}

/** 扫描可恢复的草稿，并与已保存内容对比 */
export function scanRecoveryCandidates(): RecoveryCandidate[] {
  const dir = recoveryDir()
  const out: RecoveryCandidate[] = []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.tmp'))
  } catch {
    return out
  }

  const now = Date.now()
  for (const f of files) {
    const full = join(dir, f)
    try {
      // 清理超过 24 小时的临时文件
      if (now - statSync(full).mtimeMs > RETENTION_MS) {
        rmSync(full, { force: true })
        continue
      }
    } catch {
      continue
    }

    const snap = readSnapshot(full)
    if (!snap) continue

    const work = appStore.getWork(snap.workId)
    const chapter = work?.volumes.flatMap((v) => v.chapters).find((c) => c.id === snap.chapterId)
    // 章节已被删除，或内容与已保存一致 -> 无需恢复
    const differs = !chapter || chapter.content !== snap.content
    if (!differs) {
      rmSync(full, { force: true })
      continue
    }

    out.push({
      chapterId: snap.chapterId,
      workId: snap.workId,
      chapterTitle: chapter?.title ?? basename(f, '.tmp'),
      workTitle: work?.title ?? '未知作品',
      wordCount: snap.content.replace(/\s/g, '').length,
      updatedAt: snap.updatedAt,
      differs
    })
  }
  return out
}

export function readRecoverySnapshot(chapterId: string): RecoverySnapshot | null {
  const file = join(recoveryDir(), `${chapterId}.tmp`)
  if (!existsSync(file)) return null
  return readSnapshot(file)
}

export function discardRecovery(chapterId: string): void {
  clearRecovery(chapterId)
}
