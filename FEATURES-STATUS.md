# 写作副驾（Writer's Assistant）功能清单与实现程度对照表

> 用途：粘贴到 DeepSeek 网页版，让 AI 助手完整读取项目状态。
> 格式：纯文本 + Markdown + 表格，无图片、无交互、无外部依赖。
> 实现程度图例：✅ 完整 / 🟡 部分 / ⚪ 未开始

---

## 0. 总览

| 维度 | 数值 |
|---|---|
| 产品定位 | Electron 桌面端长篇小说写作辅助工具 |
| UI 形态 | 左侧工作台 + 右侧内嵌 AI 网页（DeepSeek / ChatGPT / Claude / Gemini） |
| 技术栈 | Electron 33.4.11 + electron-vite 5.0.0 + Vite 7.3.9 + React 18.3.1 + Zustand 5.0.15 + TypeScript 5.9.3 strict + Tailwind 3.4.19 |
| 源码 | ~29,000 行 TypeScript / TSX，~140 个文件 |
| 类型文件 | 15 个（统一在 src/types/） |
| 主进程服务 | 17 个（src/main/services/） |
| 渲染组件 | 32 个（含 v3 P2-6.2 `src/renderer/components/ui/index.tsx` 统一组件库） |
| 渲染层 service | 12 个（新增 petRuleEngine / petThrottle / petBridge / petAIInspiration / aiTask / eventBus / theme） |
| 渲染层 hook | 1 个（usePetPerception） |
| 内置提示词模板 | 13 个（可由用户复制为自定义） |
| 支持站点 | 4 个（DeepSeek / ChatGPT / Claude / Gemini） |
| 冒烟测试 | 35 项（全部通过） |
| 安全约束 | contextIsolation:true / nodeIntegration:false / sandbox:true；全程遵守 |
| 设计 token | 8 类（color / radius / shadow / spacing / typography / motion / accent / focus-ring），3 主题（light/dark/parchment） |
| 主题切换 | 跟随系统 + 手动；切换加 120ms 过渡；不闪烁 |

---

## 1. 写作功能（写作工作台）

### 1.1 作品 / 卷 / 章节 CRUD

| 功能 | 程度 | 说明 |
|---|---|---|
| 新建 / 删除 / 重命名作品 | ✅ | `useWorkStore` + `workService` |
| 编辑作者简介 | ✅ | |
| 新建 / 删除 / 重命名卷 | ✅ | 每作品至少保留一卷 |
| 新建 / 删除 / 重命名章节 | ✅ | 每卷至少保留一章 |
| 章节内：保存 / 复制 / 清空 | ✅ | |
| 自动保存（6 触发源） | ✅ | 手动 / 自动（800ms 防抖）/ AI 插入 / 导入 / 章节完成 / 崩溃恢复 |

### 1.2 版本历史与回滚

| 功能 | 程度 | 说明 |
|---|---|---|
| 自动版本快照 | ✅ | 每次保存旧内容入库（带 source 字段） |
| 最多保留版本数 | ✅ | 20 个，自动清理 |
| 列出版本 / 回滚 / 标记重要 / 删除 / 导出 | ✅ | |
| 行级 diff（三色） | ✅ | `DiffView` |
| 字符级 diff 工具 | ✅ | `computeDiff`：same / add / del 三种 segment，输出 DiffSummary |

### 1.3 崩溃恢复

| 功能 | 程度 | 说明 |
|---|---|---|
| 临时草稿写入 | ✅ | 每 5 秒，路径 `<userData>/recovery/` |
| 启动扫描候选草稿 | ✅ | 列章节 ID + 内容预览 + 时间戳 |
| 一键替换章节正文 | ✅ | |

### 1.4 编辑器

