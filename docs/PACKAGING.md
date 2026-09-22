# 打包手册（v3 P4）

> 本仓库的 `package.json` 已经配好 electron-builder 的 win / mac / linux 三平台配置。
> **打包动作不要在受限沙箱里跑**（spawn EPERM），请在开发者本机执行。
> 本文档面向**实际打发行版的开发者**。

## 0. 一次性准备

```bash
npm install --ignore-scripts        # electron 二进制走 setup:electron
npm run setup:electron              # 下载与平台对应的 Electron 二进制
npx tsc -p tsconfig.node.json --noEmit
npx tsc -p tsconfig.web.json --noEmit
```

## 1. 各平台命令

### Windows（NSIS 安装器 + zip 压缩包）

**首选**：双击或命令行运行

```cmd
scripts\build-win.cmd
```

无需修改 PowerShell ExecutionPolicy，纯净 `.cmd` 包装。

**备选**（如果 cmd 路径含空格或 PATH 异常）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1
```

**最直接**（如果 Electron 已经下载完）：

```bash
npm run dist:win
```

产物在 `release/`：

| 文件 | 用途 |
|---|---|
| `写作副驾-Setup-1.3.0-x64.exe` | NSIS 安装器（用户双击安装） |
| `写作副驾-1.3.0-x64.exe` | 绿色版 zip 解压即用 |
| `写作副驾-Setup-1.3.0-x64.exe.blockmap` | 增量更新用 |
| `latest.yml` | electron-updater 元数据 |

### macOS（dmg + zip）

```bash
# 必须在 macOS 上跑
npm run dist:mac
```

产物：
- `写作副驾-1.3.0-x64.dmg` / `写作副驾-1.3.0-arm64.dmg`
- `写作副驾-1.3.0-x64.zip` / `写作副驾-1.3.0-arm64.zip`

> 未签名：构建期设 `hardenedRuntime:false` / `gatekeeperAssess:false` / `identity:null`。
> 如需正式签名，请在 `package.json` 的 `build.mac` 里配置 `identity` + 证书。

### Linux（AppImage + deb）

```bash
# 必须在 Linux 上跑
npm run dist:linux
```

产物：
- `写作副驾-1.3.0-x64.AppImage` —— 免安装双击运行
- `写作副驾-1.3.0-x64.deb` —— Debian / Ubuntu 包

### 三平台并行

如需一次性构建三个平台，需在三台对应 OS 上分别运行
`npm run dist:win` / `dist:mac` / `dist:linux`。
electron-builder 不支持交叉编译。

## 2. 仅本地预演（不解包）

```bash
npm run pack
```

只生成 `release/win-unpacked/`（或 macOS 的 .app、Linux 的 unpacked 目录），
不打包成安装器，适合本地快速验证图标 / 资源是否正确。

## 3. NSIS 安装器行为

由 `resources/installer/installer.nsh` 定义（v3 P4 起已精简为纯文本钩子，
不依赖任何 NSIS 插件头，避免兼容问题）：

- `customHeader` — 顶部声明（空）
- `customInstall` — 安装后打印提示
- `customUnInstall` — 卸载后打印提示
- `customWelcomePage` — 欢迎页（用 electron-builder 默认）

卸载行为由 NSIS 内置选项控制：

| 选项 | 值 | 含义 |
|---|---|---|
| `deleteAppDataOnUninstall` | `false` | **保留** `%APPDATA%\writer-assistant\` |
| `oneClick` | `false` | 显示安装向导（可改路径） |
| `perMachine` | `false` | 不强制管理员 |
| `allowElevation` | `false` | 不尝试提权 |

## 4. 图标

源：`resources/icons/icon.svg`（256×256 viewBox，纯自制）

electron-builder 26+ 自动转：
- Windows：`.ico`（含 16/32/48/64/128/256 多尺寸）
- macOS：`.icns`
- Linux：多尺寸 PNG

如果需要替换图标：
1. 替换 `resources/icons/icon.svg`
2. 重新 `npm run dist:*`
3. 不要在仓库里直接放 `.ico` / `.icns` 二进制（已被 .gitignore 排除）

## 5. 代码签名（未启用）

本项目**不默认启用**代码签名：
- Windows：`signtoolOptions` 未配置
- macOS：`identity: null`
- Linux：未配置 DEB / RPM 签名

如需正式发布签名，需：
- Windows：购买 EV 代码签名证书，配置 `CSC_LINK` + `CSC_KEY_PASSWORD` 环境变量
- macOS：加入 Apple Developer Program，配置 notarize 凭据

## 6. 发布到 GitHub Release

1. 在 `package.json` 的 `build.publish` 段已配置 GitHub provider
2. 打 tag：`git tag v1.3.0`
3. 推送：`git push origin main --tags`
4. `.github/workflows/release.yml` 自动跑 `npm run dist:win`
5. 把 `release/*.exe` 上传到 GitHub Release

## 7. 不做的事（合规硬约束）

- ❌ 不内置 / 不打包 / 不上传 DeepSeek 娘 / Live2D / Spine 等第三方素材
- ❌ 不绕过任何 AI 站点风控
- ❌ 不存 AI 账号凭证
- ❌ 不联网同步用户作品
- ❌ 不内置示例用户数据 / 真实作品

## 8. 已知限制

- electron-builder 首次打包会从 GitHub 下载 electron 二进制（~80MB），受网络影响
- Windows 打包只能在 Windows（或带 Wine 的 Linux）跑；macOS 必须 macOS
- 沙箱里**不能**跑打包命令（spawn EPERM）
- 图标 SVG 必须有 256×256 viewBox，否则转换失败