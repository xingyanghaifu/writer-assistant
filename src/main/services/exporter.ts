/**
 * 导出服务（阶段 6.5）。
 *
 * 格式：JSON（完整备份）、TXT（带卷章结构）、Markdown（层级标题）、HTML（排版投稿）。
 * 导出上限 200MB。
 */
import { createHash } from 'node:crypto'
import { statSync, existsSync } from 'node:fs'
import type { Work } from '@shared/work'
import type { ExportFormat } from '@shared/settings'
import { appStore } from '../store'
import { atomicWrite } from './importer'

export const MAX_EXPORT_BYTES = 200 * 1024 * 1024

/** AI 辅助创作声明（阶段 8.5） */
export const AI_NOTICE_TEXT =
  '本文档包含 AI 辅助创作内容。AI 生成部分仅供参考，最终文本经作者修改与确认。'

export interface ExportOptions {
  workId: string
  format: ExportFormat
  includeAiNotice?: boolean
  outputPath: string
}

/** 导出为 JSON：完整备份信封（含 meta 与 hash，阶段 7.5） */
export function exportJson(work: Work, includeAiNotice: boolean): string {
  const chapters = work.volumes.flatMap((v) => v.chapters)
  const envelope = {
    meta: {
      workId: work.id,
      workTitle: work.title,
      createdAt: Date.now(),
      appVersion: appStore.getSettings().schemaVersion ? '0.1.0' : '0.1.0',
      schemaVersion: work.schemaVersion,
      chapterCount: chapters.length,
      wordCount: chapters.reduce((s, c) => s + c.wordCount, 0),
      aiAssisted: includeAiNotice
    },
    hash: '',
    data: work
  }
  // 计算内容 hash 以保证备份可校验
  const body = JSON.stringify(envelope.data)
  envelope.hash = createHash('sha256').update(body).digest('hex')
  return JSON.stringify(envelope, null, 2)
}

/** 导出为 TXT：带卷章结构 */
export function exportTxt(work: Work, includeAiNotice: boolean): string {
  const parts: string[] = []
  parts.push(`《${work.title}》`)
  if (work.author) parts.push(`作者：${work.author}`)
  parts.push('')
  if (work.intro) {
    parts.push('【简介】')
    parts.push(work.intro)
    parts.push('')
  }
  if (includeAiNotice) {
    parts.push('【声明】')
    parts.push(AI_NOTICE_TEXT)
    parts.push('')
  }
  for (const v of work.volumes) {
    // 只有一卷时不重复打印卷名
    if (work.volumes.length > 1) {
      parts.push(`\n${v.title}\n`)
    }
    for (const c of v.chapters) {
      parts.push(`\n${c.title}\n`)
      parts.push(c.content)
      parts.push('')
    }
  }
  return parts.join('\n')
}

/** 导出为 Markdown：层级标题 */
export function exportMarkdown(work: Work, includeAiNotice: boolean): string {
  const lines: string[] = []
  lines.push(`# ${work.title}`)
  if (work.author) lines.push(`> 作者：${work.author}`)
  lines.push('')
  if (work.intro) {
    lines.push('## 简介')
    lines.push('')
    lines.push(work.intro)
    lines.push('')
  }
  if (includeAiNotice) {
    lines.push('> ' + AI_NOTICE_TEXT)
    lines.push('')
  }
  for (const v of work.volumes) {
    if (work.volumes.length > 1) {
      lines.push(`## ${v.title}`)
      lines.push('')
    }
    for (const c of v.chapters) {
      const level = work.volumes.length > 1 ? '###' : '##'
      lines.push(`${level} ${c.title}`)
      lines.push('')
      lines.push(c.content)
      lines.push('')
    }
  }
  return lines.join('\n')
}

/** HTML 转义 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 导出为 HTML：排版投稿 */
export function exportHtml(work: Work, includeAiNotice: boolean): string {
  const body: string[] = []
  body.push(`<h1>${esc(work.title)}</h1>`)
  if (work.author) body.push(`<p class="author">作者：${esc(work.author)}</p>`)
  if (work.intro) body.push(`<div class="intro"><h2>简介</h2><p>${esc(work.intro)}</p></div>`)
  if (includeAiNotice) body.push(`<p class="notice">${esc(AI_NOTICE_TEXT)}</p>`)
  for (const v of work.volumes) {
    if (work.volumes.length > 1) body.push(`<h2>${esc(v.title)}</h2>`)
    for (const c of v.chapters) {
      body.push(`<h3>${esc(c.title)}</h3>`)
      for (const para of c.content.split(/\n{2,}/)) {
        const t = para.trim()
        if (t) body.push(`<p>${esc(t).replace(/\n/g, '<br/>')}</p>`)
      }
    }
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(work.title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; background: #f7f4ec; color: #2f2b24;
         font-family: "Songti SC", SimSun, serif; font-size: 17px; line-height: 1.9; }
  h1 { font-size: 28px; text-align: center; margin-bottom: 8px; }
  h2 { font-size: 21px; margin-top: 32px; border-bottom: 1px solid #ddd6c6; padding-bottom: 6px; }
  h3 { font-size: 18px; margin-top: 26px; }
  p { text-indent: 2em; margin: 0.5em 0; }
  .author { text-align: center; color: #7d7466; text-indent: 0; }
  .notice { color: #8a7f6b; font-size: 13px; text-indent: 0; border-left: 3px solid #ddd6c6; padding-left: 10px; }
  .intro p { color: #5c5346; }
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>`
}

/** 执行导出，写入文件 */
export function executeExport(options: ExportOptions): { ok: boolean; path?: string; error?: string } {
  const { workId, format, includeAiNotice = false, outputPath } = options
  const work = appStore.getWork(workId)
  if (!work) return { ok: false, error: '作品不存在' }

  let content: string
  switch (format) {
    case 'json':
      content = exportJson(work, includeAiNotice)
      break
    case 'txt':
      content = exportTxt(work, includeAiNotice)
      break
    case 'markdown':
      content = exportMarkdown(work, includeAiNotice)
      break
    case 'html':
      content = exportHtml(work, includeAiNotice)
      break
    default:
      return { ok: false, error: 'E_UNKNOWN' }
  }

  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_EXPORT_BYTES) return { ok: false, error: 'E_EXPORT_TOO_LARGE' }

  try {
    atomicWrite(outputPath, content)
    return { ok: true, path: outputPath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 导出文件扩展名 */
export function extForFormat(format: ExportFormat): string {
  switch (format) {
    case 'json':
      return 'json'
    case 'txt':
      return 'txt'
    case 'markdown':
      return 'md'
    case 'html':
      return 'html'
  }
}

/** 建议的导出文件名 */
export function suggestFileName(workTitle: string, format: ExportFormat): string {
  const safe = workTitle.replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}.${extForFormat(format)}`
}

export { existsSync, statSync }