| 功能 | 程度 | 说明 |
|---|---|---|
| 编辑 / 撤销 / 重做 / 全选 / 复制 / 粘贴 | ✅ | |
| 字数统计（实时） | ✅ | |
| Ctrl+S 保存 / Ctrl+Z 撤销 | ✅ | |
| Ctrl+Shift+R/E/C/W/Q 5 个 AI 快捷键 | ✅ | |
| 自动滚动到上次位置 | ✅ | |
| 字号 / 字体 / 行距 / 主题 | ✅ | Tailwind class + CSS 变量 |

### 1.5 工作台标签（固定 6 个）

| 标签 | 程度 | 说明 |
|---|---|---|
| 草稿 | ✅ | 章节正文编辑器 |
| 大纲 | ✅ | 层级树，拖拽排序，章纲生成 |
| 角色 | ✅ | 角色卡片网格，按 lastUpdatedAt 排序 |
| 伏笔 | ✅ | 伏笔追踪表 |
| 便签（含灵感） | ✅ | 10 个分类的灵感库 modal |
| 统计 | ✅ | 写作进度 / 健康提醒 / 数据可视化 |

---

## 2. AI 辅助写作（气泡菜单）

### 2.1 5 种 AI 动作

| 动作 | 程度 | 说明 |
|---|---|---|
| 润色（polish） | ✅ | |
| 扩写（expand） | ✅ | |
| 缩写（condense） | ✅ | |
| 改写（rewrite） | ✅ | |
| 问 AI（ask） | ✅ | 多行输入对话框 |

### 2.2 第六个动作（标记伏笔）

| 程度 | 说明 |
|---|---|
| ✅ | 从选中文本创建一条伏笔条目 |

### 2.3 气泡结果面板

| 功能 | 程度 | 说明 |
|---|---|---|
| 字符级 diff 对比视图 | ✅ | 新增绿底 / 删除红删除线 |
| 替换 / 插入到光标 / 仅复制 | ✅ | |
| 重新生成（保留原文） | ✅ | |
| 跳到侧栏改写记录 | ✅ | |
| 提示词快照 + 一键跳设置 | ✅ | |

### 2.4 改写记录侧栏

| 功能 | 程度 | 说明 |
|---|---|---|
| 按章节分组 / 时间倒序 | ✅ | |
| 动作图标 / 类型 / 原文片段 / 时间戳 / 是否已应用 | ✅ | |
| 展开看 diff + 改动统计（+/- 字数 / 百分比） | ✅ | |
| 复制并替换 / 仅复制 / 删除 | ✅ | |
| 批量清空（二次确认） | ✅ | |
| localStorage 持久化 `wa.rewriteHistory.v1` | ✅ | 最多 100 条 |
| 跨重启保留 / 进 tab 自动 reload | ✅ | |

---

## 3. AI 站点管理（站点健康化）

| 功能 | 程度 | 说明 |
|---|---|---|
| 4 站点支持 | ✅ | DeepSeek / ChatGPT / Claude / Gemini |
| 适配器架构 | ✅ | `adapters/*.ts` 只声明选择器；scripts.ts 编译 |
| 主进程 site-agnostic | ✅ | 不写任何站点细节 |
| 5 种站点状态 | ✅ | online / logged-out / risk / offline / loading / unknown |
| 侧栏头部彩色徽章 | ✅ | `SiteStatusBadge` |
| 实时检测（dom-ready + did-navigate） | ✅ | 登录态 + URL 风控模式 |
| 风控前置拦截 | ✅ | `isRiskUrl` 匹配 risk/control/verify/challenge/captcha/forbidden/banned |
| AI 调用失败自动降级 | ✅ | `SiteStatusWatcher` 监听 lastReason 跳到下一个 available |
| 站点下拉手动切换 | ✅ | 顶栏下拉 |
| 仅清会话 vs 彻底清空（两档） | ✅ | IPC `webview:clear-storage('session'\|'full')`，mode=session 清 cookies/sessionStorage；mode=full 清一切 |
| 站点管理弹窗 | ✅ | 状态 / 切换 / 清缓存 / 重载 |
| 首启动引导卡 | ✅ | 3 步引导，选站点 → 登录 → 写作 |

---

## 4. 提示词管理

