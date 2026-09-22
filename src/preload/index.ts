import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/settings'
import type { Work, Chapter, ChapterVersion, RecoverySnapshot, RecoveryCandidate } from '@shared/work'
import type { Character, Foreshadowing, Outline, Location, Setting, Note, DailyStat } from '@shared/material'
import type { PromptTemplate } from '@shared/suggestion'
import type { PromptItem } from '@shared/promptLibrary'
import type { SensitiveWord, QualityFeedback } from '@shared/advanced'
import type {
  AppCommand,
  BackupRestoreParams,
  BgRequestParams,
  ExportParams,
  ImportExecuteParams,
  Res,
  WriterAssistantApi
} from '@shared/ipc'

/** 订阅主进程推送，返回取消订阅函数 */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: WriterAssistantApi = {
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    platform: () => ipcRenderer.invoke(IPC.appPlatform),
    minimize: () => ipcRenderer.invoke(IPC.appMinimize),
    maximize: () => ipcRenderer.invoke(IPC.appMaximize),
    close: () => ipcRenderer.invoke(IPC.appClose),
    isMaximized: () => ipcRenderer.invoke(IPC.appIsMaximized),
    onWindowState: (cb) => on(IPC.appWindowState, cb)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch),
    clearAll: () => ipcRenderer.invoke(IPC.settingsClearAll)
  },

  adapters: {
    list: () => ipcRenderer.invoke(IPC.adapterList),
    switch: (siteId: string) => ipcRenderer.invoke(IPC.adapterSwitch, siteId)
  },

  webview: {
    register: (webContentsId: number, kind: 'main' | 'background') =>
      ipcRenderer.invoke(IPC.webviewRegister, webContentsId, kind),
    execute: (target: 'main' | 'background', script: string) => ipcRenderer.invoke(IPC.webviewExecute, target, script),
    loginState: (target: 'main' | 'background') => ipcRenderer.invoke(IPC.webviewLoginState, target),
    clearStorage: (mode: 'session' | 'full') =>
      ipcRenderer.invoke('webview:clear-storage' as never, mode),
    onScriptResult: (cb) => on(IPC.webviewScriptResult, cb),
    onStreamChunk: (cb) => on(IPC.webviewStreamChunk, cb)
  },

  bg: {
    start: (params: BgRequestParams) => ipcRenderer.invoke(IPC.bgRequestStart, params),
    cancel: (requestId: string) => ipcRenderer.invoke(IPC.bgRequestCancel, requestId),
    onStatus: (cb) => on(IPC.bgRequestStatus, cb),
    onChunkProgress: (cb) => on(IPC.bgChunkProgress, cb)
  },

  work: {
    list: () => ipcRenderer.invoke(IPC.workList),
    get: (id: string): Promise<Work | undefined> => ipcRenderer.invoke(IPC.workGet, id),
    create: (input) => ipcRenderer.invoke(IPC.workCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.workUpdate, id, patch),
    remove: (id: string) => ipcRenderer.invoke(IPC.workDelete, id),
    merge: (srcId: string, dstId: string) => ipcRenderer.invoke(IPC.workMerge, srcId, dstId),
    setCurrent: (id: string) => ipcRenderer.invoke(IPC.workSetCurrent, id)
  },

  chapter: {
    get: (workId: string, chapterId: string): Promise<Chapter | undefined> =>
      ipcRenderer.invoke(IPC.chapterGet, workId, chapterId),
    save: (workId, chapterId, content, source) =>
      ipcRenderer.invoke(IPC.chapterSave, workId, chapterId, content, source),
    create: (workId, volumeId, title) => ipcRenderer.invoke(IPC.chapterCreate, workId, volumeId, title),
    rename: (workId, chapterId, title) => ipcRenderer.invoke(IPC.chapterRename, workId, chapterId, title),
    remove: (workId, chapterId) => ipcRenderer.invoke(IPC.chapterDelete, workId, chapterId),
    reorder: (workId, volumeId, chapterIds) => ipcRenderer.invoke(IPC.chapterReorder, workId, volumeId, chapterIds),
    setSummary: (workId: string, chapterId: string, summary: string, version: number) =>
      ipcRenderer.invoke(IPC.chapterSetSummary, workId, chapterId, summary, version)
  },

  volume: {
    create: (workId, title) => ipcRenderer.invoke(IPC.volumeCreate, workId, title),
    rename: (workId, volumeId, title) => ipcRenderer.invoke(IPC.volumeRename, workId, volumeId, title),
    remove: (workId, volumeId) => ipcRenderer.invoke(IPC.volumeDelete, workId, volumeId)
  },

  version: {
    list: (workId: string, chapterId: string): Promise<ChapterVersion[]> =>
      ipcRenderer.invoke(IPC.versionList, workId, chapterId),
    restore: (workId, chapterId, versionId) => ipcRenderer.invoke(IPC.versionRestore, workId, chapterId, versionId),
    markImportant: (workId, chapterId, versionId, important) =>
      ipcRenderer.invoke(IPC.versionMarkImportant, workId, chapterId, versionId, important),
    remove: (workId, chapterId, versionId) => ipcRenderer.invoke(IPC.versionDelete, workId, chapterId, versionId),
    exportTxt: (workId, chapterId, versionId) => ipcRenderer.invoke(IPC.versionExport, workId, chapterId, versionId)
  },

  recovery: {
    write: (snapshot: RecoverySnapshot) => ipcRenderer.invoke(IPC.recoveryWrite, snapshot),
    // 主进程实际返回 { candidates, uncleanExit }，此前类型标注为数组，
    // 导致调用方要用 as unknown as 兜底。
    scan: (): Promise<{ candidates: RecoveryCandidate[]; uncleanExit: boolean }> =>
      ipcRenderer.invoke(IPC.recoveryScan),
    apply: (candidate: RecoveryCandidate) => ipcRenderer.invoke(IPC.recoveryApply, candidate),
    discard: (chapterId: string) => ipcRenderer.invoke(IPC.recoveryDiscard, chapterId)
  },

  material: {
    characters: (workId: string): Promise<Character[]> => ipcRenderer.invoke(IPC.characterList, workId),
    upsertCharacter: (workId, c) => ipcRenderer.invoke(IPC.characterUpsert, workId, c),
    removeCharacter: (workId, id) => ipcRenderer.invoke(IPC.characterDelete, workId, id),
    foreshadowings: (workId: string): Promise<Foreshadowing[]> => ipcRenderer.invoke(IPC.foreshadowingList, workId),
    upsertForeshadowing: (workId, f) => ipcRenderer.invoke(IPC.foreshadowingUpsert, workId, f),
    removeForeshadowing: (workId, id) => ipcRenderer.invoke(IPC.foreshadowingDelete, workId, id),
    outline: (workId: string): Promise<Outline[]> => ipcRenderer.invoke(IPC.outlineGet, workId),
    saveOutline: (workId: string, nodes: Outline[]) => ipcRenderer.invoke(IPC.outlineSave, workId, nodes),
    locations: (workId: string): Promise<Location[]> => ipcRenderer.invoke(IPC.locationList, workId),
    settings: (workId: string): Promise<Setting[]> => ipcRenderer.invoke(IPC.settingList, workId),
    notes: (workId: string): Promise<Note[]> => ipcRenderer.invoke(IPC.noteList, workId),
    upsertNote: (workId, n) => ipcRenderer.invoke(IPC.noteUpsert, workId, n),
    removeNote: (workId, id) => ipcRenderer.invoke(IPC.noteDelete, workId, id),
    stats: (workId: string, days?: number): Promise<DailyStat[]> => ipcRenderer.invoke(IPC.statList, workId, days),
    addStat: (workId: string, words: number, durationMs: number) =>
      ipcRenderer.invoke(IPC.statAdd, workId, words, durationMs)
  },

  io: {
    pickImportFile: () => ipcRenderer.invoke(IPC.ioPickImportFile),
    pickDirectory: () => ipcRenderer.invoke(IPC.ioPickDirectory),
    analyzeImport: (filePath: string) => ipcRenderer.invoke(IPC.ioAnalyzeImport, filePath),
    executeImport: (params: ImportExecuteParams) => ipcRenderer.invoke(IPC.ioExecuteImport, params),
    export: (params: ExportParams) => ipcRenderer.invoke(IPC.ioExport, params),
    cancel: () => ipcRenderer.invoke(IPC.ioCancel),
    onProgress: (cb) => on(IPC.ioProgress, cb)
  },

  backup: {
    status: () => ipcRenderer.invoke(IPC.backupStatus),
    runNow: () => ipcRenderer.invoke(IPC.backupRunNow),
    verify: (filePath: string) => ipcRenderer.invoke(IPC.backupVerify, filePath),
    restore: (params: BackupRestoreParams) => ipcRenderer.invoke(IPC.backupRestore, params),
    snapshot: (workId: string, chapterId: string) => ipcRenderer.invoke(IPC.backupSnapshot, workId, chapterId),
    list: () => ipcRenderer.invoke(IPC.backupList)
  },

  prompts: {
    list: (): Promise<PromptTemplate[]> => ipcRenderer.invoke(IPC.promptList),
    save: (t: PromptTemplate) => ipcRenderer.invoke(IPC.promptSave, t),
    reset: (id?: string) => ipcRenderer.invoke(IPC.promptReset, id),
    import: () => ipcRenderer.invoke(IPC.promptImport),
    export: () => ipcRenderer.invoke(IPC.promptExport),
    checkUpdate: () => ipcRenderer.invoke(IPC.promptCheckUpdate)
  },

  promptLibrary: {
    list: (): Promise<PromptItem[]> => ipcRenderer.invoke(IPC.promptLibraryList),
    save: (item: PromptItem) => ipcRenderer.invoke(IPC.promptLibrarySave, item),
    remove: (id: string) => ipcRenderer.invoke(IPC.promptLibraryRemove, id),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.promptLibraryDuplicate, id),
    reorder: (ids: string[]) => ipcRenderer.invoke(IPC.promptLibraryReorder, ids),
    import: () => ipcRenderer.invoke(IPC.promptLibraryImport),
    importText: (text: string, category?: string) => ipcRenderer.invoke(IPC.promptLibraryImportText, text, category),
    export: () => ipcRenderer.invoke(IPC.promptLibraryExport),
    render: (id: string, vars: Record<string, string>) =>
      ipcRenderer.invoke(IPC.promptLibraryRender, id, vars),
    touch: (id: string) => ipcRenderer.invoke(IPC.promptLibraryTouch, id),
    recordUsage: (input) => ipcRenderer.invoke(IPC.promptLibraryRecordUsage, input),
    iteratePreview: (id: string) => ipcRenderer.invoke(IPC.promptLibraryIteratePreview, id),
    iterate: (id: string) => ipcRenderer.invoke(IPC.promptLibraryIterate, id),
    iterationHistory: (promptId?: string) => ipcRenderer.invoke(IPC.promptLibraryIterationHistory, promptId),
    appendHistory: (entry) => ipcRenderer.invoke(IPC.promptLibraryAppendHistory, entry),
    previewByInstruction: (id: string, req: unknown) => ipcRenderer.invoke(IPC.promptLibraryPreviewByInstruction, id, req),
    iterateByInstruction: (id: string, req: unknown) => ipcRenderer.invoke(IPC.promptLibraryIterateByInstruction, id, req),
    restoreIteration: (historyIndex: number) => ipcRenderer.invoke(IPC.promptLibraryRestoreIteration, historyIndex)
  },

  pet: {
    open: () => ipcRenderer.invoke('pet:open' as never),
    close: () => ipcRenderer.invoke('pet:close' as never),
    listAvatars: () => ipcRenderer.invoke('pet:list-avatars' as never),
    importAvatar: () => ipcRenderer.invoke('pet:import-avatar' as never),
    importAvatarFromPath: (path: string) =>
      ipcRenderer.invoke('pet:import-avatar-from-path' as never, path),
    switchAvatar: (id: string) => ipcRenderer.invoke('pet:switch-avatar' as never, id),
    deleteAvatar: (id: string) => ipcRenderer.invoke('pet:delete-avatar' as never, id),
    updateSettings: (s: unknown) => ipcRenderer.invoke('pet:update-settings' as never, s),
    getSettings: (): Promise<unknown> => ipcRenderer.invoke('pet:get-settings' as never),
    pushInspiration: (item: unknown): Promise<Res<void>> =>
      ipcRenderer.invoke('pet:push-inspiration' as never, item),
    onInspiration: (cb: (payload: unknown) => void) =>
      on('pet:inspiration' as never, cb as never)
  },

  bookBreakdown: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('breakdown:list' as never),
    create: (input: unknown) => ipcRenderer.invoke('breakdown:create' as never, input),
    remove: (id: string) => ipcRenderer.invoke('breakdown:remove' as never, id),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('breakdown:get' as never, id),
    start: (id: string, opts?: unknown) =>
      ipcRenderer.invoke('breakdown:start' as never, id, opts),
    pause: (id: string) => ipcRenderer.invoke('breakdown:pause' as never, id),
    resume: (id: string) => ipcRenderer.invoke('breakdown:resume' as never, id),
    exportJson: (id: string) => ipcRenderer.invoke('breakdown:export-json' as never, id),
    importToMaterials: (id: string, workId: string) =>
      ipcRenderer.invoke('breakdown:import-to-materials' as never, id, workId),
    patch: (id: string, patch: unknown) =>
      ipcRenderer.invoke('breakdown:patch' as never, id, patch),
    generatePrompt: (id: string, kind: string) =>
      ipcRenderer.invoke('breakdown:generate-prompt' as never, id, kind),
    onProgress: (cb: (payload: unknown) => void) =>
      on('breakdown:progress' as never, cb as never)
  },

  agent: {
    list: () => ipcRenderer.invoke(IPC.agentList),
    get: (id: string) => ipcRenderer.invoke(IPC.agentGet, id),
    pick: (scene: string) => ipcRenderer.invoke(IPC.agentPick, scene),
    save: (item: unknown) => ipcRenderer.invoke(IPC.agentSave, item),
    remove: (id: string) => ipcRenderer.invoke(IPC.agentRemove, id),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.agentDuplicate, id),
    setDefault: (id: string, scene?: string) => ipcRenderer.invoke(IPC.agentSetDefault, id, scene),
    touch: (id: string) => ipcRenderer.invoke(IPC.agentTouch, id),
    reset: () => ipcRenderer.invoke(IPC.agentReset),
    apiCall: (params: unknown) => ipcRenderer.invoke(IPC.agentApiCall, params),
    testApi: (params: unknown) => ipcRenderer.invoke(IPC.agentTestApi, params)
  },

  cache: {
    get: (key: string) => ipcRenderer.invoke(IPC.cacheGet, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.cacheSet, key, value),
    clear: () => ipcRenderer.invoke(IPC.cacheClear),
    stats: () => ipcRenderer.invoke(IPC.cacheStats)
  },

  /** 数据存储位置 */
  storage: {
    status: () => ipcRenderer.invoke(IPC.storageStatus),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.storagePickDir),
    setDir: (dir: string, migrateMode: 'migrate' | 'fresh') =>
      ipcRenderer.invoke(IPC.storageSetDir, dir, migrateMode),
    resetDir: () => ipcRenderer.invoke(IPC.storageResetDir),
    openDir: (dir?: string) => ipcRenderer.invoke(IPC.storageOpenDir, dir),
    restart: () => ipcRenderer.invoke(IPC.storageRestart)
  },

  net: {
    state: () => ipcRenderer.invoke(IPC.networkState),
    onChanged: (cb) => on(IPC.networkChanged, cb)
  },

  /** 阶段 11 进阶功能（全部本地计算） */
  advanced: {
    checkSensitive: (text: string) => ipcRenderer.invoke(IPC.sensitiveCheck, text),
    getSensitiveDict: () => ipcRenderer.invoke(IPC.sensitiveDict),
    setSensitiveDict: (words: SensitiveWord[]) => ipcRenderer.invoke(IPC.sensitiveDictSet, words),
    analyzeStyle: (text: string, workId?: string) => ipcRenderer.invoke(IPC.styleAnalyze, text, workId),
    getStyle: (workId?: string) => ipcRenderer.invoke(IPC.styleGet, workId),
    checkConsistency: (workId: string) => ipcRenderer.invoke(IPC.consistencyCheck, workId),
    suggestSplits: (text: string, targetWords?: number) =>
      ipcRenderer.invoke(IPC.smartSplit, text, targetWords),
    goalProgress: (workId: string, chapterId: string) =>
      ipcRenderer.invoke(IPC.goalProgress, workId, chapterId),
    setGoal: (workId: string, chapterId: string, target: number) =>
      ipcRenderer.invoke(IPC.goalSet, workId, chapterId, target),
    health: (continuousMs: number) => ipcRenderer.invoke(IPC.healthStatus, continuousMs),
    submitFeedback: (fb: QualityFeedback) => ipcRenderer.invoke(IPC.feedbackSubmit, fb),
    feedbackSummary: () => ipcRenderer.invoke(IPC.feedbackSummary),
    parseOutline: (raw: string, fallbackTitle: string) =>
      ipcRenderer.invoke(IPC.outlineParse, raw, fallbackTitle)
  },

  /** 阶段 13 数据可视化 */
  viz: {
    overview: (workId: string, days?: number) => ipcRenderer.invoke(IPC.vizOverview, workId, days),
    calendar: (workId: string, days?: number) => ipcRenderer.invoke(IPC.vizCalendar, workId, days),
    trend: (workId: string, days?: number) => ipcRenderer.invoke(IPC.vizTrend, workId, days)
  },

  onCommand: (cb: (cmd: AppCommand) => void) => on(IPC.command, cb)
}

contextBridge.exposeInMainWorld('api', api)
