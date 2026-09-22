/**
 * 导入服务（阶段 6.5）。
 *
 * 支持：TXT（自动分章）、Markdown、DOCX（mammoth）、EPUB、PDF、JSON（完整恢复）。
 * 全部文件读写在主进程完成；渲染进程只发 IPC 指令。
 *
 * 错误码：E_TXT_TOO_LARGE / E_CHAPTERS_TOO_MANY / E_BACKUP_VERSION /
 *        E_BACKUP_CORRUPTED / E_IO_BUSY / E_ENCODING_FAILED / E_EXPORT_TOO_LARGE
 */
import { readFileSync, writeFileSync, renameSync, existsSync, statSync, unlinkSync } from 'node:fs'
import type { Work, Volume, Chapter } from '@shared/work'
import type { ImportPreview, ImportResult, ImportStrategy, ImportExportErrorCode } from '@shared/settings'
import { DATA_SCHEMA_VERSION, appStore } from '../store'
import { countWords, newId } from './work'
import { extractTextFromFile } from './documentExtract'

/** 大小与数量上限 */
export const MAX_TXT_BYTES = 20 * 1024 * 1024
export const MAX_CHAPTERS = 2000

/** 章节标题识别模式 */
const CHAPTER_PATTERNS: RegExp[] = [
  // 第X章/回/节/卷/幕（中文数字或阿拉伯数字）
  /^\s*第\s*[0-9〇零一二三四五六七八九十百千万两]+\s*[章节回卷幕]\s*[^\n]{0,40}$/,
  // Chapter X
  /^\s*Chapter\s+\d+\s*[^\n]{0,60}$/i,
  // 序章/楔子/尾声/后记/番外/前言/引子/终章
  // 要求标记后紧跟分隔符或行尾，避免把"前言内容"这类正文误判为标题
  /^\s*(序章|楔子|尾声|后记|番外|前言|引子|终章|外传|序)(\s|[:：、.．\-—·]|$)[^\n]{0,40}$/,
  // 纯数字标题（如 "1" / "12." 独占一行）
  /^\s*\d{1,4}\s*[.、]?\s*$/
]

/** 句子结束标点：出现则基本可判定为正文而非标题 */
const SENTENCE_END_RE = /[。！？；]/

export function isChapterTitle(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 60) return false
  // 含句末标点的长句不是标题（防止"第一章的内容很精彩。"这类正文被误判）
  if (SENTENCE_END_RE.test(t) && t.length > 20) return false
  return CHAPTER_PATTERNS.some((re) => re.test(line))
}

export interface ParsedChapter {
  title: string
  content: string
}

export interface ParsedDocument {
  preface: string
  chapters: ParsedChapter[]
}

/**
 * 把纯文本切分为章节。
 * 规则：标题前的非空内容归"前言"；无标题则整文件单章；空行折叠。
 */
export function splitChapters(text: string): ParsedDocument {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const chapters: ParsedChapter[] = []
  const prefaceLines: string[] = []
  let currentTitle: string | null = null
  let buffer: string[] = []

  const flush = (): void => {
    if (currentTitle === null) return
    const content = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    chapters.push({ title: currentTitle, content })
    buffer = []
  }

  for (const line of lines) {
    if (isChapterTitle(line)) {
      if (currentTitle === null) {
        // 第一个标题前的内容是前言
        flush()
      } else {
        flush()
      }
      currentTitle = line.trim()
    } else if (currentTitle === null) {
      prefaceLines.push(line)
    } else {
      buffer.push(line)
    }
  }
  flush()

  const preface = prefaceLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // 无标题 -> 整文件单章
  if (chapters.length === 0) {
    const whole = normalized.trim()
    if (whole) {
      return { preface: '', chapters: [{ title: '全文', content: whole }] }
    }
    return { preface: '', chapters: [] }
  }

  // 前言如果有内容，作为独立章节放在最前
  if (preface) {
    return { preface, chapters: [{ title: '前言', content: preface }, ...chapters] }
  }
  return { preface: '', chapters }
}

