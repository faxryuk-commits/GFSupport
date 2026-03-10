import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

interface StepInfo {
  icon: string
  text: string
}

interface EducationalEmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  steps?: StepInfo[]
  action?: {
    label: string
    onClick: () => void
  }
  variant?: 'default' | 'compact'
}

export function EducationalEmptyState({
  icon,
  title,
  description,
  steps = [],
  action,
  variant = 'default',
}: EducationalEmptyStateProps) {
  if (variant === 'compact') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="mb-4 text-gray-300">{icon}</div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 max-w-xs mb-3">{description}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            {action.label} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-5 text-gray-300">{icon}</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">{description}</p>

        {steps.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Как начать</p>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">{step.icon}</span>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-sm text-gray-700">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {action && (
          <button
            onClick={action.onClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
          >
            {action.label}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