### 4.1 内置模板（13 个）

| 模板 | 任务 | 程度 |
|---|---|---|
| 摘要 / 总结 | summarize | ✅ |
| 章纲生成 | outline-gen | ✅ |
| 智能分章 | chapter-split | ✅ |
| 同步提取（一致性） | sync-extract | ✅ |
| 一致性检查 | consistency-check | ✅ |
| 润色 / 扩写 / 缩写 / 改写 / 问 AI | polish/expand/condense/rewrite/ask | ✅ |
| 灵感生成（10 分类） | inspiration | ✅ |
| 模板版本管理（version + minAppVersion） | ✅ | 阶段 13 迁移 |

### 4.2 用户提示词库（v3 模块一）

| 功能 | 程度 | 说明 |
|---|---|---|
| 分类（10 类） | ✅ | 润色改写 / 扩写缩写 / 角色 / 伏笔 / 大纲 / 风格 / 一致性 / 灵感 / 工具 / 其他 |
| 标签 / 收藏 / 启用 / 排序 | ✅ | |
| 8 个内置变量 | ✅ | `{text}` / `{content}` / `{question}` / `{chapterSummary}` / `{characters}` / `{foreshadowings}` / `{locations}` / `{outline}` |
| 自定义变量自动表单 | ✅ | 渲染时未知变量返回 missing[] |
| 设置页三栏（分类 / 列表 / 编辑） | ✅ | 含变量测试 + 实时预览 |
| 导入 / 导出 JSON | ✅ | 只导 user-defined |
| 复制为自定义（内置不可直接改） | ✅ | |
| 收藏 / 启用 / 启用停用 / 删除 | ✅ | 删除仅 custom 项 |
| 气泡菜单「📚 选模板」入口 | ✅ | PromptPicker |
| 三步选择流（选 → 填变量 → 预览 → 确认） | ✅ | |
| AI 调用走现有 BackgroundWebview | ✅ | prompt → bg.start |
| 写入改写记录 | ✅ | promptPreview 标注「（提示词库）模板名」 |
| 最近使用 + 使用次数 | ✅ | touch IPC 自动更新 |
| 拖拽排序 | 🟡 | reorder IPC 通，UI 拖拽未加 |

---

## 5. 素材管理

### 5.1 角色

| 功能 | 程度 | 说明 |
|---|---|---|
| 增删改 / 批量同步（从章节提取） | ✅ | |
| 字段：id / name / intro / tags / appearances / mentions / supplements | ✅ | |
| 进阶字段（一致性检查）：aliases / traits / appearance / status / relationships | ✅ | |
| 关系图可视化 | 🟡 | 数据有，UI 占位 |

### 5.2 伏笔

| 功能 | 程度 | 说明 |
|---|---|---|
| 字段：id / content / type / status / chapterId / recoveredChapterId / relatedTo / anchor | ✅ | |
| 状态：planted / recovered / dropped | ✅ | |
| 锚点（章节 + 字符 offset） | ✅ | |
| 回收率统计 | ✅ | |

### 5.3 地点 / 设定

| 功能 | 程度 | 说明 |
|---|---|---|
| 字段：id / name / description / isNew | ✅ | |
| 与卷 / 章关联 | ✅ | |

### 5.4 大纲

| 功能 | 程度 | 说明 |
|---|---|---|
| 树形结构（递归） | ✅ | |
| 字段：id / title / summary / children / order | ✅ | |
| 拖拽排序 | 🟡 | 数据 OK，UI 简化 |

### 5.5 便签 + 灵感

| 功能 | 程度 | 说明 |
|---|---|---|
| 自由便签 | ✅ | |
| 灵感子模块（10 分类） | ✅ | 角色 / 情节 / 对话 / 场景 / 冲突 / 主题 / 设定 / 物件 / 视角 / 其它 |

---

## 6. AI 后台调用（高级功能）

### 6.1 智能分章

