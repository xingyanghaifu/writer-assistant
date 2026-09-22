# 写作副驾（Writer's Assistant）功能清单

> 用途：粘贴到 DeepSeek 网页版，让 AI 助手直接读取并据此回答你的问题。
> 格式：纯文本 + Markdown，无图片、无交互、无外部依赖。

---

## 一、产品定位

写作副驾是一款基于 Electron + TypeScript 的桌面端长篇小说写作辅助工具，采用「左侧写作工作台 + 右侧内嵌 AI 网页（DeepSeek / ChatGPT / Claude / Gemini）」双栏布局。

核心设计目标：
- 不绕过 AI 网站的风控与登录机制
- 不存储任何 AI 账号凭证
- 用户在右侧 AI 网页手动登录后，工具通过脚本注入驱动 AI 完成润色、扩写、缩写、改写、问 AI 等操作
- 所有用户作品数据保存在本地（不联网同步）

---

## 二、用户界面结构

### 主窗口布局

- 左侧：工作台（固定 360px，可折叠）
- 中间：分隔条（可拖动调整右侧宽度，支持平滑过渡；拖拽时过渡关闭避免延迟）
- 右侧：AI 侧栏（默认 460px，宽度可压缩；最小 320px，最大 900px）

### 左侧工作台（6 个固定标签）

1. 草稿：当前章节正文编辑器，含字数统计、自动保存（手动 / 自动 / AI 插入 / 导入 / 章节完成 / 崩溃恢复六种来源）、版本回滚、行级 diff
2. 大纲：层级化大纲树，支持拖拽排序、章纲生成、章纲继承
3. 角色：角色卡片网格，按 lastUpdatedAt 排序，可视化关系图
4. 伏笔：伏笔追踪表，标记已埋伏 / 已回收 / 预期回收时间
5. 便签：自由便签，含灵感子模块（10 个分类的灵感库 modal）
6. 统计：写作进度、健康提醒、数据可视化（趋势图、词云、活跃日历、回收率）

### 右侧 AI 侧栏

- 头部：tab 切换（AI 网页 / 改写记录）+ 站点状态徽章（在线 / 未登录 / 风控 / 离线 / 加载中五种状态彩色点）+ 折叠按钮
- 内容区：根据 tab 显示 AI 网页或改写记录面板
- AI 网页部分使用 `<webview>` 内嵌，partition 持久化登录态，UA 伪装为 Chrome/130

### 顶栏

- 站点下拉（4 个站点）
- 自动监听开关
- 工具按钮组：作品库 / 检索 / 导入 / 导出 / 备份 / 设置 / 站点管理

---

## 三、写作功能

### 3.1 章节 CRUD

- 新建作品 / 删除作品 / 重命名 / 编辑作者简介
- 新建卷 / 删除卷 / 重命名卷（每作品至少保留一卷）
- 新建章节 / 删除章节（每卷至少保留一章）/ 重命名章节
- 章节内可执行：保存、复制、清空
- 自动保存触发：手动（Ctrl+S）、自动（每 800ms 防抖）、AI 插入、导入、章节完成、崩溃恢复

### 3.2 版本历史

- 每次保存章节时，旧内容自动作为版本快照入库（source 字段标注来源）
- 最多保留 20 个版本（自动清理）
- 支持：列出版本、回滚到任意版本、标记重要版本、删除版本、导出单版本为 TXT
- 行级 diff：相同 / 新增 / 删除三色显示

### 3.3 崩溃恢复

- 编辑过程中每 5 秒写入临时草稿到 `<userData>/recovery/`
- 启动时扫描：列出候选草稿（章节 ID + 内容预览 + 时间戳）
- 一键恢复：选中的草稿会替换对应章节正文

### 3.4 字符级 diff 工具

- 用于润色/扩写结果对比
- 输出三种 segment：same（保留）/ add（新增）/ del（删除）
- 提供 DiffSummary：added / deleted / same / changeRatio

---

## 四、AI 辅助写作功能（气泡菜单）

> 选中文本后弹出气泡菜单，可执行以下操作。结果自动入「改写记录」侧栏。

### 4.1 五种 AI 动作

1. 润色（polish）：保持原意与风格，使表达更流畅
2. 扩写（expand）：补充细节与描写，使内容更丰富
3. 缩写（condense）：保留关键信息与情节，删除冗余
4. 改写（rewrite）：换一种表达方式，保持原意
5. 问 AI（ask）：用户输入问题，针对选区提问

