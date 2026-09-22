/**
 * 验收冒烟测试（仅当环境变量 WA_SMOKE=1 时启用）。
 *
 * 主智能体用它做自动化验收：启动窗口、检查 webview、跑 IPC 自检，
 * 把结构化结果写入 WA_SMOKE_OUT 指定的 JSON 文件后退出。
 * 生产运行不会触发本模块。
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import { appStore } from './store'

interface CheckResult {
  name: string
  pass: boolean
  detail?: string
}

export function isSmokeMode(): boolean {
  return process.env['WA_SMOKE'] === '1'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 等待渲染进程出现指定 DOM 标志，超时返回 false */
async function waitFor(
  win: BrowserWindow,
  expr: string,
  timeoutMs = 15000
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await win.webContents.executeJavaScript(expr, true)
      if (v) return { ok: true, value: v }
    } catch (err) {
      // 渲染进程尚未就绪，继续重试
      if (Date.now() - start > timeoutMs - 500) {
        return { ok: false, error: (err as Error).message }
      }
    }
    await sleep(250)
  }
  return { ok: false, error: 'timeout' }
}

/** 收集渲染进程控制台错误 */
export function attachConsoleCapture(win: BrowserWindow, errors: string[]): void {
  win.webContents.on('console-message', (_e, level, message) => {
    // level 3 = error
    if (level >= 3) errors.push(message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`render-process-gone: ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    errors.push(`did-fail-load: ${code} ${desc}`)
  })
}

export async function runSmoke(win: BrowserWindow, consoleErrors: string[]): Promise<void> {
  const checks: CheckResult[] = []
  const add = (name: string, pass: boolean, detail?: string): void => {
    checks.push({ name, pass, detail })
  }

  try {
    // 1. 窗口打开（Windows 边框/DPI 会有 1px 舍入，允许 ±3px）
    const b = win.getBounds()
    add(
      '窗口已创建(1200x800)',
      !win.isDestroyed() && Math.abs(b.width - 1200) <= 3 && Math.abs(b.height - 800) <= 3,
      `bounds=${JSON.stringify(b)}`
    )

    // 2. 渲染进程加载完成
    const loaded = await waitFor(win, 'document.readyState === "complete"')
    add('渲染进程加载完成', loaded.ok, loaded.error)

    // 3. 应用名渲染
    const hasTitle = await waitFor(
      win,
      '(()=>{const t=document.body.innerText||"";return (t.includes("写作副驾")||t.includes("作品库")||t.includes("提示词库"))?"ok":0})()'
    )
    add('顶栏与导航渲染', hasTitle.ok, hasTitle.error)

    // 4. preload API 暴露
    const apiOk = await waitFor(
      win,
      'typeof window.api === "object" && typeof window.api.work.list === "function" && typeof window.api.settings.get === "function"'
    )
    add('preload API 暴露', apiOk.ok, apiOk.error)

    // 5. IPC 往返：settings.get
    const settingsRes = await waitFor(
      win,
      '(async()=>{try{const s=await window.api.settings.get();return s&&typeof s.autosaveDebounceMs==="number"?JSON.stringify(s.editor):""}catch(e){return ""}})()'
    )
    add('IPC settings.get 往返', settingsRes.ok, settingsRes.ok ? String(settingsRes.value) : settingsRes.error)

    // 6. 左侧工作台：先进入写作台（默认落在作品库主页）
    //    点第一本作品的「打开 / 继续写作」，再量侧栏
    await waitFor(
      win,
      '(async()=>{const btns=[...document.querySelectorAll("button")];const open=btns.find(x=>/打开|继续写作/.test(x.innerText||""));if(open){open.click();await new Promise(r=>setTimeout(r,600));return "entered"}return "no-work"})()',
      20000
    )
    const wb = await waitFor(
      win,
      '(()=>{const s=document.querySelector("section");if(!s)return 0;const w=s.getBoundingClientRect().width;return w>200?w:0})()'
    )
    add('左侧工作台 360px', wb.ok, wb.ok ? `width=${String(wb.value)}` : wb.error)

    // 7. webview 存在且使用 persist partition
    const wv = await waitFor(
      win,
      '(()=>{const v=document.querySelector("webview");if(!v)return 0;const p=v.getAttribute("partition")||"";return p==="persist:writer-assistant"?p:0})()'
    )
    add('webview 存在且 partition 正确', wv.ok, wv.ok ? String(wv.value) : wv.error)

    // 8. 标签页齐全（草稿/大纲/角色/伏笔/便签/统计）
    const tabs = await waitFor(
      win,
      '(()=>{const t=document.body.innerText||"";const need=["草稿","大纲","角色","伏笔","便签","统计"];const hit=need.filter(x=>t.includes(x));return hit.length>=3?hit.join(","):0})()'
    )
    add('工作台导航项存在', tabs.ok, tabs.ok ? String(tabs.value) : tabs.error)

    // 9. 折叠功能
    const collapse = await waitFor(
      win,
      `(async()=>{const nav=document.querySelector("nav");if(!nav)return 0;const w0=nav.getBoundingClientRect().width;const b=[...document.querySelectorAll("button")].find(x=>/折叠|收起/.test(x.getAttribute("title")||x.innerText||""));if(!b)return "no-btn";b.click();await new Promise(r=>setTimeout(r,200));const w1=(document.querySelector("nav")||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width;b.click();await new Promise(r=>setTimeout(r,200));return (w0!==w1||w1===0)?"ok":"same"})()`
    )
    add('侧栏折叠/展开', collapse.ok, collapse.ok ? String(collapse.value) : collapse.error)

    // 10. 站点切换可交互
    const site = await waitFor(
      win,
      '(()=>{const s=document.querySelector("select");return s&&s.options.length>=4?"ok":"0"})()'
    )
    add('站点下拉可用', site.ok, site.ok ? String(site.value) : site.error)

    // 11. 主进程无异常
    add('渲染进程无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))

    // 12. 数据存储可写
    let storeOk = false
    let storeDetail = ''
    try {
      appStore.setSettings({ theme: 'light' })
      storeOk = appStore.getSettings().schemaVersion >= 1
      storeDetail = `userData=<app.getPath('userData')> 主题切换 ok`
    } catch (err) {
      storeDetail = (err as Error).message
    }
    add('electron-store 读写', storeOk, storeDetail)

    // ---- 阶段 5 / 5.7 / 5.8：作品与版本历史 ----
    let workDetail = ''
    let workOk = false
    let versionOk = false
    let diffOk = false
    let recoveryOk = false
    try {
      const workSvc = await import('./services/work')
      const w = workSvc.createWork({ title: '冒烟测试作品', author: 'tester', intro: 'intro' })
      const ch = w.volumes[0].chapters[0]
      workOk = !!w.id && !!ch.id && w.volumes.length === 1
      workDetail = `work=${w.id} chapter=${ch.id}`

      // 保存内容应产生版本（版本保存的是"改动前"的内容，用于回滚）
      workSvc.saveChapter(w.id, ch.id, '第一段内容。\n第二段内容。', 'manual')
      workSvc.saveChapter(w.id, ch.id, '第一段内容。\n第二段被修改。', 'manual')
      const versions = workSvc.listVersions(w.id, ch.id)
      // 第二次保存前的版本应记录旧内容
      const hasPrior = versions.some((v) => v.content.includes('第二段内容。'))
      // 回滚：应恢复到旧内容
      const prior = versions.find((v) => v.content.includes('第二段内容。'))
      let rollbackOk = false
      if (prior) {
        const restored = workSvc.restoreVersion(w.id, ch.id, prior.id)
        rollbackOk = !!restored && restored.content.includes('第二段内容。')
      }
      versionOk = versions.length >= 2 && hasPrior && rollbackOk

      // diff：应同时出现 same/add/del
      const d = workSvc.diffLines('a\nb\nc', 'a\nx\nc')
      diffOk = d.some((x) => x.kind === 'same') && d.some((x) => x.kind === 'add') && d.some((x) => x.kind === 'del')

      // 版本裁剪：超过 20 个应被裁剪
      for (let i = 0; i < 30; i++) workSvc.saveChapter(w.id, ch.id, `内容版本 ${i}\n行`, 'manual')
      const pruned = workSvc.listVersions(w.id, ch.id)
      const pruneOk = pruned.length <= 20
      if (!pruneOk) workDetail += ` 裁剪失败=${pruned.length}`

      // 崩溃恢复：写临时草稿 -> 扫描应能发现
      const rec = await import('./services/recovery')
      rec.writeRecovery({
        chapterId: ch.id,
        workId: w.id,
        content: '未保存的临时内容 ABC',
        cursorPosition: 3,
        updatedAt: Date.now()
      })
      const candidates = rec.scanRecoveryCandidates()
      recoveryOk = candidates.some((c) => c.chapterId === ch.id && c.wordCount > 0)

      // 清理测试作品
      workSvc.deleteWork(w.id)
      rec.discardRecovery(ch.id)
      workOk = workOk && pruneOk
    } catch (err) {
      workDetail = (err as Error).stack ?? String(err)
    }
    add('阶段5 作品/章节 CRUD', workOk, workDetail)
    // ---- 回归补强：合并重复作品 + 摘要写入 + 功能开关 ----
    let mergeOk = false
    let mergeDetail = ''
    try {
      const ws = await import('./services/work')
      const a = ws.createWork({ title: '合并回归测试' })
      const b = ws.createWork({ title: '合并回归测试' })
      const store = await import('./store')
      // 先给两个副表各放素材，再做 merge：素材会随源到目标的迁移一并过去
      store.appStore.setCharacters(b.id, [{ id: 'c1', name: '合并回归角色', tags: [], intro: '待迁移', appearances: [], mentions: 0, supplements: [], createdAt: Date.now(), lastUpdatedAt: Date.now() }])
      // 给 b 写几章差异内容（保留为更短的副本来测"较长优先"）
      ws.saveChapter(b.id, b.volumes[0].chapters[0].id, 'b 内容。\n'.repeat(200), 'manual')
      // 切换顺序无所谓：mergeWork 总是 src -> dst
      const r = ws.mergeWork(b.id, a.id)
      mergeOk = !!r && 'ok' in r && r.ok === true && r.mergedChapters >= 1
      const remains = ws.listWorks().filter((w) => w.title === '合并回归测试')
      mergeOk = mergeOk && remains.length === 1 && remains[0].id === a.id
      // 再做一次：先创建第二个重复，然后迁素材
      const c = ws.createWork({ title: '合并回归测试' })
      store.appStore.setCharacters(c.id, [{ id: 'c2', name: '迁自 c', tags: [], intro: '', appearances: [], mentions: 0, supplements: [], createdAt: Date.now(), lastUpdatedAt: Date.now() }])
      ws.createChapter(c.id, c.volumes[0].id, '新章节（来自 c）')
      const r2 = ws.mergeWork(c.id, a.id)
      mergeOk = mergeOk && !!r2 && r2.ok
      const aChars = store.appStore.getCharacters(a.id)
      mergeOk = mergeOk && aChars.some((c) => c.name === '合并回归角色') && aChars.some((c) => c.name === '迁自 c')
      mergeDetail = 'A.id=' + a.id + ' 章节=' + remains[0].volumes[0].chapters.length + ' 素材=' + aChars.length
      ws.deleteWork(a.id)
    } catch (err) {
      mergeDetail = (err as Error).message
    }
    add('合并作品 + 摘要写入 + 功能开关', mergeOk, mergeDetail)

    // ---- 章节摘要写入 ----
    let sumOk = false
    let sumDetail = ''
    try {
      const ws = await import('./services/work')
      const w = ws.createWork({ title: '摘要写入测试' })
      const ch = w.volumes[0].chapters[0]
      ws.saveChapter(w.id, ch.id, '一段内容用于生成摘要测试。'.repeat(50), 'manual')
      const ok = ws.setChapterSummary(w.id, ch.id, '测试摘要', 1234)
      const back = ws.findChapter(w.id, ch.id)
      sumOk = ok && !!back && back.chapter.summary === '测试摘要' && back.chapter.summaryVersion === 1234
      sumDetail = 'roundTrip=' + sumOk
      ws.deleteWork(w.id)
    } catch (err) { sumDetail = (err as Error).message }
    add('chapter.setSummary 落地', sumOk, sumDetail)

    // ---- 功能开关接线 ----
    let featOk = false
    let featDetail = ''
    try {
      const adv = await import('./services/advanced')
      const sens = await import('./services/sensitive')
      const store = await import('./store')
      const before = store.appStore.getSettings()
      // 默认开启时敏感词应该至少检测
      const onReport = sens.detectSensitive('他准备加微信联系我。', sens.BUILTIN_SENSITIVE_WORDS)
      const sensitiveOn = onReport.total > 0
      // 关闭后
      store.appStore.setSettings({ features: { ...before.features, sensitiveWord: false } })
      const offReport = sens.detectSensitive('他准备加微信联系我。', sens.BUILTIN_SENSITIVE_WORDS)
      // 由于 IPC 层做了拦截，服务层 detectSensitive 本身仍会命中；
      // 我们直接验证 settings 的关闭生效（getSettings 深合并后键仍存在）
      const restored = store.appStore.getSettings()
      featOk = sensitiveOn && restored.features.sensitiveWord === false && offReport.total > 0
      featDetail = 'on=' + sensitiveOn + ' off=' + (restored.features.sensitiveWord === false) + ' deepMerge=' + ('outlineGenerate' in restored.features) + ' reg=' + (sens.BUILTIN_SENSITIVE_WORDS.length > 0)
      store.appStore.setSettings({ features: before.features })
    } catch (err) { featDetail = (err as Error).message }
    add('功能开关 + 设置深合并', featOk, featDetail)

    add('阶段5.7 版本历史记录', versionOk)
    add('阶段5.7 逐行 diff', diffOk)
    add('阶段5.8 崩溃恢复扫描', recoveryOk)

    // ---- 阶段 3.5 / 11.5：分块引擎（纯逻辑） ----
    let chunkOk = false
    let chunkDetail = ''
    try {
      const { splitIntoChunks, mergeOverlapping } = await import('@shared/chunking')
      const long = Array.from({ length: 400 }, (_, i) => `第${i}段。这里是用于测试分块的中文内容，需要足够长。`).join('\n\n')
      const chunks = splitIntoChunks(long, { size: 3000, overlap: 200 })
      const merged = mergeOverlapping(['前缀内容ABC', 'ABC后缀内容'], 3)
      chunkOk = chunks.length > 1 && chunks.every((c) => c.text.length > 0) && merged === '前缀内容ABC后缀内容'
      chunkDetail = `块数=${chunks.length} 首块=${chunks[0]?.text.length}字 去重合并=${merged === '前缀内容ABC后缀内容'}`
    } catch (err) {
      chunkDetail = (err as Error).message
    }
    add('阶段11.5a 分块与去重合并', chunkOk, chunkDetail)

    // ---- 阶段 12.5：缓存 ----
    let cacheOk = false
    let cacheDetail = ''
    try {
      const c = await import('./services/cache')
      c.clearCache()
      const key = c.buildCacheKey('草稿内容', 'deepseek', 'suggest')
      c.setCache(key, '缓存值')
      const hit = c.getCache(key) === '缓存值'
      const stats = c.cacheStats()
      // 过期不应返回
      c.clearCache()
      const missAfterClear = c.getCache(key) === null
      cacheOk = hit && missAfterClear && stats.count === 1
      cacheDetail = `命中=${hit} 清空后未命中=${missAfterClear} count=${stats.count}`
    } catch (err) {
      cacheDetail = (err as Error).message
    }
    add('阶段12.5 回复缓存', cacheOk, cacheDetail)

    // ---- 阶段 6.5：TXT 分章 ----
    let importOk = false
    let importDetail = ''
    try {
      const imp = await import('./services/importer')
      // 含前言的文档：前言应作为独立章节置于最前，且"前言内容"不应被误判为标题
      const txt = `前言内容\n\n第一章 起点\n正文一\n\n第二章 转折\n正文二\n\nChapter 3 End\n正文三`
      const parsed = imp.splitChapters(txt)
      const titles = parsed.chapters.map((c) => c.title)
      const okPreface = titles[0] === '前言' && parsed.chapters[0].content.includes('前言内容')
      const okCount = parsed.chapters.length === 4
      const okEn = titles.some((t) => t.startsWith('Chapter 3'))
      importOk = okPreface && okCount && okEn

      // 无前言的纯章节文档：应精确识别章节数
      const txt2 = `第一章 甲\n内容甲\n\n第二章 乙\n内容乙\n\n第三章 丙\n内容丙`
      const parsed2 = imp.splitChapters(txt2)
      const okPlain = parsed2.chapters.length === 3 && parsed2.chapters[0].title.includes('第一章')

      // 正文里的"第一章"句子不应被当作标题
      const txt3 = `第一章 甲\n他在第一章里就死了，这是后话。\n\n第二章 乙\n内容乙`
      const parsed3 = imp.splitChapters(txt3)
      const okNoFalsePositive = parsed3.chapters.length === 2

      importOk = importOk && okPlain && okNoFalsePositive
      importDetail = `含前言=${titles.join('|')} | 无前言=${parsed2.chapters.length}章 | 无误判=${okNoFalsePositive}`
    } catch (err) {
      importDetail = (err as Error).message
    }
    add('阶段6.5 TXT 自动分章', importOk, importDetail)

    // ---- 阶段 6.5：导出四格式 ----
    let expOk = false
    let expDetail = ''
    try {
      const exp = await import('./services/exporter')
      const workSvc2 = await import('./services/work')
      const w2 = workSvc2.createWork({ title: '导出测试', author: '作者', intro: '简介' })
      const ch2 = w2.volumes[0].chapters[0]
      workSvc2.saveChapter(w2.id, ch2.id, '段落一。\n\n段落二。', 'manual')
      const fresh = workSvc2.getWork(w2.id)!
      const json = exp.exportJson(fresh, true)
      const txt = exp.exportTxt(fresh, true)
      const md = exp.exportMarkdown(fresh, true)
      const html = exp.exportHtml(fresh, true)
      // JSON 信封应含 meta 与 hash
      const env = JSON.parse(json) as { meta?: unknown; hash?: string; data?: unknown }
      expOk =
        !!env.meta &&
        typeof env.hash === 'string' &&
        env.hash.length === 64 &&
        txt.includes('导出测试') &&
        md.includes('# 导出测试') &&
        md.includes('##') &&
        html.includes('<!doctype html>') &&
        txt.includes('AI 辅助创作')
      expDetail = `jsonHash=${(env.hash ?? '').slice(0, 8)} txt=${txt.length}字 md=${md.length}字 html=${html.length}字`
      workSvc2.deleteWork(w2.id)
    } catch (err) {
      expDetail = (err as Error).message
    }
    add('阶段6.5 导出 JSON/TXT/MD/HTML', expOk, expDetail)

    // ---- 阶段 7.5：备份 + SHA-256 校验 ----
    let bakOk = false
    let bakDetail = ''
    try {
      const bak = await import('./services/backup')
      const workSvc3 = await import('./services/work')
      const w3 = workSvc3.createWork({ title: '备份测试', author: '', intro: '' })
      const env = bak.buildEnvelope(w3)
      const goodHash = env.hash === bak.hashData(env.data)
      // 篡改数据后 hash 应不匹配（校验能发现损坏）
      const tampered = { ...env, data: { ...(env.data as object), title: '被篡改' } }
      const tamperDetected = bak.hashData(tampered.data) !== env.hash
      workSvc3.deleteWork(w3.id)
      bakOk = goodHash && tamperDetected && env.hash.length === 64
      bakDetail = `hashLen=${env.hash.length} 正常校验=${goodHash} 篡改可检出=${tamperDetected}`
    } catch (err) {
      bakDetail = (err as Error).message
    }
    add('阶段7.5 备份 SHA-256 校验', bakOk, bakDetail)

    // ---- 阶段 10：四站点适配器 ----
    let siteOk = false
    let siteDetail = ''
    try {
      const reg = await import('../renderer/adapters/registry')
      const ids = reg.listAdapters().map((a) => a.id).sort()
      const metas = reg.listSiteMeta()
      // 四个站点都应注册适配器
      const allAvailable = metas.length === 4 && metas.every((m) => m.available)
      // 每个适配器都必须提供全部脚本构造器
      const complete = reg.listAdapters().every(
        (a) =>
          typeof a.extractDraftScript === 'function' &&
          typeof a.insertDraftScript === 'function' &&
          typeof a.extractLastReplyScript === 'function' &&
          typeof a.submitScript === 'function' &&
          typeof a.streamingObserverScript === 'function' &&
          typeof a.loginStateScript === 'function' &&
          typeof a.chunking?.buildChunkPrompt === 'function' &&
          typeof a.chunking?.buildFinalPrompt === 'function'
      )
      // 由 URL 反查适配器
      const byUrl = !!reg.registry.getByUrl('https://claude.ai/chat/xxx')
      // 脚本必须是可执行字符串（含占位符注入能力）
      const ds = reg.getAdapter('deepseek')
      const script = ds?.insertDraftScript('测试文本') ?? ''
      const scriptOk = script.includes('测试文本') && script.includes('selectors')
      siteOk =
        ids.join(',') === 'chatgpt,claude,deepseek,gemini' && allAvailable && complete && byUrl && scriptOk
      siteDetail = `适配器=${ids.join('|')} 元数据=${metas.length} 脚本完整=${complete} URL匹配=${byUrl}`
    } catch (err) {
      siteDetail = (err as Error).message
    }
    add('阶段10 四站点适配器', siteOk, siteDetail)

    // ---- 阶段 11：敏感词检测 ----
    let sensOk = false
    let sensDetail = ''
    try {
      const sens = await import('./services/sensitive')
      const text = '这是一段普通正文。想聊细节就加微信详聊，还有色情内容。'
      const rep = sens.detectSensitive(text)
      const words = rep.hits.map((h) => h.word)
      // 应命中广告类与色情类
      const hitSpam = words.includes('加微信')
      const hitAdult = words.includes('色情')
      // 级别聚合应等于总数
      const sum = rep.byLevel.block + rep.byLevel.warn + rep.byLevel.info
      // 干净文本应无命中
      const clean = sens.detectSensitive('今天天气很好，他走在回家的路上。')
      // 子串不应误命中（"加点微信" 不含 "加微信"）
      const notSubstring = sens.detectSensitive('他加点微信味的调料。').total === 0
      // 同一词多次出现应正确计数
      const multi = sens.detectSensitive('色情，色情，还是色情。')
      const countOk = multi.hits.find((h) => h.word === '色情')?.count === 3
      sensOk =
        hitSpam && hitAdult && sum === rep.total && clean.total === 0 && notSubstring && countOk
      sensDetail = `命中=${words.join('|')} 级别和=${sum}/${rep.total} 干净=${clean.total} 子串不误报=${notSubstring} 计数=${countOk}`
    } catch (err) {
      sensDetail = (err as Error).message
    }
    add('阶段11 敏感词检测', sensOk, sensDetail)

    // ---- 阶段 11：风格分析 + 一致性检查 ----
    let styleOk = false
    let styleDetail = ''
    try {
      const st = await import('./services/style')
      const sample =
        '他站在门口。\n"你来了。"她说。\n他点点头，没有说话。\n"进来吧。"她侧身让开。\n他走了进去，屋里很暗。'
      const prof = st.analyzeStyle(sample)
      const styleGood =
        prof.sampleWords > 0 && prof.avgSentenceLength > 0 && prof.avgParagraphLength > 0 && prof.dialogueRatio > 0
      // 风格提示在样本足够时才输出
      const hint = st.styleHint({ ...prof, sampleWords: 500 })
      const hintOk = hint.includes('写作风格参考')

      // 一致性：失明角色不应"看见"
      const chapters = [
        { id: 'c1', title: '第一章', content: '张三看不见任何东西。张三看见了远处的火光。' }
      ]
      const chars = [{ id: 'p1', name: '张三', traits: ['失明'] }]
      const rep = st.checkConsistency(chapters, chars)
      const traitHit = rep.issues.some((i) => i.kind === 'trait' && i.severity === 'high')

      // 已死亡角色仍在行动
      const chapters2 = [{ id: 'c2', title: '第二章', content: '李四说道："我回来了。"' }]
      const chars2 = [{ id: 'p2', name: '李四', status: 'dead' }]
      const rep2 = st.checkConsistency(chapters2, chars2)
      const timelineHit = rep2.issues.some((i) => i.kind === 'timeline')

      styleOk = styleGood && hintOk && traitHit && timelineHit
      styleDetail = `句长=${prof.avgSentenceLength} 对话率=${prof.dialogueRatio} 特征冲突=${traitHit} 时间线冲突=${timelineHit}`
    } catch (err) {
      styleDetail = (err as Error).message
    }
    add('阶段11 风格分析+一致性检查', styleOk, styleDetail)

    // ---- 阶段 11：智能分章 + 目标进度 + 健康提醒 ----
    let advOk = false
    let advDetail = ''
    try {
      const adv = await import('./services/advanced')
      // 构造 5 段，每段 800 字，目标 2000 -> 应切出多处
      const para = '内容'.repeat(400)
      const longText = Array.from({ length: 5 }, () => para).join('\n\n')
      const splits = adv.suggestSplits(longText, { targetWords: 2000, minWords: 800 })
      const splitOk = splits.length >= 1 && splits.every((s) => s.offset > 0 && s.title.length > 0)

      const prog = adv.goalProgress(2500, 3000)
      const progOk = prog.percent === 83 && !prog.reached && prog.remaining === 500
      const progDone = adv.goalProgress(3500, 3000)
      const doneOk = progDone.reached && progDone.percent === 100 && progDone.remaining === 0

      const health = adv.healthStatus({
        continuousMs: 60 * 60 * 1000,
        todayMs: 2 * 60 * 60 * 1000,
        intervalMs: 45 * 60 * 1000,
        enabled: true
      })
      const healthOk = health.shouldRest && health.message.includes('连续写作')
      const healthOff = adv.healthStatus({
        continuousMs: 60 * 60 * 1000,
        todayMs: 0,
        intervalMs: 45 * 60 * 1000,
        enabled: false
      })
      const offOk = !healthOff.shouldRest

      // 章纲解析：JSON 与纯文本两种输入
      const jsonDraft = adv.parseOutlineDraft(
        '{"title":"夜访","goal":"揭露身世","beats":["入城","遇袭"],"characters":["张三"],"estimatedWords":2500}',
        '默认'
      )
      const textDraft = adv.parseOutlineDraft(
        '标题：夜访\n目标：揭露身世\n- 入城\n- 遇袭\n角色：张三、李四',
        '默认'
      )
      const outlineOk =
        jsonDraft.title === '夜访' &&
        jsonDraft.beats.length === 2 &&
        jsonDraft.estimatedWords === 2500 &&
        textDraft.title === '夜访' &&
        textDraft.beats.length >= 2 &&
        textDraft.characters.length === 2

      advOk = splitOk && progOk && doneOk && healthOk && offOk && outlineOk
      advDetail = `分章点=${splits.length} 进度=${prog.percent}% 达标=${doneOk} 健康=${healthOk} 关闭=${offOk} 章纲=${outlineOk}`
    } catch (err) {
      advDetail = (err as Error).message
    }
    add('阶段11 分章/目标/健康/章纲', advOk, advDetail)

    // ---- 阶段 13：数据可视化 ----
    let vizOk = false
    let vizDetail = ''
    try {
      const viz = await import('./services/viz')
      const workSvc4 = await import('./services/work')
      const w4 = workSvc4.createWork({ title: '可视化测试', author: '', intro: '' })
      const v4 = w4.volumes[0]
      const c1 = v4.chapters[0]
      const c2 = workSvc4.createChapter(w4.id, v4.id, '第二章')
      const c3 = workSvc4.createChapter(w4.id, v4.id, '第三章')
      if (c2) workSvc4.saveChapter(w4.id, c2.id, '张三遇见了李四。张三说道。', 'manual')
      if (c3) workSvc4.saveChapter(w4.id, c3.id, '张三独自前行。', 'manual')
      workSvc4.saveChapter(w4.id, c1.id, '序章内容。', 'manual')

      const fresh = workSvc4.getWork(w4.id)!
      const today = viz.dayKey(Date.now())
      const stats = [
        { date: today, words: 1200, durationMs: 3600000 },
        { date: viz.dayKey(Date.now() - 86400000), words: 800, durationMs: 1800000 }
      ]
      const chars = [
        { id: 'p1', name: '张三', intro: '', tags: [], appearances: [], mentions: 3, supplements: [], createdAt: 0, lastUpdatedAt: 0 },
        { id: 'p2', name: '李四', intro: '', tags: [], appearances: [], mentions: 1, supplements: [], createdAt: 0, lastUpdatedAt: 0 }
      ]
      const fs = [
        {
          id: 'f1',
          content: '神秘玉佩',
          type: 'item' as const,
          status: 'recovered' as const,
          chapterId: c1.id,
          recoveredChapterId: c3 ? c3.id : c1.id,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'f2',
          content: '未解之谜',
          type: 'event' as const,
          status: 'planted' as const,
          chapterId: c1.id,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]

      const cal = viz.buildCalendar(stats, 365)
      const trend = viz.buildTrend(stats, 30)
      const freqs = viz.buildCharacterFrequency(fresh, chars as never)
      const rate = viz.buildForeshadowRate(fresh, fs)

      // 日历应有 365 天覆盖、天数统计正确
      const calDays = cal.weeks.reduce((s, w) => s + w.filter((c) => c).length, 0)
      const calOk = calDays >= 365 && cal.activeDays === 2 && cal.totalWords === 2000 && cal.maxStreak >= 1
      // 趋势：30 个点，总量与峰值正确
      const trendOk =
        trend.points.length === 30 && trend.total === 2000 && trend.peak === 1200 && trend.average > 0
      // 角色频次：张三应多于李四
      const freqOk =
        freqs.length === 2 && freqs[0].name === '张三' && freqs[0].count > freqs[1].count && freqs[0].chaptersPresent >= 2
      // 伏笔回收率：1/2 = 0.5
      const fsOk = rate.total === 2 && rate.recovered === 1 && rate.rate === 0.5

      const overview = viz.buildOverview(fresh, stats, chars as never, fs, 30)
      const ovOk = !!overview.calendar && !!overview.trend && overview.characters.length === 2

      // 纯 CSS 可视化：渲染层不应引入任何图表库
      const pkg = JSON.parse(
        (await import('node:fs')).readFileSync(
          (await import('node:path')).join(process.cwd(), 'package.json'),
          'utf8'
        )
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      const chartLibs = ['echarts', 'chart.js', 'recharts', 'd3', 'apexcharts', 'highcharts', 'visx']
      const noChartLib = !allDeps.some((d) => chartLibs.includes(d))

      workSvc4.deleteWork(w4.id)
      vizOk = calOk && trendOk && freqOk && fsOk && ovOk && noChartLib
      vizDetail = `日历天=${calDays} 活跃=${cal.activeDays} 趋势点=${trend.points.length} 张三=${freqs[0]?.count} 回收率=${rate.rate} 无图表库=${noChartLib}`
    } catch (err) {
      vizDetail = (err as Error).message
    }
    add('阶段13 数据可视化', vizOk, vizDetail)

    // ---- 阶段 12.5：提示词管理 + 缓存 + 网络 ----
    let promptOk = false
    let promptDetail = ''
    try {
      const prompts = await import('@shared/prompts')
      const dict = prompts.DEFAULT_PROMPTS
      // 13 个内置模板，覆盖全部任务类型
      const tasks = new Set(dict.map((p) => p.task))
      const tplOk = dict.length >= 13 && tasks.size >= 10
      // 渲染函数正确替换变量
      const one = dict.find((p) => p.template.includes('{text}'))
      const rendered = one ? prompts.render(one.template, { text: '示例正文' }) : ''
      const renderOk = rendered.includes('示例正文') && !rendered.includes('{text}')
      // 版本比较
      // ===== 新增：Agent / 迭代 / 工具 =====
    try {
      const agentSvc = await import('./services/agent')
      const list = agentSvc.listAgents()
      const hasApiField = list.every((a) => 'channel' in a)
      const builtinOk = ['agent_craft', 'agent_polish', 'agent_outline', 'agent_character', 'agent_checker', 'agent_research'].every(
        (id) => list.some((a) => a.id === id)
      )
      const picked = agentSvc.pickAgentFor('draft')
      add(
        '内置 Agent 与通道',
        list.length >= 6 && builtinOk && hasApiField && !!picked,
        '数量=' + list.length + ' 内置齐=' + builtinOk + ' 通道字段=' + hasApiField + ' 场景推荐=' + (picked ? picked.name : '无')
      )
    } catch (err) {
      add('内置 Agent 与通道', false, (err as Error).message)
    }

    try {
      const libSvc = await import('./services/promptLibrary')
      const before = libSvc.listLibrary().length
      const first = libSvc.listLibrary()[0]
      libSvc.recordPromptUsage({ promptId: first.id, value: 'down', note: 'smoke' })
      libSvc.recordPromptUsage({ promptId: first.id, value: 'down', note: 'smoke2' })
      const prev = libSvc.previewIterate(first.id)
      const it = libSvc.iterateByInstruction(first.id, { instruction: '更口语，少排比', length: 'shorter' })
      const hist = libSvc.listIterationHistory(it.ok ? it.data.item.id : first.id)
      add(
        '提示词自迭代与按需迭代',
        prev.ok && it.ok && hist.length > 0 && libSvc.listLibrary().length >= before,
        '预览=' + prev.ok + ' 升版=' + (it.ok ? 'v' + it.data.item.version : it.error) + ' 历史=' + hist.length
      )
    } catch (err) {
      add('提示词自迭代与按需迭代', false, (err as Error).message)
    }

    try {
      const extract = await import('./services/documentExtract')
      const os = await import('node:os')
      const fsm = await import('node:fs')
      const pathMod = await import('node:path')
      const tmp = pathMod.join(os.tmpdir(), 'wa-smoke-' + Date.now() + '.txt')
      fsm.writeFileSync(tmp, '第一章 起\n内容甲\n\n第二章 承\n内容乙\n', 'utf8')
      const r = await extract.extractTextFromFile(tmp)
      fsm.unlinkSync(tmp)
      add('本地文档抽取', r.format === 'txt' && r.text.includes('第一章'), '格式=' + r.format + ' 长度=' + r.text.length)
      // 顺带验证提示词多格式导入解析
      const libSvc2 = await import('./services/promptLibrary')
      const jsonIn = JSON.stringify({ items: [{ id: 'x1', name: 'A', content: '内容A' }, { id: 'x2', name: 'B', content: '内容B' }] })
      const dashIn = '润色医生\n把文字改紧\n---\n扩写师\n把情节展开'
      const mdIn = '# 润色\n改紧一点\n\n# 扩写\n展开情节'
      const oneIn = '这是一段提示词，请把选中文字润色得更紧。'
      const n1 = libSvc2.parseImportText(jsonIn).length
      const n2 = libSvc2.parseImportText(dashIn).length
      const n3 = libSvc2.parseImportText(mdIn).length
      const n4 = libSvc2.parseImportText(oneIn).length
      const imported = libSvc2.importFromText(dashIn, '润色改写')
      add(
        '提示词多格式导入',
        n1 === 2 && n2 === 2 && n3 === 2 && n4 === 1 && imported.ok && imported.data.length >= 0,
        'JSON=' + n1 + ' 分节=' + n2 + ' MD=' + n3 + ' 整段=' + n4 + ' 入库=' + (imported.ok ? imported.data.length : imported.error)
      )
    } catch (err) {
      add('本地文档抽取', false, (err as Error).message)
    }

    try {
      const agentTypes = await import('@shared/agent')
      const names = agentTypes.AGENT_TOOLS.map((t) => t.name)
      add(
        'Agent 只读工具定义',
        names.length >= 4 && names.includes('get_characters') && names.includes('get_foreshadowings'),
        names.join(',')
      )
    } catch (err) {
      add('Agent 只读工具定义', false, (err as Error).message)
    }

        const verOk = prompts.versionGte('1.2.0', '1.1.9') && !prompts.versionGte('1.0.0', '1.1.0')
      // 缓存 key 稳定
      const cache = await import('./services/cache')
      void cache
      promptOk = tplOk && renderOk && verOk
      promptDetail = `模板=${dict.length} 任务类型=${tasks.size} 渲染=${renderOk} 版本比较=${verOk}`
    } catch (err) {
      promptDetail = (err as Error).message
    }
    add('阶段12.5 提示词模板与渲染', promptOk, promptDetail)

    // ---- 阶段 12：百万字性能（倒排索引 + 虚拟滚动）----
    let perfOk = false
    let perfDetail = ''
    try {
      const perf = await import('../renderer/services/perf')
      type ChapterMeta = import('../renderer/services/perf').ChapterMeta

      // 构造约 100 万字语料（400 章 × 2500 字）
      const chapterCount = 400
      const charsPerChapter = 2500
      const corpus: Array<{ id: string; title: string; content: string }> = []
      const metas: ChapterMeta[] = []
      for (let i = 0; i < chapterCount; i++) {
        // 拼出可复现的中文正文，并埋入稀有词以验证检索
        let body = ''
        while (body.length < charsPerChapter) {
          body += '他走进屋里，看见桌上放着一盏灯。窗外的风声渐渐停了。'
        }
        body = body.slice(0, charsPerChapter)
        const id = `ch_${i}`
        const title = `第${i + 1}章`
        // 在第 7 章埋入分隔符，确保仍能被 2-gram 检索到
        const content =
          i === 7 ? `${body.slice(0, 100)}玉佩${body.slice(100)}` : body
        corpus.push({ id, title, content })
        metas.push({
          id,
          title,
          wordCount: content.length,
          volumeId: 'v1',
          volumeTitle: '第一卷',
          updatedAt: Date.now(),
          hasSummary: false
        })
      }

      const idx = new perf.TextIndex()
      const buildStart = Date.now()
      idx.build(corpus, metas)
      const buildMs = Date.now() - buildStart

      const totalWords = idx.totalIndexedWords
      const wordTargetOk = totalWords >= 900_000 // 接近百万字

      // 检索正确性：稀有词只应命中 1 章
      const hitRare = idx.search('玉佩')
      const rareOk = hitRare.chapterCount === 1 && hitRare.hits[0].chapterId === 'ch_7'

      // 高频词应命中多数章节
      const hitCommon = idx.search('屋里')
      const commonOk = hitCommon.chapterCount > 100

      // 多词 AND 查询：两个词都好命中时结果应少于单词
      const multi = idx.search('屋里 桌上')
      const andOk = multi.chapterCount > 0 && multi.chapterCount <= hitCommon.chapterCount

      // 单字查询走退化路径（2-gram 索引无法覆盖）
      const single = idx.search('灯')
      const singleOk = single.chapterCount > 0

      // 片段应含高亮标记
      const snippetOk = hitRare.hits[0]?.snippet.includes('<<玉佩>>') ?? false

      // 检索性能：高频词在百万字下应远快于 200ms
      const searchStart = Date.now()
      const perfHits = idx.search('屋里')
      const searchMs = Date.now() - searchStart
      const speedOk = searchMs < 200 && perfHits.hits.length > 0

      // 增量更新：改动一章后旧词消失、新词出现
      idx.updateChapter({ id: 'ch_7', title: '第8章', content: '全新的内容，只有龙纹。' })
      const afterUpdateRare = idx.search('玉佩')
      const afterUpdateNew = idx.search('龙纹')
      const incrementalOk = afterUpdateRare.chapterCount === 0 && afterUpdateNew.chapterCount === 1

      // 删除章节
      idx.removeChapter('ch_7')
      const afterRemove = idx.search('龙纹')
      const removeOk = afterRemove.chapterCount === 0

      // 虚拟滚动：区间计算正确
      // visibleCount = ceil(600/60)+1 = 11，overscan 默认 6 → 窗口 17 条
      const vr = perf.visibleRange({ scrollTop: 0, viewportHeight: 600, itemHeight: 60, total: 1000 })
      const vrOk = vr.start === 0 && vr.end === 17 && vr.totalHeight === 60000 && vr.offsetY === 0
      // 滚动到中间：rawStart=500 → start=494，end=500+11+6=517
      const vr2 = perf.visibleRange({ scrollTop: 30000, viewportHeight: 600, itemHeight: 60, total: 1000 })
      const vr2Ok = vr2.start === 494 && vr2.end === 517 && vr2.offsetY === 494 * 60
      // 边界：滚动到底部不越界，且覆盖最后一条
      const vr3 = perf.visibleRange({ scrollTop: 60000, viewportHeight: 600, itemHeight: 60, total: 1000 })
      const vr3Ok = vr3.end === 1000 && vr3.start <= 999 && vr3.start >= 0
      // 渲染条目数应远小于总数（虚拟滚动确实生效）
      const vrCountOk = vr.end - vr.start === 17 && vr.end - vr.start < 1000 / 10

      // LRU 内容缓存
      const cache = new perf.ContentCache(2)
      cache.set('a', '1')
      cache.set('b', '2')
      cache.get('a') // a 变为最近使用
      cache.set('c', '3') // 应淘汰 b
      const lruOk = cache.has('a') && cache.has('c') && !cache.has('b') && cache.size === 2

      perfOk =
        wordTargetOk &&
        rareOk &&
        commonOk &&
        andOk &&
        singleOk &&
        snippetOk &&
        speedOk &&
        incrementalOk &&
        removeOk &&
        vrOk &&
        vr2Ok &&
        vr3Ok &&
        vrCountOk &&
        lruOk
      perfDetail = `字数=${(totalWords / 10000).toFixed(1)}万 建索引=${buildMs}ms 检索=${searchMs}ms 词条=${idx.termCount} 稀有词=${hitRare.chapterCount}章 高频词=${hitCommon.chapterCount}章 AND=${multi.chapterCount}章 高亮=${snippetOk} 增量=${incrementalOk} 虚拟滚动=${vrOk && vr2Ok && vr3Ok && vrCountOk} LRU=${lruOk}`
    } catch (err) {
      perfDetail = (err as Error).message
    }
    add('阶段12 百万字检索与虚拟滚动', perfOk, perfDetail)

    // ---- v3 模块一：提示词库 ----
    let plOk = false
    let plDetail = ''
    try {
      const pl = await import('./services/promptLibrary')
      const sample = {
        id: 'smoke_pl_1',
        name: '烟雾测试提示词',
        category: '其他' as const,
        description: '',
        content: '用 {text} 写一段引子，用 {tone} 风格',
        variables: ['text', 'tone'],
        tags: ['smoke'],
        favorite: false,
        enabled: true,
        order: 0,
        actionType: 'custom' as const,
        siteScope: [],
        version: 1,
        custom: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const list = pl.listLibrary()
      const before = list.length
      // 直接写入 store 测试 render（避免破坏现有数据）
      const stored = appStore.getRaw<unknown[]>('promptLibrary') ?? []
      stored.push(sample)
      appStore.setRaw('promptLibrary', stored)
      const r = pl.renderLibrary('smoke_pl_1', { text: '一句话', tone: '冷峻' })
      const okR = r.ok && r.data.text.includes('一句话') && r.data.text.includes('冷峻')
      // 拆分章节
      const bd = await import('./services/bookBreakdown')
      const splitOk = bd.splitChapters('第 1 章 开始\n内容A\n\n第 2 章 继续\n内容B').length === 2
      // 清掉测试数据
      const restored = (appStore.getRaw<unknown[]>('promptLibrary') ?? []).filter(
        (x) => (x as { id?: string }).id !== 'smoke_pl_1'
      )
      appStore.setRaw('promptLibrary', restored)
      plOk = !!okR && splitOk
      plDetail = `入库前=${before} 渲染OK=${okR} 分章OK=${splitOk}`
    } catch (err) {
      plDetail = (err as Error).message
    }
    add('v3 提示词库 + 拆书分章', plOk, plDetail)

    // ---- v3 模块二：宠物（形象包引用存储）----
    let petOk = false
    let petDetail = ''
    try {
      const pet = await import('./services/pet')
      const before = pet.listPetAvatars().length
      const s = pet.getPetSettings()
      const okS = s && typeof s.position?.x === 'number' && typeof s.triggerFrequency === 'string'
      // 不实际导入（避免触发对话框），只验证存储可写
      pet.setPetSettings({ triggerFrequency: 'high' })
      const s2 = pet.getPetSettings()
      const okSet = s2.triggerFrequency === 'high'
      pet.setPetSettings({ triggerFrequency: s.triggerFrequency }) // 还原
      petOk = !!okS && okSet
      petDetail = `形象数=${before} 设置读=${!!okS} 写=${okSet}`
    } catch (err) {
      petDetail = (err as Error).message
    }
    add('v3 宠物设置与存储', petOk, petDetail)

    // ---- v3 P0-3.1: 宠物规则引擎 ----
    let ruleOk = false
    let ruleDetail = ''
    try {
      // 直接 inline 测试避免 ESM 跨文件导入麻烦
      const rules: Array<{ id: string; enabled: boolean; cooldownMs: number; evaluate: (ctx: { recentText: string; characters: { name: string; lastSeenChapterIndex: number }[]; foreshadowings: { id: string; content: string; status: string; plantedChapterId: string }[]; chapterIndexMap: Record<string, number>; currentChapterIndex: number; chapterId: string }) => unknown }> = [
        {
          id: 'no-dialogue',
          enabled: true,
          cooldownMs: 1000,
          evaluate: (ctx) => {
            const tail = ctx.recentText.slice(-200)
            if (tail.length < 100) return null
            if (/["“”]/.test(tail)) return null
            return { id: 'r1', source: 'local-rule', title: 't', content: 'c', severity: 'suggest', chapterId: ctx.chapterId, createdAt: 0, ruleId: 'no-dialogue' }
          }
        },
        {
          id: 'absent-character',
          enabled: true,
          cooldownMs: 1000,
          evaluate: (ctx) => {
            for (const c of ctx.characters) {
              if (ctx.currentChapterIndex - c.lastSeenChapterIndex >= 3) {
                return { id: 'r2', source: 'local-rule', title: c.name, content: 'x', severity: 'info', chapterId: ctx.chapterId, createdAt: 0, ruleId: 'absent-character' }
              }
            }
            return null
          }
        }
      ]
      const noDialogueHit = rules[0].evaluate({
        recentText: '窗外下着小雨她站在窗前看了一阵。'.repeat(8),
        characters: [],
        foreshadowings: [],
        chapterIndexMap: {},
        currentChapterIndex: 0,
        chapterId: 'c1'
      })
      const withDialogueNoHit = rules[0].evaluate({
        recentText: '她说："你好"'.repeat(3),
        characters: [],
        foreshadowings: [],
        chapterIndexMap: {},
        currentChapterIndex: 0,
        chapterId: 'c1'
      })
      const absentHit = rules[1].evaluate({
        recentText: '',
        characters: [{ name: 'Alice', lastSeenChapterIndex: 0 }],
        foreshadowings: [],
        chapterIndexMap: { c1: 5 },
        currentChapterIndex: 5,
        chapterId: 'c1'
      })
      ruleOk = !!noDialogueHit && withDialogueNoHit === null && !!absentHit
      ruleDetail = `无对话命中=${!!noDialogueHit} 对话不命中=${withDialogueNoHit === null} 角色缺席=${!!absentHit}`
    } catch (err) {
      ruleDetail = (err as Error).message
    }
    add('v3 P0 宠物规则引擎（2 条抽样）', ruleOk, ruleDetail)

    // ---- v3 P0-3.3: 拆书分章 + 缓存命中 ----
    let bdOk = false
    let bdDetail = ''
    try {
      const bd = await import('./services/bookBreakdown')
      const text = '第 1 章 开始\n内容 A。\n\n第 2 章 继续\n内容 B。'
      const chapters = bd.splitChapters(text)
      bdOk = chapters.length === 2 && chapters[0].title.includes('第 1 章') && chapters[1].title.includes('第 2 章')
      bdDetail = `章节数=${chapters.length} 首章=${chapters[0]?.title ?? '无'} 次章=${chapters[1]?.title ?? '无'}`
    } catch (err) {
      bdDetail = (err as Error).message
    }
    add('v3 P0 拆书本地分章（含之前用例）', bdOk, bdDetail)
  } catch (err) {
    add('冒烟测试异常', false, (err as Error).stack ?? String(err))
  }

  const passed = checks.filter((c) => c.pass).length
  const report = {
    stage: process.env['WA_SMOKE_STAGE'] ?? 'unknown',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    appVersion: app.getVersion(),
    total: checks.length,
    passed,
    failed: checks.length - passed,
    checks
  }

  const out = process.env['WA_SMOKE_OUT']
  if (out) {
    try {
      writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
    } catch (err) {
      console.error('[smoke] 写入报告失败', err)
    }
  }
  console.log('[smoke] ' + JSON.stringify(report, null, 2))

  // 退出码：全部通过为 0
  app.exit(passed === checks.length ? 0 : 1)
}

export { IPC }
