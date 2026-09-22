# 写作副驾 — 多智能体开发契约（务必先读）

本文件是并行开发的唯一协作依据。**每个子智能体只允许修改自己 OWNER 名下的文件。**

## 0. 环境事实（重要，勿浪费时间踩坑）

| 事项 | 结论 |
|------|------|
| 包管理器 | 用 `npm`，**不要用 pnpm**（pnpm 在本机沙箱下 spawn EPERM） |
| npm 缓存 | Windows 可指定 `--cache %LOCALAPPDATA%\npm-cache`，macOS/Linux 用 `--cache ~/.npm-cache` 即可 |
| 安装依赖 | 用 `npm install --ignore-scripts`（生命周期脚本 spawn EPERM） |
| Electron 二进制 | 已通过 `node scripts/setup-electron.mjs` 装好（33.4.11） |
| 启动 Electron | **必须**用 `node_modules/electron/dist/electron.exe`，不要用 `npx electron`（会以 Node 模式启动） |
| 构建/冒烟 | esbuild/Electron 需要派生子进程，受限沙箱会 EPERM，需放开权限执行 |
| 类型检查 | `node scripts/verify.mjs type`（安全，沙箱内可跑） |

## 1. 验证命令

```bash
node scripts/verify.mjs type     # 类型检查（子智能体自检用这个，快，无副作用）
node scripts/verify.mjs build    # 构建
node scripts/verify.mjs smoke    # 构建 + 真实 Electron 冒烟验收
node scripts/verify.mjs all      # 全量
```

**提交产出前必须让 `node scripts/verify.mjs type` 通过（exit 0）。**

## 2. 目录 / 文件归属表

> 只改自己的文件。需要改别人的文件时，在汇报里写"请求"，由主智能体合并。

### 主智能体（已冻结，子智能体只读）
| 路径 | 说明 |
|------|------|
| `src/types/**` | 全部核心接口（**只读**，如确需扩展请汇报） |
| `src/preload/index.ts` | **完整 API 已实现**，只读；新通道已预留 |
| `src/main/store.ts` | electron-store 封装（有素材读写方法，可直接用） |
| `src/main/index.ts` / `window.ts` | 应用入口与窗口，只读 |
| `src/main/ipc/index.ts` / `handle.ts` | IPC 注册总入口与包装器 |
| `src/main/ipc/app.ts` / `settings.ts` | 已实现，只读 |
| `src/main/smoke.ts` | 验收脚本 |
| `src/renderer/App.tsx` | 外壳，**只读**（E 需要改则汇报） |
| `src/renderer/store/ui.ts` | UI 状态，只读（需要新状态请汇报） |
| `src/renderer/components/TopToolbar.tsx` | 工具栏，只读 |
| `src/renderer/components/Workbench.tsx` | 标签页分发，只读 |

### 子智能体 A — 数据层构建师（阶段 5、5.7、5.8）
| 路径 | 动作 |
|------|------|
| `src/main/ipc/work.ts` | **替换**：作品/卷/章/版本历史全部 IPC |
| `src/main/ipc/recovery.ts` | **替换**：崩溃恢复 IPC（补 recoveryApply） |
| `src/main/services/work.ts` | **新建**：作品 CRUD、版本历史裁剪策略 |
| `src/main/services/recovery.ts` | 已存在基础实现，可**扩展** |
| `src/renderer/store/work.ts` | **新建**：作品/章节 Zustand store |
| `src/renderer/components/workbench/DraftTab.tsx` | **替换**：章节树 + 编辑器 + 自动保存 |
| `src/renderer/components/VersionHistoryPanel.tsx` | **新建**：版本历史面板 + diff 对比 |
| `src/renderer/components/RecoveryDialog.tsx` | **新建**：崩溃恢复对话框 |

### 子智能体 B — AI 核心工程师（阶段 2、3、3.5、4）
| 路径 | 动作 |
|------|------|
| `src/renderer/adapters/deepseek.ts` | **新建** |
| `src/renderer/adapters/registry.ts` | **新建** |
| `src/renderer/adapters/index.ts` | **新建** |
| `src/main/ipc/webview.ts` | **替换**：脚本注入、流式监听、登录态 |
| `src/main/ipc/background.ts` | **替换**：后台建议会话（单请求/超时/取消） |
| `src/main/services/inject.ts` | **新建**：webContents 注入执行 |
| `src/renderer/services/context.ts` | **新建**：上下文组装 assembleContext |
| `src/renderer/services/suggest.ts` | **新建**：请求编排、JSON 解析 |
| `src/renderer/components/CardPanel.tsx` | **新建**：走向卡片面板 |
| `src/renderer/components/SuggestionCard.tsx` | **新建**：单张卡片 |
| `src/renderer/components/BackgroundWebview.tsx` | **新建**：隐藏后台 webview |

