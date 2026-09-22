import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * Electron <webview> 的 JSX 类型声明。
 * React 18 的 JSX.IntrinsicElements 不含 webview，需显式声明。
 */
type WebviewProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  partition?: string
  allowpopups?: boolean | string
  useragent?: string
  preload?: string
  nodeintegration?: boolean | string
  webpreferences?: string
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps
    }
  }
}

export {}
