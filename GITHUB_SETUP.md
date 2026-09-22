# GitHub 发布清单

## 本地仓库初始化

```bash
git init
git add .
git commit -m "chore: initial GitHub project"
git branch -M main
git remote add origin https://github.com/xingyanghaifu/writer-assistant.git
git push -u origin main
```

## 已纳入仓库的内容

- `src/`：Electron 主进程、preload 和 React 渲染层源码
- `scripts/`：安装、验证和跨平台打包脚本
- `resources/`：应用自身图标和安装器资源
- `docs/`：打包与验收文档
- `.github/`：CI、Release、Issue 和 PR 模板
- `README.md`、`FEATURES.md`、`SECURITY.md`、`CONTRIBUTING.md`、`LICENSE`

## 已排除的内容

`.gitignore` 会排除依赖、构建产物、安装包、日志、报告、临时测试文件、用户数据、第三方素材和本地敏感配置。不要手动强制添加这些文件。

## 发布前检查

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
```

GitHub Actions 会在推送到 `main` 或提交 Pull Request 时执行类型检查和 Electron 冒烟测试。正式发布可使用仓库中的 Release 工作流。

## 仓库信息

- GitHub 用户名：`xingyanghaifu`
- 应用名称：写作副驾（Writer's Assistant）
- 当前版本：以 `package.json` 为准
- 许可证：MIT（附加合规说明见 `LICENSE` 和 `CONTRACT.md`）
- 项目地址：`https://github.com/xingyanghaifu/writer-assistant`
