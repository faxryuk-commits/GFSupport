import { useState, useEffect } from 'react'
import { Star, TrendingUp, TrendingDown, Users, MessageSquare, Loader2 } from 'lucide-react'
import { fetchFeedbackStats, type FeedbackStats as FeedbackStatsType } from '@/shared/api/feedback'
import { RATING_CONFIG, FEEDBACK_TAG_CONFIG, formatAverageRating } from '@/entities/feedback'

interface FeedbackStatsProps {
  agentId?: string
  from?: string
  to?: string
  className?: string
}

export function FeedbackStats({ agentId, from, to, className = '' }: FeedbackStatsProps) {
  const [stats, setStats] = useState<FeedbackStatsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStats()
  }, [agentId, from, to])

  const loadStats = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const data = await fetchFeedbackStats({ agentId, from, to })
      setStats(data)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки статистики')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 p-6 flex items-center justify-center ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 p-6 text-center text-red-500 ${className}`}>
        {error || 'Нет данных'}
      </div>
    )
  }

  const ratingConfig = RATING_CONFIG[Math.round(stats.averageRating)] || RATING_CONFIG[3]

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Main Rating */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-slate-900">Отзывы клиентов</h3>
          <span className="text-sm text-slate-500">{stats.totalFeedback} отзывов</span>
        </div>

        <div className="flex items-center gap-6">
          {/* Average Rating */}
          <div className="text-center">
            <div className={`text-5xl font-bold ${ratingConfig.color}`}>
              {formatAverageRating(stats.averageRating)}
            </div>
            <div className="flex items-center justify-center gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={`w-5 h-5 ${
                    n <= Math.round(stats.averageRating)
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-slate-200'
                  }`}
                />
              ))}
            </div>
            <div className="text-sm text-slate-500 mt-1">{ratingConfig.label}</div>
          </div>

          {/* Rating Distribution */}
          <div className="flex-1 space-y-2">
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = stats.ratingDistribution[rating] || 0
              const percentage = stats.totalFeedback > 0 
                ? Math.round((count / stats.totalFeedback) * 100) 
                : 0
              
              return (
                <div key={rating} className="flex items-center gap-2">
                  <span className="w-3 text-xs text-slate-500">{rating}</span>
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        rating >= 4 ? 'bg-green-500' :
                        rating === 3 ? 'bg-yellow-500' :
                        'bg-red-500'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="w-12 text-xs text-slate-500 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Common Tags */}
      {stats.commonTags.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h4 className="font-medium text-slate-700 mb-4">Частые отзывы</h4>
          <div className="flex flex-wrap gap-2">
            {stats.commonTags.map(({ tag, count }) => {
              const tagConfig = FEEDBACK_TAG_CONFIG[tag as keyof typeof FEEDBACK_TAG_CONFIG]
              return (
                <div
                  key={tag}
                  className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${
                    tagConfig?.isPositive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {tagConfig?.emoji} {tagConfig?.label || tag}
                  <span className="text-xs opacity-60">({count})</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* By Agent */}
      {stats.byAgent.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h4 className="font-medium text-slate-700 mb-4 flex items-center gap-2">
            <Users className="w-4 h-4" />
            По сотрудникам
          </h4>
          <div className="space-y-3">
            {stats.byAgent.map((agent) => {
              const agentRatingConfig = RATING_CONFIG[Math.round(agent.averageRating)] || RATING_CONFIG[3]
              return (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                      {agent.agentName?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{agent.agentName}</div>
                      <div className="text-xs text-slate-500">
                        {agent.feedbackCount} отзывов
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-semibold ${agentRatingConfig.color}`}>
                      {formatAverageRating(agent.averageRating)}
                    </span>
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Trend */}
      {stats.trend.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h4 className="font-medium text-slate-700 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Тренд
          </h4>
          <div className="flex items-end gap-1 h-24">
            {stats.trend.slice(-14).map((day, i) => {
              const height = (day.averageRating / 5) * 100
              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col items-center"
                  title={`${day.date}: ${day.averageRating.toFixed(1)} (${day.count})`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      day.averageRating >= 4 ? 'bg-green-400' :
                      day.averageRating >= 3 ? 'bg-yellow-400' :
                      'bg-red-400'
                    }`}
                    style={{ height: `${height}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-400">
            <span>{stats.trend[0]?.date}</span>
            <span>{stats.trend[stats.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  )
}
