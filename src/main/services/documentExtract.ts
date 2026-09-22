/**
 * 本地文档文本抽取（拆书 / 导入共用）。
 *
 * 支持：TXT / MD / DOCX / EPUB / PDF
 * 约束：纯本地解析，不联网、不上传整本。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, basename } from 'node:path'

export type DocumentExtractFormat = 'txt' | 'md' | 'docx' | 'epub' | 'pdf'

export interface DocumentExtractResult {
  text: string
  format: DocumentExtractFormat
  encoding: string
  titleHint: string
  warnings: string[]
}

/** 与 importer 保持一致的大小上限 */
const MAX_TXT_BYTES = 20 * 1024 * 1024

/** 检测编码并解码（本地副本，避免与 importer 循环依赖） */
function decodeBuffer(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8(BOM)' }
  }
  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    return { text: dec.decode(buf), encoding: 'UTF-8' }
  } catch {
    for (const enc of ['gbk', 'gb18030', 'gb2312'] as const) {
      try {
        const dec = new TextDecoder(enc)
        return { text: dec.decode(buf), encoding: enc.toUpperCase() }
      } catch {
        /* try next */
      }
    }
    throw new Error('E_ENCODING_FAILED')
  }
}

const TEXT_EXTS = new Set(['txt', 'md', 'markdown'])
const SUPPORTED = new Set(['txt', 'md', 'markdown', 'docx', 'epub', 'pdf'])

function normalizeExt(filePath: string): string {
  return extname(filePath).toLowerCase().replace(/^\./, '')
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function titleFromPath(filePath: string): string {
  return basename(filePath).replace(/\.[^.]+$/, '')
}

async function extractDocx(buf: Buffer): Promise<{ text: string; warnings: string[] }> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: buf })
  const warnings = (result.messages ?? [])
    .filter((m) => m.type === 'warning')
    .slice(0, 5)
    .map((m) => m.message)
  return { text: (result.value ?? '').trim(), warnings }
}

async function readZipText(file: { async: (type: 'text') => Promise<string | Buffer | Uint8Array> }): Promise<string> {
  const data = await file.async('text')
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
}

async function extractEpub(buf: Buffer): Promise<{ text: string; warnings: string[] }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const warnings: string[] = []

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('EPUB 缺少 META-INF/container.xml')
  const containerXml = await readZipText(containerFile)
  const rootMatch = containerXml.match(/full-path\s*=\s*"([^"]+)"/i)
  if (!rootMatch) throw new Error('EPUB 无法定位 content.opf')

  const opfPath = rootMatch[1].replace(/\\/g, '/')
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('EPUB 缺少 content.opf')
  const opfXml = await readZipText(opfFile)

  const manifest = new Map<string, string>()
  const itemRe = /<item\b[^>]*>/gi
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(opfXml)) !== null) {
    const tag = item[0]
    const id = tag.match(/\bid\s*=\s*"([^"]+)"/i)?.[1]
    const href = tag.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1]
    if (id && href) manifest.set(id, href.replace(/\\/g, '/'))
  }

  const spineIds: string[] = []
  const spineRe = /<itemref\b[^>]*\bidref\s*=\s*"([^"]+)"[^>]*>/gi
  let spine: RegExpExecArray | null
  while ((spine = spineRe.exec(opfXml)) !== null) spineIds.push(spine[1])

  if (spineIds.length === 0) {
    warnings.push('EPUB spine 为空，已回退为按文件名排序抽取')
    const htmlFiles = Object.keys(zip.files)
      .filter((n) => /\.(xhtml|html|htm)$/i.test(n) && !zip.files[n].dir)
      .sort((a, b) => a.localeCompare(b, 'en'))
    const chunks: string[] = []
    for (const name of htmlFiles) {
      const f = zip.file(name)
      if (!f) continue
      chunks.push(stripHtml(await readZipText(f)))
    }
    return { text: chunks.filter(Boolean).join('\n\n'), warnings }
  }

  const chunks: string[] = []
  for (const id of spineIds) {
    const href = manifest.get(id)
    if (!href) {
      warnings.push(`spine 引用缺失: ${id}`)
      continue
    }
    const full = (opfDir + href).replace(/\/+/g, '/')
    const f = zip.file(full) ?? zip.file(decodeURIComponent(full))
    if (!f) {
      warnings.push(`章节文件缺失: ${full}`)
      continue
    }
    chunks.push(stripHtml(await readZipText(f)))
  }

  const text = chunks.filter(Boolean).join('\n\n').trim()
  if (!text) throw new Error('EPUB 未提取到正文')
  return { text, warnings }
}

async function extractPdf(buf: Buffer): Promise<{ text: string; warnings: string[] }> {
  // 直接走 lib 入口，避开 pdf-parse/index.js 自测副作用
  const mod = await import('pdf-parse/lib/pdf-parse.js')
  const pdfParse = ((mod as { default?: unknown }).default ?? mod) as (b: Buffer) => Promise<{ text?: string; numpages?: number }>
  try {
    const data = await pdfParse(buf)
    const text = (data.text ?? '').replace(/\r\n/g, '\n').trim()
    const warnings: string[] = []
    if (!text) warnings.push('PDF 未提取到可选中文本（可能是扫描版）')
    if ((data.numpages ?? 0) > 0) warnings.push(`PDF 共 ${data.numpages} 页`)
    return { text, warnings }
  } catch (err) {
    const msg = (err as Error).message || String(err)
    throw new Error('PDF 解析失败：' + msg + '（请确认不是扫描版/加密 PDF）')
  }
}

/**
 * 从本地文件抽取纯文本。
 */
export async function extractTextFromFile(filePath: string): Promise<DocumentExtractResult> {
  if (!existsSync(filePath)) throw new Error('E_IO_BUSY')
  const size = statSync(filePath).size
  if (size > MAX_TXT_BYTES) throw new Error('E_TXT_TOO_LARGE')

  const ext = normalizeExt(filePath)
  if (!SUPPORTED.has(ext)) {
    throw new Error(`不支持的文件格式: .${ext || '(无扩展名)'}（支持 txt/md/docx/epub/pdf）`)
  }

  const buf = readFileSync(filePath)
  const titleHint = titleFromPath(filePath)

  if (TEXT_EXTS.has(ext)) {
    const { text, encoding } = decodeBuffer(buf)
    return {
      text,
      format: ext === 'markdown' ? 'md' : (ext as DocumentExtractFormat),
      encoding,
      titleHint,
      warnings: []
    }
  }

  if (ext === 'docx') {
    const { text, warnings } = await extractDocx(buf)
    return { text, format: 'docx', encoding: 'DOCX', titleHint, warnings }
  }

  if (ext === 'epub') {
    const { text, warnings } = await extractEpub(buf)
    return { text, format: 'epub', encoding: 'EPUB', titleHint, warnings }
  }

  const { text, warnings } = await extractPdf(buf)
  return { text, format: 'pdf', encoding: 'PDF', titleHint, warnings }
}

export const BREAKDOWN_IMPORT_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: '书籍文档', extensions: ['txt', 'md', 'markdown', 'docx', 'epub', 'pdf'] },
  { name: '全部文件', extensions: ['*'] }
]
