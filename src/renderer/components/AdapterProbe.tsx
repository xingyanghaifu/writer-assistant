import { useState } from 'react'
import { listAdapters, listSiteMeta, getAdapter } from '../adapters/registry'
import { useUiStore } from '../store/ui'

interface ProbeResult {
  siteId: string
  siteName: string
  /** 各选择器的命中情况 */
  rows: Array<{ label: string; selector: string; found: boolean; count: number }>
  loginState: string
  /** 输入框能否成功写入 */
  insertOk: boolean | null
  insertError?: string
  error?: string
}

/**
 * 适配器自检工具（阶段 10 配套）。
 *
 * 站点改版后选择器会失效，且失败是静默的（脚本容错返回 null）。
 * 这个面板逐个选择器实测命中情况，让你一眼看出哪个选择器过期了。
 *
 * 用法：先切换到对应站点并等页面加载完，再点「检测当前站点」。
 */
export function AdapterProbe({
  onClose,
  embedded = false
}: {
  onClose: () => void
  /** 嵌入设置面板时不需要自己的外框与标题栏 */
  embedded?: boolean
}): JSX.Element {
  const siteId = useUiStore((s) => s.siteId)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ProbeResult[]>([])
  const [writeTest, setWriteTest] = useState(false)

  /** 探测单个选择器（在主 webview 中执行） */
  async function probeSelectors(
    selectors: string[]
  ): Promise<Array<{ selector: string; count: number }>> {
    const script = `(() => {
      try {
        return ${JSON.stringify(selectors)}.map((s) => {
          try { return { selector: s, count: document.querySelectorAll(s).length }; }
          catch (e) { return { selector: s, count: -1 }; }
        });
      } catch (e) { return []; }
    })()`
    const r = await window.api.webview.execute('main', script)
    if (!r.ok) return selectors.map((s) => ({ selector: s, count: -1 }))
    return (r.value as Array<{ selector: string; count: number }>) ?? []
  }

  async function run(): Promise<void> {
    setBusy(true)
    const out: ProbeResult[] = []
    // 只检测当前站点（其他站点页面没加载，检测无意义）
    const adapter = getAdapter(siteId)
    const meta = listSiteMeta().find((m) => m.id === siteId)

    if (!adapter) {
      setResults([
        {
          siteId,
          siteName: meta?.name ?? siteId,
          rows: [],
          loginState: 'unknown',
          insertOk: null,
          error: '该站点未注册适配器'
        }
      ])
      setBusy(false)
      return
    }

    try {
      const groups: Array<[string, string[]]> = [
        ['输入框', adapter.inputSelectors],
        ['发送按钮', adapter.sendButtonSelectors],
        ['助手回复容器', adapter.assistantMessageSelectors]
      ]

      const rows: ProbeResult['rows'] = []
      for (const [label, sels] of groups) {
        const found = await probeSelectors(sels)
        for (const f of found) {
          rows.push({
            label,
            selector: f.selector,
            found: f.count > 0,
            count: f.count
          })
        }
      }

      // 登录态
      const login = await window.api.webview.loginState('main')

      // 可选：写入测试（会在输入框填入测试串，不发送）
      let insertOk: boolean | null = null
      let insertError: string | undefined
      if (writeTest) {
        const marker = `__WA_PROBE_${Date.now()}__`
        const r = await window.api.webview.execute(
          'main',
          adapter.insertDraftScript(marker)
        )
        const val = r.value as { ok?: boolean; error?: string } | undefined
        insertOk = !!val?.ok
        insertError = val?.error
      }

      out.push({
        siteId,
        siteName: adapter.name,
        rows,
        loginState: login,
        insertOk,
        insertError
      })
    } catch (err) {
      out.push({
        siteId,
        siteName: meta?.name ?? siteId,
        rows: [],
        loginState: 'unknown',
        insertOk: null,
        error: (err as Error).message
      })
    }

    setResults(out)
    setBusy(false)
  }

  return (
    <div className={embedded ? 'block' : 'wa-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-6'}>
      <div
        className={
          embedded
            ? 'flex flex-col'
            : 'flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl'
        }
      >
        {!embedded && (
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">适配器自检</h2>
            <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5 wa-interactive">
              ✕
            </button>
          </div>
        )}

        <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto text-xs ${embedded ? '' : 'p-4'}`}>
          <div className="rounded border px-2.5 py-2" style={{ borderColor: 'var(--wa-border)' }}>
            <div className="font-medium">已注册适配器</div>
            <div className="mt-1 space-y-0.5">
              {listAdapters().map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className={a.id === siteId ? 'font-semibold' : ''}>
                    {a.name}
                    {a.id === siteId && ' （当前站点）'}
                  </span>
                  <span className="wa-muted">
                    {a.chunking.mode} · 块 {a.chunking.maxChunkSize} 字
                  </span>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={writeTest}
              onChange={(e) => setWriteTest(e.target.checked)}
            />
            <span>
              同时测试写入输入框
              <span className="wa-muted">（会在输入框填入测试串，不会发送）</span>
            </span>
          </label>

          <button
            onClick={() => void run()}
            disabled={busy}
            className="rounded bg-ink-800 px-2.5 py-1 text-white disabled:opacity-50"
          >
            {busy ? '检测中…' : '检测当前站点'}
          </button>

          {results.map((r) => (
            <div key={r.siteId} className="rounded border" style={{ borderColor: 'var(--wa-border)' }}>
              <div className="flex items-center justify-between border-b px-2.5 py-1.5" style={{ borderColor: 'var(--wa-border)' }}>
                <span className="font-medium">{r.siteName}</span>
                <span className="wa-muted">登录态：{r.loginState}</span>
              </div>

              {r.error ? (
                <div className="px-2.5 py-2 text-red-600">{r.error}</div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--wa-border)' }}>
                  {r.rows.map((row, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-2.5 py-1">
                      <div className="min-w-0">
                        <span className="wa-muted">{row.label}：</span>
                        <code className="break-all text-[10px]">{row.selector}</code>
                      </div>
                      <span className={`shrink-0 ${row.found ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.count < 0 ? '选择器无效' : row.found ? `命中 ${row.count}` : '未命中'}
                      </span>
                    </div>
                  ))}
                  {r.insertOk !== null && (
                    <div className="px-2.5 py-1">
                      写入测试：
                      <span className={r.insertOk ? 'text-emerald-600' : 'text-red-600'}>
                        {r.insertOk ? '成功' : `失败（${r.insertError ?? '未知'}）`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {results.length > 0 && (
            <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-blue-800">
              <div className="font-medium">如何修复</div>
              <p className="mt-0.5">
                若某个选择器未命中，说明站点改版了。请在浏览器里右键目标元素 →
                「检查」→ 复制其 class/id，然后只改
                <code className="mx-1">src/renderer/adapters/{'{站点}'}.ts</code>
                顶部对应的选择器常量数组即可，主进程无需改动。
              </p>
            </div>
          )}
        </div>

        {!embedded && (
          <div className="flex justify-end border-t px-4 py-2.5">
            <button onClick={onClose} className="rounded px-3 py-1 text-xs hover:bg-black/5 wa-interactive">
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
