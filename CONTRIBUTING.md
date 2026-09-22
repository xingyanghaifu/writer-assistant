# 贡献指南

感谢您考虑为本项目做出贡献！

## 分支模型

- `main`：稳定分支，CI 必须通过
- `feature/*`：新功能
- `fix/*`：bug 修复
- `docs/*`：文档更新

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型：
- `feat`：新功能
- `fix`：修复
- `refactor`：重构
- `docs`：文档
- `test`：测试
- `chore`：构建 / 工具
- `style`：格式（不改逻辑）

示例：

```
feat(pet): 增加 7 条本地灵感规则引擎
fix(breakdown): 修复章节摘要丢失首字符
```

## PR 要求

提交 PR 前请确保：

1. ✅ `npm run typecheck` 通过
2. ✅ `npm run smoke` 全部通过（35/35）
3. ✅ 不破坏安全约束（contextIsolation / sandbox / 不绕过风控）
4. ✅ 不引入大型 UI 依赖（如 MUI / AntD / Chakra）
5. ✅ 不修改 IPC channel 名（保持向后兼容）
6. ✅ UI 改动附带 before / after 截图（不含用户数据）

## 🚫 禁止提交

- **用户数据**：`writer-assistant.json`、`book-breakdowns/`、`recovery/`、`pet-assets/`、`prompt-library.json`、`bootstrap.json`
- **第三方 AI 素材**：DeepSeek 娘图片、Live2D 模型、Spine 模型、任何带版权的角色形象
- **个人路径**：`C:\Users\<user>\...`、`/Users/<user>/...`
- **账号凭证**：cookie、token、password、secret
- **真实用户作品内容**：示例 / 测试请使用占位文本

## 代码风格

- TypeScript strict
- 2 空格缩进（参考 `.editorconfig`）
- 不引入 Prettier（保持原仓库风格）；新增文件遵循现有命名约定

## 测试

冒烟测试位于 `src/main/smoke.ts`，新增功能请同步增加 smoke 项。

## 行为准则

参见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。