| 功能 | 程度 | 说明 |
|---|---|---|
| 输入：万字级全文 | ✅ | |
| 输出：按情节断点的章节切分 + 摘要 + 关键事件 | ✅ | |
| 块大小：3000 字 / 块 | ✅ | |
| 块间隔 ≥ 500 ms（合规） | ✅ | |
| 强制 JSON 输出 + 模糊匹配回退 | ✅ | |

### 6.2 同步分析（一致性检查）

| 功能 | 程度 | 说明 |
|---|---|---|
| 输入：当前章节 + 已有素材库 | ✅ | |
| 输出：6 类变更建议 | ✅ | character / foreshadowing / location / setting / outline |
| 用户逐条勾选确认入库 | ✅ | |
| 分块引擎 + 合并去重 | ✅ | |

### 6.3 风格分析

| 功能 | 程度 | 说明 |
|---|---|---|
| 句长分布 / 高频词 / 风格标签 | ✅ | |
| 用于一致性检查 | ✅ | |

### 6.4 一致性检查

| 功能 | 程度 | 说明 |
|---|---|---|
| 输入：当前章节 + 角色 + 伏笔 + 地点 + 时间线 | ✅ | |
| 输出：报告（章节 + 类型 + 严重度） | ✅ | |
| 7 类规则 | ✅ | 角色状态 / 时间线 / 伏笔回收 / 设定冲突 / 地点错用 / 名称一致 / 视角 |

### 6.5 敏感词检测

| 功能 | 程度 | 说明 |
|---|---|---|
| 12 个内置敏感词 + 自定义词表 | ✅ | |
| 检测 + 建议替换词 | ✅ | |
| 一键替换 | ✅ | |

### 6.6 一键生成章纲

| 功能 | 程度 | 说明 |
|---|---|---|
| 输入：单章任意长度 | ✅ | |
| 输出：JSON 5 字段 | ✅ | chapterSummary / keyEvents / characters / turningPoint / endingHook |
| 自动保存（chapter.summary / summaryVersion / summaryUpdatedAt） | ✅ | |

### 6.7 章纲合并（多块摘要 → 完整摘要）

| 功能 | 程度 | 说明 |
|---|---|---|
| 递归合并 | ✅ | |

---

## 7. 数据存储

| 功能 | 程度 | 说明 |
|---|---|---|
| 主数据 `<userData>/writer-assistant.json` | ✅ | 包含 works / materials / settings / versions |
| 临时草稿 `<userData>/recovery/` | ✅ | 每 5 秒 |
| 备份（带 SHA-256 校验） | ✅ | |
| 导出 JSON / TXT / Markdown / HTML | ✅ | |
| TXT 自动分章导入 | ✅ | 「第 N 章」「Chapter N」正则 |
| 自定义存储位置（需重启） | ✅ | bootstrap 文件记录 pending 路径 |
| 迁移模式（migrate / fresh） | ✅ | |
| 合并重复作品（同名检测 + 一键合并） | ✅ | 顶部横幅提示 |

---

## 9. 桌面宠物（v3 模块二）

| 功能 | 程度 | 说明 |
|---|---|---|
| 透明置顶窗口（200×240） | ✅ | transparent:true / frame:false / alwaysOnTop:true |
| 独立 preload + 独立渲染进程 | ✅ | `src/preload/pet.ts` + `src/renderer/pet/` |
| 拖拽 + 位置记忆 | ✅ | 移动结束写回 store |
| 形象包：用户本地导入 | ✅ | 不内置 / 不打包 / 不上传 / 不分发 |
| 引用本地路径 vs 复制到应用数据 | ✅ | 删除时只清应用内副本 |
| 缺 license 提示个人使用 | ✅ | UI 强制提示 |
| 10 个状态映射 | ✅ | idle / writing / thinking / ai-calling / happy / alert / sleeping / dragging / risk / error |
| 类型支持：frames / spritesheet / gif / apng / static | ✅ | Live2D / Spine 预留 |
| 设置面板（开关 / 形象 / 位置 / 频率 / 感知范围 / 是否允许 AI / 收藏过滤 / 静默 / 减少动效） | ✅ | `PetSettingsDialog` |
| 节流感知（停顿 + 字数阈值） | ✅ | v3 P0-3.1 CharThrottle（idleMs + minChars + cooldownMs） |
| 本地灵感规则引擎（7 条规则） | ✅ | v3 P0-3.1 petRuleEngine.ts（no-dialogue / static-description / absent-character / stale-foreshadowing / word-repeat / chapter-done / random-inspiration） |
| AI 灵感增强（复用提示词库） | ✅ | v3 P0-3.2 petAIInspiration.ts；复用提示词库「灵感」分类；pet 桶缓存 1h；风控/未登录静默降级 |
| 浏览器渲染减少动效 / 空闲降帧 | ✅ | v3 P3-6.1；prefers-reduced-motion + 5min idle → 2fps |

