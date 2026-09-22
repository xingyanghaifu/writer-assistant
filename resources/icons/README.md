# 应用自有图标（v3 P4）

## 来源
- 仅含本项目自制的 SVG 图标（`icon.svg`）
- **不引用**任何第三方 AI 站点素材
- **不内置** DeepSeek 娘 / Live2D / Spine 等带版权的形象
- 用户自行导入的形象（宠物窗口）保存在 `%APPDATA%\writer-assistant\pet-assets\`，版权归原权利人所有

## 平台分发
- `electron-builder` 26+ 支持直接以 SVG 作为源，自动转换：
  - Windows: `.ico`（多尺寸 16/32/48/64/128/256）
  - macOS: `.icns`
  - Linux: PNG 多尺寸
- 见 `package.json` 的 `build.icon`

## 命名规范
- `icon.svg` — 主图标（256×256 viewBox）
- `icon@2x.png` — 备用高分辨率位图（如需，开发者自行准备 512×512）
- `tray.png` — 系统托盘图标（16×16 / 32×32 PNG，开发中）

## 拒绝清单
- ❌ 不要把第三方角色形象 / DeepSeek 娘 / Live2D 模型放入此目录
- ❌ 不要把任何带版权的图标资源纳入版本控制
- ❌ 不要在 build 产物中捆绑用户数据