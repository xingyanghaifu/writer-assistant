import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import { useJobsStore } from '../store/jobs'
import { useWorkStore } from '../store/work'
import type { BookBreakdownProject, BookBreakdownChapter, ChapterRhythm, StyleReport, BreakdownOutlineNode } from '@shared/bookBreakdown'
import { runPipeline, summarizeChapter, analyzeStyle, analyzeRhythm, generateOutline, generateRewritePrompt, runOutlineImitationLoop } from '../services/breakdownPipeline'
import { EmptyState } from './ui'

interface ProjectSummary {
  id: string
  title: string
  updatedAt: number
  status: string
  progress: number
}

/**
 * 拆书工作台（v3 模块三）— UI 顶层。
 *
 * 当前会话实现：
 *  - 项目列表
 *  - 创建（选 TXT/MD/DOCX/EPUB/PDF → 自动分章）
 *  - 删除 / 暂停 / 继续 / 导出 JSON
 *  - 章节列表 + 详情预览
 *
 * AI 流水线、断点续拆、结果入库、提示词生成：后续阶段。
 */
export function BookBreakdownPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const currentWorkId = useWorkStore((s) => s.currentWorkId)
  const works = useWorkStore((s) => s.works)
  const [list, setList] = useState<ProjectSummary[]>([])
  const [current, setCurrent] = useState<BookBreakdownProject | null>(null)
  const [chapter, setChapter] = useState<BookBreakdownChapter | null>(null)

  async function refresh(): Promise<void> {
    const l = await window.api.bookBreakdown.list()
    setList(l as ProjectSummary[])
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function open(id: string): Promise<void> {
    const p = await window.api.bookBreakdown.get(id)
    setCurrent(p as BookBreakdownProject)
    setChapter(null)
  }

  async function createFromFile(): Promise<void> {
    const r = await window.api.bookBreakdown.create({ title: '' }) as { ok: boolean; data?: BookBreakdownProject; error?: string; warning?: string }
    if (r.ok) {
      const proj = r.data as BookBreakdownProject
      const tip = r.warning ? `（提示：${r.warning}）` : ''
      showToast(`已创建项目并自动分章：${proj.chapters.length} 章${tip}`, 'success')
      await refresh()
      await open(proj.id)
    } else if (r.error !== '已取消') showToast(r.error ?? '创建失败', 'error')
  }

  async function remove(id: string, title: string): Promise<void> {
    if (!window.confirm(`删除项目「${title}」？\n项目数据将被永久删除。`)) return
    const r = await window.api.bookBreakdown.remove(id)
    if (r.ok) {
      showToast('已删除', 'success')
      if (current?.id === id) {
        setCurrent(null)
        setChapter(null)
      }
      await refresh()
    } else showToast(r.error, 'error')
  }

  async function togglePause(): Promise<void> {
    if (!current) return
    const fn = current.status === 'paused' ? window.api.bookBreakdown.resume : window.api.bookBreakdown.pause
    const r = await fn(current.id)
    if (r.ok) {
      showToast(current.status === 'paused' ? '已继续' : '已暂停', 'info')
      await open(current.id)
    } else showToast(r.error, 'error')
  }

  async function exportJson(): Promise<void> {
    if (!current) return
    const r = await window.api.bookBreakdown.exportJson(current.id)
    if (r.ok) {
      const blob = new Blob([r.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${current.title}-breakdown.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('已导出', 'success')
    } else showToast(r.error, 'error')
  }

  async function startAnalysis(): Promise<void> {
    if (!current) return
    const r = await window.api.bookBreakdown.start(current.id)
    if (!r.ok) {
      showToast(r.error, 'error')
      return
    }
    const jobId = 'breakdown:' + current.id
    const jobs = useJobsStore.getState()
    const fresh0 = await window.api.bookBreakdown.get(current.id)
    const proj0 = fresh0 as BookBreakdownProject
    jobs.start({
      id: jobId,
      kind: 'breakdown',
      title: current.title + ' · 拆书流水线',
      message: 'AI 流水线已启动',
      canPause: true,
      steps: proj0.chapters.slice(0, 12).map((c) => ({
        id: c.id,
        label: '第 ' + c.index + ' 章 ' + c.title,
        status: c.analysisStatus === 'done' ? 'done' : 'pending'
      }))
    })
    void (async () => {
      const fresh = await window.api.bookBreakdown.get(current.id)
      if (!fresh) return
      const proj = fresh as BookBreakdownProject
      const startIdx = proj.chapters.findIndex((c) => c.analysisStatus !== 'done')
      const result = await runPipeline(proj, startIdx >= 0 ? startIdx : 0, {
        onChapter: (ch, index, total, ok, fromCache) => {
          jobs.setStep(jobId, ch.id, {
            status: ok ? 'done' : 'failed',
            detail: ok ? (fromCache ? '命中缓存' : '已摘要') : '失败'
          })
          jobs.patch(jobId, {
            progress: (index + 1) / total,
            message: '第 ' + (index + 1) + '/' + total + ' 章' + (ok ? '完成' : '失败')
          })
        }
      })
      jobs.finish(jobId, result.failed && !result.processed ? 'failed' : 'done', '完成：' + result.processed + ' 成功，' + result.failed + ' 失败，' + result.cached + ' 命中缓存')
      showToast('完成：' + result.processed + ' 成功，' + result.failed + ' 失败，' + result.cached + ' 命中缓存', 'success')
      await open(current.id)
    })()
  }

  async function summarizeOneChapter(): Promise<void> {
    if (!current || !chapter) return
    const proj = (await window.api.bookBreakdown.get(current.id)) as BookBreakdownProject
    const r = await summarizeChapter(proj, chapter)
    if (r.ok) {
      showToast(r.fromCache ? '命中缓存' : '完成', 'success')
    } else {
      showToast(r.reason ?? '失败', 'error')
    }
  }

  async function importToMaterials(): Promise<void> {
    if (!current) return
    const target = works.find((w) => w.id === currentWorkId) ?? works[0]
    if (!target) {
      showToast('请先创建至少一个作品', 'error')
      return
    }
    const ok = window.confirm(
      `导入到作品「${target.title}」？\n已分析的角色与关键事件会进素材库（按 name 去重）。`
    )
    if (!ok) return
    const r = await window.api.bookBreakdown.importToMaterials(current.id, target.id)
    if (r.ok) showToast(`已添加 ${(r.data as { added: number }).added} 项`, 'success')
    else showToast(r.error, 'error')
  }

  async function toggleDesensitize(): Promise<void> {
    if (!current) return
    const next = !current.anonymized
    if (next) {
      const ok = window.confirm(
        '开启脱敏模式？\nAI 调用将只发送章节标题、字数、段落数、对话/描写比例等结构信息，不发送原文。\n提示：脱敏模式下 AI 只能分析结构，不能分析具体内容。'
      )
      if (!ok) return
    }
    const r = await window.api.bookBreakdown.patch(current.id, { anonymized: next })
    if (!r.ok) {
      showToast(r.error ?? '保存失败', 'error')
      return
    }
    setCurrent({ ...current, anonymized: next })
    showToast(next ? '已开启脱敏模式' : '已关闭脱敏模式', 'info')
  }

  async function runStyle(): Promise<void> {
    if (!current) return
    showToast('风格分析中…', 'info')
    const r = await analyzeStyle(current.id)
    if (r) showToast(`风格标签：${r.styleTags.join(', ') || '无'}`, 'success')
    else showToast('失败', 'error')
  }
  async function runRhythm(): Promise<void> {
    if (!current) return
    showToast('节奏评分中…', 'info')
    const r = await analyzeRhythm(current.id)
    if (r) showToast(`节奏分析完成（${r.length} 章）`, 'success')
    else showToast('失败', 'error')
  }
  async function runOutline(): Promise<void> {
    if (!current) return
    showToast('大纲生成中…', 'info')
    const r = await generateOutline(current.id)
    if (r) showToast(`大纲生成完成（${r.length} 节点）`, 'success')
    else showToast('失败', 'error')
  }
  async function runImitationLoop(): Promise<void> {
    if (!current) return
    const ch = chapter ?? current.chapters[0]
    if (!ch) {
      showToast('请先选一章', 'error')
      return
    }
    const jobId = 'imitate:' + current.id + ':' + ch.id
    const jobs = useJobsStore.getState()
    jobs.start({
      id: jobId,
      kind: 'imitate',
      title: current.title + ' · ' + ch.title,
      message: '准备从原文抽细纲',
      canPause: true,
      steps: [
        { id: 'beats', label: '从原文抽细纲', status: 'pending' },
        { id: 'r1', label: '第 1 轮仿写对照', status: 'pending' },
        { id: 'r2', label: '第 2 轮仿写对照', status: 'pending' },
        { id: 'r3', label: '第 3 轮仿写对照', status: 'pending' },
        { id: 'r4', label: '第 4 轮仿写对照', status: 'pending' }
      ]
    })
    jobs.setStep(jobId, 'beats', { status: 'running', detail: '抽取场景 / 冲突 / 转折 / 钩子' })
    try {
      const r = await runOutlineImitationLoop({
        projectId: current.id,
        chapterId: ch.id,
        maxRounds: 4,
        targetScore: 78,
        onRound: (round) => {
          jobs.setStep(jobId, 'beats', { status: 'done' })
          const sid = 'r' + round.round
          jobs.setStep(jobId, sid, {
            status: round.score >= 78 ? 'done' : 'running',
            score: round.score,
            detail: (round.gaps && round.gaps.length ? round.gaps.join('；') : '结构对照完成') + (round.changelog.length ? '｜' + round.changelog.join('；') : '')
          })
          jobs.patch(jobId, { progress: Math.min(1, round.round / 4), message: '第 ' + round.round + ' 轮：' + round.score + ' 分' })
          jobs.log(jobId, '第 ' + round.round + ' 轮 ' + round.score + ' 分')
        }
      })
      jobs.setStep(jobId, 'beats', { status: r.beatSheet ? 'done' : 'failed', detail: r.beatSheet ? (r.beatSheet.beats.length + ' 个节拍') : '细纲抽取失败' })
      const reason = r.stoppedReason === 'reached' ? '已达标' : r.stoppedReason === 'max-rounds' ? '达到轮次上限' : r.stoppedReason === 'cancelled' ? '已暂停' : 'AI 失败'
      jobs.finish(jobId, r.stoppedReason === 'cancelled' ? 'paused' : r.bestScore > 0 || r.stoppedReason === 'reached' ? 'done' : 'failed', '最高 ' + r.bestScore + ' 分（' + reason + '，共 ' + r.rounds.length + ' 轮）')
      showToast('结束：最高 ' + r.bestScore + ' 分（' + reason + '）', r.bestScore >= 78 ? 'success' : 'info')
    } catch (err) {
      jobs.finish(jobId, 'failed', err instanceof Error ? err.message : '迭代失败')
      showToast('细纲迭代失败', 'error')
    }
  }

  /** 批量：对未分析的章节依次跑细纲迭代 */
  async function runBatchImitation(): Promise<void> {
    if (!current) return
    const targets = current.chapters.slice(0, 5)
    if (targets.length === 0) {
      showToast('没有可迭代的章节', 'error')
      return
    }
    if (!window.confirm(`对 ${targets.length} 章依次做细纲迭代？\n每章最多 4 轮，串行执行；可在右下角进度里停止。`)) return
    const jobId = 'imitate-batch:' + current.id
    const jobs = useJobsStore.getState()
    jobs.start({
      id: jobId,
      kind: 'imitate',
      title: current.title + ' · 批量细纲迭代',
      message: '准备批量执行',
      canPause: true,
      steps: targets.map((c) => ({ id: c.id, label: '第 ' + c.index + ' 章 ' + c.title, status: 'pending' }))
    })
    let done = 0
    for (let i = 0; i < targets.length; i++) {
      const ch = targets[i]
      const live = await window.api.bookBreakdown.get(current.id)
      if (live && (live as BookBreakdownProject).status === 'paused') {
        jobs.finish(jobId, 'paused', '已暂停，完成 ' + done + ' 章')
        return
      }
      jobs.setStep(jobId, ch.id, { status: 'running' })
      jobs.patch(jobId, { progress: i / targets.length, message: '第 ' + (i + 1) + '/' + targets.length + ' 章：' + ch.title })
      try {
        const r = await runOutlineImitationLoop({
          projectId: current.id,
          chapterId: ch.id,
          maxRounds: 3,
          targetScore: 78,
          onRound: (round) => {
            jobs.log(jobId, ch.title + ' 第 ' + round.round + ' 轮 ' + round.score + ' 分')
          }
        })
        jobs.setStep(jobId, ch.id, { status: r.bestScore > 0 ? 'done' : 'failed', score: r.bestScore })
        done++
      } catch {
        jobs.setStep(jobId, ch.id, { status: 'failed' })
      }
      jobs.patch(jobId, { progress: (i + 1) / targets.length })
      await new Promise((res) => setTimeout(res, 600))
    }
    jobs.finish(jobId, 'done', '批量完成：' + done + '/' + targets.length + ' 章')
    showToast('批量细纲迭代完成（' + done + '/' + targets.length + '）', 'success')
  }

  async function runRewrite(): Promise<void> {
    if (!current) return
    showToast('仿写提示词生成中…', 'info')
    const r = await generateRewritePrompt(current.id)
    if (r) {
      // 写入提示词库
      const item = {
        id: r.id,
        name: `仿写：${current.title}`,
        category: '灵感' as const,
        description: `由拆书项目「${current.title}」自动生成`,
        content: r.content,
        variables: ['outline', 'characters', 'tone', 'length'],
        tags: ['拆书生成'],
        favorite: false,
        enabled: true,
        order: 0,
        actionType: 'inspiration' as const,
        siteScope: [],
        version: 1,
        custom: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        useCount: 0
      }
      const save = await window.api.promptLibrary.save(item)
      if (save.ok) showToast('已加入提示词库（灵感分类）', 'success')
      else showToast(save.error, 'error')
    } else showToast('失败', 'error')
  }

  useEffect(() => {
    let lastShownAt = 0
    return window.api.bookBreakdown.onProgress((p: unknown) => {
      const payload = p as { projectId: string; status: string; message?: string; progress: number; chapterIndex?: number }
      if (!current || payload.projectId !== current.id) return
      // P3-6.2：进度事件节流 500ms
      const now = Date.now()
      if (now - lastShownAt < 500 && payload.status !== 'done' && payload.status !== 'failed') return
      lastShownAt = now
      showToast(payload.message ?? payload.status, payload.status === 'failed' ? 'error' : 'info')
      // 重读项目以反映进度
      void open(current.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  return (
    <div
      className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wa-modal flex h-[min(52rem,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(64rem,calc(100vw-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">📚 拆书工作台</h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-xs hover:bg-black/5 wa-interactive">✕</button>
        </div>

        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
          {/* 左：项目列表 */}
          <div className="flex w-52 min-h-0 shrink-0 flex-col gap-1">
            <button
              onClick={createFromFile}
              className="rounded bg-ink-800 px-2 py-1 text-[11px] text-white hover:bg-ink-900 wa-interactive"
            >
              ➕ 导入文件创建项目
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto rounded border" style={{ borderColor: 'var(--wa-border)' }}>
              {list.length === 0 ? (
                <EmptyState icon="📚" title="暂无拆书项目" description="点击上方「导入文件创建项目」，支持 TXT / MD / DOCX / EPUB / PDF" className="!p-6" />
              ) : (
                list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => open(p.id)}
                    className={`flex w-full flex-col items-start gap-0.5 border-b px-2 py-1.5 text-left text-[11px] hover:bg-black/5 wa-interactive ${
                      current?.id === p.id ? 'bg-ink-800/10' : ''
                    }`}
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    <span className="truncate font-medium">{p.title}</span>
                    <div className="flex w-full items-center gap-1 text-[10px] wa-muted">
                      <span>{p.status}</span>
                      <span>·{(p.progress * 100).toFixed(0)}%</span>
                      <div className="flex-1" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void remove(p.id, p.title)
                        }}
                        className="rounded px-1 text-rose-700 hover:bg-rose-50"
                      >
                        ✕
                      </button>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 中：章节列表 */}
          <div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto rounded border p-1" style={{ borderColor: 'var(--wa-border)' }}>
            {current ? (
              current.chapters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChapter(c)}
                  className={`flex items-start gap-1 rounded border px-1.5 py-1 text-left text-[11px] hover:bg-black/5 wa-interactive ${
                    chapter?.id === c.id ? 'bg-ink-800/10' : ''
                  }`}
                  style={{ borderColor: 'var(--wa-border)' }}
                >
                  <span className="wa-muted">{c.index}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="text-[10px] wa-muted">{c.analysisStatus}</span>
                </button>
              ))
            ) : (
              <div className="self-center p-3 text-center text-[11px] wa-muted">选个项目</div>
            )}
          </div>

          {/* 右：详情 */}
          <div className="flex min-w-0 flex-1 flex-col gap-1 rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
            {!current ? (
              <div className="flex h-full items-center justify-center text-[11px] wa-muted">选个项目查看章节</div>
            ) : (
              <>
                {current.extras && <ProjectExtras extras={current.extras} chapters={current.chapters} />}
                <div className="flex items-center gap-2 text-[12px]">
                  <strong className="truncate">{current.title}</strong>
                  <span className="text-[10px] wa-muted">·{current.chapters.length} 章</span>
                  <div className="flex-1" />
                  <button
                    onClick={togglePause}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    {current.status === 'paused' ? '继续' : '暂停'}
                  </button>
                  <button
                    onClick={startAnalysis}
                    className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900 wa-interactive"
                    disabled={current.status === 'running'}
                  >
                    ▶ 开始 AI 拆解
                  </button>
                  <button
                    onClick={exportJson}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                  >
                    导出 JSON
                  </button>
                  <button
                    onClick={importToMaterials}
                    className="rounded border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900 hover:bg-emerald-100 wa-interactive"
                  >
                    ⬇ 入素材库
                  </button>
                  <button
                    onClick={runStyle}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="风格分析"
                  >
                    🎨 风格
                  </button>
                  <button
                    onClick={runRhythm}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="节奏曲线"
                  >
                    📈 节奏
                  </button>
                  <button
                    onClick={runOutline}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="大纲生成"
                  >
                    🌳 大纲
                  </button>
                  <button
                    onClick={runRewrite}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="仿写提示词"
                  >
                    ✍ 仿写
                  </button>
                  <button
                    onClick={() => void runImitationLoop()}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="从原文抽细纲，再迭代提示词直到仿写接近原文结构"
                  >
                    🔁 细纲迭代
                  </button>
                  <button
                    onClick={() => void runBatchImitation()}
                    className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 wa-interactive"
                    style={{ borderColor: 'var(--wa-border)' }}
                    title="对前 5 章依次跑细纲迭代，串行执行"
                  >
                    🔁 批量迭代
                  </button>
                  <button
                    onClick={toggleDesensitize}
                    className={`rounded px-2 py-0.5 text-[11px] wa-interactive ${
                      current.anonymized ? 'border border-amber-400 bg-amber-50 text-amber-900' : 'border hover:bg-black/5'
                    }`}
                    style={current.anonymized ? undefined : { borderColor: 'var(--wa-border)' }}
                    title="脱敏模式：只发结构，不发原文"
                  >
                    {current.anonymized ? '🛡 脱敏开' : '🛡 脱敏'}
                  </button>
                </div>
                {chapter ? (
                  <>
                    <div className="text-[11px] font-medium">第 {chapter.index} 章：{chapter.title}</div>
                    <div className="flex items-center gap-2 text-[10px] wa-muted">
                      <span>状态：{chapter.analysisStatus}</span>
                      <span>·{chapter.content.length} 字</span>
                    </div>
                    {chapter.summary && (
                      <div className="rounded bg-black/[0.04] p-2 text-[11px] leading-relaxed">
                        <strong>摘要：</strong>
                        {chapter.summary}
                      </div>
                    )}
                    {chapter.keyEvents && chapter.keyEvents.length > 0 && (
                      <div className="text-[11px]">
                        <strong>关键事件：</strong>
                        <ul className="ml-4 list-disc">
                          {chapter.keyEvents.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {chapter.rhythm && <RhythmBars r={chapter.rhythm} />}
                    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-2 font-mono text-[10px] leading-relaxed">
                      {chapter.content.slice(0, 3000)}
                      {chapter.content.length > 3000 && `\n…（共 ${chapter.content.length} 字）`}
                    </pre>
                    <div className="flex justify-end">
                      <button
                        onClick={summarizeOneChapter}
                        disabled={chapter.analysisStatus === 'running'}
                        className="rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 wa-interactive"
                        style={{ borderColor: 'var(--wa-border)' }}
                      >
                        🤖 总结本章
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] wa-muted">选个章节查看</div>
                )}
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900" style={{ borderColor: 'var(--wa-border)' }}>
                  ⚠ 合规提示：仅个人学习、研究、评论使用；不传播拆书结果全文；不绕过付费墙 / DRM / 登录；
                  导入书籍本地保存，不上传整本；AI 调用只发必要分块，且可通过脱敏模式只发结构。
                  AI 流水线、断点续拆、结果入库、提示词生成在后续阶段实现。
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
          <button onClick={onClose} className="rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900 wa-interactive">关闭</button>
        </div>
      </div>
    </div>
  )
}

/** 章节节奏条（轻量 SVG，无依赖） */
function RhythmBars({ r }: { r: ChapterRhythm }): JSX.Element {
  const pct = (n: number): number => Math.max(0, Math.min(100, n * 10))
  return (
    <div className="grid grid-cols-3 gap-2 text-[10px] wa-muted">
      {(['tension', 'emotion', 'hook'] as const).map((k) => (
        <div key={k}>
          <div className="flex items-center justify-between">
            <span>{k === 'tension' ? '紧张度' : k === 'emotion' ? '情绪' : '钩子'}</span>
            <span>{r[k]}/10</span>
          </div>
          <svg width="100%" height="6" viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-0.5">
            <rect x="0" y="0" width="100" height="6" fill="rgba(0,0,0,0.08)" rx="3" />
            <rect x="0" y="0" width={pct(r[k])} height="6" fill="#0f172a" rx="3" />
          </svg>
        </div>
      ))}
    </div>
  )
}

/** 项目级别的风格 / 大纲展示 */
function ProjectExtras({ extras, chapters }: { extras: BookBreakdownProject['extras']; chapters: BookBreakdownChapter[] }): JSX.Element | null {
  if (!extras) return null
  return (
    <div className="rounded border p-2 text-[11px]" style={{ borderColor: 'var(--wa-border)' }}>
      {extras.style && (
        <div>
          <strong>风格：</strong>
          <span>标签 [{extras.style.styleTags.join(', ') || '无'}]</span>
          <span className="ml-2">视角 [{extras.style.pov}]</span>
          {extras.style.topWords.length > 0 && (
            <span className="ml-2">高频词：{extras.style.topWords.slice(0, 5).map((w: { word: string; count: number }) => `${w.word}(${w.count})`).join('、')}</span>
          )}
        </div>
      )}
      {extras.rhythm && extras.rhythm.length > 0 && (
        <div className="mt-1">
          <strong>节奏曲线：</strong>
          <svg width="100%" height="40" viewBox={`0 0 ${extras.rhythm.length * 20} 40`} className="mt-0.5">
            {(['tension', 'emotion', 'hook'] as const).map((k, ki) => (
              <polyline
                key={k}
                fill="none"
                stroke={ki === 0 ? '#dc2626' : ki === 1 ? '#2563eb' : '#16a34a'}
                strokeWidth="1.5"
                points={extras.rhythm!
                  .map((r, i) => `${i * 20 + 10},${40 - (r[k] * 4)}`)
                  .join(' ')}
              />
            ))}
          </svg>
          <div className="flex gap-3 text-[10px] wa-muted">
            <span><span className="inline-block h-2 w-2 rounded-full bg-red-600 align-middle" /> 紧张</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-blue-600 align-middle" /> 情绪</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-green-600 align-middle" /> 钩子</span>
          </div>
        </div>
      )}
      {extras.outline && extras.outline.length > 0 && (
        <div className="mt-1">
          <strong>大纲（{extras.outline.length} 节点）：</strong>
          <ul className="ml-4 list-disc">
            {extras.outline.slice(0, 8).map((o: BreakdownOutlineNode) => (
              <li key={o.id}>
                {o.title} <span className="wa-muted">— {o.summary.slice(0, 50)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-1 text-[10px] wa-muted">{chapters.filter((c) => c.analysisStatus === 'done').length} 章已分析</div>
    </div>
  )
}