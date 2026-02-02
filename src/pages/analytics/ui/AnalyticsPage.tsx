import { useState, useEffect, useCallback } from 'react'
import { 
  ChevronDown, Loader2, AlertTriangle, RefreshCw, MessageSquare, 
  Briefcase, Users, TrendingUp, AlertCircle, Clock, CheckCircle,
  BarChart3, Mic, Video
} from 'lucide-react'
import { fetchAnalytics, type AnalyticsData } from '@/shared/api'
import { Badge } from '@/shared/ui'
import { ResponseTimeDetailsModal } from './ResponseTimeDetailsModal'

// Перевод категорий на русский
const categoryLabels: Record<string, string> = {
  technical: 'Техническая проблема',
  integration: 'Интеграция',
  general: 'Общие вопросы',
  complaint: 'Жалоба',
  billing: 'Оплата и биллинг',
  feature_request: 'Запрос функции',
  onboarding: 'Подключение',
  question: 'Вопрос',
  feedback: 'Обратная связь',
  order: 'Заказы',
  delivery: 'Доставка',
  menu: 'Меню',
  app: 'Приложение',
}

const getCategoryLabel = (name: string): string => {
  if (!name) return 'Без категории'
  return categoryLabels[name.toLowerCase()] || name
}

const periods = [
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: '90d', label: 'Последние 90 дней' },
]

