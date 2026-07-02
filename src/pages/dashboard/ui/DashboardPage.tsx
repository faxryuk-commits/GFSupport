import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { EmptyState, LoadingState } from '@/shared/ui'
import { fetchAnalytics, type DashboardMetrics, type AnalyticsData } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import {
  ResponseTimeDetailsModal,
  WeeklyScoreWidget,
  PulseStrip,
  CustomerHealthBanner,
} from '@/features/analytics'
import type { FetchMetricParams } from '@/shared/api'
import { CommitmentsPanel } from '@/features/commitments/ui'
import { formatWaitTime } from '../model/types'
import type { AttentionItem, RecentActivity, ResponseTimeModalData } from '../model/types'
import { DashboardHeader } from './DashboardHeader'
import { ChannelSourceSummary, type SourceFilter } from './ChannelSourceSummary'
import { OperationsSection } from './OperationsSection'
import { StatsSection } from './StatsSection'
import { useMarket } from '@/shared/hooks/useMarket'

function mapDashboardPeriod(range: string): FetchMetricParams['period'] {
  switch (range) {
    case 'today':
      return 'today'
    case 'yesterday':
      return 'yesterday'
    case 'week':
    case '7d':
      return '7d'
    case 'month':
    case '30d':
      return '30d'
    case '90d':
      return '90d'
    default:
      return '30d'
  }
}

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
  const { selectedMarket, selectedMarketInfo } = useMarket()

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
  }, [dateRange, selectedMarket])

  useEffect(() => { loadData() }, [loadData])

  const handleRefresh = () => {
    setIsRefreshing(true)
    loadData()
  }

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
        {selectedMarketInfo && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Фильтр по рынку: <span className="font-medium text-slate-700">
              {selectedMarketInfo.name}
            </span>
            {' '}— статистика только по каналам этого рынка
          </div>
        )}

        <CustomerHealthBanner
          period={mapDashboardPeriod(dateRange)}
          source={sourceFilter === 'all' ? undefined : sourceFilter}
          marketKey={selectedMarket}
        />

        <PulseStrip
          period={mapDashboardPeriod(dateRange)}
          source={sourceFilter === 'all' ? undefined : sourceFilter}
          marketKey={selectedMarket}
        />

        <ChannelSourceSummary
          channels={channels}
          value={sourceFilter}
          onChange={setSourceFilter}
        />

        <OperationsSection
          needsAttention={filteredAttention}
          agents={agents}
        />

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <CommitmentsPanel className="h-full" />
          </div>
          <WeeklyScoreWidget marketKey={selectedMarket} />
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
            marketKey={selectedMarket}
          />
        )}

        <div className="bg-white rounded-xl border border-[#e8edf3] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">Детальная аналитика</h3>
              <p className="text-sm text-slate-500 mt-1">
                Pulse / Diagnosis / Detail · per-agent FRT и SLA, состояние покупателей, категории проблем
              </p>
            </div>
            <a href="/analytics" className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium">
              Открыть Аналитику <span className="text-xs">→</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
