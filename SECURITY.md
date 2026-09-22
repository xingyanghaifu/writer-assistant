# 安全策略

## 支持版本

下表列出本项目当前支持的版本线：

| 版本 | 支持状态 |
|------|---------|
| latest | ✅ 活跃维护 |
| < latest | ❌ 不再维护 |

## 报告漏洞

发现安全漏洞请通过以下方式**私下**报告：

- GitHub Security Advisories（推荐）
- 不要在公开 Issue 中披露未修复漏洞

响应时间：收到报告后 7 天内确认，30 天内评估修复方案。

## 🔒 项目硬约束

以下行为在本项目中**永远不会**实现：

- ❌ 绕过任何 AI 站点的风控、登录、验证码、限流
- ❌ 账号池、多账号轮换、批量自动化
- ❌ CDN 反代、官方 API 替代网页版 AI
- ❌ HTTP 协议级伪装、UA 欺骗以绕过检测
- ❌ 自动扫描全盘用户数据
- ❌ 内置 / 打包 / 上传 / 再分发第三方 AI 站点素材

## 🛡️ 安全特性

本项目当前的安全设计：

- ✅ Electron `contextIsolation: true`
- ✅ Electron `nodeIntegration: false`
- ✅ Electron `sandbox: true`
- ✅ 渲染层只能通过 preload IPC 访问主进程
- ✅ CSP（Content Security Policy）限制资源加载
- ✅ 不存储 AI 账号凭证、cookie、token
- ✅ 所有用户数据保存在本地（`app.getPath('userData')`）
- ✅ 不联网同步用户作品
- ✅ AI 调用走 BackgroundWebview 串行队列
- ✅ 风控前置拦截 + 自动降级

## 报告不存储凭证

本项目**不存储**：

- ❌ AI 账号密码
- ❌ Cookie（AI 站点登录态保存在 webview partition 内，由用户浏览器管理）
- ❌ API token
- ❌ 任何形式的凭证

如果发现本项目存储了上述任何一项，请立即报告（这是漏洞）。

## 已知限制

- 用户导入的形象素材版权归原权利人所有；项目不做版权审查，由用户自行负责
- 拆书功能不内置示例书籍；用户导入的内容版权归原作者所有
- AI 调用受站点状态影响；站点变更策略时功能可能中断