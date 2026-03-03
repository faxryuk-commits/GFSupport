import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { EmptyState, LoadingState } from '@/shared/ui'
import { fetchDashboardMetrics, fetchAnalytics, type DashboardMetrics, type AnalyticsData } from '@/shared/api'
import { fetchChannels } from '@/shared/api'
import { fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'
import { ResponseTimeDetailsModal } from '@/pages/analytics/ui/ResponseTimeDetailsModal'
import { CommitmentsPanel } from '@/features/commitments/ui'
import { ProblemDetailsModal } from './ProblemDetailsModal'
import { generateAIRecommendations } from '../model/recommendations'
import { formatWaitTime } from '../model/types'
import type { AttentionItem, RecentActivity, ResponseTimeModalData } from '../model/types'
import { DashboardHeader } from './DashboardHeader'
import { AIRecommendationsPanel } from './AIRecommendationsPanel'
import { MetricsSection } from './MetricsSection'
import { OperationsSection } from './OperationsSection'
import { StatsSection } from './StatsSection'
import { DetailedAnalyticsSection } from './DetailedAnalyticsSection'
import { SLACategoryModal } from './SLACategoryModal'
import { OnboardingOverviewPanel } from './OnboardingOverviewPanel'

export function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState('today')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [_channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [needsAttention, setNeedsAttention] = useState<AttentionItem[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])

  const [responseTimeModal, setResponseTimeModal] = useState<ResponseTimeModalData | null>(null)
  const [problemDetailsModal, setProblemDetailsModal] = useState<{ category: string; label: string } | null>(null)
  const [slaCategoryModal, setSlaCategoryModal] = useState<{ category: string; label: string } | null>(null)
  const [slaCategoryMessages, setSlaCategoryMessages] = useState<any[]>([])
  const [slaCategoryLoading, setSlaCategoryLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [metricsData, analyticsData, channelsData, agentsData] = await Promise.all([
        fetchDashboardMetrics(dateRange),
        fetchAnalytics(dateRange),
        fetchChannels(),
        fetchAgents()
      ])

      setMetrics(metricsData)
      setAnalytics(analyticsData)
      setChannels(channelsData)
      setAgents(agentsData)

      const attentionItems: AttentionItem[] = channelsData
        .filter(ch => ch.awaitingReply)
        .slice(0, 15)
        .map(ch => ({
          id: ch.id,
          name: ch.name || ch.companyName || `Канал ${ch.id}`,
          waitTime: formatWaitTime(ch.lastMessageAt ?? undefined),
          issue: ch.lastMessageText || 'Ожидает ответа',
          priority: ch.unreadCount > 5 ? 'urgent' : ch.unreadCount > 2 ? 'high' : 'normal',
          type: 'chat' as const
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

        <MetricsSection
          metrics={metrics}
          analytics={analytics}
          onSlaCategoryClick={loadSlaCategoryDetails}
        />

        <OperationsSection
          needsAttention={needsAttention}
          agents={agents}
        />

        {/* Commitments + Reminders */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <CommitmentsPanel className="h-full" />
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-orange-500" />
              <h3 className="font-semibold text-slate-800">Напоминания</h3>
            </div>
            <p className="text-sm text-slate-500 text-center py-4">Нет активных напоминаний</p>
          </div>
        </div>

        {/* Onboarding Analytics */}
        <OnboardingOverviewPanel />

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

        {analytics && (
          <DetailedAnalyticsSection
            analytics={analytics}
            onProblemClick={(cat, label) => setProblemDetailsModal({ category: cat, label })}
          />
        )}

        {/* Problem Details Modal */}
        {problemDetailsModal && (
          <ProblemDetailsModal
            isOpen={!!problemDetailsModal}
            onClose={() => setProblemDetailsModal(null)}
            category={problemDetailsModal.category}
            categoryLabel={problemDetailsModal.label}
          />
        )}

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
