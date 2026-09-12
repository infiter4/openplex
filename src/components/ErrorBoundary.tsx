import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('[openplex] render error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="font-mono text-[15px] text-faint">
            open<span className="text-accent">plex</span>
          </div>
          <h1 className="text-[17px] font-semibold text-ink">Something broke on screen</h1>
          <p className="text-[13px] text-muted leading-relaxed">
            The app hit an unexpected error. Your chats and keys are safe — they're stored locally. Try
            recovering below; if it keeps happening, reload.
          </p>
          {import.meta.env.DEV && (
            <pre className="text-left text-[11.5px] text-danger bg-bg1 border border-line rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
              {error.message}
            </pre>
          )}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-line text-ink hover:bg-bg2 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
