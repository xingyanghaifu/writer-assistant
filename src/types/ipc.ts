/**
 * IPC 通道契约 —— 主进程 / preload / 渲染进程共同遵守的唯一接口定义。
 *
 * 约定：
 *  - 渲染进程不得直接使用 Node API，只能通过 window.api 调用下列通道
 *  - 文件读写、备份、导入导出全部在主进程完成
 *  - 通道名集中定义在此，禁止在业务代码里写裸字符串
 */

import type { SiteAdapter, LoginState, ChunkProgress, ScriptResult, AdapterScripts, ChunkingSpec } from './adapter'
import type {
  Work,
  Chapter,
  ChapterVersion,
  RecoveryCandidate,
  RecoverySnapshot,
  EditorCursor
} from './work'
import type {
  Character,
  Foreshadowing,
  Outline,
  Location,
  Setting,
  Note,
  DailyStat,
  SyncExtraction,
  SyncMode
} from './material'
import type {
  AppSettings,
  ImportPreview,
  ImportResult,
  ImportStrategy,
  ExportFormat,
  BackupStatus,
  BackupEnvelope,
  RestoreStrategy,
  StorageStatus
} from './settings'
import type { TaskType, NetworkState, ConsistencyIssue, ConsistencyReport, SplitPoint, PromptTemplate } from './suggestion'
import type {
  SensitiveReport,
  SensitiveWord,
  StyleProfile,
  GoalProgress,
  HealthStatus,
  QualityFeedback,
  FeedbackSummary,
  OutlineDraft
} from './advanced'
import type { VizOverview, WritingCalendar, WordTrend } from './viz'
import type { PromptItem } from './promptLibrary'

/** 通用返回包装 */
export interface Ok<T> {
  ok: true
  data: T
}

export interface Err {
  ok: false
  error: string
  code?: string
}

export type Res<T> = Ok<T> | Err