### 子智能体 C — 写作模块开发者（阶段 5.5、5.6、6）
| 路径 | 动作 |
|------|------|
| `src/main/ipc/material.ts` | **替换**：素材与统计全部 IPC |
| `src/main/services/material.ts` | **新建**：角色/伏笔/大纲/地点/设定合并逻辑 |
| `src/main/services/sync.ts` | **新建**：自动同步提取与合并 |
| `src/renderer/store/material.ts` | **新建** |
| `src/renderer/components/workbench/OutlineTab.tsx` | **替换** |
| `src/renderer/components/workbench/CharacterTab.tsx` | **替换** |
| `src/renderer/components/workbench/ForeshadowTab.tsx` | **替换** |
| `src/renderer/components/workbench/NoteTab.tsx` | **替换** |
| `src/renderer/components/workbench/StatTab.tsx` | **替换** |

### 子智能体 D — 导入导出专家（阶段 6.5、7、7.5）
| 路径 | 动作 |
|------|------|
| `src/main/ipc/io.ts` | **替换** |
| `src/main/ipc/backup.ts` | **替换** |
| `src/main/services/importer.ts` | **新建**：TXT/MD/DOCX/JSON 导入与分章 |
| `src/main/services/exporter.ts` | **新建**：JSON/TXT/MD/HTML 导出 |
| `src/main/services/backup.ts` | **新建**：多副本备份、快照、SHA-256 校验 |
| `src/renderer/components/ImportDialog.tsx` | **新建** |
| `src/renderer/components/ExportDialog.tsx` | **新建** |
| `src/renderer/components/BackupPanel.tsx` | **新建** |

### 子智能体 E — 排版工程师（阶段 9、9.5）
| 路径 | 动作 |
|------|------|
| `src/renderer/components/Editor/**` | **新建**：三栏、排版、状态栏、主题 |
| `src/renderer/components/BubbleMenu.tsx` | **新建**：选中气泡菜单 |
| `src/renderer/store/editor.ts` | **新建**：排版/主题状态 |
| `src/renderer/components/workbench/DraftTab.tsx` | **与 A 冲突 → 见下** |

> ⚠️ **E 与 A 冲突处理**：`DraftTab.tsx` 归 A。E 负责 `src/renderer/components/Editor/` 下的编辑器本体，
> 并导出一个 `<ChapterEditor />`；A 在 DraftTab 中引用它。若 A 尚未产出，E 可先建占位并汇报。

### 子智能体 F — 性能 & 多站点（阶段 12、10、11.5a、11.5b）
| 路径 | 动作 |
|------|------|
| `src/renderer/adapters/chatgpt.ts` | **新建** |
| `src/renderer/adapters/claude.ts` | **新建** |
| `src/renderer/adapters/gemini.ts` | **新建** |
| `src/renderer/adapters/chunking/*.ts` | **新建**：四平台 ChunkingProfile |
| `src/main/services/chunking.ts` | **新建**：通用分块引擎 |
| `src/renderer/adapters/chunking-notes.md` | **新建**：实测记录 |
| `src/renderer/services/perf.ts` | **新建**：倒排索引、缓存 |
| `src/renderer/components/ChunkProgressPanel.tsx` | **新建** |

> ⚠️ **F 与 B 冲突处理**：`registry.ts` 归 B。F 只新建自己的 adapter 文件与 `chunking/` 目录，
> 并汇报"需在 registry 注册"由主智能体合并。

## 3. 安全约束（全程硬性）

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 不向 AI 页面暴露任何 Node API
- 渲染进程一切文件读写走 IPC，主进程 `fs` 完成
- webview `partition` 必须是 `persist:writer-assistant`（后台会话同 partition 共享登录态）

## 4. 合规约束（全程硬性）

- 不绕过登录、验证码、风控
- 不自动发送用户当前对话
- 不高频自动化滥用；块间隔 ≥500ms；同一时间仅一个后台请求

## 5. IPC 约定

- 通道名一律用 `@shared/ipc` 的 `IPC` 常量，**禁止裸字符串**
- 返回值用 `{ ok: true, data }` / `{ ok: false, error }` 信封（`Res<T>`）
- 主进程 `handle()` 已自动 try/catch，异常不会抛给渲染进程
- preload 已把**全部 API 暴露完毕**；你只需实现主进程 handler

## 6. 汇报格式（每个子智能体必须给出）

1. **产出文件清单**（相对路径）
2. **验证结果**：`node scripts/verify.mjs type` 的实际输出
3. **遗留问题 / 未实现项**
4. **请求**（需要主智能体合并的跨模块改动）
