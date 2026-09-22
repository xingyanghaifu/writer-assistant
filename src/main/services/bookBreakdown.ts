/**
 * 拆书工作台服务（v3 模块三 — 数据层）。
 *
 * 本会话实现：
 *  - 列表 / 创建 / 删除 / 获取
 *  - TXT 导入 → 自动分章（复用 prompts 中的 chapter-split 提示词或本地规则）
 *  - 章节状态机 + 序列化
 *
 * 后续阶段实现：
 *  - AI 摘要 / 关键事件 / 人物 / 伏笔 / 大纲 / 风格 / 节奏
 *  - 断点续拆 + 队列
 *  - 结果入库（→ 素材库）+ 导出 + 提示词生成
 */
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { appStore } from '../store'
import type {
  BookBreakdownProject,
  BookBreakdownChapter,
  BreakdownProgress
} from '@shared/bookBreakdown'
import type { Res } from '@shared/ipc'

const STORE_KEY = 'bookBreakdowns'
const DIR_NAME = 'book-breakdowns'

function ok<T>(data: T): Res<T> {
  return { ok: true, data }
}
function fail<T = never>(error: string): Res<T> {
  return { ok: false, error }
}

function getRootDir(): string {
  return join(app.getPath('userData'), DIR_NAME)
}

function projectFilePath(id: string): string {
  return join(getRootDir(), `${id}.json`)
}