/** 通道名常量 */
export const IPC = {
  // ---- 窗口 / 应用 ----
  appVersion: 'app:version',
  appOpenExternal: 'app:open-external',
  appPlatform: 'app:platform',
  appMinimize: 'app:minimize',
  appMaximize: 'app:maximize',
  appClose: 'app:close',
  appIsMaximized: 'app:is-maximized',
  appWindowState: 'app:window-state',

  // ---- 设置 ----
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsClearAll: 'settings:clear-all',

  // ---- webview 注入执行（阶段 2）----
  webviewExecute: 'webview:execute',
  /** 渲染进程 -> 主进程：注册 webview 的 webContentsId */
  webviewRegister: 'webview:register',
  /** 主进程 -> 渲染进程：脚本执行结果 */
  webviewScriptResult: 'webview:script-result',
  /** 主进程 -> 渲染进程：流式增量文本 */
  webviewStreamChunk: 'webview:stream-chunk',
  webviewStreamEnd: 'webview:stream-end',
  webviewLoginState: 'webview:login-state',

  // ---- 后台建议会话（阶段 3 / 4.5 / 11.5）----
  bgRequestStart: 'bg:request-start',
  bgRequestCancel: 'bg:request-cancel',
  /** 主进程 -> 渲染进程：请求状态 */
  bgRequestStatus: 'bg:request-status',
  /** 主进程 -> 渲染进程：分块进度 */
  bgChunkProgress: 'bg:chunk-progress',

  // ---- 适配器 ----
  adapterList: 'adapter:list',
  adapterSwitch: 'adapter:switch',

  // ---- 作品 / 章节（阶段 5）----
  workList: 'work:list',
  workCreate: 'work:create',
  workUpdate: 'work:update',
  workDelete: 'work:delete',
  workMerge: 'work:merge',
  workGet: 'work:get',
  workSetCurrent: 'work:set-current',
  chapterGet: 'chapter:get',
  chapterSave: 'chapter:save',
  chapterCreate: 'chapter:create',
  chapterDelete: 'chapter:delete',
  chapterRename: 'chapter:rename',
  /** 写入章节摘要（供 AI 摘要/章纲落地到 Chapter.summary） */
  chapterSetSummary: 'chapter:set-summary',
  volumeCreate: 'volume:create',
  volumeRename: 'volume:rename',
  volumeDelete: 'volume:delete',
  chapterReorder: 'chapter:reorder',

  // ---- 版本历史（阶段 5.7）----
  versionList: 'version:list',
  versionRestore: 'version:restore',
  versionMarkImportant: 'version:mark-important',
  versionDelete: 'version:delete',
  versionExport: 'version:export',

  // ---- 崩溃恢复（阶段 5.8）----
  recoveryWrite: 'recovery:write',
  recoveryScan: 'recovery:scan',
  recoveryApply: 'recovery:apply',
  recoveryDiscard: 'recovery:discard',

  // ---- 素材模块（阶段 6 / 5.6）----
  characterList: 'character:list',
  characterUpsert: 'character:upsert',
  characterDelete: 'character:delete',
  foreshadowingList: 'foreshadowing:list',
  foreshadowingUpsert: 'foreshadowing:upsert',
  foreshadowingDelete: 'foreshadowing:delete',
  outlineGet: 'outline:get',
  outlineSave: 'outline:save',
  locationList: 'location:list',
  settingList: 'setting:list',
  noteList: 'note:list',
  noteUpsert: 'note:upsert',
  noteDelete: 'note:delete',
  statList: 'stat:list',
  statAdd: 'stat:add',

  // ---- 导入导出（阶段 6.5）----
  ioPickImportFile: 'io:pick-import-file',
  ioPickDirectory: 'io:pick-directory',
  ioAnalyzeImport: 'io:analyze-import',
  ioExecuteImport: 'io:execute-import',
  ioExport: 'io:export',
  ioCancel: 'io:cancel',
  /** 主进程 -> 渲染进程：导入进度 */
  ioProgress: 'io:progress',

  // ---- 备份（阶段 7.5）----
  backupStatus: 'backup:status',
  backupRunNow: 'backup:run-now',
  backupVerify: 'backup:verify',
  backupRestore: 'backup:restore',
  backupSnapshot: 'backup:snapshot',
  backupList: 'backup:list',

  // ---- 数据存储位置 ----
  storageStatus: 'storage:status',
  storagePickDir: 'storage:pick-dir',
  storageSetDir: 'storage:set-dir',
  storageResetDir: 'storage:reset-dir',
  storageOpenDir: 'storage:open-dir',
  storageRestart: 'storage:restart',

  // ---- 提示词（阶段 12.5 / 13）----
  promptList: 'prompt:list',
  promptSave: 'prompt:save',
  promptReset: 'prompt:reset',
  promptImport: 'prompt:import',
  promptExport: 'prompt:export',
  promptCheckUpdate: 'prompt:check-update',

  // ---- 用户提示词库（v3 模块一）----
  promptLibraryList: 'prompt-library:list',
  promptLibrarySave: 'prompt-library:save',
  promptLibraryRemove: 'prompt-library:remove',
  promptLibraryDuplicate: 'prompt-library:duplicate',
  promptLibraryReorder: 'prompt-library:reorder',
  promptLibraryImport: 'prompt-library:import',
  promptLibraryImportText: 'prompt-library:import-text',
  promptLibraryExport: 'prompt-library:export',
  promptLibraryRender: 'prompt-library:render',
  promptLibraryTouch: 'prompt-library:touch',
  promptLibraryRecordUsage: 'prompt-library:record-usage',
  promptLibraryIteratePreview: 'prompt-library:iterate-preview',
  promptLibraryIterate: 'prompt-library:iterate',
  promptLibraryIterationHistory: 'prompt-library:iteration-history',
  promptLibraryAppendHistory: 'prompt-library:append-history',
  promptLibraryIterateByInstruction: 'prompt-library:iterate-by-instruction',
  promptLibraryPreviewByInstruction: 'prompt-library:preview-by-instruction',
  promptLibraryRestoreIteration: 'prompt-library:restore-iteration',

  // ---- 自定义 Agent ----
  agentList: 'agent:list',
  agentGet: 'agent:get',
  agentPick: 'agent:pick',
  agentSave: 'agent:save',
  agentRemove: 'agent:remove',
  agentDuplicate: 'agent:duplicate',
  agentSetDefault: 'agent:set-default',
  agentTouch: 'agent:touch',
  agentReset: 'agent:reset',
  agentApiCall: 'agent:api-call',
  agentTestApi: 'agent:test-api',

  // ---- 缓存（阶段 12.5）----
  cacheGet: 'cache:get',
  cacheSet: 'cache:set',
  cacheClear: 'cache:clear',
  cacheStats: 'cache:stats',

  // ---- 网络状态（阶段 12.5）----
  networkState: 'net:state',
  /** 主进程 -> 渲染进程 */
  networkChanged: 'net:changed',

  // ---- 阶段 11 进阶功能 ----
  /** 敏感词检测 */
  sensitiveCheck: 'advanced:sensitive-check',
  /** 敏感词库读取/保存 */
  sensitiveDict: 'advanced:sensitive-dict',
  sensitiveDictSet: 'advanced:sensitive-dict-set',
  /** 写作风格画像（基于草稿或整部作品） */
  styleAnalyze: 'advanced:style-analyze',
  /** 风格画像读取（缓存） */
  styleGet: 'advanced:style-get',
  /** 角色一致性检查 */
  consistencyCheck: 'advanced:consistency-check',
  /** 智能分章建议 */
  smartSplit: 'advanced:smart-split',
  /** 目标字数进度 */
  goalProgress: 'advanced:goal-progress',
  /** 设置章节目标字数 */
  goalSet: 'advanced:goal-set',
  /** 健康状态 */
  healthStatus: 'advanced:health-status',
  /** 建议质量反馈：提交 */
  feedbackSubmit: 'advanced:feedback-submit',
  /** 建议质量反馈：汇总 */
  feedbackSummary: 'advanced:feedback-summary',
  /** 一键生成章纲（解析 AI 返回） */
  outlineParse: 'advanced:outline-parse',

  // ---- 阶段 13 数据可视化 ----
  vizOverview: 'viz:overview',
  vizCalendar: 'viz:calendar',
  vizTrend: 'viz:trend',

  // ---- 主进程 -> 渲染进程：命令（菜单/快捷键）----
  command: 'app:command'
} as const

