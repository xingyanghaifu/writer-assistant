import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useUiStore } from '../store/ui'

/**
 * 渲染层 ErrorBoundary：
 *  - React 子树异常时阻止整窗空白；
 *  - 暴露恢复按钮（清掉自身错误并提示用户重试）；
 *  - 错误上报给 toast，便于「白屏」时仍能留下线索。
 *
 * ⚠️ 背景：当前 28/28 冒烟只覆盖主进程逻辑 + DOM 存在性，
 *  渲染层一处抛错（例如某个 IPC 返回了旧版本数据触发解构失败），
 *  React 会卸载整棵子树而**没有任何兜底**。这里补齐兜底。
 */
interface State {
  hasError: boolean
  message: string
  info: string
}

interface Props {
  children: ReactNode
  /** 自定义兜底 UI；默认使用 toast + 重置按钮 */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode
  /** 错误分区名（仅用于诊断） */
  scope?: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', info: '' }

  static getDerivedStateFromError(err: Error): State {
    return {
      hasError: true,
      message: err?.message ?? String(err),
      info: (err?.stack ?? '').slice(0, 1200)
    }
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // 静默落到 toast，避免噪声；如果将来接入上报，这里是接入口
    try {
      useUiStore.getState().showToast(
        `${this.props.scope ? '「' + this.props.scope + '」' : ''}渲染出错：${err?.message ?? err}（已隔离，可继续用其它部分）`,
        'error'
      )
    } catch {
      /* toast 自身挂了也不能继续抛 */
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, message: '', info: '' })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) {
      return this.props.fallback({ error: new Error(this.state.message), reset: this.reset })
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-base">⚠️</span>
        <span className="text-xs font-semibold">这一片区域渲染失败了，其它部分不受影响</span>
        <span className="text-[11px] wa-muted">{this.state.message}</span>
        <button
          onClick={this.reset}
          className="mt-1 rounded bg-ink-800 px-3 py-1 text-xs text-white hover:bg-ink-900"
        >
          重试
        </button>
      </div>
    )
  }
}