interface ResponseTimeModalData {
  bucket: string
  bucketLabel: string
  count: number
  avgMinutes: number
  color: string
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState('30d')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [responseTimeModal, setResponseTimeModal] = useState<ResponseTimeModalData | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchAnalytics(period)
      setData(result)
    } catch (err) {
      console.error('Ошибка загрузки аналитики:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-500">Загрузка аналитики...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-slate-700 font-medium">Ошибка загрузки</p>
          <p className="text-slate-500 text-sm">{error}</p>
          <button 
            onClick={loadData}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Повторить
          </button>
        </div>
      </div>
    )
  }

  const selectedPeriod = periods.find(p => p.value === period)
  
  // Расчёт метрик
  const resolutionRate = data.cases.total > 0 
    ? Math.round((data.cases.resolved / data.cases.total) * 100) 
    : 0
  const problemRate = data.messages.total > 0 
    ? ((data.messages.problems / data.messages.total) * 100).toFixed(1) 
    : '0'

  return (
    <div className="p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Сводная аналитика</h1>
          <p className="text-slate-500 mt-0.5">Детальная статистика и отчёты</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            title="Обновить"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <div className="relative">
            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              {selectedPeriod?.label}
              <ChevronDown className="w-4 h-4" />
            </button>
            {isOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                {periods.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { setPeriod(p.value); setIsOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg ${
                      period === p.value ? 'bg-blue-50 text-blue-600' : ''
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm text-slate-500">Всего каналов</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{data.channels.total}</p>
          <p className="text-sm text-green-600 mt-1">{data.channels.active} активных</p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-sm text-slate-500">Сообщений</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{data.messages.total}</p>
          <div className="flex gap-2 mt-1 text-xs">
            {data.messages.voice > 0 && (
              <span className="flex items-center gap-1 text-slate-500">
                <Mic className="w-3 h-3" /> {data.messages.voice}
              </span>
            )}
            {data.messages.video > 0 && (
              <span className="flex items-center gap-1 text-slate-500">
                <Video className="w-3 h-3" /> {data.messages.video}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm text-slate-500">Решено кейсов</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{data.cases.resolved}/{data.cases.total}</p>
          <p className="text-sm text-green-600 mt-1">{resolutionRate}% решено</p>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
            <span className="text-sm text-slate-500">Проблем</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{problemRate}%</p>
          <p className="text-sm text-slate-500 mt-1">{data.messages.problems} сообщений</p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-5 gap-4">
        <MetricCard 
          label="Открытых кейсов" 
          value={data.cases.open} 
          icon={Briefcase}
          color="blue"
        />
        <MetricCard 
          label="Срочных" 
          value={data.cases.urgent} 
          icon={AlertTriangle}
          color="red"
        />
        <MetricCard 
          label="Повторяющихся" 
          value={data.cases.recurring} 
          icon={TrendingUp}
          color="amber"
        />
        <MetricCard 
          label="Среднее время ответа" 
          value={data.channels.avgFirstResponse ? `${data.channels.avgFirstResponse}м` : '—'} 
          icon={Clock}
          color="green"
        />
        <MetricCard 
          label="Среднее решение" 
          value={data.cases.avgResolutionHours ? `${data.cases.avgResolutionHours}ч` : '—'} 
          icon={CheckCircle}
          color="emerald"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Daily Trend Chart */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Обращения по дням
          </h2>
          {data.team.dailyTrend.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="h-48 flex items-end gap-1">
              {data.team.dailyTrend.map((d, i) => {
                const maxVal = Math.max(...data.team.dailyTrend.map(x => x.cases), 1)
                const height = Math.max((d.cases / maxVal) * 140, 4)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col gap-0.5">
                      <div 
                        className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                        style={{ height: `${height}px` }}
                        title={`${d.cases} создано`}
                      />
                      {d.resolved > 0 && (
                        <div 
                          className="w-full bg-green-400 rounded-b"
                          style={{ height: `${Math.max((d.resolved / maxVal) * 140, 2)}px` }}
                          title={`${d.resolved} решено`}
                        />
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 truncate w-full text-center">
                      {new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded" /> Создано</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded" /> Решено</span>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">По категориям</h2>
          {data.patterns.byCategory.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-3">
              {data.patterns.byCategory.slice(0, 6).map((cat, i) => {
                const max = Math.max(...data.patterns.byCategory.map(c => c.count), 1)
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-700 truncate">{getCategoryLabel(cat.name)}</span>
                      <div className="flex items-center gap-2">
                        {cat.openCount > 0 && (
                          <span className="text-xs text-orange-500">{cat.openCount} откр.</span>
                        )}
                        <span className="text-slate-500 font-medium">{cat.count}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${(cat.count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Team Metrics Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            Активность команды
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Статистика ответов сотрудников поддержки
          </p>
        </div>
        {data.team.byManager.length === 0 ? (
          <div className="p-8 text-center text-slate-400">Нет данных по команде</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-5 py-3 text-slate-600 font-medium">Сотрудник</th>
                  <th className="text-center px-3 py-3 text-slate-600 font-medium">Сообщений</th>
                  <th className="text-center px-3 py-3 text-slate-600 font-medium">Каналов</th>
                  <th className="text-center px-3 py-3 text-slate-600 font-medium">Дней активен</th>
                  <th className="text-center px-3 py-3 text-slate-600 font-medium">Кейсов</th>
                  <th className="text-center px-3 py-3 text-slate-600 font-medium">Последняя активность</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.team.byManager.map((m, i) => {
                  const formatLastActive = (dateStr?: string) => {
                    if (!dateStr) return '—'
                    const date = new Date(dateStr)
                    const now = new Date()
                    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
                    if (diffHours < 1) return 'только что'
                    if (diffHours < 24) return `${diffHours}ч назад`
                    const diffDays = Math.floor(diffHours / 24)
                    if (diffDays < 7) return `${diffDays}д назад`
                    return date.toLocaleDateString('ru-RU')
                  }
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">{m.name || 'Неизвестный'}</div>
                        {m.id && <div className="text-xs text-slate-400">ID: {String(m.id).slice(0, 8)}</div>}
                      </td>
                      <td className="text-center px-3 py-3">
                        <span className="text-lg font-semibold text-blue-600">{m.totalMessages}</span>
                      </td>
                      <td className="text-center px-3 py-3 text-slate-600">{m.channelsServed}</td>
                      <td className="text-center px-3 py-3 text-slate-600">{m.activeDays}</td>
                      <td className="text-center px-3 py-3">
                        {m.totalCases > 0 ? (
                          <div>
                            <span className="text-slate-600">{m.resolved}/{m.totalCases}</span>
                            {m.resolutionRate > 0 && (
                              <Badge 
                                variant={m.resolutionRate >= 80 ? 'success' : m.resolutionRate >= 50 ? 'warning' : 'default'}
                                size="sm"
                                className="ml-1"
                              >
                                {m.resolutionRate}%
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="text-center px-3 py-3 text-slate-500 text-xs">
                        {formatLastActive(m.lastActiveAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Response Time Distribution */}
      {data.team.responseTimeDistribution && data.team.responseTimeDistribution.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-500" />
              Время первого ответа
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-5 gap-4">
              {data.team.responseTimeDistribution.map((item, i) => {
                const total = data.team.responseTimeDistribution.reduce((sum, r) => sum + r.count, 0)
                const percent = total > 0 ? Math.round((item.count / total) * 100) : 0
                const colors = [
                  'bg-green-500',   // до 5 мин
                  'bg-emerald-500', // до 10 мин
                  'bg-amber-500',   // до 30 мин
                  'bg-orange-500',  // до 1 часа
                  'bg-red-500',     // более 1 часа
                ]
                const bucketLabels = [
                  'до 5 минут',
                  'до 10 минут', 
                  'до 30 минут',
                  'до 1 часа',
                  'более 1 часа'
                ]
                return (
                  <button 
                    key={i} 
                    onClick={() => setResponseTimeModal({
                      bucket: item.bucket,
                      bucketLabel: bucketLabels[i] || item.bucket,
                      count: item.count,
                      avgMinutes: item.avgMinutes,
                      color: colors[i] || 'bg-slate-400'
                    })}
                    className="text-center p-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    <div className="mb-2">
                      <div className="text-3xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{item.count}</div>
                      <div className="text-xs text-slate-500">{percent}%</div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div 
                        className={`h-full ${colors[i] || 'bg-slate-400'} rounded-full`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="text-sm font-medium text-slate-700">{item.bucket}</div>
                    <div className="text-xs text-slate-400">
                      сред. {item.avgMinutes > 0 ? `${Math.round(item.avgMinutes)} мин` : '—'}
                    </div>
                    <div className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 mt-1 transition-opacity">
                      Нажмите для деталей →
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Recurring Problems */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-500" />
            Повторяющиеся проблемы
          </h2>
          {data.patterns.recurringProblems.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-2">
              {data.patterns.recurringProblems.slice(0, 6).map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700 text-sm truncate flex-1">{p.issue}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{p.affected} комп.</span>
                    <Badge variant="warning" size="sm">{p.count}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sentiment Distribution */}
        <div className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-4">Настроение клиентов</h2>
          {data.patterns.bySentiment.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-3">
              {data.patterns.bySentiment.map((s, i) => {
                const max = Math.max(...data.patterns.bySentiment.map(x => x.count), 1)
                const colors: Record<string, string> = {
                  positive: 'bg-green-500',
                  neutral: 'bg-slate-400',
                  negative: 'bg-red-500',
                  frustrated: 'bg-orange-500',
                }
                const labels: Record<string, string> = {
                  positive: 'Позитивное',
                  neutral: 'Нейтральное',
                  negative: 'Негативное',
                  frustrated: 'Разочарование',
                }
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-700">{labels[s.sentiment] || s.sentiment}</span>
                      <span className="text-slate-500">{s.count}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${colors[s.sentiment] || 'bg-slate-400'}`}
                        style={{ width: `${(s.count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Churn Signals Section */}
      {(data.churnSignals.highRiskCompanies.length > 0 || 
        data.churnSignals.negativeCompanies.length > 0 || 
        data.churnSignals.stuckCases.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Клиенты, требующие внимания
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Каналы с признаками неудовлетворённости или проблем
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100">
            {/* High Risk Companies */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-800">Высокий риск</h3>
                  <p className="text-xs text-slate-500">Много негатива + проблем</p>
                </div>
              </div>
              {data.churnSignals.highRiskCompanies.length === 0 ? (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Всё хорошо
                </p>
              ) : (
                <div className="space-y-2">
                  {data.churnSignals.highRiskCompanies.slice(0, 5).map((c, i) => {
                    const maxRisk = Math.max(...data.churnSignals.highRiskCompanies.map(x => x.riskScore), 1)
                    const riskPercent = (c.riskScore / maxRisk) * 100
                    return (
                      <div key={i} className="group">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-700 truncate max-w-[140px]" title={c.companyName}>
                            {c.companyName || `Канал ${c.companyId?.slice(0, 8)}`}
                          </span>
                          <span className="text-xs font-medium text-red-600">{c.riskScore} баллов</span>
                        </div>
                        <div className="h-1.5 bg-red-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-red-500 rounded-full transition-all"
                            style={{ width: `${riskPercent}%` }}
                          />
                        </div>
                        {(c.openCases > 0 || c.recurringCases > 0) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {c.openCases > 0 && `${c.openCases} откр. кейсов`}
                            {c.openCases > 0 && c.recurringCases > 0 && ' • '}
                            {c.recurringCases > 0 && `${c.recurringCases} повторных`}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Negative Companies */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-800">Негативные отзывы</h3>
                  <p className="text-xs text-slate-500">Жалобы и недовольство</p>
                </div>
              </div>
              {data.churnSignals.negativeCompanies.length === 0 ? (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Всё хорошо
                </p>
              ) : (
                <div className="space-y-2">
                  {data.churnSignals.negativeCompanies.slice(0, 5).map((c, i) => {
                    const maxNeg = Math.max(...data.churnSignals.negativeCompanies.map(x => x.negativeMessages), 1)
                    const negPercent = (c.negativeMessages / maxNeg) * 100
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-700 truncate max-w-[140px]" title={c.companyName}>
                            {c.companyName || `Канал ${c.companyId?.slice(0, 8)}`}
                          </span>
                          <span className="text-xs font-medium text-orange-600">
                            {c.negativeMessages} сообщ.
                          </span>
                        </div>
                        <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-orange-500 rounded-full transition-all"
                            style={{ width: `${negPercent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Stuck Cases */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-800">Долго без ответа</h3>
                  <p className="text-xs text-slate-500">Кейсы открыты &gt;48ч</p>
                </div>
              </div>
              {data.churnSignals.stuckCases.length === 0 ? (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Всё хорошо
                </p>
              ) : (
                <div className="space-y-2">
                  {data.churnSignals.stuckCases.slice(0, 5).map((c, i) => {
                    const formatHours = (h: number) => {
                      if (h < 24) return `${h} ч`
                      const days = Math.floor(h / 24)
                      const hours = h % 24
                      return hours > 0 ? `${days} дн ${hours} ч` : `${days} дн`
                    }
                    const maxHours = Math.max(...data.churnSignals.stuckCases.map(x => x.oldestHours), 1)
                    const hoursPercent = (c.oldestHours / maxHours) * 100
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-700 truncate max-w-[140px]" title={c.companyName}>
                            {c.companyName || `Канал ${c.companyId?.slice(0, 8)}`}
                          </span>
                          <span className="text-xs font-medium text-amber-600">
                            {formatHours(c.oldestHours)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-amber-500 rounded-full transition-all"
                            style={{ width: `${hoursPercent}%` }}
                          />
                        </div>
                        {c.stuckCases > 1 && (
                          <p className="text-xs text-slate-400 mt-0.5">{c.stuckCases} кейсов</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-slate-400 py-2">
        Данные за {data.periodDays} дней • Обновлено: {new Date(data.generatedAt).toLocaleString('ru-RU')}
      </div>

      {/* Response Time Details Modal */}
      {responseTimeModal && (
        <ResponseTimeDetailsModal
          isOpen={!!responseTimeModal}
          onClose={() => setResponseTimeModal(null)}
          bucket={responseTimeModal.bucket}
          bucketLabel={responseTimeModal.bucketLabel}
          count={responseTimeModal.count}
          avgMinutes={responseTimeModal.avgMinutes}
          period={period}
          color={responseTimeModal.color}
        />
      )}
    </div>
  )
}

// Helper Components
function MetricCard({ label, value, icon: Icon, color }: { 
  label: string
  value: string | number
  icon: typeof Briefcase
  color: string 
}) {
  const bgColor = `bg-${color}-100`
  const textColor = `text-${color}-600`
  
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 ${bgColor} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${textColor}`} />
        </div>
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="h-48 flex items-center justify-center text-slate-400">
      <div className="text-center">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Нет данных за период</p>
      </div>
    </div>
  )
}
