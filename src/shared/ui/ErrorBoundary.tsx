import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="text-6xl text-red-400 mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Что-то пошло не так</h2>
          <p className="text-sm text-slate-500 mb-4 max-w-md">
            {this.state.error.message}
          </p>
          <pre className="text-xs text-left bg-slate-100 p-4 rounded-lg max-w-lg overflow-auto mb-4 max-h-32">
            {this.state.error.stack?.slice(0, 500)}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Попробовать снова
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
