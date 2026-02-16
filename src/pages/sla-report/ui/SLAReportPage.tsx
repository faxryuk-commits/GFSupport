import { useState, useEffect } from 'react'
import { 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  Users, 
  FileText,
  Calendar,
  RefreshCw,
  Target,
  MessageSquare,
  Timer,
  XCircle,
  ArrowRight
} from 'lucide-react'

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
    totalResponses: number
    withinSLA: number
    violatedSLA: number
    slaCompliance: number
    avgMinutes: number
    minMinutes: number
    maxMinutes: number
    medianMinutes: number
  }>
  slaViolations: Array<{
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
    channelName: string
    clientName: string
    messagePreview: string
    messageAt: string
    waitingMinutes: number
  }>
  pendingCases: Array<{
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
}

export function SLAReportPage() {
  const [report, setReport] = useState<SLAReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'response' | 'cases' | 'agents'>('response')
  
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
  
  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tashkent'
    })
  }
  
  const formatMinutes = (mins: number) => {
    if (mins < 60) return `${Math.round(mins)} мин`
    const hours = Math.floor(mins / 60)
    const minutes = Math.round(mins % 60)
    return `${hours}ч ${minutes}м`
  }
  
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
  
  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: 'bg-red-100 text-red-700',
      high: 'bg-orange-100 text-orange-700',
      medium: 'bg-blue-100 text-blue-700',
      low: 'bg-slate-100 text-slate-700',
    }
    return colors[priority] || 'bg-slate-100 text-slate-700'
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
            {/* SLA Compliance */}
            <div className={`rounded-xl border p-4 ${getComplianceBg(report.responseTimeSummary.slaCompliancePercent)}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  report.responseTimeSummary.slaCompliancePercent >= 95 ? 'bg-green-200' : 
                  report.responseTimeSummary.slaCompliancePercent >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                }`}>
                  <Target className={`w-6 h-6 ${getComplianceColor(report.responseTimeSummary.slaCompliancePercent)}`} />
                </div>
                <div>
                  <p className={`text-3xl font-bold ${getComplianceColor(report.responseTimeSummary.slaCompliancePercent)}`}>
                    {report.responseTimeSummary.slaCompliancePercent}%
                  </p>
                  <p className="text-sm text-slate-600">SLA выполнение</p>
                </div>
              </div>
            </div>
            
            {/* Average Response */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900">
                    {report.responseTimeSummary.avgResponseMinutes}
                  </p>
                  <p className="text-sm text-slate-500">Среднее время (мин)</p>
                </div>
              </div>
            </div>
            
            {/* Case Resolution Rate */}
            <div className={`rounded-xl border p-4 ${getComplianceBg(report.caseResolutionSummary.resolutionRatePercent)}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  report.caseResolutionSummary.resolutionRatePercent >= 95 ? 'bg-green-200' : 
                  report.caseResolutionSummary.resolutionRatePercent >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                }`}>
                  <CheckCircle className={`w-6 h-6 ${getComplianceColor(report.caseResolutionSummary.resolutionRatePercent)}`} />
                </div>
                <div>
                  <p className={`text-3xl font-bold ${getComplianceColor(report.caseResolutionSummary.resolutionRatePercent)}`}>
                    {report.caseResolutionSummary.resolutionRatePercent}%
                  </p>
                  <p className="text-sm text-slate-600">Кейсы решены</p>
                </div>
              </div>
            </div>
            
            {/* Avg Resolution Time */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Timer className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900">
                    {report.caseResolutionSummary.avgResolutionHours}ч
                  </p>
                  <p className="text-sm text-slate-500">Время решения</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Detailed Numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-slate-900">{report.responseTimeSummary.totalClientMessages}</p>
              <p className="text-xs text-slate-500">Сообщений от клиентов</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{report.responseTimeSummary.withinSLA}</p>
              <p className="text-xs text-slate-500">Ответ в срок</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{report.responseTimeSummary.violatedSLA}</p>
              <p className="text-xs text-slate-500">Нарушения SLA</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{report.responseTimeSummary.noResponse}</p>
              <p className="text-xs text-slate-500">Без ответа</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-slate-900">{report.caseResolutionSummary.totalCases}</p>
              <p className="text-xs text-slate-500">Кейсов создано</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{report.caseResolutionSummary.open}</p>
              <p className="text-xs text-slate-500">Кейсов открыто</p>
            </div>
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
          </div>
          
          {/* Tab Content: Response Time */}
          {activeTab === 'response' && (
            <div className="space-y-6">
              {/* Response Time Distribution */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900 mb-4">Распределение времени ответа</h3>
                <div className="grid grid-cols-7 gap-2 text-center">
                  {[
                    { label: '≤1 мин', value: report.responseDistribution.within1min, color: 'bg-green-500' },
                    { label: '1-5 мин', value: report.responseDistribution.within5min, color: 'bg-green-400' },
                    { label: '5-10 мин', value: report.responseDistribution.within10min, color: 'bg-lime-500' },
                    { label: '10-30 мин', value: report.responseDistribution.within30min, color: 'bg-yellow-500' },
                    { label: '30-60 мин', value: report.responseDistribution.within60min, color: 'bg-orange-500' },
                    { label: '>60 мин', value: report.responseDistribution.over60min, color: 'bg-red-500' },
                    { label: 'Нет ответа', value: report.responseDistribution.noResponse, color: 'bg-slate-400' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col items-center">
                      <div className={`w-full h-24 rounded-lg ${item.color} flex items-end justify-center relative`}>
                        <span className="absolute top-2 text-white font-bold text-lg">{item.value}</span>
                      </div>
                      <span className="text-xs text-slate-600 mt-2">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* SLA Violations */}
              {report.slaViolations.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    Нарушения SLA ({report.slaViolations.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Клиент</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Сообщение</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Время</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Ответ через</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Ответил</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.slaViolations.map((v, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 font-medium">{v.channelName}</td>
                            <td className="py-2 px-3">{v.clientName}</td>
                            <td className="py-2 px-3 text-slate-500 max-w-48 truncate">{v.messagePreview}</td>
                            <td className="py-2 px-3 text-slate-500 text-xs">{formatDateTime(v.messageAt)}</td>
                            <td className="py-2 px-3 text-center">
                              <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                                {formatMinutes(v.responseMinutes)}
                              </span>
                            </td>
                            <td className="py-2 px-3">{v.responder}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {/* Unanswered Messages */}
              {report.unansweredMessages.length > 0 && (
                <div className="bg-white rounded-xl border border-red-200 p-4">
                  <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-500" />
                    Сообщения без ответа ({report.unansweredMessages.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-red-50">
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Клиент</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Сообщение</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Время</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Ожидает</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.unansweredMessages.map((m, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-red-50">
                            <td className="py-2 px-3 font-medium">{m.channelName}</td>
                            <td className="py-2 px-3">{m.clientName}</td>
                            <td className="py-2 px-3 text-slate-500 max-w-48 truncate">{m.messagePreview || '[медиа]'}</td>
                            <td className="py-2 px-3 text-slate-500 text-xs">{formatDateTime(m.messageAt)}</td>
                            <td className="py-2 px-3 text-center">
                              <span className="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">
                                {formatMinutes(m.waitingMinutes)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Tab Content: Cases */}
          {activeTab === 'cases' && (
            <div className="space-y-6">
              {/* Pending Cases */}
              {report.pendingCases.length > 0 && (
                <div className="bg-white rounded-xl border border-orange-200 p-4">
                  <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-orange-500" />
                    Открытые кейсы ({report.pendingCases.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-orange-50">
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Номер</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Тема</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Приоритет</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Назначен</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Создан</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Ожидает</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.pendingCases.map((c, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-orange-50">
                            <td className="py-2 px-3 font-mono text-blue-600">{c.ticketNumber}</td>
                            <td className="py-2 px-3 max-w-48 truncate">{c.title}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPriorityBadge(c.priority)}`}>
                                {c.priority}
                              </span>
                            </td>
                            <td className="py-2 px-3">{c.channelName}</td>
                            <td className="py-2 px-3">{c.agentName || '-'}</td>
                            <td className="py-2 px-3 text-slate-500 text-xs">{formatDateTime(c.createdAt)}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                c.waitingHours > 24 ? 'bg-red-100 text-red-700' :
                                c.waitingHours > 8 ? 'bg-orange-100 text-orange-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                                {c.waitingHours}ч
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {/* Resolved Cases */}
              {report.resolvedCasesDetails.length > 0 && (
                <div className="bg-white rounded-xl border border-green-200 p-4">
                  <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    Решённые кейсы ({report.resolvedCasesDetails.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-green-50">
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Номер</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Тема</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Приоритет</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Решил</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-600">Создан → Решён</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-600">Время решения</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.resolvedCasesDetails.map((c, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-green-50">
                            <td className="py-2 px-3 font-mono text-blue-600">{c.ticketNumber}</td>
                            <td className="py-2 px-3 max-w-40 truncate">{c.title}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPriorityBadge(c.priority)}`}>
                                {c.priority}
                              </span>
                            </td>
                            <td className="py-2 px-3">{c.channelName}</td>
                            <td className="py-2 px-3">{c.agentName || '-'}</td>
                            <td className="py-2 px-3 text-slate-500 text-xs">
                              {formatDateTime(c.createdAt)}
                              <ArrowRight className="w-3 h-3 inline mx-1" />
                              {formatDateTime(c.resolvedAt)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                                {c.resolutionHours ? `${c.resolutionHours}ч` : formatMinutes(c.resolutionMinutes || 0)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Tab Content: Agents */}
          {activeTab === 'agents' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Производительность сотрудников
              </h3>
              
              {report.agentPerformance.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Нет данных за выбранный период</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="text-left py-3 px-3 font-medium text-slate-600">Сотрудник</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Ответов</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">В срок</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Нарушений</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">SLA %</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Среднее</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Медиана</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Мин</th>
                        <th className="text-center py-3 px-3 font-medium text-slate-600">Макс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.agentPerformance.map((agent) => (
                        <tr key={agent.name} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-700">
                                {agent.name.charAt(0)}
                              </div>
                              <span className="font-medium">{agent.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-bold">{agent.totalResponses}</td>
                          <td className="py-3 px-3 text-center text-green-600 font-medium">{agent.withinSLA}</td>
                          <td className="py-3 px-3 text-center text-red-600 font-medium">{agent.violatedSLA}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2 py-1 rounded text-sm font-bold ${
                              agent.slaCompliance >= 95 ? 'bg-green-100 text-green-700' :
                              agent.slaCompliance >= 80 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {agent.slaCompliance}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">{agent.avgMinutes} мин</td>
                          <td className="py-3 px-3 text-center">{agent.medianMinutes} мин</td>
                          <td className="py-3 px-3 text-center text-green-600">{agent.minMinutes} мин</td>
                          <td className="py-3 px-3 text-center text-red-600">{agent.maxMinutes} мин</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
