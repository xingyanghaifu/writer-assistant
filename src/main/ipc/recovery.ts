/**
 * 崩溃恢复 IPC（阶段 5.8）。
 * 底层服务见 src/main/services/recovery.ts。
 */
import { IPC } from '@shared/ipc'
import type { RecoverySnapshot, RecoveryCandidate } from '@shared/work'
import { handleRaw } from './handle'
import {
  writeRecovery,
  scanRecoveryCandidates,
  discardRecovery,
  readRecoverySnapshot,
  hadUncleanExit
} from '../services/recovery'
import { addVersion, findChapter } from '../services/work'
import { appStore } from '../store'

export function registerRecoveryIpc(): void {
  /** 渲染进程定时上报临时草稿（不阻塞） */
  handleRaw(IPC.recoveryWrite, (_e, snap: RecoverySnapshot) => writeRecovery(snap))

  /** 启动扫描：返回可恢复候选（含上次是否异常退出与内容预览） */
  handleRaw(IPC.recoveryScan, () => {
    const candidates = scanRecoveryCandidates().map((c) => {
      const snap = readRecoverySnapshot(c.chapterId)
      // 预览取前 500 字，避免大文本过长
      const preview = snap ? snap.content.slice(0, 500) : ''
      return { ...c, preview }
    })
    return { candidates, uncleanExit: hadUncleanExit() }
  })

  /**
   * 应用恢复：把临时内容写回章节，并作为新版本存入版本历史（source='recovery'）。
   * 恢复可撤销 —— 当前内容先存为一个版本。
   */
  handleRaw(IPC.recoveryApply, (_e, candidate: RecoveryCandidate) => {
    const snap = readRecoverySnapshot(candidate.chapterId)
    if (!snap) return { ok: false, error: '临时草稿已不存在' }

    const found = findChapter(snap.workId, candidate.chapterId)
    if (!found) return { ok: false, error: '章节已不存在，请手动找回' }

    const { chapter, volume, work } = found

    // 先保存当前内容，保证恢复可撤销
    addVersion(snap.workId, candidate.chapterId, chapter.content, 'manual')

    // 写入临时草稿内容，并记录为 recovery 版本
    chapter.content = snap.content
    chapter.wordCount = snap.content.replace(/\s/g, '').length
    chapter.updatedAt = Date.now()
    volume.updatedAt = chapter.updatedAt
    work.updatedAt = chapter.updatedAt
    addVersion(snap.workId, candidate.chapterId, snap.content, 'recovery')

    // 交由上层持久化（复用 saveChapter 会再写一次版本，这里直接改引用后落库）
    appStore.upsertWork(work)

    discardRecovery(candidate.chapterId)
    return { ok: true, data: chapter }
  })

  handleRaw(IPC.recoveryDiscard, (_e, chapterId: string) => {
    discardRecovery(chapterId)
    return { ok: true }
  })
}
