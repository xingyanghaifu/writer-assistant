import { BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * 内嵌 webview 使用的 Chrome 版本号（伪装 UA 用）。
 *
 * 背景：Electron 默认 UA 结尾是 "Electron/33.4.11"，DeepSeek 等站点会据此
 * 判定「使用环境异常」，从而拒绝保持登录态（登录后立刻跳回 sign_in）。
 * 这是站点侧的风控行为，不是本应用缺陷，也无法靠改代码绕过其判定；
 * 我们能做的是让内嵌页面表现得像标准 Chrome —— 与用户自己用浏览器访问一致。
 *
 * 注意：这里只改 UA 字符串，**不伪造任何登录凭证、不绕过验证码或风控校验**。
 * 用户仍需在本页面正常登录，登录失败时页面会如实报错。
 */
const CHROME_MAJOR = '130'
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`

/** 应用伪装 UA 到内嵌 AI 站点所在的 partition */
export function applyEmbeddedUserAgent(): void {
  try {
    const ses = session.fromPartition('persist:writer-assistant')
    ses.setUserAgent(CHROME_UA)
  } catch (err) {
    console.error('[ua] 设置内嵌 UA 失败', err)
  }
}

/** 主窗口创建。安全约束：contextIsolation 开、nodeIntegration 关、sandbox 开。 */
export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    autoHideMenuBar: true,
    transparent: false,
    backgroundColor: '#eef1f6',
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: 'active',
    roundedCorners: true,
    icon: (() => {
      const ico = join(process.cwd(), 'resources', 'icons', 'icon.ico')
      const png = join(process.cwd(), 'resources', 'icons', 'icon.png')
      if (existsSync(ico)) return ico
      if (existsSync(png)) return png
      return undefined
    })(),
    title: '写作副驾',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全约束（全程遵守）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 阶段 1：内嵌 AI 网页
      webviewTag: true,
      // 后台会话与主 webview 复用同一 partition（登录态共享）
      webSecurity: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外部链接交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
