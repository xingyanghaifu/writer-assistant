/**
 * 主题管理（v3 P2-6.1）。
 *
 * 三档：light / dark / parchment
 * system 模式跟随 prefers-color-scheme
 * 切换时只改 html[data-theme]，不触发 React 重渲染
 *
 * 启动顺序：
 *  1. main.tsx 调用 applyTheme(initial) 在 React 挂载前设值（避免闪烁）
 *  2. 用户在设置里改主题后调 setTheme
 *  3. 系统主题变化时（仅当用户选了 system）调 onSystemThemeChange
 */
export type ThemeMode = 'light' | 'dark' | 'parchment' | 'system'
export type EffectiveTheme = 'light' | 'dark' | 'parchment'

const STORAGE_KEY = 'wa:theme'

function systemPref(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function effectiveOf(mode: ThemeMode): EffectiveTheme {
  if (mode === 'system') return systemPref()
  return mode
}

/** 应用主题：在 html 上设 data-theme */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const eff = effectiveOf(mode)
  document.documentElement.setAttribute('data-theme', eff)
}

/** 读当前持久化的主题；无则返回 'system' */
export function loadTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const v = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
  if (v === 'light' || v === 'dark' || v === 'parchment' || v === 'system') return v
  return 'system'
}

/** 持久化 + 立即应用 */
export function setTheme(mode: ThemeMode): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode)
  applyTheme(mode)
}

/** 订阅系统主题变化（仅用户选 system 时需重应用） */
export function watchSystemTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const m = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (): void => cb()
  m.addEventListener('change', handler)
  return () => m.removeEventListener('change', handler)
}

/** 一次性：读存储 → 应用 → 启动系统监听 */
export function bootstrapTheme(): () => void {
  const mode = loadTheme()
  applyTheme(mode)
  // 即使不是 system 模式也注册监听，供后续切换时即时响应
  return watchSystemTheme(() => {
    if (loadTheme() === 'system') applyTheme('system')
  })
}