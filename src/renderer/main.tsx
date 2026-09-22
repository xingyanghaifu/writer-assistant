import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { useUiStore } from './store/ui'
import { getAdapter } from './adapters/registry'
import { bootstrapTheme } from './services/theme'

// 在 React 挂载前应用主题，避免首屏闪烁
bootstrapTheme()

// 启动时加载设置（阶段 7：恢复上次状态）
async function bootstrap(): Promise<void> {
  try {
    const settings = await window.api.settings.get()
    const store = useUiStore.getState()
    store.setSettings(settings)
    // 恢复上次使用的站点（仅当该站点已有适配器）
    if (settings.lastSiteId && getAdapter(settings.lastSiteId)) {
      store.setSiteId(settings.lastSiteId)
    }
  } catch (err) {
    console.error('[bootstrap] 加载设置失败', err)
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