---

## 10. 拆书工作台（v3 模块三）

| 功能 | 程度 | 说明 |
|---|---|---|
| TXT / MD 导入（本地分章） | ✅ | 「第 N 章 / 节 / 卷」「Chapter N」 |
| 自动分章规则 | ✅ | header 位置切分；< 2 章 fallback |
| 项目列表 / 创建 / 删除 | ✅ | `<userData>/book-breakdowns/<id>.json` |
| 暂停 / 继续 | ✅ | project.status 字段 |
| 导出 JSON（仅摘要，不含原文） | ✅ | |
| 入素材库（角色 + 关键事件 → Foreshadowing） | ✅ | 按 name / content 去重 |
| AI 章节摘要（summary + keyEvents + characters + turningPoint + endingHook） | ✅ | 强 JSON，5 字段 |
| 串行处理 / 块间隔 ≥ 600 ms | ✅ | |
| 缓存命中（hashKey） | ✅ | |
| 风控 / 未登录 / 离线前置拦截 | ✅ | |
| 进度事件（breakdown:progress） | ✅ | 主进程 → 渲染层 |
| 风格 / 节奏 / 大纲生成 / 仿写提示词 | ✅ | v3 P0-3.3 |
| 拆书 EPUB / PDF / DOCX 导入 | ✅ 本地解析：DOCX(mammoth) / EPUB(jszip) / PDF(pdf-parse) + TXT/MD |
| 脱敏模式（只发结构） | ✅ | v3 P1-4.4：UI 开关 + analyzeStyle/analyzeRhythm 自动忽略原文 |

---

## 11. 数据可视化（阶段 13）

| 功能 | 程度 | 说明 |
|---|---|---|
| 字数趋势图 | ✅ | |
| 写作日历（活跃度） | ✅ | |
| 词云 | ✅ | |
| 伏笔回收率 | ✅ | |
| 多模型对比 | ✅ | |

---

## 12. 检索与性能（阶段 12 / 12.5）

| 功能 | 程度 | 说明 |
|---|---|---|
| 百万字倒排索引（2-gram 切词） | ✅ | |
| 检索响应 < 50ms | ✅ | |
| 虚拟滚动（章节列表 1000+） | ✅ | |
| 增量构建索引（add / remove 不重建） | ✅ | |
| AI 回复缓存（LRU 500 + TTL 24h） | ✅ | |
| 自动降级超时（firstTokenLimit 60s / idleLimit 30s / hardDeadline 180s） | ✅ | |

---

## 13. 稳定性与 UI

| 功能 | 程度 | 说明 |
|---|---|---|
| ErrorBoundary（渲染层子树） | ✅ | Workbench tab + 写作区 |
| 自动降级超时 | ✅ | |
| 后台会话隔离（BackgroundWebview partition 共享） | ✅ | 视口外 left:-10000px 渲染 |
| 统一动效（3 档时长 + 2 套缓动） | ✅ | fast 120ms / base 180ms / slow 240ms |
| 4 个 keyframes（modal-in / fade-in / tab-in / slide-up） | ✅ | |
| prefers-reduced-motion 全局覆盖 | ✅ | 强制 1ms |
| 拖拽时 transition 全局短路 | ✅ | |
| 侧栏宽度平滑过渡 + 窗宽适配 | ✅ | |
| 主题切换（明亮 / 暗黑） | ✅ | |

