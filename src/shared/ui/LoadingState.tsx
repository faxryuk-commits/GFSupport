interface LoadingStateProps {
  text?: string
  size?: 'sm' | 'md' | 'lg'
  fullScreen?: boolean
}

export function LoadingState({ text = 'Loading...', size = 'md', fullScreen }: LoadingStateProps) {
  const sizeClasses = {
    sm: { spinner: 'w-5 h-5', text: 'text-sm', padding: 'py-4' },
    md: { spinner: 'w-8 h-8', text: 'text-base', padding: 'py-12' },
    lg: { spinner: 'w-12 h-12', text: 'text-lg', padding: 'py-20' },
  }

  const styles = sizeClasses[size]

  const content = (
    <div className={`flex flex-col items-center justify-center ${styles.padding}`}>
      <div className={`${styles.spinner} border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin`} />
      {text && <p className={`mt-3 text-slate-500 ${styles.text}`}>{text}</p>}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
        {content}
      </div>
    )
  }

  return content
}