### 4.2 第六个动作（非 AI）

- 标记伏笔：从选中文本创建一条伏笔条目

### 4.3 快捷键

- 选中文本后：
  - Ctrl+Shift+R：润色
  - Ctrl+Shift+E：扩写
  - Ctrl+Shift+C：缩写
  - Ctrl+Shift+W：改写
  - Ctrl+Shift+Q：问 AI

### 4.4 气泡结果面板

- 字符级 diff 对比视图（新增绿底、删除红删除线）
- 三个动作：替换原文 / 插入到光标 / 仅复制结果
- 重新生成（保留原文）
- 跳到侧栏「改写记录」
- 提示词快照（点击 ⚙ 查看当前动作所用模板，「在设置中修改」一键跳到设置页的提示词 tab）

### 4.5 改写记录侧栏

- 按章节分组、按时间倒序
- 每条记录：动作图标 / 类型 / 原文片段 / 时间戳 / 是否已应用
- 展开后看 diff + 改动统计（+/- 字数、变化百分比）
- 三个动作：复制并替换 / 仅复制结果 / 删除
- 批量清空（二次确认）
- localStorage 持久化（`wa.rewriteHistory.v1`），最多 100 条，跨重启保留
- 进 tab 时自动从 localStorage 重新加载

---

## 五、提示词管理

### 5.1 内置模板（13 个）

- 摘要 / 总结 / 角色分析 / 关系分析 / 伏笔分析 / 一致性检查 / 风格分析
- 润色 / 扩写 / 缩写 / 改写 / 问 AI
- 一键生成章纲（强制 JSON 输出）
- 大纲生成 / 灵感生成

### 5.2 自定义模板

- 设置 → 提示词 tab
- 可编辑、保存、导入、导出（JSON）
- 模板变量用 `{text}`、`{content}`、`{question}` 等占位符
- 内置 render 函数做安全替换

### 5.3 提示词版本管理

- 每个模板有 version 和 minAppVersion
- 内置 versionGte 函数做版本比较
- 支持「恢复默认」与「检查更新」

---

## 六、素材管理

### 6.1 角色管理

- 字段：id / name / intro / tags / appearances / mentions / supplements
- 进阶字段（阶段 11 一致性检查）：aliases / traits / appearance / status / relationships
- 操作：增删改、批量同步（从章节正文提取角色）、关系图可视化

### 6.2 伏笔管理

- 字段：id / name / description / plantedChapterId / plantedAt / expectedResolveChapterId / resolvedChapterId / status / priority
- 状态：planted（已埋伏）/ resolved（已回收）/ dropped（弃用）
- 回收率统计

### 6.3 地点 / 设定管理

- 字段：id / name / description / isNew
- 与卷/章关联

### 6.4 大纲管理

- 树形结构（递归）
- 字段：id / title / summary / children / order
- 拖拽排序

### 6.5 便签管理

- 自由文本
- 灵感子模块：10 个分类（角色 / 情节 / 对话 / 场景 / 冲突 / 主题 / 设定 / 物件 / 视角 / 其它）

---

## 七、AI 后台调用（高级功能）

### 7.1 智能分章

- 输入：全文（万字级）
- 输出：按情节断点的章节切分 + 每章摘要 + 关键事件列表
- 块大小：3000 字 / 块
- 块间隔 ≥ 500ms（合规）
- 强制 JSON 输出，解析失败回退到模糊匹配

### 7.2 同步分析（一致性检查）

- 输入：当前章节正文 + 已有素材库
- 输出：六类变更建议（character / foreshadowing / location / setting / outline）
- 用户可逐条勾选确认后才入库
- 分块引擎：splitIntoChunks → 逐块调用 → 结果合并去重

### 7.3 风格分析

- 输入：当前章节正文
- 输出：句长分布 / 高频词 / 风格标签
- 用于一致性检查

### 7.4 一致性检查

- 输入：当前章节 + 角色表 + 伏笔表 + 地点表 + 时间线
- 输出：报告（每条问题标注章节 + 类型 + 严重度）
- 涉及 7 类规则（角色状态 / 时间线 / 伏笔回收 / 设定冲突 / 地点错用 / 名称一致 / 视角）

### 7.5 敏感词检测

- 12 个内置敏感词 + 自定义词表
- 检测后给出建议替换词
- 用户可一键替换