---

## 14. 冒烟测试（33 项）

| 阶段 | 测试项 | 程度 |
|---|---|---|
| 5 | 作品 / 章节 CRUD | ✅ |
| 5.7 | 版本历史 + 行级 diff | ✅ |
| 5.8 | 崩溃恢复扫描 | ✅ |
| 6.5 | TXT 自动分章 | ✅ |
| 6.5 | 导出 JSON / TXT / MD / HTML | ✅ |
| 7.5 | 备份 SHA-256 校验 | ✅ |
| 10 | 四站点适配器 | ✅ |
| 11 | 敏感词 | ✅ |
| 11 | 风格分析 + 一致性检查 | ✅ |
| 11 | 分章 / 目标 / 健康 / 章纲 | ✅ |
| 11.5a | 分块与去重合并 | ✅ |
| 12.5 | 回复缓存 | ✅ |
| 12.5 | 提示词模板与渲染 | ✅ |
| 12 | 百万字检索 + 虚拟滚动 | ✅ |
| 13 | 数据可视化 | ✅ |
| 自定义 | 合并作品 + 摘要写入 + 功能开关 | ✅ |
| **v3** | **v3 提示词库 + 拆书分章** | ✅ |
| **v3** | **v3 宠物设置与存储** | ✅ |

---

## 15. 合规与安全

| 约束 | 程度 | 备注 |
|---|---|---|
| contextIsolation:true | ✅ | 全程 |
| nodeIntegration:false | ✅ | 全程 |
| sandbox:true | ✅ | 全程（含宠物窗口） |
| 仅 preload IPC 暴露 API | ✅ | |
| 主进程 site-agnostic | ✅ | 注入脚本由 renderer/adapters 编译 |
| 不存储 AI 凭证（cookie 由 webview 自己管） | ✅ | |
| 不联网同步用户作品 | ✅ | 全部本地 |
| 不绕过 AI 网站登录 / 风控 / 验证码 | ✅ | 手动登录 |
| 块间隔 ≥ 500 ms | ✅ | |
| 串行调用，不高频并发 | ✅ | |
| 缓存 LRU 500 + TTL 24h | ✅ | |
| 风控前置拦截 + 自动降级 | ✅ | |
| 不默认发送整本 / 整章 | ✅ | 只发构造好的提示词 |
| 新增窗口（宠物）走独立 preload | ✅ | 同样三道安全护栏 |
| 拆书不绕过付费墙 / DRM / 登录 | ✅ | 仅本地 + 网页版 AI |
| 拆书 AI 调用只发必要分块 | ✅ | 3000 字 / 块 |

---

## 16. 已知限制 / 后续迭代

| 项 | 备注 |
|---|---|
| 宠物本地灵感规则引擎（7 条） | ✅ v3 P0-3.1；编辑器接 CharThrottle + runWhenIdle |
| 宠物 AI 灵感增强 | ✅ v3 P0-3.2；走 aiTask.pet 优先级 + 缓存分桶 |
| 拆书 AI 风格 / 节奏 / 大纲 / 仿写提示词 | ✅ v3 P0-3.3；4 个独立分析函数 |
| 拆书 EPUB / PDF / DOCX 导入 | ✅ 本地解析：DOCX(mammoth) / EPUB(jszip) / PDF(pdf-parse) + TXT/MD |
| 拆书脱敏模式 UI | ✅ v3 P1-4.4；UI 开关 + 自动忽略原文 |
| 提示词拖拽排序 | ✅ v3 P1-4.1；原生 HTML5 拖拽，零依赖 |
| 关系图可视化 | ✅ v3 P1-4.2；CharacterGraph 自绘 SVG（环形 + 拖拽 + 缩放） |
| 大纲拖拽排序 | ✅ OutlineTab 已实现 |
| 宠物 GPU 优化 | ✅ v3 P3-6.1；prefers-reduced-motion + idle 2fps |
| 拆书大项目内存优化 | ✅ v3 P3-6.2；进度事件 500ms 节流 |
| 缓存分层 | ✅ v3 P3-6.3；user/pet/breakdown 三桶 key 前缀 |
| 统一 AI 任务抽象层 | ✅ v3 P2-5.1；aiTask.ts 三优先级队列 |
| 事件总线 | ✅ v3 P2-5.2；eventBus.ts subscribeAppEvent / publishAppEvent |
| 类型文件合并 | ⚪ 留待 P4 |
| NSIS 打包 | ⚪ 当前通过 release/win-unpacked/ 直接分发 |
| 4 个站点风险控制绕过 | 不做（合规硬约束） |
| 账号池 / 多账号轮换 | 不做（合规硬约束） |
| CDN 反代 | 不做（合规硬约束） |

