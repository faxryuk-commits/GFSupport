import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, Lightbulb, Zap,
} from 'lucide-react'
import type { AIRecommendation } from '../model/types'

interface Props {
  recommendations: AIRecommendation[]
}

const styles = {
  warning: { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-600' },
  success: { icon: CheckCircle, bg: 'bg-green-50', border: 'border-green-200', iconColor: 'text-green-600' },
  info: { icon: Lightbulb, bg: 'bg-blue-50', border: 'border-blue-200', iconColor: 'text-blue-600' },
  action: { icon: Zap, bg: 'bg-purple-50', border: 'border-purple-200', iconColor: 'text-purple-600' },
}

export function AIRecommendationsPanel({ recommendations }: Props) {
  if (recommendations.length === 0) return null

  return (
    <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
          <Lightbulb className="w-4 h-4 text-white" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-800">AI Рекомендации</h2>
          <p className="text-xs text-slate-500">На основе анализа данных за период</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {recommendations.slice(0, 4).map(rec => {
          const style = styles[rec.type]
          const Icon = style.icon
          return (
            <div key={rec.id} className={`${style.bg} ${style.border} border rounded-lg p-3 flex items-start gap-3`}>
              <Icon className={`w-5 h-5 ${style.iconColor} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{rec.title}</p>
                <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{rec.description}</p>
                {rec.action && (
                  <Link to={rec.action.link} className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                    {rec.action.label} →
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
