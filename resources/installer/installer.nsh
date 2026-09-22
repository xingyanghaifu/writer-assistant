; NSIS 自定义安装脚本（v3 P4，已修复兼容版本）
;
; 设计原则：
;  - 不 !include 任何插件头（MUI2.nsh / LogicLib.nsh 等）
;    — electron-builder 自带的 makensis 不一定带这些头，避免 NSIS 编译失败
;  - 只输出 DetailPrint 文本，零外部依赖
;  - 卸载时**保留** %APPDATA%\writer-assistant\ 下的用户数据
;    （用 NSIS 内置 deleteAppDataOnUninstall=false 即可达成，无需脚本）
;
; electron-builder 调用以下可重定义宏：
;   customHeader / customWelcomePage / customInstall / customUninstall
;
; 所有宏必须以 !macro / !macroend 包裹。

!macro customHeader
  ; 头部声明区：什么都不做，避免触发额外宏依赖
!macroend

!macro customWelcomePage
  ; 欢迎页：electron-builder 默认已显示 license + 路径选择页
  ; 此处不重写，避免触发 MUI 依赖
!macroend

!macro customInstall
  ; 安装完成时打印提示（安全：纯文本，不调用任何宏）
  DetailPrint "写作副驾 ${VERSION} 安装完成。"
  DetailPrint "用户作品数据保存在：$APPDATA\writer-assistant\"
  DetailPrint "卸载时不会删除用户数据；可在 设置 -> 数据目录 中管理。"
!macroend

!macro customUnInstall
  ; 卸载时打印提示
  DetailPrint "已卸载写作副驾。"
  DetailPrint "$APPDATA\writer-assistant\ 下的用户数据已保留。"
  DetailPrint "如需彻底清理，请手动删除该目录。"
!macroend