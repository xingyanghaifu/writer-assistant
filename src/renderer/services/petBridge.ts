/**
 * 渲染层推灵感到主进程（v3 P0-3.1）。
 * 主进程会转发到宠物窗口。
 */
import type { InspirationItem } from '@shared/pet'

export async function pushInspiration(item: InspirationItem): Promise<void> {
  // 走现有 pet:pushInspiration 通道（已存在于 preload）
  try {
    await window.api.pet.pushInspiration(item)
  } catch {
    /* ignore */
  }
}