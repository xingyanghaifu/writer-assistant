/**
 * IPC 注册总入口。
 *
 * 每个领域一个文件，由各子智能体独立负责，避免并行开发时的文件冲突：
 *   app.ts        窗口/应用        （主智能体）
 *   settings.ts   设置             （主智能体）
 *   webview.ts    脚本注入         （子智能体 B）
 *   bg.ts         后台建议会话     （子智能体 B）
 *   work.ts       作品/章节/版本   （子智能体 A）
 *   recovery.ts   崩溃恢复         （子智能体 A）
 *   material.ts   大纲/角色/伏笔…  （子智能体 C）
 *   io.ts         导入导出         （主智能体，阶段 6.5）
 *   backup.ts     备份             （主智能体，阶段 7.5）
 *   prompts.ts    提示词/缓存      （主智能体，阶段 12.5）
 *   advanced.ts   进阶功能/可视化  （主智能体，阶段 11 / 13）
 *   storage.ts    数据存储位置     （主智能体）
 */
import { registerAppIpc } from './app'
import { registerSettingsIpc } from './settings'
import { registerWorkIpc } from './work'
import { registerRecoveryIpc } from './recovery'
import { registerWebviewIpc } from './webview'
import { registerBackgroundIpc } from './background'
import { registerMaterialIpc } from './material'
import { registerIoIpc } from './io'
import { registerBackupIpc } from './backup'
import { registerPromptsIpc } from './prompts'
import { registerAdvancedIpc } from './advanced'
import { registerStorageIpc } from './storage'
import { registerPromptLibraryIpc } from './promptLibrary'
import { registerAgentIpc } from './agent'
import { registerPetIpc } from './pet'
import { registerBookBreakdownIpc } from './bookBreakdown'

let registered = false

export function registerIpc(): void {
  if (registered) return
  registered = true

  registerAppIpc()
  registerSettingsIpc()
  registerWorkIpc()
  registerRecoveryIpc()
  registerWebviewIpc()
  registerBackgroundIpc()
  registerMaterialIpc()
  registerIoIpc()
  registerBackupIpc()
  registerPromptsIpc()
  registerAdvancedIpc()
  registerStorageIpc()
  registerPromptLibraryIpc()
  registerAgentIpc()
  registerPetIpc()
  registerBookBreakdownIpc()
}