/** 请求开始参数 */
export interface BgRequestParams {
  /** 任务类型，决定提示词模板与缓存 key */
  task: TaskType
  /** 组装好的提示词 */
  prompt: string
  /** 站点 id */
  siteId: string
  /** 是否跳过缓存（重新生成时为 true） */
  skipCache?: boolean
  /** 是否分块发送 */
  chunked?: boolean
  /** 分块任务描述（最后一段"开始处理"用） */
  chunkTask?: string
  /** 待分块的长文本（不填则用 prompt） */
  chunkSource?: string
  /** 批次 id，用于关联建议批次 */
  batchId?: string
  /** 缓存 key 的附加因子（草稿 hash 等） */
  cacheKeyExtra?: string
  /** 模型标签（多模型对比） */
  modelLabel?: string
  /**
   * 渲染进程下发的注入脚本集合。
   * 主进程只执行、不理解站点细节 —— 站点改版只需改 renderer/adapters。
   */
  scripts: AdapterScripts
  /** 分块策略（可序列化），仅分块请求需要 */
  chunkingProfile?: ChunkingSpec
  /** 轮询读取回复的间隔毫秒（默认 400） */
  pollIntervalMs?: number
}

/** 主进程内部使用：附带 requestId，供取消检查 */
export interface BgRequestParamsInternal extends BgRequestParams {
  bgRequestId?: string
}

