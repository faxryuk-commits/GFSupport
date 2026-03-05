import { useState, useEffect } from 'react'
import { 
  Clock, 
  CheckCircle, 
  Users, 
  FileText,
  Calendar,
  RefreshCw,
  Target,
  MessageSquare,
  Timer,
  BarChart3
} from 'lucide-react'
import { AgentPerformanceTable, AgentExpertise, WeeklyHeatmap, CollaborationMetrics, CommunicationMap } from '@/features/analytics'
import type { AgentExpertiseEntry, WeeklyEntry, CollaborationData } from '@/features/analytics'
import { ResponseTimeTab, CasesTab, MetricDrilldownModal } from '@/features/sla-report'
import type { DrilldownMetric } from '@/features/sla-report'

interface SLAReport {
  period: {
    from: string
    to: string
    slaMinutes: number
    timezone: string
  }
  responseTimeSummary: {
    totalClientMessages: number
    responded: number
    withinSLA: number
    violatedSLA: number
    noResponse: number
    slaCompliancePercent: number
    responseRatePercent: number
    avgResponseMinutes: number
    medianResponseMinutes: number
    minResponseMinutes: number
    maxResponseMinutes: number
  }
  caseResolutionSummary: {
    totalCases: number
    resolved: number
    open: number
    resolutionRatePercent: number
    avgResolutionMinutes: number
    avgResolutionHours: number
  }
  responseDistribution: {
    within1min: number
    within5min: number
    within10min: number
    within30min: number
    within60min: number
    over60min: number
    noResponse: number
  }
  agentPerformance: Array<{
    name: string
    role: 'admin' | 'manager' | 'agent'
    totalResponses: number
    withinSLA: number
    violatedSLA: number
    slaCompliance: number | null
    avgMinutes: number
    minMinutes: number
    maxMinutes: number
    medianMinutes: number
    totalMessages: number
    totalChars: number
    avgCharsPerMessage: number
    channelsServed: number
    activeDays: number
    resolvedCases: number
    totalAssignedCases: number
    efficiencyRatio: number
    onlineHours: number
    engagementScore: number
    engagementLevel: 'high' | 'medium' | 'low'
    engagementBreakdown: {
      activity: number
      speed: number
      quality: number
      responsibility: number
    }
    isInactive: boolean
  }>
  slaViolations: Array<{
    channelId?: string
    channelName: string
    clientName: string
    messagePreview: string
    messageAt: string
    responseAt: string
    responseMinutes: number
    responder: string
    exceededBy: number
  }>
  unansweredMessages: Array<{
    channelId?: string
    channelName: string
    clientName: string
    messagePreview: string
    messageAt: string
    waitingMinutes: number
  }>
  pendingCases: Array<{
    caseId?: string
    ticketNumber: string
    title: string
    status: string
    priority: string
    channelName: string
    agentName: string
    createdAt: string
    waitingHours: number
  }>
  resolvedCasesDetails: Array<{
    caseId?: string
    ticketNumber: string
    title: string
    priority: string
    channelName: string
    agentName: string
    createdAt: string
    resolvedAt: string
    resolutionMinutes: number
    resolutionHours: number
  }>
  agentExpertise: AgentExpertiseEntry[]
  weeklyWorkload: WeeklyEntry[]
  teamWeekly: number[]
  collaboration: CollaborationData
}

