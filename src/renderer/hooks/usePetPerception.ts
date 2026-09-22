/**
 * usePetPerception：编辑器感知 + 规则评估（v3 P0-3.1）。
 *
 * 使用：
 *  - 在 Editor 组件 mount 时调用 const hook = usePetPerception()
 *  - 编辑器 textarea onChange 时调 hook.onTextChange(newText)
 *  - hook.item 是最新一条命中（已通过 IPC 推到宠物窗口）
 *
 * 依赖：
 *  - PetSettings（idleSeconds / perceptionMinChars / triggerFrequency）
 *  - 当前章节 + 全部章节（用于角色久未出现 / 伏笔未回收判断）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../store/ui'
import { useWorkStore } from '../store/work'
import { CharThrottle, runWhenIdle } from '../services/petThrottle'
import { buildRules, initEngineState, evaluateRules } from '../services/petRuleEngine'
import { pushInspiration } from '../services/petBridge'
import { generateAiInspiration } from '../services/petAIInspiration'
import type { InspirationItem, PetPerceptionContext, PetRule } from '@shared/pet'
import type { Work, Chapter } from '@shared/work'
import type { Character, Foreshadowing } from '@shared/material'

const FREQ_COOLDOWN: Record<'low' | 'normal' | 'high', number> = {
  low: 60_000,
  normal: 30_000,
  high: 15_000
}

export interface UsePetPerception {
  onTextChange: (text: string) => void
  item: InspirationItem | null
  triggerRandom: () => void
  triggerChapterDone: (chapterId: string) => void
}

export function usePetPerception(): UsePetPerception {
  const petSettings = useUiStore((s) => s.settings?.pet)
  const petEnabled = petSettings?.enabled ?? false
  const perceptionMinChars = petSettings?.perceptionMinChars ?? 50
  const idleSeconds = petSettings?.perceptionIdleSeconds ?? 2
  const triggerFreq = petSettings?.triggerFrequency ?? 'normal'

  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const currentChapterId = useWorkStore((s) => s.currentChapterId)
  const works: Work[] = useWorkStore((s) => s.works)

  const engineStateRef = useRef(initEngineState())
  const rulesRef = useRef<PetRule[]>(buildRules())
  const [item, setItem] = useState<InspirationItem | null>(null)
  const [materials, setMaterials] = useState<{ characters: Character[]; foreshadowings: Foreshadowing[] }>({
    characters: [],
    foreshadowings: []
  })

  // 加载当前作品的素材库（character + foreshadowings）
  useEffect(() => {
    if (!currentWorkId) return
    let cancelled = false
    void (async () => {
      try {
        const chars = await window.api.material.characters(currentWorkId)
        const fores = await window.api.material.foreshadowings(currentWorkId)
        if (!cancelled) setMaterials({ characters: chars, foreshadowings: fores })
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentWorkId])

  const throttleRef = useRef<CharThrottle | null>(null)

  useEffect(() => {
    throttleRef.current = new CharThrottle(
      idleSeconds * 1000,
      perceptionMinChars,
      FREQ_COOLDOWN[triggerFreq]
    )
    const th = throttleRef.current
    th.onTrigger = (snapshot, full) => {
      runWhenIdle(async () => {
        if (!currentWorkId || !currentChapterId) return
        const ctx = buildContext(currentWorkId, currentChapterId, snapshot, full, works, materials)
        const r = evaluateRules(ctx, rulesRef.current, engineStateRef.current)
        if (!r) return
        engineStateRef.current = r.nextState
        setItem(r.item)
        void pushInspiration(r.item)
        // P0-3.2：AI 灵感增强（不影响本地规则的 cooldown；由 AI 自身节流）
        const aiSettings = useUiStore.getState().settings?.pet
        if (aiSettings?.allowAiInspiration && r.item.severity !== 'info') {
          const recent = full.split(/\n+/).filter(Boolean).slice(-3).join('\n')
          const ai = await generateAiInspiration({
            chapterId: currentChapterId,
            recentParagraphs: recent,
            summary: '',
            characters: ctx.characters.slice(0, 3).map((c) => c.name).join(', '),
            foreshadowings: ctx.foreshadowings.slice(0, 3).map((f) => f.content).join(' | ')
          })
          if (ai) {
            setItem(ai)
            void pushInspiration(ai)
          }
        }
      })
    }
    return () => th.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleSeconds, perceptionMinChars, triggerFreq, currentChapterId, currentWorkId])

  useEffect(() => {
    if (!petEnabled) {
      setItem(null)
      engineStateRef.current = initEngineState()
    }
  }, [petEnabled])

  return useMemo(
    () => ({
      item,
      onTextChange: (text) => {
        if (!petEnabled) return
        throttleRef.current?.feed(text)
      },
      triggerRandom: () => {
        if (!petEnabled || !currentChapterId) return
        runWhenIdle(() => {
          if (!currentWorkId || !currentChapterId) return
          const ctx = buildContext(currentWorkId, currentChapterId, '', '', works, materials)
          const r = evaluateRules(ctx, rulesRef.current, engineStateRef.current)
          if (!r) return
          engineStateRef.current = r.nextState
          setItem(r.item)
          void pushInspiration(r.item)
        })
      },
      triggerChapterDone: (chapterId) => {
        if (!petEnabled) return
        runWhenIdle(() => {
          const ctx: PetPerceptionContext = {
            chapterId,
            recentText: '',
            fullText: '',
            characters: [],
            foreshadowings: [],
            chapterIndexMap: {},
            currentChapterIndex: 0
          }
          const rule = rulesRef.current.find((x) => x.id === 'chapter-done')
          if (!rule) return
          const r = evaluateRules(ctx, [rule], engineStateRef.current)
          if (!r) return
          engineStateRef.current = r.nextState
          setItem(r.item)
          void pushInspiration(r.item)
        })
      }
    }),
    [item, petEnabled, currentChapterId, currentWorkId, works, materials]
  )
}

/** 构造规则引擎所需的 context */
function buildContext(
  _workId: string,
  chapterId: string,
  recentText: string,
  fullText: string,
  works: ReadonlyArray<Work> | undefined,
  materials: { characters: Character[]; foreshadowings: Foreshadowing[] }
): PetPerceptionContext {
  const work = works?.[0]
  const chapterIndexMap: Record<string, number> = {}
  const allChapters: Chapter[] = []
  if (work?.volumes) {
    for (const v of work.volumes) {
      for (const c of v.chapters ?? []) {
        allChapters.push(c)
      }
    }
  }
  let counter = 1
  for (const c of allChapters) {
    chapterIndexMap[c.id] = counter++
  }
  const currentChapterIndex = chapterIndexMap[chapterId] ?? 0

  const characters = (materials.characters ?? []).map((c) => {
    const lastApp = (c.appearances ?? []).map((id) => chapterIndexMap[id] ?? 0)
    const lastSeen = lastApp.length > 0 ? Math.max(...lastApp) : 0
    return { name: c.name, lastSeenChapterIndex: lastSeen }
  })

  const foreshadowings = (materials.foreshadowings ?? []).map((f) => ({
    id: f.id,
    content: f.content,
    status: f.status,
    plantedChapterId: f.chapterId ?? ''
  }))

  return {
    chapterId,
    recentText,
    fullText,
    characters,
    foreshadowings,
    chapterIndexMap,
    currentChapterIndex
  }
}