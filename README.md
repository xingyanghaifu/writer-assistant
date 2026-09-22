# 写作副驾（Writer's Assistant）

> 左侧专业写作工作台 + 右侧内嵌 AI 网页（DeepSeek / ChatGPT / Claude / Gemini）。
> 不绕过风控、不存账号凭证、不联网同步作品。

---

## ✨ 一句话

为长篇小说作者打造的桌面端双栏写作工具：左边安心写，右边 AI 帮忙润色、扩写、问问题。

## 🎯 核心特性

- **专业写作工作台**：草稿 / 大纲 / 角色 / 伏笔 / 便签 / 统计 6 个固定标签
- **AI 侧栏内嵌**：4 个 AI 站点网页（DeepSeek / ChatGPT / Claude / Gemini），partition 持久化登录态
- **桌面宠物**：本地灵感规则引擎（7 条）+ AI 灵感增强 + 宠物窗口独立渲染
- **拆书工作台**：TXT/MD 导入 → 智能分章 → 章节摘要 → AI 风格/节奏/大纲/仿写 → 入素材库
- **提示词库**：13 个内置模板 + 用户自定义 + 拖拽排序 + 变量替换 + 气泡接入
- **本地优先**：所有作品数据保存在本地，不联网同步
- **透明安全**：35 项冒烟测试、类型 0 错误、contextIsolation+sandbox 全程开启

## 📸 截图占位

> 截图目录 `docs/screenshots/`（待补；不含用户正文、不含任何第三方素材）

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20 LTS）
- pnpm 或 npm
- Windows 10+ / macOS 11+ / Ubuntu 20.04+

### 安装

```bash
git clone https://github.com/your-org/writer-assistant.git
cd writer-assistant
npm install
```

### 开发模式

```bash
npm run dev
```

### 类型检查

```bash
npm run typecheck
```

### 冒烟测试

```bash
npm run smoke
```

### 生产构建

```bash
npm run build
```

构建产物在 `out/` 目录。

### 启动应用

```bash
# 开发模式已自动启动；生产构建后：
.\node_modules\electron\dist\electron.exe .
```

> **不要使用 `npx electron`**，这会从 npx 缓存拉取不同的 electron 版本。

## 🔒 安全与隐私

- ❌ **不存储**任何 AI 账号凭证、cookie、token、密码
- ❌ **不联网同步**用户作品（所有数据保存在 `%APPDATA%\writer-assistant\`）
- ❌ **不绕过**任何 AI 站点的风控、登录、验证码
- ❌ **不内置**任何第三方 AI 素材、DeepSeek 娘、Live2D / Spine 模型
- ✅ 用户自行导入的形象素材版权归原权利人所有
- ✅ 渲染层 `contextIsolation:true / nodeIntegration:false / sandbox:true` 全程开启
- ✅ 所有 AI 调用走 BackgroundWebview 串行队列，块间隔 ≥ 500ms
- ✅ 风控 / 未登录 / 离线前置拦截 + 自动降级
- ✅ 缓存分 user / pet / breakdown 三桶，TTL 分级

## ⚖️ 合规声明

本项目仅用于**个人学习、研究**。禁止：

1. 用于绕过任何 AI 站点的风控、登录、验证码、限流
2. 账号池、多账号轮换、批量自动化
3. CDN 反代、官方 API 替代、HTTP 协议级伪装
4. 内置、打包、上传、再分发任何第三方 AI 站点素材
5. 默认发送整本书或整章作为 prompt
6. 销售本项目（或其分支）作为商业 SaaS

AI 站点的 ToS 优先于本项目；如站点变更策略，本项目可能不再兼容。

## 📁 目录结构

```
writer-assistant/
├── src/
│   ├── main/           # Electron 主进程（17 个服务 + IPC handlers）
│   ├── preload/        # preload 桥接（主窗口 + pet 独立）
│   ├── renderer/       # React 渲染层（31 个组件 + 6 个 store）
│   └── types/          # 15 个类型文件
├── scripts/            # setup / verify 脚本
├── resources/icons/    # 应用自有图标（不含第三方素材）
├── FEATURES.md         # 完整功能说明
├── FEATURES-STATUS.md  # 实现程度对照
└── LICENSE             # MIT + 附加合规说明
```

## 🤝 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

**禁止提交**：用户数据、第三方 AI 素材、个人路径、账号凭证。

## 🔐 安全漏洞

参见 [SECURITY.md](./SECURITY.md)。

## 📜 行为准则

参见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 📄 许可证

[MIT](./LICENSE)，附加合规说明。

## ⚠️ 免责声明

本项目按"现状"提供，不提供任何明示或暗示的保证。作者不对因使用本项目而产生的任何损失负责，包括但不限于账号封禁、数据丢失、AI 站点 ToS 变更等。

使用本项目即表示同意遵守所有适用法律和 AI 站点的服务条款。