/** 检测编码并解码 */
export function decodeBuffer(buf: Buffer): { text: string; encoding: string } {
  // BOM 检测
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8(BOM)' }
  }
  // 先按 UTF-8 严格解码，失败再退回 GBK
  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    return { text: dec.decode(buf), encoding: 'UTF-8' }
  } catch {
    for (const enc of ['gbk', 'gb18030', 'gb2312']) {
      try {
        const dec = new TextDecoder(enc)
        return { text: dec.decode(buf), encoding: enc.toUpperCase() }
      } catch {
        /* 尝试下一种 */
      }
    }
    throw new Error('E_ENCODING_FAILED')
  }
}

/** 分析导入文件，返回预览 */
export async function analyzeImport(filePath: string): Promise<ImportPreview> {
  const warnings: string[] = []
  if (!existsSync(filePath)) throw new Error('E_IO_BUSY')
  const size = statSync(filePath).size
  if (size > MAX_TXT_BYTES) throw new Error('E_TXT_TOO_LARGE')

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const buf = readFileSync(filePath)

  if (ext === 'epub' || ext === 'pdf') {
    const extracted = await extractTextFromFile(filePath)
    const parsed = splitChapters(extracted.text)
    const warnings = [...extracted.warnings]
    if (ext === 'pdf') warnings.push('PDF 按纯文本分章，扫描版可能无正文')
    if (ext === 'epub') warnings.push('EPUB 按阅读顺序抽取正文后自动分章')
    return buildPreview(parsed, extracted.encoding, warnings)
  }

  if (ext === 'docx') {
    // mammoth 转 HTML -> 纯文本
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: buf })
    const parsed = splitChapters(result.value)
    return buildPreview(parsed, 'DOCX', warnings)
  }

  if (ext === 'json') {
    const { text } = decodeBuffer(buf)
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(text)
    } catch {
      throw new Error('E_BACKUP_CORRUPTED')
    }
    const work = extractWorkFromJson(parsedJson)
    if (!work) throw new Error('E_BACKUP_CORRUPTED')
    const chapters = work.volumes.flatMap((v) => v.chapters)
    return {
      encoding: 'JSON',
      chapterCount: chapters.length,
      wordCount: chapters.reduce((s, c) => s + c.wordCount, 0),
      chapters: chapters.slice(0, 50).map((c) => ({ title: c.title, wordCount: c.wordCount })),
      prefaceLength: 0,
      warnings: ['将按 JSON 备份完整恢复作品']
    }
  }

  // TXT / Markdown
  const { text, encoding } = decodeBuffer(buf)
  const parsed = splitChapters(text)
  if (ext === 'md') warnings.push('Markdown 文件按标题行自动分章')
  return buildPreview(parsed, encoding, warnings)
}

function buildPreview(parsed: ParsedDocument, encoding: string, warnings: string[]): ImportPreview {
  if (parsed.chapters.length > MAX_CHAPTERS) {
    warnings.push(`章节数超过上限 ${MAX_CHAPTERS}，超出部分将被忽略`)
  }
  return {
    encoding,
    chapterCount: Math.min(parsed.chapters.length, MAX_CHAPTERS),
    wordCount: parsed.chapters.reduce((s, c) => s + countWords(c.content), 0),
    chapters: parsed.chapters.slice(0, 50).map((c) => ({ title: c.title, wordCount: countWords(c.content) })),
    prefaceLength: countWords(parsed.preface),
    warnings
  }
}

/** 从 JSON 备份中取出作品 */
export function extractWorkFromJson(json: unknown): Work | null {
  const obj = json as Record<string, unknown>
  if (!obj || typeof obj !== 'object') return null
  // 支持 {meta,hash,data} 信封
  const data = (obj.data ?? obj) as Record<string, unknown>
  if (data && Array.isArray(data.volumes)) return data as unknown as Work
  // 支持 {works:[...]}
  if (Array.isArray(data?.works)) return (data.works as Work[])[0] ?? null
  return null
}

/**
 * 原子写入：先写 .tmp，成功后 rename。
 */
export function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, filePath)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

