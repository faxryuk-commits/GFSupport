import { ReactNode } from 'react'
import { Inbox, Search, AlertCircle, Plus } from 'lucide-react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    icon?: ReactNode
  }
  variant?: 'default' | 'search' | 'error'
  size?: 'sm' | 'md' | 'lg'
}

export function EmptyState({ 
  icon, 
  title, 
  description, 
  action, 
  variant = 'default',
  size = 'md' 
}: EmptyStateProps) {
  const defaultIcons = {
    default: <Inbox className="w-12 h-12 text-slate-300" />,
    search: <Search className="w-12 h-12 text-slate-300" />,
    error: <AlertCircle className="w-12 h-12 text-red-300" />,
  }

  const sizeClasses = {
    sm: 'py-8',
    md: 'py-12',
    lg: 'py-20',
  }

  return (
    <div className={`flex flex-col items-center justify-center text-center ${sizeClasses[size]}`}>
      <div className="mb-4">
        {icon || defaultIcons[variant]}
      </div>
      <h3 className="text-lg font-medium text-slate-800 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
        >
          {action.icon || <Plus className="w-4 h-4" />}
          {action.label}
        </button>
      )}
    </div>
  )
}
