import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface PetApi {
  getAvatars(): Promise<{ ok: boolean; data: PetAvatar[] }>
  getSettings(): Promise<PetSettings>
  switchAvatar(id: string): Promise<void>
  onInspiration(cb: (p: { text: string; kind?: string }) => void): () => void
}

interface PetAvatar {
  id: string
  name: string
  assetDir: string
  manifest: {
    states: { idle: { frames: string[]; fps: number } }
  }
}

interface PetSettings {
  avatarId: string | null
}

declare global {
  interface Window {
    petApi: PetApi
  }
}

function App(): JSX.Element {
  const [avatars, setAvatars] = useState<PetAvatar[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [inspiration, setInspiration] = useState<{ text: string; kind?: string } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [idle, setIdle] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void window.petApi.getAvatars().then((r) => {
      if (r.ok) setAvatars(r.data)
    })
    void window.petApi.getSettings().then((s) => {
      setActiveId(s.avatarId)
    })
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(m.matches)
    const onChange = (): void => setReducedMotion(m.matches)
    m.addEventListener('change', onChange)
    return window.petApi.onInspiration((p) => {
      setInspiration(p)
      setIdle(false)
      setTimeout(() => setInspiration(null), 8000)
    })
  }, [])

  // 长时间无操作自动进入 idle（5 分钟）
  useEffect(() => {
    const onAct = (): void => setIdle(false)
    window.addEventListener('mousemove', onAct)
    window.addEventListener('keydown', onAct)
    const t = setInterval(() => setIdle(true), 5 * 60 * 1000)
    return () => {
      window.removeEventListener('mousemove', onAct)
      window.removeEventListener('keydown', onAct)
      clearInterval(t)
    }
  }, [])

  const active = avatars.find((a) => a.id === activeId) ?? null

  // 帧循环：reduced-motion 时停动画；idle 时降到 2 fps
  useEffect(() => {
    if (!active) return
    if (reducedMotion) return // 完全停帧
    const state = active.manifest.states.idle
    const fps = idle ? 2 : Math.max(80, Math.floor(1000 / state.fps))
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % state.frames.length)
    }, fps)
    return () => clearInterval(id)
  }, [active, reducedMotion, idle])

  // 拖拽时短路全局动效（与主窗口 wa-dragging 行为一致）
  useEffect(() => {
    document.body.dataset.waDragging = dragging ? '1' : '0'
    return () => {
      delete document.body.dataset.waDragging
    }
  }, [dragging])

  if (!active) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 10, color: '#888' }}>未导入形象</div>
        <div style={{ fontSize: 9, color: '#aaa' }}>设置 → 宠物</div>
      </div>
    )
  }

  const src = `file:///${active.assetDir.replace(/\\/g, '/')}/${active.manifest.states.idle.frames[frame]}`

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: dragging ? 'grabbing' : 'grab',
        // 拖拽时 1.05 放大；idle 时轻微呼吸
        transform: dragging ? 'scale(1.05)' : undefined,
        transition: 'transform var(--wa-motion-fast, 120ms) var(--wa-ease-out, cubic-bezier(0.22, 1, 0.36, 1))',
        animation: idle && !reducedMotion ? 'wa-breathe 3500ms ease-in-out infinite' : undefined
      }}
      onMouseDown={() => setDragging(true)}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
    >
      <img
        src={src}
        alt={active.name}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          imageRendering: 'pixelated'
        }}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.opacity = '0.3'
        }}
      />
      {inspiration && (
        <>
          {/* 气泡箭头（指向宠物） */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: 0,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid rgba(0,0,0,0.78)'
            }}
          />
          <div
            role="status"
            className="wa-pop"
            style={{
              position: 'absolute',
              left: '50%',
              right: 'auto',
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: 6,
              background: 'rgba(0,0,0,0.78)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 12,
              fontSize: 11,
              maxWidth: 280,
              minWidth: 60,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.45,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              wordBreak: 'break-word'
            }}
          >
            {inspiration.text}
          </div>
        </>
      )}
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)