/** 执行导入 */
export async function executeImport(params: {
  filePath: string
  strategy: ImportStrategy
  targetWorkId?: string
}): Promise<ImportResult> {
  const { filePath, strategy, targetWorkId } = params
  try {
    if (!existsSync(filePath)) {
      return { ok: false, chapterCount: 0, skipped: 0, renamed: 0, error: 'E_IO_BUSY', message: '文件不存在' }
    }
    if (statSync(filePath).size > MAX_TXT_BYTES) {
      return {
        ok: false,
        chapterCount: 0,
        skipped: 0,
        renamed: 0,
        error: 'E_TXT_TOO_LARGE',
        message: '文件超过 20MB'
      }
    }

    const buf = readFileSync(filePath)
    const ext = filePath.toLowerCase().split('.').pop() ?? ''
    let parsed: ParsedDocument

    if (ext === 'json') {
      const { text } = decodeBuffer(buf)
      const work = extractWorkFromJson(JSON.parse(text))
      if (!work) {
        return {
          ok: false,
          chapterCount: 0,
          skipped: 0,
          renamed: 0,
          error: 'E_BACKUP_CORRUPTED',
          message: 'JSON 备份无法解析'
        }
      }
      // JSON 完整恢复：直接写入为独立作品
      const restored: Work = {
        ...work,
        id: strategy === 'new' || !targetWorkId ? newId('work') : targetWorkId,
        schemaVersion: DATA_SCHEMA_VERSION,
        updatedAt: Date.now()
      }
      appStore.upsertWork(restored)
      appStore.setSettings({ currentWorkId: restored.id })
      const count = restored.volumes.flatMap((v) => v.chapters).length
      return { ok: true, workId: restored.id, chapterCount: count, skipped: 0, renamed: 0 }
    }

    if (ext === 'docx' || ext === 'epub' || ext === 'pdf') {
      const extracted = await extractTextFromFile(filePath)
      parsed = splitChapters(extracted.text)
    } else {
      const { text } = decodeBuffer(buf)
      parsed = splitChapters(text)
    }

    if (parsed.chapters.length > MAX_CHAPTERS) {
      return {
        ok: false,
        chapterCount: 0,
        skipped: 0,
        renamed: 0,
        error: 'E_CHAPTERS_TOO_MANY',
        message: `章节数超过上限 ${MAX_CHAPTERS}`
      }
    }

    // 目标作品
    let work: Work | undefined
    if (strategy === 'merge' && targetWorkId) {
      work = appStore.getWork(targetWorkId)
    }
    if (!work) {
      const t = Date.now()
      const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '导入作品'
      work = {
        id: newId('work'),
        title: fileName.replace(/\.[^.]+$/, ''),
        author: '',
        intro: '由文件导入',
        volumes: [],
        createdAt: t,
        updatedAt: t,
        schemaVersion: DATA_SCHEMA_VERSION
      }
    }

    // 合并目标卷（没有则新建）
    let volume: Volume | undefined = work.volumes[0]
    if (!volume) {
      volume = {
        id: newId('vol'),
        title: '第一卷',
        chapters: [],
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      work.volumes.push(volume)
    }

    let skipped = 0
    let renamed = 0
    let added = 0

    for (const pc of parsed.chapters) {
      const existingSameTitle = volume.chapters.find((c) => c.title === pc.title)
      if (existingSameTitle) {
        if (existingSameTitle.content.trim() === pc.content.trim()) {
          // 标题相同且内容相同 -> 跳过
          skipped++
          continue
        }
        // 同名不同文 -> 重命名为「（导入 N）」
        let n = 1
        let newTitle = `${pc.title}（导入 ${n}）`
        while (volume.chapters.some((c) => c.title === newTitle)) {
          n++
          newTitle = `${pc.title}（导入 ${n}）`
        }
        renamed++
        volume.chapters.push(makeChapter(newTitle, pc.content))
        added++
        continue
      }
      volume.chapters.push(makeChapter(pc.title, pc.content))
      added++
    }

    volume.updatedAt = Date.now()
    work.updatedAt = Date.now()
    appStore.upsertWork(work)
    appStore.setSettings({ currentWorkId: work.id })

    return {
      ok: true,
      workId: work.id,
      chapterCount: added,
      skipped,
      renamed,
      message: `导入 ${added} 章，跳过 ${skipped}，重命名 ${renamed}`
    }
  } catch (err) {
    const code = (err as Error).message as ImportExportErrorCode
    return {
      ok: false,
      chapterCount: 0,
      skipped: 0,
      renamed: 0,
      error: code.startsWith('E_') ? code : 'E_UNKNOWN',
      message: (err as Error).message
    }
  }
}

function makeChapter(title: string, content: string): Chapter {
  const t = Date.now()
  return {
    id: newId('ch'),
    title,
    content,
    wordCount: countWords(content),
    createdAt: t,
    updatedAt: t,
    versions: []
  }
}
