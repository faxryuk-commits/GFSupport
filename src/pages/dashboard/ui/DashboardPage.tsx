import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { EmptyState, LoadingState } from '@/shared/ui'
import { fetchAnalytics, type DashboardMetrics, type AnalyticsData } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import { ResponseTimeDetailsModal, WeeklyScoreWidget } from '@/features/analytics'
import { CommitmentsPanel } from '@/features/commitments/ui'
import { generateAIRecommendations } from '../model/recommendations'
import { formatWaitTime } from '../model/types'
import type { AttentionItem, RecentActivity, ResponseTimeModalData } from '../model/types'
import { DashboardHeader } from './DashboardHeader'
import { AIRecommendationsPanel } from './AIRecommendationsPanel'
import { ChannelSourceSummary, type SourceFilter } from './ChannelSourceSummary'
import { MetricsSection } from './MetricsSection'
import { OperationsSection } from './OperationsSection'
import { StatsSection } from './StatsSection'
import { SLACategoryModal } from './SLACategoryModal'

export function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState('today')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [needsAttention, setNeedsAttention] = useState<AttentionItem[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  const [responseTimeModal, setResponseTimeModal] = useState<ResponseTimeModalData | null>(null)
  const [slaCategoryModal, setSlaCategoryModal] = useState<{ category: string; label: string } | null>(null)
  const [slaCategoryMessages, setSlaCategoryMessages] = useState<any[]>([])
  const [slaCategoryLoading, setSlaCategoryLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [analyticsData, channelsData, agentsData] = await Promise.all([
        fetchAnalytics(dateRange),
        fetchChannels(),
        fetchAgents()
      ])

      const rtd = analyticsData?.team?.responseTimeDistribution || []
      const slaSampleSize = rtd.reduce((sum, d) => sum + d.count, 0)
      // null = недостаточно замеров FRT за период. Раньше тут стояло
      // 0/95/100 в зависимости от наличия avgFirstResponse — это путало.
      const slaPercent = slaSampleSize > 0
        ? Math.round(
            ((rtd.find((d) => d.bucket === '5min')?.count || 0) +
             (rtd.find((d) => d.bucket === '10min')?.count || 0)) /
            slaSampleSize * 100
          )
        : null

      const metricsData: DashboardMetrics = {
        waiting: channelsData.filter((c: any) => c.awaitingReply).length,
        avgResponseTime: analyticsData?.channels?.avgFirstResponse
          ? `${Math.round(analyticsData.channels.avgFirstResponse)}м`
          : '—',
        slaPercent,
        slaSampleSize,
        urgentCases: analyticsData?.cases?.urgent || 0,
        resolvedToday: analyticsData?.cases?.resolved || 0,
        totalChannels: analyticsData?.channels?.total || 0,
        activeAgents: 0
      }

      setMetrics(metricsData)
      setAnalytics(analyticsData)
      setChannels(channelsData)
      setAgents(agentsData)

      const attentionItems: AttentionItem[] = channelsData
        .filter(ch => ch.awaitingReply)
        .slice(0, 50)
        .map(ch => ({
          id: ch.id,
          name: ch.name || ch.companyName || `Канал ${ch.id}`,
          waitTime: formatWaitTime(ch.lastMessageAt ?? undefined),
          issue: ch.lastMessageText || 'Ожидает ответа',
          priority: ch.unreadCount > 5 ? 'urgent' : ch.unreadCount > 2 ? 'high' : 'normal',
          type: 'chat' as const,
          source: (ch.source as 'telegram' | 'whatsapp' | undefined) || 'telegram',
        }))
      setNeedsAttention(attentionItems)

      if (analyticsData.team?.dailyTrend) {
        const activities: RecentActivity[] = []
        if (analyticsData?.cases?.resolved && analyticsData.cases.resolved > 0) {
          activities.push({ id: '1', type: 'case_resolved', title: `${analyticsData.cases.resolved} кейсов решено`, description: 'За выбранный период', time: 'сегодня' })
        }
        if (analyticsData?.messages?.total && analyticsData.messages.total > 0) {
          activities.push({ id: '2', type: 'message', title: `${analyticsData.messages.total} сообщений`, description: 'Обработано за период', time: 'сегодня' })
        }
        setRecentActivity(activities)
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [dateRange])

  useEffect(() => { loadData() }, [loadData])

  const handleRefresh = () => {
    setIsRefreshing(true)
    loadData()
  }

  const loadSlaCategoryDetails = async (category: string, label: string) => {
    setSlaCategoryModal({ category, label })
    setSlaCategoryLoading(true)
    try {
      const token = localStorage.getItem('support_agent_token')
      const periodParam = dateRange.startsWith('custom:')
        ? `from=${dateRange.split(':')[1]}&to=${dateRange.split(':')[2]}`
        : `period=${dateRange}`
      const res = await fetch(
        `/api/support/analytics/response-time-details?bucket=all&${periodParam}&sla_category=${encodeURIComponent(category)}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        const data = await res.json()
        setSlaCategoryMessages(data.messages || [])
      }
    } catch (e) {
      console.error('Failed to load SLA category details:', e)
    } finally {
      setSlaCategoryLoading(false)
    }
  }

  const aiRecommendations = useMemo(() =>
    generateAIRecommendations(analytics, metrics, agents),
    [analytics, metrics, agents]
  )

  // Применяем фильтр по платформе к списку "Требует внимания" на клиенте
  const filteredAttention = useMemo(() => {
    if (sourceFilter === 'all') return needsAttention.slice(0, 15)
    return needsAttention.filter((a) => (a.source || 'telegram') === sourceFilter).slice(0, 15)
  }, [needsAttention, sourceFilter])

  if (isLoading) {
    return <LoadingState text="Загрузка дашборда..." />
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12 text-red-500" />}
          title="Ошибка загрузки"
          description={error}
          action={{ label: 'Повторить', onClick: loadData }}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardHeader
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <AIRecommendationsPanel recommendations={aiRecommendations} />

        <ChannelSourceSummary
          channels={channels}
          value={sourceFilter}
          onChange={setSourceFilter}
        />

        <MetricsSection
          metrics={metrics}
          analytics={analytics}
          onSlaCategoryClick={loadSlaCategoryDetails}
        />

        <OperationsSection
          needsAttention={filteredAttention}
          agents={agents}
        />

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <CommitmentsPanel className="h-full" />
          </div>
          <WeeklyScoreWidget />
        </div>

        <StatsSection
          analytics={analytics}
          metrics={metrics}
          recentActivity={recentActivity}
          onResponseTimeClick={setResponseTimeModal}
        />

        {/* Response Time Details Modal */}
        {responseTimeModal && (
          <ResponseTimeDetailsModal
            isOpen={!!responseTimeModal}
            onClose={() => setResponseTimeModal(null)}
            bucket={responseTimeModal.bucket}
            bucketLabel={responseTimeModal.bucketLabel}
            count={responseTimeModal.count}
            avgMinutes={responseTimeModal.avgMinutes}
            period={dateRange === 'today' ? '7d' : dateRange === 'week' ? '7d' : '30d'}
            color={responseTimeModal.color}
          />
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">Детальная аналитика</h3>
              <p className="text-sm text-slate-500 mt-1">Время ответа, агенты, кейсы, инсайты</p>
            </div>
            <a href="/sla-report" className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium">
              SLA Отчёт <span className="text-xs">→</span>
            </a>
          </div>
        </div>

        {/* SLA Category Modal */}
        {slaCategoryModal && (
          <SLACategoryModal
            category={slaCategoryModal.category}
            label={slaCategoryModal.label}
            messages={slaCategoryMessages}
            loading={slaCategoryLoading}
            onClose={() => setSlaCategoryModal(null)}
          />
        )}
      </div>
    </div>
  )
}