---

## 17. 关键文件清单（DeepSeek 引用用）

### 17.1 主进程

| 路径 | 用途 |
|---|---|
| src/main/index.ts | 入口 |
| src/main/store.ts | electron-store 抽象（17 个方法） |
| src/main/services/work.ts | 作品 CRUD |
| src/main/services/material.ts | 素材管理 |
| src/main/services/background.ts | BackgroundWebview AI 调用（串行 + 超时 + 缓存 + 风控） |
| src/main/services/cache.ts | LRU 500 / TTL 24h |
| src/main/services/advanced.ts | 智能分章 / 风格 / 一致性 |
| src/main/services/sensitive.ts | 敏感词 |
| src/main/services/pet.ts | v3 宠物服务 |
| src/main/services/promptLibrary.ts | v3 提示词库 |
| src/main/services/bookBreakdown.ts | v3 拆书项目服务 |

### 17.2 渲染层

| 路径 | 用途 |
|---|---|
| src/renderer/store/{ui,work,editor,material,rewrite,site}.ts | 6 个 store |
| src/renderer/components/BubbleMenu.tsx | AI 气泡菜单 |
| src/renderer/components/SettingsDialog.tsx | 设置（含 v3 提示词库 tab） |
| src/renderer/components/TopToolbar.tsx | 顶栏（v3 新增 🐾 宠物 / 📚 拆书） |
| src/renderer/components/SiteManageDialog.tsx | 站点管理弹窗 |
| src/renderer/components/SiteStatusBadge.tsx | 状态徽章 + Watcher |
| src/renderer/components/PromptsLibraryTab.tsx | v3 提示词库 tab |
| src/renderer/components/PromptPicker.tsx | v3 气泡菜单模板选择 |
| src/renderer/components/PetSettingsDialog.tsx | v3 宠物设置 |
| src/renderer/components/BookBreakdownPanel.tsx | v3 拆书工作台 |
| src/renderer/services/aiError.ts | 风控 / 状态拦截 |
| src/renderer/services/breakdownPipeline.ts | v3 拆书 AI 流水线（含 P0-3.3 风格 / 节奏 / 大纲 / 仿写） |
| src/renderer/services/cacheBridge.ts | 渲染层缓存桥接（v3 P3-6.3 user/pet/breakdown 三桶） |
| src/renderer/services/petRuleEngine.ts | v3 P0-3.1 7 条本地规则 + evaluateRules |
| src/renderer/services/petThrottle.ts | v3 P0-3.1 CharThrottle + runWhenIdle |
| src/renderer/services/petBridge.ts | v3 P0-3.1 pushInspiration |
| src/renderer/services/petAIInspiration.ts | v3 P0-3.2 宠物 AI 灵感（缓存分桶 + 风控降级） |
| src/renderer/services/aiTask.ts | v3 P2-5.1 统一 AI 任务抽象层（user/pet/breakdown 三优先级） |
| src/renderer/services/eventBus.ts | v3 P2-5.2 渲染层事件总线 |
| src/renderer/hooks/usePetPerception.ts | v3 P0-3.1 宠物感知 hook |
| src/renderer/components/CharacterGraph.tsx | v3 P1-4.2 角色关系图（自绘 SVG） |
| src/renderer/adapters/{registry,scripts,deepseek,chatgpt,claude,gemini}.ts | 站点适配器（site-agnostic） |
| src/renderer/pet/{index.html,main.tsx} | 宠物窗口独立 React 应用（v3 P3-6.1 reduced-motion + idle 2fps） |

