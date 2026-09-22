/**
 * 角色关系图（v3 P1-4.2）。
 *
 * 轻量自绘 SVG（不引 d3-force 等大依赖）：
 *  - 节点：角色
 *  - 边：relationships（如 "恋人"/"师徒"/"对手"）
 *  - 节点位置：环形布局 + 拖拽时动态偏移
 *  - 缩放 / 重置
 *  - 按章节过滤（只显示该章出场角色）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Character } from '@shared/material'

interface CharacterLite {
  id: string
  name: string
  intro?: string
  relationships?: Array<{ targetId: string; relation: string }>
  appearances?: string[]
}

interface CharacterGraphProps {
  characters: CharacterLite[]
  /** 当前章节 id；过滤只显示该章出场的角色 */
  currentChapterId?: string
  /** 点击节点回调 */
  onSelect?: (id: string) => void
  /** 容器尺寸（默认 360） */
  size?: number
}

interface NodePos {
  id: string
  x: number
  y: number
}

export function CharacterGraph({ characters, currentChapterId, onSelect, size = 360 }: CharacterGraphProps): JSX.Element {
  const filtered = useMemo(() => {
    if (!currentChapterId) return characters
    return characters.filter((c) => (c.appearances ?? []).includes(currentChapterId))
  }, [characters, currentChapterId])

  // 环形布局
  const positions = useMemo<NodePos[]>(() => {
    const cx = size / 2
    const cy = size / 2
    const r = Math.min(cx, cy) - 50
    return filtered.map((c, i) => {
      const angle = (i / Math.max(1, filtered.length)) * Math.PI * 2
      return { id: c.id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
    })
  }, [filtered, size])

  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [layout, setLayout] = useState<NodePos[]>(positions)

  useEffect(() => {
    setLayout(positions)
  }, [positions])

  const posMap = useMemo(() => new Map(layout.map((p) => [p.id, p])), [layout])

  function startDrag(id: string, e: React.MouseEvent): void {
    const p = posMap.get(id)
    if (!p) return
    const svg = (e.currentTarget as SVGElement).closest('svg') as SVGSVGElement | null
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = (e.clientX - rect.left) / zoom - size / 2
    const y = (e.clientY - rect.top) / zoom - size / 2
    setDrag({ id, offsetX: x - p.x + size / 2, offsetY: y - p.y + size / 2 })
  }

  function moveDrag(e: React.MouseEvent): void {
    if (!drag) return
    const svg = (e.currentTarget as SVGSVGElement)
    const rect = svg.getBoundingClientRect()
    const x = (e.clientX - rect.left) / zoom - size / 2
    const y = (e.clientY - rect.top) / zoom - size / 2
    setLayout((prev) => prev.map((p) => (p.id === drag.id ? { ...p, x: x - drag.offsetX, y: y - drag.offsetY } : p)))
  }
  function endDrag(): void {
    setDrag(null)
  }

  function reset(): void {
    setLayout(positions)
    setZoom(1)
  }

  if (filtered.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border text-[11px] wa-muted"
        style={{ borderColor: 'var(--wa-border)', height: size }}
      >
        {currentChapterId ? '本章暂无出场角色' : '尚无角色数据'}
      </div>
    )
  }

  // 边（关系）
  const edges: Array<{ from: NodePos; to: NodePos; label: string }> = []
  for (const c of filtered) {
    const from = posMap.get(c.id)
    if (!from) continue
    for (const r of c.relationships ?? []) {
      const to = posMap.get(r.targetId)
      if (!to) continue
      edges.push({ from, to, label: r.relation })
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] wa-muted">
        <span>节点 {filtered.length} · 关系 {edges.length}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            className="rounded border px-1.5 text-[10px] wa-interactive"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            className="rounded border px-1.5 text-[10px] wa-interactive"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            +
          </button>
          <button
            onClick={reset}
            className="rounded border px-1.5 text-[10px] wa-interactive"
            style={{ borderColor: 'var(--wa-border)' }}
          >
            重置
          </button>
        </div>
      </div>
      <svg
        width={size}
        height={size}
        viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
        onMouseMove={moveDrag}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ border: '1px solid var(--wa-border)', borderRadius: 6, background: 'var(--wa-paper)' }}
      >
        <g transform={`scale(${zoom})`}>
          {edges.map((e, i) => (
            <g key={i}>
              <line
                x1={e.from.x}
                y1={e.from.y}
                x2={e.to.x}
                y2={e.to.y}
                stroke="#64748b"
                strokeWidth={1.2}
                strokeOpacity={0.6}
              />
              <text
                x={(e.from.x + e.to.x) / 2}
                y={(e.from.y + e.to.y) / 2 - 2}
                fontSize={9}
                fill="#475569"
                textAnchor="middle"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {e.label}
              </text>
            </g>
          ))}
          {layout.map((p) => {
            const c = filtered.find((x) => x.id === p.id)
            if (!c) return null
            return (
              <g
                key={p.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: 'grab' }}
                onMouseDown={(e) => startDrag(p.id, e)}
                onClick={() => onSelect?.(p.id)}
              >
                <circle r={20} fill="#0f172a" stroke="#fff" strokeWidth={2} />
                <text fontSize={10} fill="#fff" textAnchor="middle" y={4} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {c.name.slice(0, 3)}
                </text>
                <text fontSize={9} fill="#0f172a" textAnchor="middle" y={32} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {c.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}