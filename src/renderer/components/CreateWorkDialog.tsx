import { useRef, useState } from 'react'
import { useWorkStore } from '../store/work'
import { useUiStore } from '../store/ui'

async function fileToCoverUrl(file: File): Promise<string> {
  const raw = await file.arrayBuffer()
  const blob = new Blob([raw], { type: file.type || 'image/jpeg' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片无法读取'))
      el.src = url
    })
    const max = 720
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理封面')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 居中新建作品弹窗：书名 / 作者 / 简介 / 封面。
 */
export function CreateWorkDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated?: () => void
}): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [intro, setIntro] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onPickCover(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const data = await fileToCoverUrl(file)
      setCoverUrl(data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '封面读取失败', 'error')
    }
  }

  async function submit(): Promise<void> {
    const t = title.trim()
    if (!t) {
      showToast('请输入作品名', 'error')
      return
    }
    setBusy(true)
    try {
      await useWorkStore.getState().createWork({
        title: t,
        author: author.trim() || undefined,
        intro: intro.trim() || undefined,
        coverUrl: coverUrl || undefined
      })
      showToast(`已创建「${t}」`, 'success')
      onCreated?.()
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/45 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] min-h-0 w-[min(32rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border shadow-2xl wa-panel"
        style={{ borderColor: 'var(--wa-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b px-4 py-2.5" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">新建作品</h2>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5">
            ✕
          </button>
        </header>

        <div className="flex gap-4 p-4">
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative flex h-40 w-[108px] items-center justify-center overflow-hidden rounded-lg border text-[11px] wa-muted hover:bg-black/5"
              style={{ borderColor: 'var(--wa-border)' }}
              title="选择封面"
            >
              {coverUrl ? (
                <img src={coverUrl} alt="封面预览" className="h-full w-full object-cover" />
              ) : (
                <span className="px-2 text-center leading-relaxed">点击添加封面</span>
              )}
              {coverUrl && (
                <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-[10px] text-white opacity-0 group-hover:opacity-100">
                  更换
                </span>
              )}
            </button>
            {coverUrl && (
              <button
                type="button"
                onClick={() => setCoverUrl('')}
                className="mt-1 w-full text-[10px] wa-muted hover:underline"
              >
                移除封面
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void onPickCover(e.target.files?.[0])}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <label className="block text-[11px]">
              <span className="mb-0.5 block wa-muted">作品名 *</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                placeholder="例如：转生末影龙"
                className="w-full rounded border px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: 'var(--wa-border)' }}
              />
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block wa-muted">作者</span>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="可选"
                className="w-full rounded border px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: 'var(--wa-border)' }}
              />
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block wa-muted">作品简介</span>
              <textarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="一句话介绍这本书，会显示在作品库卡片上"
                rows={5}
                className="w-full resize-none rounded border px-2 py-1.5 text-xs leading-relaxed outline-none"
                style={{ borderColor: 'var(--wa-border)' }}
              />
            </label>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--wa-border)' }}>
          <button type="button" onClick={onClose} className="rounded px-3 py-1 text-xs hover:bg-black/5">
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建并开始写作'}
          </button>
        </footer>
      </div>
    </div>
  )
}
