import { useState, useEffect } from 'react'
import { 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  Users, 
  FileText,
  TrendingUp,
  Calendar,
  BarChart3,
  RefreshCw,
  Download,
  Target
} from 'lucide-react'

interface SLAReport {
  period: {
    from: string
    to: string
    slaMinutes: number
  }
  summary: {
    totalMessages: number
    responded: number
    withinSLA: number
    violatedSLA: number
    noResponse: number
    slaCompliance: number
    avgResponseMinutes: number
  }
  distribution: {
    within5min: number
    within10min: number
    within30min: number
    within60min: number
    over60min: number
    noResponse: number
  }
  cases: {
    total: number
    resolved: number
    open: number
    resolutionRate: number
  }
  agentBreakdown: Array<{
    name: string
    totalResponses: number
    withinSLA: number
    slaCompliance: number
    avgResponseMinutes: number
  }>
  topViolations: Array<{
    channelId: string
    channelName: string
    violations: number
    total: number
    violationRate: number
  }>
  hourlyDistribution: Array<{
    hour: number
    total: number
    violations: number
    violationRate: number
  }>
  recentViolations: Array<{
    channelId: string
    channelName: string
    clientName: string
    messageAt: string
    responseAt: string
    responseMinutes: number
    responder: string
  }>
}

export function SLAReportPage() {
  const [report, setReport] = useState<SLAReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Date range (default: current month)
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const [fromDate, setFromDate] = useState(firstOfMonth.toISOString().split('T')[0])
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
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tashkent'
    })
  }
  
  const getComplianceColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600'
    if (rate >= 80) return 'text-yellow-600'
    return 'text-red-600'
  }
  
  const getComplianceBg = (rate: number) => {
    if (rate >= 95) return 'bg-green-100'
    if (rate >= 80) return 'bg-yellow-100'
    return 'bg-red-100'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Target className="w-7 h-7 text-blue-500" />
            SLA Отчёт
          </h1>
          <p className="text-slate-500 mt-1">
            Анализ времени ответа и выполнения SLA
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
              SLA (минут)
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
            Обновить
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
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {/* SLA Compliance */}
            <div className={`rounded-xl border p-4 ${getComplianceBg(report.summary.slaCompliance)}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  report.summary.slaCompliance >= 95 ? 'bg-green-200' : 
                  report.summary.slaCompliance >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                }`}>
                  <Target className={`w-6 h-6 ${getComplianceColor(report.summary.slaCompliance)}`} />
                </div>
                <div>
                  <p className={`text-3xl font-bold ${getComplianceColor(report.summary.slaCompliance)}`}>
                    {report.summary.slaCompliance}%
                  </p>
                  <p className="text-sm text-slate-600">SLA Compliance</p>
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
                    {report.summary.avgResponseMinutes} <span className="text-lg font-normal">мин</span>
                  </p>
                  <p className="text-sm text-slate-500">Среднее время ответа</p>
                </div>
              </div>
            </div>
            
            {/* Within SLA */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-600">{report.summary.withinSLA}</p>
                  <p className="text-sm text-slate-500">В срок (&lt; {slaMinutes} мин)</p>
                </div>
              </div>
            </div>
            
            {/* Violations */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-red-600">
                    {report.summary.violatedSLA + report.summary.noResponse}
                  </p>
                  <p className="text-sm text-slate-500">Нарушений SLA</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Cases Resolution */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{report.cases.total}</p>
                  <p className="text-sm text-slate-500">Кейсов создано</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{report.cases.resolved}</p>
                  <p className="text-sm text-slate-500">Закрыто ({report.cases.resolutionRate}%)</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-600">{report.cases.open}</p>
                  <p className="text-sm text-slate-500">Открыто</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Response Time Distribution */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-500" />
                Распределение времени ответа
              </h3>
              <div className="space-y-3">
                {[
                  { label: '≤ 5 мин', value: report.distribution.within5min, color: 'bg-green-500' },
                  { label: '5-10 мин', value: report.distribution.within10min, color: 'bg-lime-500' },
                  { label: '10-30 мин', value: report.distribution.within30min, color: 'bg-yellow-500' },
                  { label: '30-60 мин', value: report.distribution.within60min, color: 'bg-orange-500' },
                  { label: '> 60 мин', value: report.distribution.over60min, color: 'bg-red-500' },
                  { label: 'Без ответа', value: report.distribution.noResponse, color: 'bg-slate-400' },
                ].map((item) => {
                  const total = report.summary.totalMessages
                  const pct = total > 0 ? (item.value / total) * 100 : 0
                  return (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-sm text-slate-600 w-24">{item.label}</span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${item.color} rounded-full transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-900 w-16 text-right">
                        {item.value} ({Math.round(pct)}%)
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            
            {/* Agent Breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                По сотрудникам
              </h3>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {report.agentBreakdown.length === 0 ? (
                  <p className="text-slate-500 text-sm">Нет данных</p>
                ) : (
                  report.agentBreakdown.map((agent) => (
                    <div key={agent.name} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-700">
                          {agent.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 text-sm">{agent.name}</p>
                          <p className="text-xs text-slate-500">
                            {agent.totalResponses} ответов, avg {agent.avgResponseMinutes} мин
                          </p>
                        </div>
                      </div>
                      <div className={`px-2 py-1 rounded text-sm font-medium ${
                        agent.slaCompliance >= 95 ? 'bg-green-100 text-green-700' :
                        agent.slaCompliance >= 80 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {agent.slaCompliance}%
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          {/* Hourly Distribution */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Нарушения по часам (время Ташкента)
            </h3>
            <div className="flex items-end gap-1 h-32">
              {report.hourlyDistribution.map((hour) => {
                const maxViolations = Math.max(...report.hourlyDistribution.map(h => h.violations))
                const height = maxViolations > 0 ? (hour.violations / maxViolations) * 100 : 0
                return (
                  <div key={hour.hour} className="flex-1 flex flex-col items-center gap-1">
                    <div 
                      className={`w-full rounded-t ${hour.violations > 0 ? 'bg-red-400' : 'bg-slate-200'}`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${hour.hour}:00 - ${hour.violations} нарушений из ${hour.total}`}
                    />
                    <span className="text-xs text-slate-500">{hour.hour}</span>
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Top Violations */}
          {report.topViolations.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Каналы с нарушениями SLA
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Нарушений</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Всего</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">% нарушений</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topViolations.map((channel) => (
                      <tr key={channel.channelId} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3">{channel.channelName}</td>
                        <td className="py-2 px-3 text-center text-red-600 font-medium">{channel.violations}</td>
                        <td className="py-2 px-3 text-center">{channel.total}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            channel.violationRate > 50 ? 'bg-red-100 text-red-700' :
                            channel.violationRate > 20 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {channel.violationRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {/* Recent Violations */}
          {report.recentViolations.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Последние нарушения SLA
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Клиент</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Время сообщения</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Ответ через</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Ответил</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentViolations.map((v, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3">{v.channelName}</td>
                        <td className="py-2 px-3">{v.clientName}</td>
                        <td className="py-2 px-3 text-slate-500">{formatDate(v.messageAt)}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            {v.responseMinutes} мин
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
        </>
      )}
    </div>
  )
}
