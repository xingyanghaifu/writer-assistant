import { useEffect, useState } from 'react'
import { useUiStore } from '../store/ui'
import { AGENT_SCENE_LABEL, AGENT_STYLE_LABEL, type AgentProfile, type AgentScene } from '@shared/agent'
import { listSiteMeta } from '../adapters/registry'

const SCENES: AgentScene[] = ['draft', 'polish', 'outline', 'character', 'consistency', 'research', 'general']

const EMPTY: AgentProfile = {
  id: '',
  channel: 'web',
  name: '',
  description: '',
  siteId: 'deepseek',
  systemPrompt: '',
  scenes: ['general'],
  style: 'balanced',
  enabled: true,
  custom: true,
  isDefault: false,
  createdAt: 0,
  updatedAt: 0
}

/**
 * Agent 管理面板：自选站点 + 提示词 + 场景。
 * 内置项只读，复制后可改；每个场景可设默认。
 */
export function AgentPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [list, setList] = useState<AgentProfile[]>([])
  const [draft, setDraft] = useState<AgentProfile | null>(null)
  const sites = listSiteMeta()
  const [providers, setProviders] = useState<Array<{ id: string; name: string; baseUrl: string }>>([])
  const [pvDraft, setPvDraft] = useState<{ id: string; name: string; baseUrl: string; apiKey: string } | null>(null)

  async function loadProviders(): Promise<void> {
    const st = await window.api.settings.get()
    setProviders((st.apiProviders ?? []).map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl })))
  }

  async function saveProvider(): Promise<void> {
    if (!pvDraft) return
    if (!pvDraft.name.trim() || !pvDraft.baseUrl.trim() || !pvDraft.apiKey.trim()) {
      showToast('名称 / 地址 / Key 都要填', 'error')
      return
    }
    const st = await window.api.settings.get()
    const list = (st.apiProviders ?? []).filter((x) => x.id !== pvDraft.id)
    list.push({ ...pvDraft, name: pvDraft.name.trim(), baseUrl: pvDraft.baseUrl.trim(), apiKey: pvDraft.apiKey.trim() })
    await window.api.settings.set({ apiProviders: list })
    setPvDraft(null)
    await loadProviders()
    showToast('已保存凭据', 'success')
  }

  async function testApi(): Promise<void> {
    if (!draft?.api?.providerId) {
      showToast('先选择 API 凭据', 'error')
      return
    }
    if (!draft.api.model) {
      showToast('先填模型名', 'error')
      return
    }
    const r = await window.api.agent.testApi({ providerId: draft.api.providerId, model: draft.api.model })
    showToast(r.ok ? `连接正常：${r.data.reply}` : `连接失败：${r.error}`, r.ok ? 'success' : 'error')
  }

  async function load(): Promise<void> {
    const l = await window.api.agent.list()
    setList(l ?? [])
    if (!draft && l && l[0]) setDraft(l[0])
  }
  useEffect(() => {
    void load()
    void loadProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 编辑草稿。内置项一改就自动转成自定义副本，
   * 避免"看得见改不了"，也避免污染内置预设。
   */
  function edit(next: AgentProfile): void {
    if (!draft) return
    if (!next.custom) {
      setDraft({ ...next, id: 'agent_' + Date.now().toString(36), name: next.name + ' · 改', custom: true, isDefault: false, createdAt: Date.now() })
      showToast('已转为自定义副本，改完记得保存', 'info')
      return
    }
    setDraft(next)
  }

  function select(a: AgentProfile): void {
    setDraft(a)
  }

  async function save(): Promise<void> {
    if (!draft) return
    if (!draft.name.trim()) {
      showToast('请填写 Agent 名称', 'error')
      return
    }
    const r = await window.api.agent.save(draft)
    if (!r.ok) {
      showToast(r.error || '保存失败', 'error')
      return
    }
    showToast('已保存', 'success')
    await load()
    setDraft(r.data)
  }

  async function duplicate(): Promise<void> {
    if (!draft) return
    const r = await window.api.agent.duplicate(draft.id)
    if (!r.ok) {
      showToast(r.error || '复制失败', 'error')
      return
    }
    showToast('已复制为自定义', 'success')
    await load()
    setDraft(r.data)
  }

  async function remove(): Promise<void> {
    if (!draft) return
    if (!window.confirm(`删除 Agent「${draft.name}」？`)) return
    const r = await window.api.agent.remove(draft.id)
    if (!r.ok) {
      showToast(r.error || '删除失败', 'error')
      return
    }
    setDraft(null)
    await load()
  }

  async function setDefault(): Promise<void> {
    if (!draft) return
    const scene = draft.scenes[0] ?? 'general'
    const r = await window.api.agent.setDefault(draft.id, scene)
    if (!r.ok) {
      showToast(r.error || '设置失败', 'error')
      return
    }
    showToast(`已设为「${AGENT_SCENE_LABEL[scene]}」默认`, 'success')
    await load()
  }

  function toggleScene(s: AgentScene): void {
    if (!draft) return
    const has = draft.scenes.includes(s)
    const scenes = has ? draft.scenes.filter((x) => x !== s) : [...draft.scenes, s]
    edit({ ...draft, scenes: scenes.length ? scenes : ['general'] })
  }

  return (
    <div className="wa-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/40 p-4">
      <div className="wa-modal flex h-[min(820px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(64rem,calc(100vw-1.5rem))] min-h-0 flex-col overflow-hidden rounded-lg">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--wa-border)' }}>
          <h2 className="text-sm font-semibold">AI Agent</h2>
          <span className="text-[11px] wa-muted">自选站点与提示词，按场景切换</span>
          <div className="flex-1" />
          <button
            onClick={() => setDraft({ ...EMPTY, id: 'agent_' + Date.now().toString(36) })}
            className="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-white hover:bg-ink-900"
          >
            + 新建 Agent
          </button>
          <button onClick={onClose} className="rounded px-1.5 text-sm hover:bg-black/5">✕</button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 左：列表 */}
          <div className="w-56 shrink-0 overflow-y-auto border-r" style={{ borderColor: 'var(--wa-border)' }}>
            {list.map((a) => (
              <button
                key={a.id}
                onClick={() => select(a)}
                className={`flex w-full flex-col items-start gap-0.5 border-b px-2.5 py-2 text-left text-[11px] hover:bg-black/5 ${
                  draft?.id === a.id ? 'bg-ink-800/10' : ''
                }`}
                style={{ borderColor: 'var(--wa-border)' }}
              >
                <div className="flex w-full items-center gap-1">
                  <span className="truncate font-medium">{a.name}</span>
                  {a.isDefault && <span className="rounded bg-ink-800 px-1 text-[9px] text-white">默认</span>}
                  {!a.custom && <span className="text-[9px] wa-muted">内置</span>}
                  {!a.enabled && <span className="text-[9px] text-zinc-400">停用</span>}
                </div>
                <span className="wa-muted">{sites.find((s) => s.id === a.siteId)?.name ?? a.siteId}</span>
                <span className="wa-muted">{a.scenes.map((s) => AGENT_SCENE_LABEL[s]).join(' / ')}</span>
                {a.useCount ? <span className="wa-muted">用过 {a.useCount} 次</span> : null}
                {a.totalTokens ? <span className="wa-muted">累计 {a.totalTokens} token</span> : null}
              </button>
            ))}
          </div>

          {/* 右：编辑 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            {!draft ? (
              <div className="grid h-full place-items-center text-[12px] wa-muted">选一个 Agent，或新建</div>
            ) : (
              <div className="space-y-2 text-[11px]">
                {(draft.useCount || draft.lastError) && (
                  <div className="flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--wa-border)' }}>
                    <span className="wa-muted">用过 {draft.useCount ?? 0} 次</span>
                    {draft.totalTokens ? <span className="wa-muted">· {draft.totalTokens} token</span> : null}
                    {draft.lastDurationMs ? <span className="wa-muted">· 上次 {(draft.lastDurationMs / 1000).toFixed(1)}s</span> : null}
                    {draft.lastError ? (
                      <span className="text-rose-600">· 上次失败：{draft.lastError.slice(0, 60)}</span>
                    ) : (
                      <span className="text-emerald-700">· 上次成功</span>
                    )}
                  </div>
                )}

                <label className="block">
                  <span className="mb-0.5 block wa-muted">名称</span>
                  <input
                    value={draft.name}
                    
                    onChange={(e) => edit({ ...draft, name: e.target.value })}
                    className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                    style={{ borderColor: 'var(--wa-border)' }}
                  />
                </label>

                <label className="block">
                  <span className="mb-0.5 block wa-muted">说明</span>
                  <input
                    value={draft.description}
                    
                    onChange={(e) => edit({ ...draft, description: e.target.value })}
                    className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                    style={{ borderColor: 'var(--wa-border)' }}
                  />
                </label>

                {draft.channel === 'api' && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="wa-muted">快速套用：</span>
                    {[
                      ['gpt-5.6', 'GPT-5.6'],
                      ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
                      ['deepseek-v4.1-flash', 'DeepSeek Flash'],
                      ['glm-5.3', 'GLM-5.3'],
                      ['kimi-k3', 'Kimi K3'],
                      ['qwen3.8-max', 'Qwen3.8 Max']
                    ].map(([model, label]) => (
                      <button
                        key={model}
                        
                        onClick={() => setDraft({
                          ...draft,
                          api: { providerId: draft.api?.providerId ?? '', baseUrl: '', model }
                        })}
                        className="rounded border px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                        style={{ borderColor: 'var(--wa-border)' }}
                        title={'模型名填：' + model}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <span className="mb-0.5 block wa-muted">调用通道</span>
                  <div className="flex gap-1">
                    {([['web', '网页（用已登录站点）'], ['api', 'API 直连']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        
                        onClick={() => edit({ ...draft, channel: k })}
                        className={`rounded border px-2 py-0.5 disabled:opacity-60 ${
                          (draft.channel ?? 'web') === k ? 'border-ink-800 bg-black/5 font-medium' : 'hover:bg-black/5'
                        }`}
                        style={{ borderColor: 'var(--wa-border)' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <label className="block flex-1">
                    <span className="mb-0.5 block wa-muted">{draft.channel === 'api' ? '标签站点' : '站点'}</span>
                    <select
                      value={draft.siteId}
                      
                      onChange={(e) => edit({ ...draft, siteId: e.target.value })}
                      className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                      style={{ borderColor: 'var(--wa-border)' }}
                    >
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block w-36">
                    <span className="mb-0.5 block wa-muted">输出倾向</span>
                    <select
                      value={draft.style ?? 'balanced'}
                      
                      onChange={(e) => edit({ ...draft, style: e.target.value as AgentProfile['style'] })}
                      className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                      style={{ borderColor: 'var(--wa-border)' }}
                    >
                      {Object.entries(AGENT_STYLE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div>
                  <span className="mb-0.5 block wa-muted">适用场景（可多选）</span>
                  <div className="flex flex-wrap gap-1">
                    {SCENES.map((s) => (
                      <button
                        key={s}
                        
                        onClick={() => toggleScene(s)}
                        className={`rounded border px-2 py-0.5 disabled:opacity-60 ${
                          draft.scenes.includes(s) ? 'border-ink-800 bg-black/5 font-medium' : 'hover:bg-black/5'
                        }`}
                        style={{ borderColor: 'var(--wa-border)' }}
                      >
                        {AGENT_SCENE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>

                {draft.channel === 'api' && (
                  <div className="space-y-1.5 rounded border p-2" style={{ borderColor: 'var(--wa-border)' }}>
                    <div className="text-[10px] wa-muted">API 凭据与 Agent 分开存放；这里只引用。</div>
                    <div className="flex items-center gap-1">
                      <span className="wa-muted">凭据</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setPvDraft({ id: 'pv_' + Date.now().toString(36), name: '', baseUrl: '', apiKey: '' })}
                        className="rounded border px-1.5 py-0.5 hover:bg-black/5"
                        style={{ borderColor: 'var(--wa-border)' }}
                      >
                        + 新增凭据
                      </button>
                    </div>
                    {providers.length === 0 && (
                      <div className="text-[10px] text-amber-700">还没有 API 凭据，先点「新增凭据」填写地址与 Key。</div>
                    )}
                    <label className="block">
                      <select
                        value={draft.api?.providerId ?? ''}
                        
                        onChange={(e) => edit({ ...draft, api: { providerId: e.target.value, model: draft.api?.model ?? '', baseUrl: '' } })}
                        className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--wa-border)' }}
                      >
                        <option value="">（未选择）</option>
                        {providers.map((pv) => (
                          <option key={pv.id} value={pv.id}>{pv.name} · {pv.baseUrl}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-0.5 block wa-muted">模型名</span>
                      <input
                        value={draft.api?.model ?? ''}
                        
                        onChange={(e) => edit({ ...draft, api: { providerId: draft.api?.providerId ?? '', model: e.target.value, baseUrl: '' } })}
                        placeholder="如 gpt-5.6 / deepseek-v4-pro"
                        className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--wa-border)' }}
                      />
                    </label>
                    <div className="flex gap-2">
                      <label className="block w-28">
                        <span className="mb-0.5 block wa-muted">temperature</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={draft.api?.temperature ?? 0.7}
                          
                          onChange={(e) => edit({ ...draft, api: { providerId: draft.api?.providerId ?? '', model: draft.api?.model ?? '', baseUrl: '', temperature: Number(e.target.value) } })}
                          className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      </label>
                      <label className="block w-32">
                        <span className="mb-0.5 block wa-muted">max_tokens</span>
                        <input
                          type="number"
                          min="0"
                          value={draft.api?.maxTokens ?? ''}
                          
                          onChange={(e) => edit({ ...draft, api: { providerId: draft.api?.providerId ?? '', model: draft.api?.model ?? '', baseUrl: '', maxTokens: e.target.value ? Number(e.target.value) : undefined } })}
                          className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      </label>
                      <div className="flex items-end flex-col gap-1">
                        <button
                          onClick={() => void testApi()}
                          className="rounded border px-2 py-1 hover:bg-black/5"
                          style={{ borderColor: 'var(--wa-border)' }}
                        >
                          测试连接
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <label className="flex items-center gap-1" title="允许模型先读取作品里的角色/伏笔/大纲再回答">
                        <input
                          type="checkbox"
                          checked={!!draft.api?.toolLoop}
                          
                          onChange={(e) => edit({ ...draft, api: { ...(draft.api ?? { providerId: '', model: '', baseUrl: '' }), toolLoop: e.target.checked } })}
                        />
                        工具调用（读角色/伏笔/大纲）
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!draft.api?.jsonMode}
                          
                          onChange={(e) => edit({ ...draft, api: { ...(draft.api ?? { providerId: '', model: '', baseUrl: '' }), jsonMode: e.target.checked } })}
                        />
                        强制 JSON 输出
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <label className="block w-24">
                        <span className="mb-0.5 block wa-muted">top_p</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="1"
                          value={draft.api?.topP ?? ''}
                          
                          onChange={(e) => edit({ ...draft, api: { ...(draft.api ?? { providerId: '', model: '', baseUrl: '' }), topP: e.target.value ? Number(e.target.value) : undefined } })}
                          className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      </label>
                      <label className="block w-32">
                        <span className="mb-0.5 block wa-muted">频率惩罚</span>
                        <input
                          type="number"
                          step="0.1"
                          min="-2"
                          max="2"
                          value={draft.api?.frequencyPenalty ?? ''}
                          
                          onChange={(e) => edit({ ...draft, api: { ...(draft.api ?? { providerId: '', model: '', baseUrl: '' }), frequencyPenalty: e.target.value ? Number(e.target.value) : undefined } })}
                          className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      </label>
                      <label className="block w-32">
                        <span className="mb-0.5 block wa-muted">工具轮次上限</span>
                        <input
                          type="number"
                          min="1"
                          max="4"
                          value={draft.api?.maxToolRounds ?? 2}
                          disabled={!draft.api?.toolLoop}
                          onChange={(e) => edit({ ...draft, api: { ...(draft.api ?? { providerId: '', model: '', baseUrl: '' }), maxToolRounds: Number(e.target.value) } })}
                          className="w-full rounded border px-2 py-1 outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--wa-border)' }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="mb-0.5 block wa-muted">系统提示词（每次调用都会带上）</span>
                  <textarea
                    value={draft.systemPrompt}
                    
                    onChange={(e) => edit({ ...draft, systemPrompt: e.target.value })}
                    rows={10}
                    className="w-full resize-none rounded border px-2 py-1 leading-relaxed outline-none disabled:opacity-60"
                    style={{ borderColor: 'var(--wa-border)' }}
                  />
                </label>

                <div className="flex items-center gap-2 pt-1">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      
                      onChange={(e) => edit({ ...draft, enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <div className="flex-1" />
                  <button onClick={() => void setDefault()} className="rounded border px-2 py-0.5 hover:bg-black/5" style={{ borderColor: 'var(--wa-border)' }}>
                    设为默认
                  </button>
                  <button onClick={() => void duplicate()} className="rounded border px-2 py-0.5 hover:bg-black/5" style={{ borderColor: 'var(--wa-border)' }}>
                    复制
                  </button>
                  {draft.custom && (
                    <>
                      <button onClick={() => void save()} className="rounded bg-ink-800 px-2 py-0.5 text-white hover:bg-ink-900">
                        保存
                      </button>
                      <button onClick={() => void remove()} className="rounded px-2 py-0.5 text-rose-700 hover:bg-rose-50">
                        删除
                      </button>
                    </>
                  )}
                  {!draft.custom && <span className="text-[10px] wa-muted">内置项：先复制再修改</span>}
                </div>
              </div>
            )}
          </div>
        </div>
        {pvDraft && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 p-6" onClick={() => setPvDraft(null)}>
            <div
              className="w-full max-w-md space-y-2 rounded-lg border p-3 text-[11px] wa-panel"
              style={{ borderColor: 'var(--wa-border)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[12px] font-semibold">{providers.some((x) => x.id === pvDraft.id) ? '编辑凭据' : '新增凭据'}</div>
              <label className="block">
                <span className="mb-0.5 block wa-muted">名称</span>
                <input
                  value={pvDraft.name}
                  onChange={(e) => setPvDraft({ ...pvDraft, name: e.target.value })}
                  placeholder="如：DoCode 中转"
                  className="w-full rounded border px-2 py-1 outline-none"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block wa-muted">Base URL</span>
                <input
                  value={pvDraft.baseUrl}
                  onChange={(e) => setPvDraft({ ...pvDraft, baseUrl: e.target.value })}
                  placeholder="https://docode.cc/v1"
                  className="w-full rounded border px-2 py-1 outline-none"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block wa-muted">API Key</span>
                <input
                  type="password"
                  value={pvDraft.apiKey}
                  onChange={(e) => setPvDraft({ ...pvDraft, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full rounded border px-2 py-1 outline-none"
                  style={{ borderColor: 'var(--wa-border)' }}
                />
              </label>
              <div className="text-[10px] wa-muted">只保存在本机用户数据目录，不联网同步。</div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setPvDraft(null)} className="rounded px-2 py-0.5 hover:bg-black/5">取消</button>
                <button onClick={() => void saveProvider()} className="rounded bg-ink-800 px-2 py-0.5 text-white hover:bg-ink-900">保存</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
