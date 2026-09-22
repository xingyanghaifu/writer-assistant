import { useMemo, useState } from 'react'
import {
  DEFAULT_FORMAT_OPTIONS,
  describeFormat,
  formatManuscript,
  type FormatOptions
} from '@shared/format'

/** 可切换的排版项（键与 FormatOptions 对应） */
const TOGGLES: Array<{ key: keyof FormatOptions; label: string; hint: string }> = [
  { key: 'indent', label: '段首缩进两格', hint: '每段开头统一加两个全角空格' },
  { key: 'trimLeading', label: '去除段首原有空白', hint: '避免与自动缩进重复' },
  { key: 'trimTrailing', label: '删除行尾空白', hint: '清理复制粘贴带来的尾随空格' },
  { key: 'collapseBlankLines', label: '合并连续空行', hint: '多个空行折叠为一个' },
  { key: 'squeezeSpaces', label: '压缩段内多余空格', hint: '连续空格压成一个' },
  { key: 'normalizePunctuation', label: '标点规范化', hint: '。。。→……；半角逗号句号转全角' },
  { key: 'normalizeQuotes', label: '引号规范化', hint: '直引号 " 转为中文弯引号 “”' },
  { key: 'cjkLatinSpace', label: '中英文间补空格', hint: '如「他说hello」→「他说 hello」' }
]

/**
 * 自动排版面板。
 *
 * 全部为**本地纯文本处理**，不调用 AI、不上传任何内容。
 * 先给预览再应用，用户能看到具体改动，避免"一键排版把稿子改坏"。
 */
export function FormatPanel({
  source,
  onClose,
  onApply
}: {
  source: string
  onClose: () => void
  onApply: (text: string) => void
}): JSX.Element {
  const [opts, setOpts] = useState<FormatOptions>(DEFAULT_FORMAT_OPTIONS)

  const result = useMemo(() => formatManuscript(source, opts), [source, opts])

  const summary = describeFormat(result.stats)

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="flex max-h-[92vh] w-[min(56rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">自动排版</h2>
          <span className="wa-muted text-[11px]">纯本地处理 · 不改动文字内容</span>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 选项 */}
          <div
            className="w-52 shrink-0 overflow-y-auto border-r p-2.5"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            <div className="mb-1.5 text-[11px] font-medium wa-muted">排版规则</div>
            {TOGGLES.map((t) => (
              <label key={t.key} className="mb-1.5 flex items-start gap-1.5" title={t.hint}>
                <input
                  type="checkbox"
                  checked={opts[t.key]}
                  onChange={(e) => setOpts((o) => ({ ...o, [t.key]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span className="text-[11px] leading-tight">{t.label}</span>
              </label>
            ))}
            <button
              onClick={() => setOpts(DEFAULT_FORMAT_OPTIONS)}
              className="mt-1 w-full rounded px-2 py-1 text-[11px] hover:bg-black/5"
              style={{ border: '1px solid var(--wa-border)' }}
            >
              恢复推荐设置
            </button>
          </div>

          {/* 预览 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              <span className="font-medium">改动预览</span>
              <span className={result.changed ? 'text-emerald-600' : 'wa-muted'}>{summary}</span>
              <div className="flex-1" />
              <span className="wa-muted">
                {source.replace(/\s/g, '').length} 字 → {result.text.replace(/\s/g, '').length} 字
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!result.changed ? (
                <div className="py-8 text-center text-xs wa-muted">当前稿件已符合所选规则，无需改动</div>
              ) : (
                <pre
                  className="whitespace-pre-wrap rounded border p-2.5 text-xs leading-[1.9]"
                  style={{ borderColor: 'var(--wa-border)', background: 'var(--wa-paper)' }}
                >
                  {result.text.slice(0, 4000)}
                  {result.text.length > 4000 && '\n\n…（预览仅显示前 4000 字，应用时会处理全文）'}
                </pre>
              )}
            </div>

            <div
              className="flex shrink-0 items-center gap-2 border-t px-3 py-2"
              style={{ borderColor: 'var(--wa-border)' }}
            >
              <span className="text-[11px] wa-muted">
                应用后可在「历史版本」中找回排版前的版本
              </span>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="rounded px-2.5 py-1 text-xs hover:bg-black/5"
                style={{ border: '1px solid var(--wa-border)' }}
              >
                取消
              </button>
              <button
                onClick={() => onApply(result.text)}
                disabled={!result.changed}
                className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 disabled:opacity-40"
              >
                应用排版
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
