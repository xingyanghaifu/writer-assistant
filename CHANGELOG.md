# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- GitHub 仓库整理（.gitignore / LICENSE / README / CI / Release workflow）
- UI 设计 token 体系扩展（深色 / 浅色 / 羊皮纸三主题）
- 统一基础组件库（Button / Input / Card / Modal / Toast / Badge / Tabs / Tooltip）
- 空状态 / 加载 / 错误组件

## [1.3.0] - 2025-XX-XX

### Added
- v3 P1/P2/P3：提示词拖拽排序、角色关系图、拆书脱敏模式
- 统一 AI 任务抽象层（user / pet / breakdown 三优先级）
- 渲染层事件总线
- 缓存分 user / pet / breakdown 三桶
- 宠物 GPU 优化（prefers-reduced-motion + 5min idle → 2fps）
- 拆书大项目内存优化（进度事件 500ms 节流）

## [1.2.0] - 2025-XX-XX

### Added
- v3 P0-3.3 拆书工作台进阶（风格 / 节奏 / 大纲 / 仿写提示词 4 项 AI 分析）
- v3 P0-3.1 桌面宠物本地灵感规则引擎（7 条规则 + CharThrottle + runWhenIdle）
- v3 P0-3.2 宠物 AI 灵感增强（复用提示词库「灵感」分类）

## [1.1.0] - 2025-XX-XX

### Added
- v3 模块二：桌面宠物（透明置顶窗口 / 形象包导入 / 设置面板 / 10 个状态映射）
- 独立 pet preload + 独立渲染进程

## [1.0.0] - 2025-XX-XX

### Added
- v3 模块一：用户提示词库（13 个内置模板 + 自定义 + 变量替换 + 气泡接入）
- v3 模块三：拆书工作台（TXT / MD 导入 / 智能分章 / 章节摘要 / 入素材库 / 导出）
- 35 项冒烟测试（全部通过）
- 4 站点适配（DeepSeek / ChatGPT / Claude / Gemini）
- 站点健康化（5 状态 / 风控拦截 / 清缓存 / 首启引导）
- 数据可视化（字数趋势 / 写作日历 / 词云 / 伏笔回收率 / 多模型对比）

## [0.9.0] - 2025-XX-XX

### Added
- 站点管理（4 站点 / 风控状态 / 健康检查）
- LRU 缓存 + TTL 24h
- BackgroundWebview AI 调用（串行 + 超时 + 风控降级）

## [0.5.0] - 2025-XX-XX

### Added
- 阶段 5-7：作品 CRUD / 章节版本 / 崩溃恢复 / 备份 SHA-256
- 阶段 10-12：4 站点适配 / 智能分章 / 百万字检索 / 虚拟滚动
- 阶段 13：数据可视化