export function SLAReportPage() {
  const [report, setReport] = useState<SLAReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'response' | 'cases' | 'agents' | 'insights' | 'communications'>('response')
  const [drilldownMetric, setDrilldownMetric] = useState<DrilldownMetric | null>(null)
  
  // Date range (default: last 7 days)
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [fromDate, setFromDate] = useState(weekAgo.toISOString().split('T')[0])
  const [toDate, setToDate] = useState(today.toISOString().split('T')[0])
  const [slaMinutes, setSlaMinutes] = useState(10)
  
  const loadReport = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch(
        `/api/support/analytics/sla-report?from=${fromDate}&to=${toDate}&sla_minutes=${slaMinutes}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (!res.ok) throw new Error('Failed to load report')
      
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setReport(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    loadReport()
  }, [])
  
  const getComplianceColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600'
    if (rate >= 80) return 'text-yellow-600'
    return 'text-red-600'
  }
  
  const getComplianceBg = (rate: number) => {
    if (rate >= 95) return 'bg-green-50 border-green-200'
    if (rate >= 80) return 'bg-yellow-50 border-yellow-200'
    return 'bg-red-50 border-red-200'
  }
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Target className="w-7 h-7 text-blue-500" />
            Отчёт по SLA
          </h1>
          <p className="text-slate-500 mt-1">
            Время ответа и решения тикетов • {report?.period.timezone}
          </p>
        </div>
      </div>
      
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              <Calendar className="w-4 h-4 inline mr-1" />
              С даты
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              По дату
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              <Clock className="w-4 h-4 inline mr-1" />
              SLA норма
            </label>
            <select
              value={slaMinutes}
              onChange={(e) => setSlaMinutes(parseInt(e.target.value))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value={5}>5 минут</option>
              <option value={10}>10 минут</option>
              <option value={15}>15 минут</option>
              <option value={30}>30 минут</option>
              <option value={60}>60 минут</option>
            </select>
          </div>
          <button
            onClick={loadReport}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Сформировать
          </button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}
      
      {loading && !report && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      )}
      
      {report && (
        <>
          {/* Main Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <button onClick={() => setDrilldownMetric('sla')} className={`rounded-xl border p-4 text-left cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${getComplianceBg(report.responseTimeSummary.slaCompliancePercent)}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  report.responseTimeSummary.slaCompliancePercent >= 95 ? 'bg-green-200' : 
                  report.responseTimeSummary.slaCompliancePercent >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                }`}>
                  <Target className={`w-6 h-6 ${getComplianceColor(report.responseTimeSummary.slaCompliancePercent)}`} />
                </div>
                <div>
                  <p className={`text-3xl font-bold ${getComplianceColor(report.responseTimeSummary.slaCompliancePercent)}`}>{report.responseTimeSummary.slaCompliancePercent}%</p>
                  <p className="text-sm text-slate-600">SLA (из отвеченных)</p>
                </div>
              </div>
            </button>
            
            <button onClick={() => setDrilldownMetric('avgTime')} className="bg-white rounded-xl border border-slate-200 p-4 text-left cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900">{report.responseTimeSummary.avgResponseMinutes}</p>
                  <p className="text-sm text-slate-500">Среднее время (мин)</p>
                </div>
              </div>
            </button>
            
            <button onClick={() => setDrilldownMetric('caseResolution')} className={`rounded-xl border p-4 text-left cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${getComplianceBg(report.caseResolutionSummary.resolutionRatePercent)}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  report.caseResolutionSummary.resolutionRatePercent >= 95 ? 'bg-green-200' : 
                  report.caseResolutionSummary.resolutionRatePercent >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                }`}>
                  <CheckCircle className={`w-6 h-6 ${getComplianceColor(report.caseResolutionSummary.resolutionRatePercent)}`} />
                </div>
                <div>
                  <p className={`text-3xl font-bold ${getComplianceColor(report.caseResolutionSummary.resolutionRatePercent)}`}>{report.caseResolutionSummary.resolutionRatePercent}%</p>
                  <p className="text-sm text-slate-600">Кейсы решены</p>
                </div>
              </div>
            </button>
            
            <button onClick={() => setDrilldownMetric('avgResolution')} className="bg-white rounded-xl border border-slate-200 p-4 text-left cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Timer className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900">{report.caseResolutionSummary.avgResolutionHours}ч</p>
                  <p className="text-sm text-slate-500">Время решения</p>
                </div>
              </div>
            </button>
          </div>
          
          {/* Detailed Numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 mb-6">
            {([
              { metric: 'totalMessages' as const, value: report.responseTimeSummary.totalClientMessages, label: 'Сообщений от клиентов', color: 'text-slate-900' },
              { metric: 'responseRate' as const, value: `${report.responseTimeSummary.responseRatePercent}%`, label: 'Охват ответов', color: report.responseTimeSummary.responseRatePercent >= 80 ? 'text-green-600' : 'text-orange-600' },
              { metric: 'withinSLA' as const, value: report.responseTimeSummary.withinSLA, label: 'Ответ в срок', color: 'text-green-600' },
              { metric: 'violations' as const, value: report.responseTimeSummary.violatedSLA, label: 'Нарушения SLA', color: 'text-red-600' },
              { metric: 'noResponse' as const, value: report.responseTimeSummary.noResponse, label: 'Без ответа', color: 'text-orange-600' },
              { metric: 'totalCases' as const, value: report.caseResolutionSummary.totalCases, label: 'Кейсов создано', color: 'text-slate-900' },
              { metric: 'openCases' as const, value: report.caseResolutionSummary.open, label: 'Кейсов открыто', color: 'text-orange-600' },
            ]).map(card => (
              <button key={card.metric} onClick={() => setDrilldownMetric(card.metric)} className="bg-white rounded-lg border border-slate-200 p-3 text-center cursor-pointer hover:ring-2 hover:ring-blue-300 hover:shadow-sm transition-all">
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                <p className="text-xs text-slate-500">{card.label}</p>
              </button>
            ))}
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('response')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'response' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MessageSquare className="w-4 h-4 inline mr-2" />
              Время ответа
            </button>
            <button
              onClick={() => setActiveTab('cases')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'cases' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <FileText className="w-4 h-4 inline mr-2" />
              Решение кейсов
            </button>
            <button
              onClick={() => setActiveTab('agents')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'agents' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Users className="w-4 h-4 inline mr-2" />
              Сотрудники
            </button>
            <button
              onClick={() => setActiveTab('insights')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'insights' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <BarChart3 className="w-4 h-4 inline mr-2" />
              Аналитика
            </button>
            <button
              onClick={() => setActiveTab('communications')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'communications'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MessageSquare className="w-4 h-4 inline mr-2" />
              Коммуникации
            </button>
          </div>
          
          {/* Tab Content: Response Time */}
          {activeTab === 'response' && (
            <ResponseTimeTab
              distribution={report.responseDistribution}
              violations={report.slaViolations}
              unanswered={report.unansweredMessages}
            />
          )}
          
          {/* Tab Content: Cases */}
          {activeTab === 'cases' && (
            <CasesTab pending={report.pendingCases} resolved={report.resolvedCasesDetails} />
          )}
          
          {/* Tab Content: Agents */}
          {activeTab === 'agents' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Производительность сотрудников
              </h3>
              <AgentPerformanceTable agents={report.agentPerformance} />
            </div>
          )}

          {/* Tab Content: Insights */}
          {activeTab === 'insights' && (
            <div className="space-y-6">
              <AgentExpertise data={report.agentExpertise} />
              <WeeklyHeatmap agents={report.weeklyWorkload} teamWeekly={report.teamWeekly} />
              <CollaborationMetrics data={report.collaboration} />
            </div>
          )}

          {/* Tab Content: Communications */}
          {activeTab === 'communications' && (
            <CommunicationMap />
          )}
        </>
      )}

      {report && drilldownMetric && (
        <MetricDrilldownModal
          metric={drilldownMetric}
          onClose={() => setDrilldownMetric(null)}
          violations={report.slaViolations}
          unanswered={report.unansweredMessages}
          pending={report.pendingCases}
          resolved={report.resolvedCasesDetails}
          responseSummary={{
            slaCompliancePercent: report.responseTimeSummary.slaCompliancePercent,
            avgResponseMinutes: report.responseTimeSummary.avgResponseMinutes,
            responseRatePercent: report.responseTimeSummary.responseRatePercent,
            totalClientMessages: report.responseTimeSummary.totalClientMessages,
            withinSLA: report.responseTimeSummary.withinSLA,
            violatedSLA: report.responseTimeSummary.violatedSLA,
            noResponse: report.responseTimeSummary.noResponse,
            slaMinutes,
          }}
          caseSummary={report.caseResolutionSummary}
          agents={report.agentPerformance}
        />
      )}
    </div>
  )
}
