import { useState, useEffect, useCallback } from 'react'
import {
  Clock, Users, MessageSquare, TrendingUp, Loader2, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Hash, Zap, BarChart3, Mail, Send
} from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'

interface Overview {
  totalMessages: number
  fromClients: number
  fromAgents: number
  activeChannels: number
  avgResponseMin: number | null
  unansweredCount: number
}

interface UnansweredChannel {
  id: string
  name: string
  source: string
  waitingMinutes: number
}

interface AgentStat {
  name: string
  position: string
  messagesSent: number
  channelsActive: number
  avgResponseMin: number | null
  minResponseMin: number | null
  maxResponseMin: number | null
  avgMessageLength: number
}

interface HourlyItem {
  hour: number
  total: number
  clientMsgs: number
  agentMsgs: number
}

interface WeekdayItem {
  dow: number
  label: string
  total: number
  clientMsgs: number
  agentMsgs: number
  avgResponseMin: number | null
}

interface ChannelItem {
  id: string
  name: string
  source: string
  totalMessages: number
  clientMessages: number
  agentMessages: number
  avgResponseMin: number | null
}

interface DailyItem {
  day: string
  total: number
  incoming: number
  outgoing: number
  avgResponseMin: number | null
}

interface CommData {
  overview: Overview
  unanswered: UnansweredChannel[]
  agentStats: AgentStat[]
  hourlyLoad: HourlyItem[]
  weekdayLoad: WeekdayItem[]
  topChannels: ChannelItem[]
  dailyTrend: DailyItem[]
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`
  if (minutes < 1440) return `${Math.round(minutes / 60)} ч`
  return `${Math.round(minutes / 1440)} дн`
}

function ResponseBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-xs text-slate-400">—</span>
  const color = minutes <= 5 ? 'bg-green-100 text-green-700'
    : minutes <= 15 ? 'bg-blue-100 text-blue-700'
    : minutes <= 30 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{minutes} мин</span>
}

function SourceBadge({ source }: { source: string }) {
  return source === 'whatsapp'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-medium">WA</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">TG</span>
}

export function CommunicationMap() {
  const [data, setData] = useState<CommData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const result = await apiGet<CommData>('/analytics/conversation-sessions?days=14')
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
        <p className="text-slate-600 mb-2">Не удалось загрузить данные</p>
        <p className="text-sm text-slate-400 mb-4">{error}</p>
        <button onClick={loadData} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
          Повторить
        </button>
      </div>
    )
  }

  const { overview, unanswered, agentStats, hourlyLoad, weekdayLoad, topChannels, dailyTrend } = data
  const maxHourly = Math.max(...hourlyLoad.map(h => h.total), 1)
  const maxDaily = Math.max(...dailyTrend.map(d => d.total), 1)

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<MessageSquare className="w-5 h-5" />}
          label="Сообщений"
          value={overview.totalMessages}
          sub={`${overview.fromClients} входящих · ${overview.fromAgents} исходящих`}
          iconColor="text-blue-500" bgColor="bg-blue-50"
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Среднее время ответа"
          value={overview.avgResponseMin !== null ? `${overview.avgResponseMin} мин` : '—'}
          sub="среднее за период"
          iconColor="text-violet-500" bgColor="bg-violet-50"
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Ожидают ответа"
          value={overview.unansweredCount}
          sub="каналов без ответа"
          iconColor={overview.unansweredCount > 0 ? 'text-red-500' : 'text-green-500'}
          bgColor={overview.unansweredCount > 0 ? 'bg-red-50' : 'bg-green-50'}
        />
        <KpiCard
          icon={<Hash className="w-5 h-5" />}
          label="Активных каналов"
          value={overview.activeChannels}
          sub="за период"
          iconColor="text-slate-500" bgColor="bg-slate-50"
        />
      </div>

      {/* Unanswered - Critical Alert */}
      {unanswered.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4" />
            Ожидают ответа ({unanswered.length})
          </h3>
          <div className="space-y-2">
            {unanswered.slice(0, 8).map(ch => (
              <div key={ch.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <SourceBadge source={ch.source} />
                  <span className="text-sm font-medium text-slate-800 truncate">{ch.name}</span>
                  
                </div>
                <span className={`text-xs font-bold flex-shrink-0 ml-2 ${
                  ch.waitingMinutes > 60 ? 'text-red-600' : 'text-amber-600'
                }`}>
                  {formatWait(ch.waitingMinutes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Performance Table */}
      {agentStats.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              Эффективность сотрудников
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left px-4 py-2.5 font-medium">Сотрудник</th>
                  <th className="text-center px-3 py-2.5 font-medium">Ответов</th>
                  <th className="text-center px-3 py-2.5 font-medium">Каналов</th>
                  <th className="text-center px-3 py-2.5 font-medium">Ср. время ответа</th>
                  <th className="text-center px-3 py-2.5 font-medium">Мин / Макс</th>
                  <th className="text-center px-3 py-2.5 font-medium">Ср. длина</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agentStats.map((a, i) => (
                  <tr key={a.name} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-medium text-slate-800">{a.name}</p>
                          {a.position && <p className="text-xs text-slate-400">{a.position}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="font-semibold text-slate-700">{a.messagesSent}</span>
                    </td>
                    <td className="text-center px-3 py-3 text-slate-600">{a.channelsActive}</td>
                    <td className="text-center px-3 py-3">
                      <ResponseBadge minutes={a.avgResponseMin} />
                    </td>
                    <td className="text-center px-3 py-3 text-xs text-slate-500">
                      {a.minResponseMin !== null && a.maxResponseMin !== null
                        ? `${a.minResponseMin} / ${a.maxResponseMin} мин`
                        : '—'}
                    </td>
                    <td className="text-center px-3 py-3 text-slate-600">
                      {a.avgMessageLength > 0 ? `${a.avgMessageLength} сим.` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hourly + Weekday side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Hourly Activity */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-amber-500" />
            Нагрузка по часам
          </h3>
          <div className="flex items-end gap-[3px] h-32">
            {Array.from({ length: 24 }, (_, h) => {
              const item = hourlyLoad.find(x => x.hour === h)
              const total = item?.total || 0
              const pct = (total / maxHourly) * 100
              const isWorkHours = h >= 9 && h <= 18
              return (
                <div key={h} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div
                    className={`w-full rounded-t transition-all ${
                      isWorkHours ? 'bg-blue-400 hover:bg-blue-500' : 'bg-slate-300 hover:bg-slate-400'
                    }`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    title={`${h}:00 — ${total} сообщений`}
                  />
                  {h % 3 === 0 && (
                    <span className="text-[9px] text-slate-400">{h}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              Рабочие часы (9–18)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-slate-300" />
              Нерабочие
            </div>
          </div>
        </div>

        {/* Weekday Activity */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <BarChart3 className="w-4 h-4 text-purple-500" />
            По дням недели
          </h3>
          <div className="space-y-2.5">
            {weekdayLoad.map(w => {
              const maxWd = Math.max(...weekdayLoad.map(x => x.total), 1)
              const pct = (w.total / maxWd) * 100
              return (
                <div key={w.dow} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-600 w-5">{w.label}</span>
                  <div className="flex-1 flex h-5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="bg-blue-400 rounded-l transition-all"
                      style={{ width: `${(w.agentMsgs / (w.total || 1)) * pct}%` }}
                      title={`Ответы: ${w.agentMsgs}`}
                    />
                    <div
                      className="bg-emerald-400 transition-all"
                      style={{ width: `${(w.clientMsgs / (w.total || 1)) * pct}%` }}
                      title={`Входящие: ${w.clientMsgs}`}
                    />
                  </div>
                  <div className="flex items-center gap-2 w-28 justify-end">
                    <span className="text-xs text-slate-600 font-medium">{w.total}</span>
                    {w.avgResponseMin !== null && (
                      <ResponseBadge minutes={w.avgResponseMin} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              Ответы команды
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
              Входящие от клиентов
            </div>
          </div>
        </div>
      </div>

      {/* Daily Trend */}
      {dailyTrend.length > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-green-500" />
            Динамика по дням
          </h3>
          <div className="flex items-end gap-1 h-24">
            {dailyTrend.map(d => {
              const pctIn = (d.incoming / maxDaily) * 100
              const pctOut = (d.outgoing / maxDaily) * 100
              const dayLabel = new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${dayLabel}: ${d.incoming} вх / ${d.outgoing} исх`}>
                  <div className="w-full flex flex-col justify-end h-20">
                    <div className="bg-emerald-400 rounded-t" style={{ height: `${Math.max(pctIn, 1)}%` }} />
                    <div className="bg-blue-400 rounded-b" style={{ height: `${Math.max(pctOut, 1)}%` }} />
                  </div>
                  {dailyTrend.length <= 14 && (
                    <span className="text-[8px] text-slate-400 rotate-0">{new Date(d.day).getDate()}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
              Входящие
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              Исходящие
            </div>
          </div>
        </div>
      )}

      {/* Top Channels */}
      {topChannels.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-sm">
              <Hash className="w-4 h-4 text-slate-500" />
              Самые активные каналы
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="text-left px-4 py-2 font-medium">Канал</th>
                  <th className="text-center px-3 py-2 font-medium">
                    <div className="flex items-center justify-center gap-1"><Mail className="w-3 h-3" /> Входящие</div>
                  </th>
                  <th className="text-center px-3 py-2 font-medium">
                    <div className="flex items-center justify-center gap-1"><Send className="w-3 h-3" /> Исходящие</div>
                  </th>
                  <th className="text-center px-3 py-2 font-medium">Всего</th>
                  <th className="text-center px-3 py-2 font-medium">Ср. ответ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topChannels.map(ch => (
                  <tr key={ch.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <SourceBadge source={ch.source} />
                        <span className="font-medium text-slate-800 truncate max-w-[200px]">{ch.name}</span>
                      </div>
                    </td>
                    <td className="text-center px-3 py-2.5">
                      <span className="text-emerald-600 font-medium">{ch.clientMessages}</span>
                    </td>
                    <td className="text-center px-3 py-2.5">
                      <span className="text-blue-600 font-medium">{ch.agentMessages}</span>
                    </td>
                    <td className="text-center px-3 py-2.5 font-semibold text-slate-700">{ch.totalMessages}</td>
                    <td className="text-center px-3 py-2.5">
                      <ResponseBadge minutes={ch.avgResponseMin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, sub, iconColor, bgColor }: {
  icon: React.ReactNode; label: string; value: string | number; sub: string;
  iconColor: string; bgColor: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 ${bgColor} rounded-lg flex items-center justify-center ${iconColor}`}>
          {icon}
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