### 17.3 类型

| 路径 | 用途 |
|---|---|
| src/types/{work,material,suggestion,promptLibrary,pet,bookBreakdown,adapter,ipc,settings,viz,advanced,recovery,chunking,prompts,util}.ts | 15 个类型文件 |

---

## 18. 项目里程碑

| 版本 | 阶段 | 状态 |
|---|---|---|
| v0.1 — 阶段 5 | 作品 / 章节 / 版本 / 崩溃恢复 | ✅ |
| v0.2 — 阶段 6.5 | TXT 分章 / 多格式导出 | ✅ |
| v0.3 — 阶段 7 | 备份 SHA-256 | ✅ |
| v0.4 — 阶段 10 | 4 站点适配 | ✅ |
| v0.5 — 阶段 11 | 智能分章 / 风格 / 一致性 / 敏感词 | ✅ |
| v0.6 — 阶段 12 | 百万字检索 / 虚拟滚动 | ✅ |
| v0.7 — 阶段 12.5 | 提示词 / 缓存 / 分块合并 | ✅ |
| v0.8 — 阶段 13 | 数据可视化 | ✅ |
| v0.9 — 站点健康化 | 5 状态 / 风控拦截 / 清缓存 / 首启引导 | ✅ |
| v1.0 — v3 模块一 | 用户提示词库（提示词库 UI / 变量 / 气泡接入） | ✅ |
| v1.1 — v3 模块二 | 桌面宠物（窗口 / 形象 / 设置 / 本地规则 / AI 灵感 / GPU 优化） | ✅ |
| v1.2 — v3 模块三 | 拆书工作台（TXT / 分章 / 章节摘要 / 入库 / 导出 / 风格 AI / 节奏 / 大纲 / 仿写 / 脱敏） | ✅ |
| v1.3 — v3 P1/P2/P3 | 提示词拖拽 / 角色关系图 / 脱敏 / 统一 AI 任务抽象 / 事件总线 / 缓存分层 | ✅ |
| 未来 | NSIS 打包 / 类型文件合并 | ⚠ |

---

## 19. 测试与运行

| 命令 | 用途 |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` | 主进程类型检查（0 错误） |
| `npx tsc -p tsconfig.web.json --noEmit` | 渲染层类型检查（0 错误） |
| `npx electron-vite build` | 打包（输出 out/） |
| `.\node_modules\electron\dist\electron.exe .` | 启动（不用 npx electron） |
| 冒烟 | 31 → 33 项，全通过 |
| 用户数据 | `%APPDATA%\writer-assistant\writer-assistant.json`（macOS/Linux 为 `~/Library/Application Support/writer-assistant/` 或 `~/.config/writer-assistant/`，由 Electron `app.getPath('userData')` 决定） |

---

## 20. 一句话状态

```
v3 三模块（提示词库 ✅ / 宠物 ✅ / 拆书 ✅）全部落地主线 + P0-P3 进阶 11 项 ✅。
v3 P2-6.1 主题完善 + v3 P2-6.2 统一组件库 12 类 + v3 P2-6.5 设计 token 体系 ✅。
测试 35/35，类型 0 错误，build 成功，应用运行中。
GitHub 仓库整理 ✅（.gitignore / LICENSE / README / CI / Release workflow / Issue 模板）。
仅"NSIS 打包"+"类型文件合并"两项留待后续；EPUB/PDF/DOCX 导入已落地。
```