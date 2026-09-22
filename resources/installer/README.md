# NSIS 安装器脚本（v3 P4）

## 文件
- `installer.nsh` — electron-builder NSIS `include` 自定义钩子

## 设计要点

| 项 | 决策 | 原因 |
|---|---|---|
| 安装路径 | 用户可自定义（`allowToChangeInstallationDirectory`） | 不强制 C:\Program Files |
| 权限 | per-user（`perMachine=false`，`allowElevation=false`） | 不需要管理员 |
| 快捷方式 | 桌面 + 开始菜单 | 标准分发 |
| 卸载行为 | **保留** `%APPDATA%\writer-assistant\` | 用户作品数据不丢；可在设置中自行迁移 |
| 欢迎页 | 简明声明 + 合规提示 | 法律 / 合规 |

## 自定义方法

```nsh
!macro customInstall
  ; 你的代码
!macroend
```

NSIS 在 `electron-builder` 中会调用以下宏（可重定义）：
- `customHeader` — 顶部声明
- `customWelcomePage` — 欢迎页
- `customInstall` — 安装逻辑
- `customUnInstall` — 卸载逻辑

## 调试

```bash
# 本地预演（不解包）：
npx electron-builder --win nsis --dir

# 完整安装器：
npx electron-builder --win nsis
```

## 升级行为

- NSIS 默认覆盖旧版本（同名 productName）
- 用户数据路径不变：升级不会丢失作品
- 注册表 HKCU\Software\WriterAssistant 记录 Version（用于升级提示）