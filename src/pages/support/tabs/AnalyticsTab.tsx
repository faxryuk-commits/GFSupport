import { 
  RefreshCw, MessageSquare, Users, Zap, Shield, CheckCircle,
  AlertCircle, Activity, TrendingUp, AlertTriangle, Radio
} from 'lucide-react'
import type { 
  AnalyticsData, MessagesStats, SupportMessage, SupportCase, 
  SupportChannel, KPI as KPIType 
} from './types'
import { KPI, sentimentColors } from './types'

interface GroupedChannel extends SupportChannel {
  messages?: SupportMessage[]
}

interface AnalyticsTabProps {
  analytics: AnalyticsData | null
  messagesStats: MessagesStats | null
  messages: SupportMessage[]
  cases: SupportCase[]
  groupedMessages: GroupedChannel[]
  analyticsPeriod: string
  loading: boolean
  onPeriodChange: (period: string) => void
  onShowConversationsModal: (config: { type: string; title: string }) => void
}

export function AnalyticsTab({
  analytics,
  messagesStats,
  messages,
  cases,
  groupedMessages,
  analyticsPeriod,
  loading,
  onPeriodChange,
  onShowConversationsModal,
}: AnalyticsTabProps) {
  if (loading || !analytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-slate-800">Аналитика Support</h2>
        <div className="flex gap-2">
          {['7d', '30d', '90d'].map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                analyticsPeriod === p ? 'bg-brand-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : '90 дней'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {/* Overview Cards - Clickable for details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button 
            onClick={() => onShowConversationsModal({ type: 'all', title: 'Все кейсы' })}
            className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
          >
            <div className="text-sm text-slate-500 mb-1">Всего кейсов</div>
            <div className="text-3xl font-bold text-slate-800">{analytics.overview.totalCases}</div>
            <div className="text-xs text-slate-400 mt-1">100%</div>
          </button>
          <button 
            onClick={() => onShowConversationsModal({ type: 'open', title: 'Открытые кейсы' })}
            className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
          >
            <div className="text-sm text-slate-500 mb-1">Открытых</div>
            <div className="text-3xl font-bold text-orange-500">{analytics.overview.openCases}</div>
            <div className="text-xs text-orange-400 mt-1">
              {analytics.overview.totalCases > 0 
                ? `${Math.round((analytics.overview.openCases / analytics.overview.totalCases) * 100)}%`
                : '0%'}
            </div>
          </button>
          <button 
            onClick={() => onShowConversationsModal({ type: 'resolved', title: 'Решённые кейсы' })}
            className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
          >
            <div className="text-sm text-slate-500 mb-1">Решённых</div>
            <div className="text-3xl font-bold text-green-500">{analytics.overview.resolvedCases}</div>
            <div className="text-xs text-green-400 mt-1">
              {analytics.overview.totalCases > 0 
                ? `${Math.round((analytics.overview.resolvedCases / analytics.overview.totalCases) * 100)}%`
                : '0%'}
            </div>
          </button>
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <div className="text-sm text-slate-500 mb-1">Ср. решение</div>
            <div className="text-3xl font-bold text-blue-500">{analytics.overview.avgResolutionHours}ч</div>
            <div className="text-xs text-blue-400 mt-1">среднее время</div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Problem Patterns */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              Паттерны проблем
            </h3>
            {analytics.patterns.byCategory.length === 0 ? (
              <p className="text-slate-500 text-sm">Нет данных за период</p>
            ) : (
              <div className="space-y-3">
                {analytics.patterns.byCategory.slice(0, 6).map((cat, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">
                      {{
                        technical: '🔧 Техническая',
                        billing: '💳 Биллинг',
                        integration: '🔗 Интеграция',
                        onboarding: '🚀 Онбординг',
                        feature_request: '💡 Запрос функции',
                        complaint: '😤 Жалоба',
                        question: '❓ Вопрос',
                        feedback: '💬 Обратная связь',
                        general: '📋 Общее'
                      }[cat.category] || cat.category}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-orange-500 rounded-full"
                          style={{ width: `${(cat.count / (analytics.patterns.byCategory[0]?.count || 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{cat.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sentiment Distribution */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-500" />
              Настроение сообщений
            </h3>
            {analytics.patterns.bySentiment.length === 0 ? (
              <p className="text-slate-500 text-sm">Нет данных за период</p>
            ) : (
              <div className="space-y-3">
                {analytics.patterns.bySentiment.map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${sentimentColors[s.sentiment] || 'bg-slate-100'}`}>
                      {{ positive: 'Позитивное', neutral: 'Нейтральное', negative: 'Негативное', frustrated: 'Раздражённое' }[s.sentiment] || s.sentiment}
                    </span>
                    <span className="text-sm font-medium">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Churn Signals */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            Риск оттока клиентов
          </h3>
          
          {analytics.churnSignals.highRiskCompanies.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-slate-600">Компаний с высоким риском оттока не обнаружено</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-slate-500">Компания</th>
                    <th className="text-left py-2 font-medium text-slate-500">Выручка</th>
                    <th className="text-left py-2 font-medium text-slate-500">Риск</th>
                    <th className="text-left py-2 font-medium text-slate-500">Открытых кейсов</th>
                    <th className="text-left py-2 font-medium text-slate-500">Повторных</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.churnSignals.highRiskCompanies.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{c.companyName || c.companyId}</td>
                      <td className="py-2">${c.mrr}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          c.riskScore >= 10 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {c.riskScore}
                        </span>
                      </td>
                      <td className="py-2">{c.openCases || 0}</td>
                      <td className="py-2">{c.recurringCases || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Team Performance */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            Метрики команды
          </h3>
          
          {analytics.teamMetrics.byManager.length === 0 ? (
            <p className="text-slate-500 text-sm">Нет данных за период</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-slate-500">Менеджер</th>
                    <th className="text-left py-2 font-medium text-slate-500">Кейсов</th>
                    <th className="text-left py-2 font-medium text-slate-500">Решено</th>
                    <th className="text-left py-2 font-medium text-slate-500">% решённых</th>
                    <th className="text-left py-2 font-medium text-slate-500">Ср. время</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.teamMetrics.byManager.map((m, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{m.managerName === 'Unassigned' ? 'Не назначен' : m.managerName}</td>
                      <td className="py-2">{m.totalCases}</td>
                      <td className="py-2">{m.resolvedCases}</td>
                      <td className="py-2">
                        <span className={`font-medium ${m.resolutionRate >= 80 ? 'text-green-600' : m.resolutionRate >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
                          {m.resolutionRate}%
                        </span>
                      </td>
                      <td className="py-2">{Math.round(m.avgResolutionMinutes / 60)}ч</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Messages Analytics */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Message Stats */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-500" />
              Статистика сообщений
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Всего сообщений</span>
                <span className="font-semibold">{messagesStats?.total || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Непрочитанных</span>
                <span className="font-semibold text-orange-600">{messagesStats?.unread || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Проблемных</span>
                <span className="font-semibold text-red-600">{messagesStats?.problems || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Каналов активных</span>
                <span className="font-semibold">{messagesStats?.channelsWithMessages || 0}</span>
              </div>
            </div>
          </div>

          {/* AI Analysis Summary */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-500" />
              AI обработка
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Голосовых транскрибировано</span>
                <span className="font-semibold text-purple-600">
                  {messages.filter(m => m.transcript).length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Изображений проанализировано</span>
                <span className="font-semibold text-blue-600">
                  {messages.filter(m => m.aiImageAnalysis).length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Срочные (4-5)</span>
                <span className="font-semibold text-red-600">
                  {messages.filter(m => (m.aiUrgency || 0) >= 4).length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Категоризировано</span>
                <span className="font-semibold text-green-600">
                  {messages.filter(m => m.aiCategory).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ========== АНАЛИТИКА КАНАЛОВ ========== */}
        <div className="mt-8 pt-6 border-t-2 border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
            <Radio className="w-6 h-6 text-blue-500" />
            Аналитика каналов
          </h2>

          {/* 1. Топ каналов по активности */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-xl p-5 shadow-sm">
              <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                Топ-5 активных каналов
              </h3>
              {(() => {
                const channelStats = groupedMessages
                  .map((ch: any) => ({
                    ...ch,
                    msgCount: ch.messages?.length || 0,
                    caseCount: cases.filter(c => c.channelId === ch.id).length,
                  }))
                  .sort((a: any, b: any) => b.msgCount - a.msgCount)
                  .slice(0, 5)
                
                return channelStats.length === 0 ? (
                  <p className="text-slate-500 text-sm">Нет данных</p>
                ) : (
                  <div className="space-y-3">
                    {channelStats.map((ch: any, i: number) => (
                      <div key={ch.id} className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          i === 0 ? 'bg-yellow-100 text-yellow-700' :
                          i === 1 ? 'bg-slate-100 text-slate-700' :
                          i === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-slate-50 text-slate-500'
                        }`}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{ch.name}</div>
                          <div className="text-xs text-slate-400">{ch.msgCount} сообщ. • {ch.caseCount} кейсов</div>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded ${
                          ch.awaitingReply ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                        }`}>
                          {ch.awaitingReply ? 'Ждёт' : 'OK'}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* 2. Здоровье каналов (светофор) */}
            <div className="bg-white rounded-xl p-5 shadow-sm">
              <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                Здоровье каналов
              </h3>
              {(() => {
                const healthStats = {
                  green: groupedMessages.filter((ch: any) => !ch.awaitingReply).length,
                  yellow: groupedMessages.filter((ch: any) => {
                    if (!ch.awaitingReply || !ch.lastClientMessageAt) return false
                    const waitMin = Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000)
                    return waitMin <= KPI.FIRST_RESPONSE_MIN
                  }).length,
                  red: groupedMessages.filter((ch: any) => {
                    if (!ch.awaitingReply || !ch.lastClientMessageAt) return false
                    const waitMin = Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000)
                    return waitMin > KPI.FIRST_RESPONSE_MIN
                  }).length,
                }
                const total = groupedMessages.length || 1
                
                return (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <div className="flex-1 text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{healthStats.green}</div>
                        <div className="text-xs text-green-600">В норме</div>
                      </div>
                      <div className="flex-1 text-center p-3 bg-yellow-50 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-600">{healthStats.yellow}</div>
                        <div className="text-xs text-yellow-600">Внимание</div>
                      </div>
                      <div className="flex-1 text-center p-3 bg-red-50 rounded-lg">
                        <div className="text-2xl font-bold text-red-600">{healthStats.red}</div>
                        <div className="text-xs text-red-600">Просрочено</div>
                      </div>
                    </div>
                    <div className="h-4 rounded-full overflow-hidden flex bg-slate-100">
                      <div className="bg-green-500 h-full" style={{ width: `${(healthStats.green / total) * 100}%` }} />
                      <div className="bg-yellow-500 h-full" style={{ width: `${(healthStats.yellow / total) * 100}%` }} />
                      <div className="bg-red-500 h-full" style={{ width: `${(healthStats.red / total) * 100}%` }} />
                    </div>
                    <div className="text-center text-sm text-slate-500">
                      SLA {KPI.FIRST_RESPONSE_MIN} мин: {Math.round(((healthStats.green + healthStats.yellow) / total) * 100)}% выполнение
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* 3. Проблемные каналы */}
          <div className="bg-white rounded-xl p-5 shadow-sm mb-6">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Проблемные каналы (требуют внимания)
            </h3>
            {(() => {
              const problemChannels = groupedMessages
                .filter((ch: any) => {
                  const waitMin = ch.lastClientMessageAt 
                    ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) 
                    : 0
                  return ch.awaitingReply && waitMin > KPI.FIRST_RESPONSE_MIN
                })
                .sort((a: any, b: any) => {
                  const waitA = a.lastClientMessageAt ? Date.now() - new Date(a.lastClientMessageAt).getTime() : 0
                  const waitB = b.lastClientMessageAt ? Date.now() - new Date(b.lastClientMessageAt).getTime() : 0
                  return waitB - waitA
                })
                .slice(0, 5)
              
              return problemChannels.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">Все каналы в норме</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {problemChannels.map((ch: any) => {
                    const waitMin = ch.lastClientMessageAt 
                      ? Math.floor((Date.now() - new Date(ch.lastClientMessageAt).getTime()) / 60000) 
                      : 0
                    const waitHours = Math.floor(waitMin / 60)
                    
                    return (
                      <div key={ch.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                        <div>
                          <div className="font-medium text-sm">{ch.name}</div>
                          <div className="text-xs text-slate-500">{ch.companyName}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-red-600">
                            {waitHours > 0 ? `${waitHours}ч ${waitMin % 60}м` : `${waitMin}м`}
                          </div>
                          <div className="text-xs text-red-500">ожидает</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </>
  )
}

export default AnalyticsTab