/** 请求结果 */
export interface BgRequestResult {
  requestId: string
  text: string
  fromCache: boolean
  siteId: string
  task: TaskType
  /** 分块发送时的块数（未分块为 1） */
  chunkCount?: number
  /** 是否为纯文本降级（JSON 解析由渲染进程做，这里仅标记分块降级） */
  degraded?: boolean
}

/** 导入执行参数 */
export interface ImportExecuteParams {
  filePath: string
  strategy: ImportStrategy
  targetWorkId?: string
  /** 允许的最大章节数覆盖 */
  maxChapters?: number
}

/** 导出参数 */
export interface ExportParams {
  workId: string
  format: ExportFormat
  /** 是否附带 AI 辅助创作声明 */
  includeAiNotice?: boolean
  outputPath?: string
}

/** 备份恢复参数 */
export interface BackupRestoreParams {
  filePath: string
  strategy: RestoreStrategy
}

/** 主进程 -> 渲染进程 命令 */
export type AppCommand =
  | 'focus-search'
  | 'toggle-sidebar'
  | 'toggle-focus-mode'
  | 'toggle-theme'
  | 'save-chapter'
  | 'get-suggestion'
  | 'toggle-history'

/**
 * 渲染进程可见的完整 API（由 preload 通过 contextBridge 暴露为 window.api）。
 * 所有方法均为异步；主进程侧实现见 src/main/services。
 */
