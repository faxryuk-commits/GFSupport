import { Clock, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight } from 'lucide-react'

export interface ResponseTimeStats {
  clientAvgMs: number
  agentAvgMs: number
  clientAvgFormatted: string
  agentAvgFormatted: string
  clientResponseCount: number
  agentResponseCount: number
  comparisonMs: number
  slowerParty: 'client' | 'agent'
}

interface ResponseTimeComparisonProps {
  stats: ResponseTimeStats | null
  compact?: boolean
  className?: string
}

export function ResponseTimeComparison({ stats, compact = false, className = '' }: ResponseTimeComparisonProps) {
  if (!stats || (stats.clientResponseCount === 0 && stats.agentResponseCount === 0)) {
    return null
  }

  const hasClientData = stats.clientResponseCount > 0
  const hasAgentData = stats.agentResponseCount > 0
  
  // Calculate who is slower and by how much
  const clientIsSlower = stats.slowerParty === 'client'
  const differenceFormatted = formatDuration(Math.abs(stats.comparisonMs))
  
  // Determine trend icon
  const TrendIcon = clientIsSlower ? TrendingDown : TrendingUp
  const trendColor = clientIsSlower ? 'text-amber-500' : 'text-green-500'

  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <Clock className="w-3 h-3 text-slate-400" />
        <span className="text-slate-600">Мы: {stats.agentAvgFormatted}</span>
        <span className="text-slate-400">•</span>
        <span className={clientIsSlower ? 'text-amber-600' : 'text-slate-600'}>
          Клиент: {stats.clientAvgFormatted}
        </span>
        {clientIsSlower && <ArrowDownRight className="w-3 h-3 text-amber-500" />}
      </div>
    )
  }

  return (
    <div className={`p-4 bg-slate-50 rounded-xl ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-slate-500" />
        <h4 className="font-medium text-slate-700 text-sm">Скорость коммуникации</h4>
      </div>

      <div className="space-y-3">
        {/* Agent response time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-slate-600">Мы отвечаем</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">
              {hasAgentData ? `~${stats.agentAvgFormatted}` : '—'}
            </span>
            {hasAgentData && !clientIsSlower && (
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                быстрее
              </span>
            )}
          </div>
        </div>

        {/* Client response time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${clientIsSlower ? 'bg-amber-500' : 'bg-slate-400'}`} />
            <span className="text-sm text-slate-600">Клиент отвечает</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-medium ${clientIsSlower ? 'text-amber-600' : 'text-slate-800'}`}>
              {hasClientData ? `~${stats.clientAvgFormatted}` : '—'}
            </span>
            {hasClientData && clientIsSlower && (
              <span className="text-xs text-amber-600 flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" />
                медленнее
              </span>
            )}
          </div>
        </div>

        {/* Comparison bar */}
        {hasClientData && hasAgentData && (
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendIcon className={`w-4 h-4 ${trendColor}`} />
              <span className="text-xs text-slate-500">
                {clientIsSlower 
                  ? `Клиент отвечает на ${differenceFormatted} медленнее`
                  : `Мы отвечаем на ${differenceFormatted} медленнее`
                }
              </span>
            </div>
            
            {/* Visual bar */}
            <div className="flex gap-1 h-2">
              <div 
                className="bg-green-400 rounded-l"
                style={{ 
                  flex: Math.max(1, Math.min(10, stats.agentAvgMs / 60000)) 
                }}
              />
              <div 
                className={`${clientIsSlower ? 'bg-amber-400' : 'bg-slate-300'} rounded-r`}
                style={{ 
                  flex: Math.max(1, Math.min(10, stats.clientAvgMs / 60000)) 
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>Мы</span>
              <span>Клиент</span>
            </div>
          </div>
        )}

        {/* Stats count */}
        <div className="text-[10px] text-slate-400 pt-1">
          На основе {stats.agentResponseCount + stats.clientResponseCount} ответов
        </div>
      </div>
    </div>
  )
}

// Helper function to format duration
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—'
  
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}с`
  
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}м`
  
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}ч ${remainingMinutes}м` : `${hours}ч`
  }
  
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}д ${remainingHours}ч` : `${days}д`
}