### 7.6 一键生成章纲

- 输入：单章正文（任意长度）
- 输出：JSON {chapterSummary, keyEvents, characters, turningPoint, endingHook}
- 自动保存到 chapter.summary / summaryVersion / summaryUpdatedAt

### 7.7 章纲合并

- 多块摘要合并为一段完整摘要
- 用于超长章节的递归摘要

---

## 八、数据存储

### 8.1 主数据

- 路径：`<userData>/writer-assistant.json`
- 格式：JSON
- 内容：
  - works（作品列表，含卷/章/版本/统计）
  - materials（按 workId 维度的素材库，6 类：characters / foreshadowings / outlines / locations / notes / stats）
  - settings（应用设置）
  - versions（版本历史，按 chapterId 索引）
- 大小：用户作品 146k 字时 ~ 1.4 MB

### 8.2 临时草稿

- 路径：`<userData>/recovery/`
- 写入频率：每 5 秒
- 启动扫描 + 用户选择恢复

### 8.3 备份

- 路径：用户选择
- 格式：JSON（完整工作区）
- SHA-256 校验

### 8.4 导出格式

- JSON（工作区数据）
- TXT（章节正文 / 整本书）
- Markdown（带 # 标题层级）
- HTML（带基础样式）

### 8.5 TXT 自动分章

- 导入 TXT 后自动按正则识别章节标题（如「第 N 章」「Chapter N」）
- 可指定章节字数阈值
- 自动创建卷 / 章结构

### 8.6 自定义存储位置

- 设置 → 数据 → 存储位置
- 重启后生效（migration 模式可选：迁移现有数据 / 从头开始）
- bootstrap 文件记录 pending 路径

### 8.7 合并重复作品

- 启动后或作品库打开时自动检测同名作品
- 顶部横幅提示「检测到 N 部同名作品」
- 一键合并：把源作品的章节/素材迁移到目标，删除源
- 合并策略：按章节标题去重（较长一边胜出）、按 createdAt 早者胜出（同名素材）

---

## 九、AI 站点管理

### 9.1 支持的站点（4 个）

- DeepSeek（默认）：chat.deepseek.com
- ChatGPT：chat.openai.com
- Claude：claude.ai
- Gemini：gemini.google.com

### 9.2 适配器架构