export interface WriterAssistantApi {
  app: {
    version(): Promise<string>
    openExternal(url: string): Promise<Res<void>>
    platform(): Promise<NodeJS.Platform>
    minimize(): Promise<void>
    maximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onWindowState(cb: (state: { maximized: boolean }) => void): () => void
  }

  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    clearAll(): Promise<Res<void>>
  }

  adapters: {
    list(): Promise<SiteAdapter[]>
    switch(siteId: string): Promise<Res<void>>
  }

  webview: {
    /** 注册 webview 的 webContentsId，主进程据此注入脚本 */
    register(webContentsId: number, kind: 'main' | 'background'): Promise<Res<void>>
    /** 在指定 webview 执行脚本 */
    execute(target: 'main' | 'background', script: string): Promise<ScriptResult>
    loginState(target: 'main' | 'background'): Promise<LoginState>
    /** 清除 AI webview 的存储；session = 仅 cookies/sessionStorage，full = 全清 */
    clearStorage(mode: 'session' | 'full'): Promise<Res<void>>
    onScriptResult(cb: (payload: { requestId: string; value: unknown }) => void): () => void
    onStreamChunk(cb: (payload: { requestId: string; text: string; done: boolean }) => void): () => void
  }

  bg: {
    /** 发起后台建议请求（阶段 3） */
    start(params: BgRequestParams): Promise<Res<BgRequestResult>>
    cancel(requestId: string): Promise<Res<void>>
    onStatus(cb: (payload: { requestId: string; status: string; error?: string }) => void): () => void
    onChunkProgress(cb: (p: ChunkProgress & { requestId: string }) => void): () => void
  }

  work: {
    list(): Promise<Work[]>
    get(id: string): Promise<Work | undefined>
    create(input: { title: string; author?: string; intro?: string; coverUrl?: string }): Promise<Work>
    update(id: string, patch: Partial<Pick<Work, 'title' | 'author' | 'intro' | 'coverUrl'>>): Promise<Res<Work>>
    remove(id: string): Promise<Res<void>>
    setCurrent(id: string): Promise<Res<void>>
    /** 把源作品的内容合并到目标作品后删除源 */
    merge(srcId: string, dstId: string): Promise<Res<{ mergedChapters: number }>>
  }

  chapter: {
    get(workId: string, chapterId: string): Promise<Chapter | undefined>
    save(workId: string, chapterId: string, content: string, source?: string): Promise<Res<Chapter>>
    create(workId: string, volumeId: string, title: string): Promise<Res<Chapter>>
    rename(workId: string, chapterId: string, title: string): Promise<Res<void>>
    remove(workId: string, chapterId: string): Promise<Res<void>>
    reorder(workId: string, volumeId: string, chapterIds: string[]): Promise<Res<void>>
    /** 写入章节摘要（AI 摘要 / 章纲落地用）。version 为生成摘要时的正文字数。 */
    setSummary(workId: string, chapterId: string, summary: string, version: number): Promise<Res<void>>
  }

  volume: {
    create(workId: string, title: string): Promise<Res<unknown>>
    rename(workId: string, volumeId: string, title: string): Promise<Res<void>>
    remove(workId: string, volumeId: string): Promise<Res<void>>
  }

  version: {
    list(workId: string, chapterId: string): Promise<ChapterVersion[]>
    restore(workId: string, chapterId: string, versionId: string): Promise<Res<Chapter>>
    markImportant(workId: string, chapterId: string, versionId: string, important: boolean): Promise<Res<void>>
    remove(workId: string, chapterId: string, versionId: string): Promise<Res<void>>
    exportTxt(workId: string, chapterId: string, versionId: string): Promise<Res<string>>
  }

  recovery: {
    /** 渲染进程定时上报临时草稿 */
    write(snapshot: RecoverySnapshot): Promise<Res<void>>
    scan(): Promise<{ candidates: RecoveryCandidate[]; uncleanExit: boolean }>
    apply(candidate: RecoveryCandidate): Promise<Res<Chapter>>
    discard(chapterId: string): Promise<Res<void>>
  }

  material: {
    characters(workId: string): Promise<Character[]>
    upsertCharacter(workId: string, c: Partial<Character> & { name: string }): Promise<Res<Character>>
    removeCharacter(workId: string, id: string): Promise<Res<void>>
    foreshadowings(workId: string): Promise<Foreshadowing[]>
    upsertForeshadowing(workId: string, f: Partial<Foreshadowing> & { content: string }): Promise<Res<Foreshadowing>>
    removeForeshadowing(workId: string, id: string): Promise<Res<void>>
    outline(workId: string): Promise<Outline[]>
    saveOutline(workId: string, nodes: Outline[]): Promise<Res<void>>
    locations(workId: string): Promise<Location[]>
    settings(workId: string): Promise<Setting[]>
    notes(workId: string): Promise<Note[]>
    upsertNote(workId: string, n: Partial<Note> & { content: string }): Promise<Res<Note>>
    removeNote(workId: string, id: string): Promise<Res<void>>
    stats(workId: string, days?: number): Promise<DailyStat[]>
    addStat(workId: string, words: number, durationMs: number): Promise<Res<void>>
  }

  io: {
    pickImportFile(): Promise<string | null>
    pickDirectory(): Promise<string | null>
    analyzeImport(filePath: string): Promise<Res<ImportPreview>>
    executeImport(params: ImportExecuteParams): Promise<ImportResult>
    export(params: ExportParams): Promise<Res<string>>
    cancel(): Promise<Res<void>>
    onProgress(cb: (p: { phase: string; current: number; total: number }) => void): () => void
  }

  backup: {
    status(): Promise<BackupStatus[]>
    runNow(): Promise<Res<BackupStatus[]>>
    verify(filePath: string): Promise<Res<BackupEnvelope['meta']>>
    restore(params: BackupRestoreParams): Promise<Res<string>>
    snapshot(workId: string, chapterId: string): Promise<Res<void>>
    list(): Promise<Array<{ path: string; meta: BackupEnvelope['meta'] }>>
  }

  prompts: {
    list(): Promise<PromptTemplate[]>
    save(t: PromptTemplate): Promise<Res<PromptTemplate>>
    reset(id?: string): Promise<PromptTemplate[]>
    import(): Promise<Res<PromptTemplate[]>>
    export(): Promise<Res<string>>
    checkUpdate(): Promise<Res<{ updated: number; message: string }>>
  }

  /**
   * 用户提示词库（与 prompts 互不干扰，独立的 schema 与存储）。
   * 渲染层会同时拉两份并合并展示：内置 + 用户。
   */
  promptLibrary: {
    list(): Promise<PromptItem[]>
    save(item: PromptItem): Promise<Res<PromptItem>>
    remove(id: string): Promise<Res<void>>
    duplicate(id: string): Promise<Res<PromptItem>>
    reorder(ids: string[]): Promise<Res<void>>
    import(): Promise<Res<PromptItem[]>>
    /** 粘贴文本导入，自动识别 JSON / 分节 / 整段 */
    importText(text: string, category?: string): Promise<Res<PromptItem[]>>
    export(): Promise<Res<string>>
    /** 渲染并返回最终提示词；未知变量返回 missing 列表 */
    render(id: string, vars: Record<string, string>): Promise<Res<{ text: string; missing: string[] }>>
    /** 标记最近使用（更新时间 + 次数） */
    touch(id: string): Promise<Res<void>>
    recordUsage(input: { promptId: string; action?: string; value: 'up' | 'down' | 'use'; note?: string; siteId?: string }): Promise<Res<unknown>>
    iteratePreview(id: string): Promise<Res<import('./promptLibrary').PromptIteratePreview>>
    iterate(id: string): Promise<Res<import('./promptLibrary').PromptIterateResult>>
    iterationHistory(promptId?: string): Promise<import('./bookBreakdown').PromptIterationHistoryEntry[]>
    appendHistory(entry: import('./bookBreakdown').PromptIterationHistoryEntry): Promise<Res<void>>
    previewByInstruction(id: string, req: import('./promptLibrary').PromptIterateRequest): Promise<Res<import('./promptLibrary').PromptIteratePreview>>
    iterateByInstruction(id: string, req: import('./promptLibrary').PromptIterateRequest): Promise<Res<import('./promptLibrary').PromptIterateResult>>
    restoreIteration(historyIndex: number): Promise<Res<PromptItem>>
  }

  /**
   * 桌面宠物（v3 模块二）。所有 API 都返回 Res 包装以便统一错误处理。
   */
  pet: {
    open(): Promise<Res<void>>
    close(): Promise<Res<void>>
    listAvatars(): Promise<Res<unknown[]>>
    importAvatar(): Promise<Res<unknown>>
    importAvatarFromPath(path: string): Promise<Res<unknown>>
    switchAvatar(id: string): Promise<Res<void>>
    deleteAvatar(id: string): Promise<Res<void>>
    updateSettings(s: unknown): Promise<Res<void>>
    getSettings(): Promise<unknown>
    pushInspiration(item: unknown): Promise<Res<void>>
    onInspiration(cb: (payload: unknown) => void): () => void
  }

  /**
   * 拆书工作台（v3 模块三）。队列在主进程，渲染层订阅进度。
   */
  bookBreakdown: {
    list(): Promise<unknown[]>
    create(input: { title: string; author?: string; sourceFile?: string }): Promise<Res<unknown>>
    remove(id: string): Promise<Res<void>>
    get(id: string): Promise<unknown>
    start(id: string, opts?: { fromChapter?: number }): Promise<Res<void>>
    pause(id: string): Promise<Res<void>>
    resume(id: string): Promise<Res<void>>
    exportJson(id: string): Promise<Res<string>>
    importToMaterials(id: string, workId: string): Promise<Res<{ added: number }>>
    patch(id: string, patch: { anonymized?: boolean; chunkSize?: number; title?: string; author?: string }): Promise<Res<unknown>>
    generatePrompt(id: string, kind: 'rhythm' | 'style'): Promise<Res<{ item: PromptItem }>>
    onProgress(cb: (payload: unknown) => void): () => void
  }

  /** 数据存储位置 */
  storage: {
    /** 读取当前数据目录状态 */
    status(): Promise<StorageStatus>
    /** 弹出目录选择框，返回所选目录（取消为 null） */
    pickDir(): Promise<string | null>
    /** 设置数据目录（需重启生效） */
    setDir(dir: string, migrateMode: 'migrate' | 'fresh'): Promise<Res<{ needsRestart: boolean; migrated: boolean }>>
    /** 恢复默认数据目录 */
    resetDir(): Promise<Res<{ needsRestart: boolean; migrated: boolean }>>
    /** 在文件管理器中打开数据目录 */
    openDir(dir?: string): Promise<Res<void>>
    /** 立即重启应用 */
    restart(): Promise<Res<void>>
  }

  agent: {
    list(): Promise<import('./agent').AgentProfile[]>
    get(id: string): Promise<import('./agent').AgentProfile | null>
    /** 按场景推荐一个 Agent（考虑默认与最近使用） */
    pick(scene: string): Promise<import('./agent').AgentProfile | null>
    save(item: import('./agent').AgentProfile): Promise<Res<import('./agent').AgentProfile>>
    remove(id: string): Promise<Res<void>>
    duplicate(id: string): Promise<Res<import('./agent').AgentProfile>>
    setDefault(id: string, scene?: string): Promise<Res<import('./agent').AgentProfile>>
    touch(id: string): Promise<Res<void>>
    reset(): Promise<Res<void>>
    /** API 通道：发一次请求（不走 webview） */
    apiCall(params: {
      providerId: string
      model: string
      prompt: string
      system?: string
      temperature?: number
      maxTokens?: number
      topP?: number
      frequencyPenalty?: number
      jsonMode?: boolean
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
      useTools?: boolean
      maxToolRounds?: number
      workId?: string
      agentId?: string
      startedAt?: number
    }): Promise<Res<{ text: string }>>
    /** 连通性自检 */
    testApi(params: { providerId: string; model: string }): Promise<Res<{ reply: string }>>
  }

  cache: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<Res<void>>
    clear(): Promise<Res<void>>
    stats(): Promise<{ count: number; hits: number }>
  }

  net: {
    state(): Promise<NetworkState>
    onChanged(cb: (s: NetworkState) => void): () => void
  }

  /** 阶段 11 进阶功能 */
  advanced: {
    /** 敏感词检测（纯本地） */
    checkSensitive(text: string): Promise<SensitiveReport>
    /** 读取敏感词库（内置 + 用户自定义） */
    getSensitiveDict(): Promise<SensitiveWord[]>
    /** 保存自定义敏感词 */
    setSensitiveDict(words: SensitiveWord[]): Promise<Res<void>>
    /** 分析风格（基于给定文本） */
    analyzeStyle(text: string, workId?: string): Promise<StyleProfile>
    /** 读取已缓存的风格画像 */
    getStyle(workId?: string): Promise<StyleProfile | null>
    /** 角色一致性检查 */
    checkConsistency(workId: string): Promise<ConsistencyReport>
    /** 智能分章建议 */
    suggestSplits(text: string, targetWords?: number): Promise<SplitPoint[]>
    /** 章节目标进度 */
    goalProgress(workId: string, chapterId: string): Promise<GoalProgress>
    /** 设置章节目标字数 */
    setGoal(workId: string, chapterId: string, target: number): Promise<Res<void>>
    /** 健康状态 */
    health(continuousMs: number): Promise<HealthStatus>
    /** 提交建议质量反馈 */
    submitFeedback(fb: QualityFeedback): Promise<Res<FeedbackSummary[]>>
    /** 反馈汇总 */
    feedbackSummary(): Promise<FeedbackSummary[]>
    /** 解析章纲（一键生成章纲的结果结构化） */
    parseOutline(raw: string, fallbackTitle: string): Promise<OutlineDraft>
  }

  /** 阶段 13 数据可视化 */
  viz: {
    /** 一次取全量可视化数据 */
    overview(workId: string, days?: number): Promise<VizOverview>
    /** 写作日历 */
    calendar(workId: string, days?: number): Promise<WritingCalendar>
    /** 字数趋势 */
    trend(workId: string, days?: number): Promise<WordTrend>
  }

  onCommand(cb: (cmd: AppCommand) => void): () => void
}

/** 供渲染进程声明的全局类型 */
declare global {
  interface Window {
    api: WriterAssistantApi
  }
}
