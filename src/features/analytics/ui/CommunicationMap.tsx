import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, MessageSquare, TrendingUp, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import { apiGet, apiPost } from '@/shared/services/api.service'

interface PurposeItem {
  purpose: string
  label: string
  count: number
  avgValue: number
  totalMessages: number
}

interface AgentBreakdown {
  name: string
  purposes: Record<string, number>
  total: number
  productivityPercent: number
}

interface ShadowCase {
  id: string
  title: string
  channelName: string
  priority: string
  createdAt: string
}

interface SessionsData {
  overview: {
    totalSessions: number
    productiveSessions: number
    productivityPercent: number
    shadowCasesCount: number
  }
  purposeDistribution: PurposeItem[]
  agentBreakdown: AgentBreakdown[]
  shadowCases: ShadowCase[]
}

const PURPOSE_COLORS: Record<string, string> = {
  problem_resolution: 'bg-red-500',
  customer_inquiry: 'bg-blue-500',
  team_coordination: 'bg-purple-500',
  status_update: 'bg-amber-500',
  general_chat: 'bg-slate-400',
}

const PURPOSE_LIGHT_COLORS: Record<string, string> = {
  problem_resolution: 'bg-red-100 text-red-700',
  customer_inquiry: 'bg-blue-100 text-blue-700',
  team_coordination: 'bg-purple-100 text-purple-700',
  status_update: 'bg-amber-100 text-amber-700',
  general_chat: 'bg-slate-100 text-slate-600',
}

export function CommunicationMap() {
  const [data, setData] = useState<SessionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const result = await apiGet<SessionsData>('/analytics/conversation-sessions?period=30')
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleRebuild = async () => {
    setRebuilding(true)
    try {
      await apiPost('/analytics/conversation-sessions', { days: 30 })
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Ошибка перестроения')
    } finally {
      setRebuilding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-slate-600 mb-4">{error || 'Нет данных'}</p>
        <button onClick={handleRebuild} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
          Построить сессии
        </button>
      </div>
    )
  }

  const { overview, purposeDistribution, agentBreakdown, shadowCases } = data
  const totalCount = purposeDistribution.reduce((s, p) => s + p.count, 0) || 1

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
            <MessageSquare className="w-4 h-4" />
            Всего сессий
          </div>
          <p className="text-2xl font-bold text-slate-800">{overview.totalSessions}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
            <TrendingUp className="w-4 h-4" />
            Продуктивных
          </div>
          <p className="text-2xl font-bold text-green-600">{overview.productivityPercent}%</p>
          <p className="text-xs text-slate-400">{overview.productiveSessions} из {overview.totalSessions}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
            <BarChart3 className="w-4 h-4" />
            Решено в чате
          </div>
          <p className="text-2xl font-bold text-amber-600">{overview.shadowCasesCount}</p>
          <p className="text-xs text-slate-400">без создания тикета</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-center">
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700 transition-colors disabled:opacity-50"
          >
            {rebuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Обновить анализ
          </button>
        </div>
      </div>

      {/* Purpose Distribution - Stacked Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Распределение коммуникаций</h3>
        <div className="flex h-8 rounded-lg overflow-hidden mb-4">
          {purposeDistribution.map(p => {
            const pct = (p.count / totalCount) * 100
            if (pct < 1) return null
            return (
              <div
                key={p.purpose}
                className={`${PURPOSE_COLORS[p.purpose] || 'bg-slate-300'} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${p.label}: ${p.count} (${Math.round(pct)}%)`}
              />
            )
          })}
        </div>
        <div className="flex flex-wrap gap-4">
          {purposeDistribution.map(p => (
            <div key={p.purpose} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-sm ${PURPOSE_COLORS[p.purpose] || 'bg-slate-300'}`} />
              <span className="text-sm text-slate-700">{p.label}</span>
              <span className="text-xs text-slate-400">{p.count} ({Math.round((p.count / totalCount) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />
          Продуктивность по сотрудникам
        </h3>
        <div className="space-y-3">
          {agentBreakdown.slice(0, 15).map(agent => {
            const agentTotal = agent.total || 1
            return (
              <div key={agent.name} className="group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{agent.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{agent.total} сессий</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      agent.productivityPercent >= 70 ? 'bg-green-100 text-green-700' :
                      agent.productivityPercent >= 40 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {agent.productivityPercent}% продуктивно
                    </span>
                  </div>
                </div>
                <div className="flex h-4 rounded overflow-hidden bg-slate-100">
                  {Object.entries(agent.purposes).map(([purpose, count]) => {
                    const pct = (count / agentTotal) * 100
                    if (pct < 1) return null
                    return (
                      <div
                        key={purpose}
                        className={`${PURPOSE_COLORS[purpose] || 'bg-slate-300'}`}
                        style={{ width: `${pct}%` }}
                        title={`${purpose}: ${count}`}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
          {agentBreakdown.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">Нет данных о сессиях сотрудников</p>
          )}
        </div>
      </div>

      {/* Shadow Cases */}
      {shadowCases.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Решено в чате без тикета</h3>
          <div className="space-y-2">
            {shadowCases.slice(0, 10).map(c => (
              <div key={c.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs rounded ${PURPOSE_LIGHT_COLORS.problem_resolution}`}>
                    {c.priority}
                  </span>
                  <span className="text-sm text-slate-700 truncate max-w-[300px]">{c.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>{c.channelName}</span>
                  <span>{new Date(c.createdAt).toLocaleDateString('ru-RU')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