- 每个站点一个 SiteAdapter（含 url、matchPatterns、inputSelectors、sendSelectors、loginIndicatorSelectors）
- 适配器只声明选择器，不写具体站点逻辑
- scripts.ts 把选择器编译成可执行脚本（loginState / insert / submit / extractLastReply / isStreaming）
- 主进程执行脚本，不知道任何站点细节
- 站点改版只需改 adapters/*.ts，无需改主进程

### 9.3 站点状态

- 五种状态：online / logged-out / risk / offline / loading / unknown
- 实时检测（dom-ready 后跑 loginState 脚本 + URL 风控模式匹配）
- 侧栏头部彩色徽章实时显示

### 9.4 风控检测

- URL 模式匹配：risk / control / verify / challenge / captcha / forbidden / banned
- 风控触发后 AI 调用被前置拦截
- toast 提示 + 自动切换到下一个可用站点

### 9.5 自动降级

- 站点从 online 跌到非 online 时，自动选下一个 available 站点切换
- toast 通知用户

### 9.6 清缓存（两档）

- 仅会话：清除 cookies / sessionStorage（保留 IndexedDB / 磁盘缓存），用于换账号
- 彻底清空：清除 cookies / localStorage / IndexedDB / cache / serviceWorkers / filesystem，必须重新登录
- 只清 AI 站点浏览器数据，不动用户作品

### 9.7 站点管理弹窗

- 显示当前站点状态
- 重新检测登录态
- 重新加载 AI 网页
- 清缓存两档
- 列出所有站点状态，一键切换

### 9.8 首启动引导卡

- 检测到站点不是 online 时弹出 3 步引导
- 选站点 → 在右侧登录 → 回到工作台开始写作
- 可勾选「不再提示」

---

## 十、稳定性保障

### 10.1 ErrorBoundary

- 渲染层 React 子树抛错时拦截 + 隔离 + 提示 + 一键重试
- 错误落到 toast（防止白屏）
- 已挂在 Workbench 的 TabBody 与 SplitWorkspace 的写作区

### 10.2 自动降级超时

- 后台 AI 调用：冷启动用 firstTokenLimit（最大 60s），续写用 idleLimit（默认 30s）
- 自适应空闲阈值：根据回复长度动态调整（最长 6s）
- 绝对 hardDeadlineMs 兜底（4 倍 timeout 或 180s）

### 10.3 后台会话隔离

- BackgroundWebview 与主 Webview 共用 partition（登录态共享）
- BackgroundWebview 渲染在视口外（left: -10000px），pointer-events: none
- 禁用 display:none（会破坏 Chromium 渲染管线）

### 10.4 缓存

- 路径：electron-store + 自建 cache（LRU 500 条）
- key：hashKey([draft, siteId, task, extra])
- TTL：24 小时
- 命中后跳过 AI 调用

### 10.5 性能优化

- 百万字倒排索引（2-gram 切词）
- 检索响应 < 50ms
- 虚拟滚动（章节列表 1000+ 章节流畅滚动）
- 增量构建索引（add / remove 不重建）

### 10.6 冒烟测试（31 项）

- 阶段 5：作品/章节 CRUD + 版本历史 + 行级 diff + 崩溃恢复
- 阶段 6.5：TXT 自动分章 + 导出 4 格式
- 阶段 7.5：备份 SHA-256 校验
- 阶段 10：四站点适配器
- 阶段 11：敏感词 + 风格分析 + 一致性检查 + 智能分章 + 目标进度 + 健康提醒 + 章纲
- 阶段 12：百万字检索 + 虚拟滚动 + LRU 缓存
- 阶段 12.5：提示词模板 + 缓存 + 网络
- 阶段 13：数据可视化（趋势/日历/词云/活跃/回收率）
- 自定义：合并作品 + 摘要写入 + 功能开关

---

## 十一、动画 / 交互细节

### 11.1 统一动效

- 三档时长：fast 120ms / base 180ms / slow 240ms
- 两套缓动：ease-out (cubic-bezier(0.22,1,0.36,1)) / standard (cubic-bezier(0.2,0,0,1))
- 4 个 keyframes：modal-in / fade-in / tab-in / slide-up

### 11.2 可访问性

- `prefers-reduced-motion: reduce` 全局覆盖：所有动画/过渡压到 1ms
- focus-visible 加 2px outline
- Esc 关闭弹层

### 11.3 微交互

- wa-interactive：hover 上抬 1px，active 按下 0.98 缩放
- 拖拽时 transition 全局短路（避免跟随延迟）
- 弹层遮罩淡入 + 内容轻微缩放上移
- 侧栏宽度平滑过渡

### 11.4 窗宽适配

- 窗口较窄时 AI 侧栏自动压缩
- 一次性 toast 提示（不再长亮标签）
- 极端窄窗口下隐藏右辅助面板

---

## 十二、技术栈

- Electron 33.4.11 + electron-vite 5.0.0 + Vite 7.3.9
- React 18.3.1 + Zustand 5.0.15
- TypeScript 5.9.3（strict 模式）
- electron-store 8.2.0
- Tailwind 3.4.19
- 三项目结构：src/main（主进程）+ src/preload（preload 脚本）+ src/renderer（渲染进程）
- 安全约束（全程遵守）：
  - contextIsolation: true
  - nodeIntegration: false
  - sandbox: true
- 仅通过 preload IPC 暴露 API 给渲染层
- 主进程不知道任何站点细节（site-agnostic）

---

## 十三、安全与隐私

- 不存储任何 AI 账号凭证（cookie 由 webview 自己管理）
- 不联网同步用户作品
- 所有数据保存在用户本地
- 不绕过 AI 网站的风控与登录验证
- AI 网页与工作台使用同一 partition（不暴露 Node API）
- 网络隔离：仅访问用户主动打开的 AI 站点
- 不自动发送用户当前对话（只发送构造好的提示词）
- 块间隔 ≥ 500ms（合规）
- 增量同步：每次仅上传必要的提示词与必要长度的文本

---

## 十四、已知限制

- AI 调用依赖右侧 webview 已登录（首次使用需用户手动登录）
- 站点改版时需更新适配器（目前 4 站点均已适配）
- 单台机器绑定（不跨设备同步）
- NSIS 打包尚未完成（当前通过 `release/win-unpacked/` 直接分发）
- 模板的 5% 还在测试中（如 smartSplit、chapterGoal 提醒）

---

## 十五、快速统计

- 源代码总量：约 23,000 行（src/main + src/renderer + src/types，v3 三模块新增 ~2,000 行）
- 主进程服务：16 个（新增 promptLibrary / pet / bookBreakdown）
- 渲染层 store：9 个（新增 petStore 预留）
- 渲染层组件：约 70 个（新增 PromptsLibraryTab / PromptPicker / PetSettingsDialog / BookBreakdownPanel / SiteManageDialog / WelcomeCard）
- 内置提示词模板：13 个 + 无限用户自定义
- AI 站点：4 个
- 冒烟测试：31 → 33 项（+2 个 v3 专项）

## 十六、v3 新增（提示词库 / 桌面宠物 / 拆书）

### 16.1 用户提示词库（v3 模块一）

> 在内置 13 个模板基础上，支持分类、收藏、变量测试、导入导出、自定义模板。

**数据模型**：`<userData>/writer-assistant.json` 中 `promptLibrary` 键，结构：
- id / name / category（10 类：润色改写/扩写缩写/角色人物/伏笔剧情/大纲结构/风格分析/一致性/灵感/工具/其他）
- content / variables（自动抽取）/ tags / favorite / enabled / order
- actionType（关联气泡菜单动作）/ siteScope（限定可用站点）
- version（每次保存递增）/ custom（true=用户可改，false=内置只读）/ createdAt / updatedAt / lastUsedAt / useCount

**变量系统**：
- 8 个内置变量：`{text}` 选中文本 / `{content}` 章节正文 / `{question}` 问题 / `{chapterSummary}` 章节摘要 / `{characters}` / `{foreshadowings}` / `{locations}` / `{outline}`
- 自定义变量（如 `{tone}` `{style}` `{length}`）：调用时若未填，自动弹小表单
- `renderTemplate` 已知变量替换 + 未知变量留占位返回 `missing[]`

**设置页 UI**（设置 → 提示词库）：
- 三栏：分类 / 搜索 | 列表 | 编辑 + 变量测试 + 实时预览
- 操作：双击使用 / 右键编辑 / 复制为自定义 / 收藏 / 删除（仅 custom 可删）/ 启用停用 / 排序 / 导入导出

**气泡菜单接入**：
- 新增 📚 选模板 按钮 → 打开 PromptPicker
- 三步流：选提示词 → 填变量 → 预览最终提示词 → 确认
- 确认后走 `window.api.bg.start({ task: 'ask', prompt: finalPrompt, siteId, scripts })`，沿用现有 BackgroundWebview 路径
- 自动写入改写记录（kind=ask，promptPreview 写「（提示词库）模板名」）

**IPC**（9 个新通道）：
- promptLibrary:list / save / remove / duplicate / reorder
- promptLibrary:import / export / render / touch（标记最近使用）

### 16.2 桌面宠物（v3 模块二）

> 透明置顶小窗口，实时感知写作内容，节流触发本地灵感，可选 AI 增强。

**窗口**：
- 200×240 px，`transparent: true / frame: false / alwaysOnTop: true / skipTaskbar: true`
- preload：`pet.ts`，contextIsolation:true / nodeIntegration:false / sandbox:true
- 渲染端入口：`src/renderer/pet/index.html`，独立 React 应用
- 移动结束自动写回位置 → `PetSettings.position`

**形象系统（用户本地导入）**：
- **不内置、不打包、不上传、不分发**任何形象素材
- **不自动扫描全盘**：用户主动选择目录或资源文件
- **默认引用本地路径**（`copied: false`），删除应用引用不影响原文件
- 可选「复制到应用数据」：复制到 `<userData>/pet-assets/<id>/`；删除时一起清（路径安全校验）
- 缺 `license` 字段视为「仅限个人本地使用，请勿分发」，UI 强制提示

**manifest 字段**：
- 10 个状态映射：`idle / writing / thinking / ai-calling / happy / alert / sleeping / dragging / risk / error`
- 类型支持：`frames`（PNG 帧序列）/ `spritesheet`（精灵图 + 帧坐标）/ `gif` / `apng` / `static`
- Live2D / Spine 预留适配层；无法解析时降级为 static

**触发策略**（节流，不每次按键都调用 AI）：
- 停顿 ≥ 2 秒 + 新增 ≥ 50 字 → 触发本地灵感
- 主动 AI 灵感默认关闭；开启时复用用户提示词库中「灵感」分类的条目
- 频率三档：低 / 中 / 高（控制节流间隔）
- 静默模式：不显示气泡，只改表情
- 遵守系统 `prefers-reduced-motion`

**IPC**（10 个新通道）：
- pet:open / pet:close
- pet:list-avatars / pet:import-avatar / pet:import-avatar-from-path / pet:switch-avatar / pet:delete-avatar
- pet:update-settings / pet:get-settings
- pet:inspiration（主进程 → 渲染层推送灵感事件）

**PetSettings**：enabled / avatarId / position / triggerFrequency / perceptionMinChars / perceptionIdleSeconds / allowAiInspiration / onlyFavoritePrompts / silent / honorReducedMotion / animationsEnabled

### 16.3 拆书工作台（v3 模块三）

> 导入书籍 → 自动分章 → 逐章 AI 摘要 / 关键事件 / 人物 / 伏笔 / 大纲 → 入库或导出。

**数据模型**：单独存储，不污染主作品库
- `<userData>/book-breakdowns/<projectId>.json`
- electron-store key `bookBreakdowns` 保存摘要索引（id / title / updatedAt / status / progress）

**BookBreakdownProject**：
- 字段：id / title / author / sourceFile / chapters[] / progress / status（idle / running / paused / done / failed）/ createdAt / updatedAt / chunkSize / anonymized（脱敏模式）
- 章节：index / title / content / analysisStatus / summary / keyEvents / characters / turningPoint / endingHook / error

**多格式导入与分章**：
- 选 TXT / MD / DOCX / EPUB / PDF 文件 → 读全文
- 本地规则识别（不调用 AI）：
  - `^第\s*[0-9一二...]+章` / `^第\s*[0-9...]+节` / `^第[一...]+卷`
  - `^Chapter\s+\d+`
- 按 header 位置切分；少于 2 章时 fallback 整本为 1 章

**AI 流水线**（渲染层驱动）：
- 复用现有 `window.api.bg.start`（BackgroundWebview + 网页版 AI）
- 串行逐章处理，块间隔 ≥ 600 ms（合规）
- 缓存：`hashKey([content, chunkSize, 'breakdown-summarize'])`，命中跳过
- 风控 / 未登录 / 离线 → 前置拦截 + 跳过该章（继续下一章）
- 暂停检查：`project.status === 'paused'` 时立即停
- 进度推送：`breakdown:progress` 事件（chapterIndex / status / message）

**AI 摘要单章 prompt**（强制 JSON 输出）：
```
你是长篇小说研究助手。请阅读以下章节，给出：
  summary: ≤300 字
  keyEvents: ≤5 条
  characters: 本章出现角色
  turningPoint / endingHook
严格 JSON 格式输出，不要解释
```

**结果使用**：
- 一键 ⬇ 入素材库：把人物 → `Character`、关键事件（首条）→ `Foreshadowing`（按 name/content 去重）
- 导出 JSON：项目摘要（不含原文）
- 合规提示：仅个人学习、研究、评论使用；不传播拆书结果全文；不绕过付费墙 / DRM / 登录；导入书籍本地保存，不上传整本；AI 调用只发必要分块；脱敏模式只发结构

**IPC**（10 个新通道）：
- breakdown:list / breakdown:get / breakdown:remove / breakdown:create
- breakdown:start / breakdown:pause / breakdown:resume
- breakdown:export-json / breakdown:import-to-materials / breakdown:generate-prompt
- breakdown:progress（主进程 → 渲染层事件）

### 16.4 v3 合规与硬约束

- 不存储 AI 账号 / cookie / token；不绕过登录 / 验证码 / 风控
- 不高频并发；不默认发送整本 / 整章
- AI 调用全部走 BackgroundWebview，块间隔 ≥ 500 ms
- 缓存沿用 LRU 500 / TTL 24h
- 主进程 site-agnostic；注入脚本由 renderer/adapters 编译
- 新增窗口（宠物）也走独立 preload，contextIsolation:true / nodeIntegration:false / sandbox:true
- 不内置 / 打包 / 上传任何形象素材；不自动扫描全盘
- 不绕过付费墙 / DRM / 登录

### 16.5 v3 冒烟测试（+2 项 → 33 项）

- v3 提示词库 + 拆书分章：变量渲染、本地分章、入库写读
- v3 宠物设置与存储：读写 PetSettings、形象包引用计数
- AI 站点：4 个
- 冒烟测试：31 项