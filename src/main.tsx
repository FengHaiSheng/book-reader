import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

/**
 * 顶层兜底。
 *
 * 渲染期与 effect 里抛出的错都会被 React 卸载整棵树 —— 没有边界时用户看到的是一片空白，
 * 既不知道出了什么事，也不知道还能做什么。这里把原因说出来，并给一个重新加载的入口。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面出错：', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center'
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>界面出错了</h1>
        <p style={{ maxWidth: 520, fontSize: 13, lineHeight: 1.7, opacity: 0.75 }}>
          {this.state.error.message}
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    )
  }
}

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')
createRoot(el).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