function ensureDir(): void {
  const d = getRootDir()
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

function readProject(id: string): BookBreakdownProject | null {
  const p = projectFilePath(id)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
function writeProject(proj: BookBreakdownProject): void {
  ensureDir()
  proj.updatedAt = Date.now()
  writeFileSync(projectFilePath(proj.id), JSON.stringify(proj, null, 2), 'utf8')
  // 同步摘要索引
  const index = appStore.getRaw<Array<{ id: string; title: string; updatedAt: number; status: string; progress: number }>>(STORE_KEY) ?? []
  const next = index.filter((x) => x.id !== proj.id)
  next.unshift({
    id: proj.id,
    title: proj.title,
    updatedAt: proj.updatedAt,
    status: proj.status,
    progress: proj.progress
  })
  appStore.setRaw(STORE_KEY, next)
}

export function listProjects(): Array<{ id: string; title: string; updatedAt: number; status: string; progress: number }> {
  return appStore.getRaw(STORE_KEY) ?? []
}

export function getProject(id: string): BookBreakdownProject | null {
  return readProject(id)
}

/** 部分更新项目（脱敏开关等）并落盘 */
export function patchProject(
  id: string,
  patch: Partial<Pick<BookBreakdownProject, 'anonymized' | 'chunkSize' | 'title' | 'author' | 'status'>>
): Res<BookBreakdownProject> {
  const p = readProject(id)
  if (!p) return fail('项目不存在')
  if ('anonymized' in patch) p.anonymized = patch.anonymized
  if ('chunkSize' in patch && typeof patch.chunkSize === 'number') p.chunkSize = patch.chunkSize
  if (typeof patch.title === 'string' && patch.title.trim()) p.title = patch.title.trim()
  if (typeof patch.author === 'string') p.author = patch.author
  if (patch.status) p.status = patch.status
  writeProject(p)
  return ok(p)
}

export function deleteProject(id: string): Res<void> {
  const p = projectFilePath(id)
  if (existsSync(p)) {
    try {
      unlinkSync(p)
    } catch (err) {
      return fail('删除失败：' + (err as Error).message)
    }
  }
  const index = appStore.getRaw<Array<{ id: string }>>(STORE_KEY) ?? []
  appStore.setRaw(STORE_KEY, index.filter((x) => x.id !== id))
  return ok(undefined)
}

/**
 * 创建项目：从纯文本导入。
 *
 * 自动分章策略（仅本地，无 AI 调用）：
 *  1. 匹配「第 N 章」「Chapter N」「第N回」「第N节」「卷N」+ 换行
 *  2. 都没匹配上 → 整段当作第 1 章
 *
 * 返回 project（已写入磁盘）。
 */
export function createProjectFromText(input: {
  title: string
  author?: string
  text: string
  sourceFile?: string
}): Res<BookBreakdownProject> {
  if (!input.text.trim()) return fail('文本为空')
  const id = `bd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const chapters = splitChapters(input.text)
  if (chapters.length === 0) return fail('未识别到章节')

  const project: BookBreakdownProject = {
    id,
    title: input.title,
    author: input.author,
    sourceFile: input.sourceFile,
    chapters: chapters.map((c, i) => ({
      id: `${id}_c${i}`,
      index: i + 1,
      title: c.title,
      content: c.content,
      analysisStatus: 'pending'
    })),
    progress: 0,
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    chunkSize: 3000
  }
  writeProject(project)
  return ok(project)
}

/**
 * 本地规则分章（不调用 AI）。
 * 严格遵守"不联网""不绕过登录"——纯字符串识别。
 *
 * 策略：用 header 模式切分整段（split-with-keep）。
 */
export function splitChapters(text: string): Array<{ title: string; content: string }> {
  const headerPatterns = [
    /^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节回卷节篇][^\n]*/gm,
    /^第[一二三四五六七八九十]+卷[^\n]*/gm,
    /^Chapter\s+\d+[^\n]*/gim
  ]

  // 先找 header 的位置
  type Hit = { index: number; header: string; pattern: number }
  const hits: Hit[] = []
  for (let i = 0; i < headerPatterns.length; i++) {
    const re = new RegExp(headerPatterns[i].source, headerPatterns[i].flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      hits.push({ index: m.index, header: m[0], pattern: i })
    }
  }
  if (hits.length === 0) return [{ title: '全文', content: text.trim() }]
  // 按位置排序；同一位置的不同 pattern 选先出现的（数字模式优先）
  hits.sort((a, b) => a.index - b.index || a.pattern - b.pattern)
  // 去重：同一位置的多个 hit 只保留第一个
  const uniqueHits: Hit[] = []
  for (const h of hits) {
    if (uniqueHits.length === 0 || uniqueHits[uniqueHits.length - 1].index !== h.index) {
      uniqueHits.push(h)
    }
  }
  // 至少 2 章才视为"识别到分章"
  if (uniqueHits.length < 2) return [{ title: '全文', content: text.trim() }]

  const chapters: Array<{ title: string; content: string }> = []
  for (let i = 0; i < uniqueHits.length; i++) {
    const start = uniqueHits[i].index
    const end = i + 1 < uniqueHits.length ? uniqueHits[i + 1].index : text.length
    const slice = text.slice(start, end).trim()
    const firstLine = slice.split('\n')[0].trim()
    const title = firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine || '未命名章节'
    chapters.push({ title, content: slice })
  }
  return chapters
}

/** 列出拆书目录文件（用于 debug） */
export function listProjectFiles(): string[] {
  const d = getRootDir()
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => f.endsWith('.json'))
}

/** 用户主动暂停时记录状态 */
export function pauseProject(id: string): Res<void> {
  const p = readProject(id)
  if (!p) return fail('项目不存在')
  p.status = 'paused'
  writeProject(p)
  return ok(undefined)
}

export function resumeProject(id: string): Res<void> {
  const p = readProject(id)
  if (!p) return fail('项目不存在')
  p.status = 'idle'
  writeProject(p)
  return ok(undefined)
}

/** 推进进度（AI 流水线调用） */
export function setChapterStatus(
  id: string,
  chapterId: string,
  patch: Partial<BookBreakdownChapter>
): Res<void> {
  const p = readProject(id)
  if (!p) return fail('项目不存在')
  const ch = p.chapters.find((c) => c.id === chapterId)
  if (!ch) return fail('章节不存在')
  Object.assign(ch, patch)
  // 重新计算进度
  const done = p.chapters.filter((c) => c.analysisStatus === 'done').length
  p.progress = p.chapters.length > 0 ? done / p.chapters.length : 0
  if (p.progress >= 1) p.status = 'done'
  else if (p.status !== 'paused') p.status = 'running'
  writeProject(p)
  return ok(undefined)
}

/** 进度推送订阅（渲染层用） */
type ProgressCb = (p: BreakdownProgress) => void
const progressCbs: Set<ProgressCb> = new Set()
export function onProgress(cb: ProgressCb): () => void {
  progressCbs.add(cb)
  return () => progressCbs.delete(cb)
}
export function pushProgress(payload: BreakdownProgress): void {
  for (const cb of progressCbs) cb(payload)
}