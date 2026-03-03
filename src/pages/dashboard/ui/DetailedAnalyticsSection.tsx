import { useState } from 'react'
import {
  Clock, AlertTriangle, MessageSquare, ChevronRight, TrendingUp,
  Users, Briefcase, CheckCircle, BarChart3, Mic, Video, AlertCircle,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { Badge } from '@/shared/ui'
import type { AnalyticsData } from '@/shared/api'
import { getCategoryLabel } from '../model/types'

interface Props {
  analytics: AnalyticsData
  onProblemClick: (category: string, label: string) => void
}

export function DetailedAnalyticsSection({ analytics, onProblemClick }: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <div className="text-left">
            <span className="font-semibold text-slate-800">Подробная аналитика</span>
            <p className="text-xs text-slate-500">Детальные графики, категории и метрики команды</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {expanded && (
        <>
          <OverviewCards analytics={analytics} />
          <MetricsRow analytics={analytics} />
          <ChartsRow analytics={analytics} />
          <DemandingChannelsTable analytics={analytics} />
          <SlowestClientsTable analytics={analytics} />
          <TeamMetricsTable analytics={analytics} />
          <ProblemsAndSentiment analytics={analytics} onProblemClick={onProblemClick} />
        </>
      )}
    </>
  )
}

function OverviewCards({ analytics }: { analytics: AnalyticsData }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard icon={Users} iconBg="bg-blue-100" iconColor="text-blue-600" label="Всего каналов"
        value={analytics.channels?.total || 0} sub={`${analytics.channels?.active || 0} активных`} subColor="text-green-600" />
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-purple-600" />
          </div>
          <span className="text-sm text-slate-500">Сообщений</span>
        </div>
        <p className="text-3xl font-bold text-slate-800">{analytics.messages?.total || 0}</p>
        <div className="flex gap-2 mt-1 text-xs">
          {analytics.messages?.voice && analytics.messages.voice > 0 && (
            <span className="flex items-center gap-1 text-slate-500"><Mic className="w-3 h-3" /> {analytics.messages.voice}</span>
          )}
          {analytics.messages?.video && analytics.messages.video > 0 && (
            <span className="flex items-center gap-1 text-slate-500"><Video className="w-3 h-3" /> {analytics.messages.video}</span>
          )}
        </div>
      </div>
      <StatCard icon={CheckCircle} iconBg="bg-green-100" iconColor="text-green-600" label="Решено кейсов"
        value={`${analytics.cases?.resolved || 0}/${analytics.cases?.total || 0}`}
        sub={`${analytics.cases?.total ? Math.round((analytics.cases.resolved / analytics.cases.total) * 100) : 0}% решено`}
        subColor="text-green-600" />
      <StatCard icon={AlertCircle} iconBg="bg-orange-100" iconColor="text-orange-600" label="Проблем"
        value={`${analytics.messages?.total ? ((analytics.messages.problems / analytics.messages.total) * 100).toFixed(1) : '0'}%`}
        sub={`${analytics.messages?.problems || 0} сообщений`} subColor="text-slate-500" />
    </div>
  )
}

function StatCard({ icon: Icon, iconBg, iconColor, label, value, sub, subColor }: {
  icon: React.ElementType; iconBg: string; iconColor: string; label: string;
  value: string | number; sub: string; subColor: string
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
      <p className={`text-sm ${subColor} mt-1`}>{sub}</p>
    </div>
  )
}

function MetricsRow({ analytics }: { analytics: AnalyticsData }) {
  const bp = analytics.cases?.byPriority || { low: 0, medium: 0, high: 0, urgent: 0 }
  const total = bp.low + bp.medium + bp.high + bp.urgent

  return (
    <div className="grid grid-cols-5 gap-4">
      <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
        <Briefcase className="w-6 h-6 text-blue-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-slate-800">{analytics.cases?.open || 0}</p>
        <p className="text-xs text-slate-500">Открытых кейсов</p>
      </div>
      <div className="bg-white rounded-xl p-4 border border-slate-200">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-5 h-5 text-slate-400" />
          <span className="text-xs text-slate-500">По приоритету</span>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-1 h-5 rounded overflow-hidden bg-slate-100">
            {bp.urgent > 0 && <div className="bg-red-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.urgent/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.urgent}</span></div>}
            {bp.high > 0 && <div className="bg-orange-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.high/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.high}</span></div>}
            {bp.medium > 0 && <div className="bg-amber-400 h-full flex items-center justify-center px-1" style={{width: `${(bp.medium/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.medium}</span></div>}
            {bp.low > 0 && <div className="bg-green-500 h-full flex items-center justify-center px-1" style={{width: `${(bp.low/total)*100}%`, minWidth: '20px'}}><span className="text-[9px] text-white font-bold">{bp.low}</span></div>}
          </div>
        )}
        <p className="text-lg font-bold text-slate-800 mt-1">{total}</p>
      </div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
        <TrendingUp className="w-6 h-6 text-amber-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-slate-800">{analytics.cases?.recurring || 0}</p>
        <p className="text-xs text-slate-500">Повторяющихся</p>
      </div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
        <Clock className="w-6 h-6 text-green-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-slate-800">{analytics.channels?.avgFirstResponse || '—'}м</p>
        <p className="text-xs text-slate-500">Сред. время ответа</p>
      </div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
        <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-slate-800">{analytics.cases?.avgResolutionHours || '—'}ч</p>
        <p className="text-xs text-slate-500">Сред. решение</p>
      </div>
    </div>
  )
}

function ChartsRow({ analytics }: { analytics: AnalyticsData }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />Обращения по дням
        </h2>
        {!analytics.team?.dailyTrend || analytics.team.dailyTrend.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
        ) : (
          <>
            <div className="h-44 flex items-end gap-0.5 px-1">
              {analytics.team.dailyTrend.map((d, i) => {
                const maxVal = Math.max(...analytics.team.dailyTrend!.map(x => Math.max(x.cases, x.resolved)), 1)
                const createdH = Math.max((d.cases / maxVal) * 100, d.cases > 0 ? 8 : 2)
                const resolvedH = Math.max((d.resolved / maxVal) * 100, d.resolved > 0 ? 6 : 0)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center min-w-0">
                    {(d.cases > 0 || d.resolved > 0) ? (
                      <div className="text-[9px] text-slate-600 font-medium mb-0.5 leading-none">{d.cases > 0 ? d.cases : ''}</div>
                    ) : <div className="h-3" />}
                    <div className="w-full flex flex-col gap-px" style={{ height: `${createdH + resolvedH}px` }}>
                      {d.cases > 0 && <div className="w-full bg-blue-500 rounded-sm" style={{ height: `${createdH}px`, minHeight: '4px' }} title={`${d.cases} создано`} />}
                      {d.resolved > 0 && <div className="w-full bg-green-400 rounded-sm" style={{ height: `${resolvedH}px`, minHeight: '4px' }} title={`${d.resolved} решено`} />}
                      {d.cases === 0 && d.resolved === 0 && <div className="w-full bg-slate-200 rounded-sm" style={{ height: '2px' }} />}
                    </div>
                    <span className="text-[8px] text-slate-400 truncate w-full text-center mt-1 leading-none">
                      {new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500 rounded-sm" /> Создано</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-400 rounded-sm" /> Решено</span>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h2 className="font-semibold text-slate-800 mb-4">По категориям</h2>
        {!analytics.patterns?.byCategory || analytics.patterns.byCategory.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
        ) : (
          <div className="space-y-3">
            {analytics.patterns.byCategory.slice(0, 6).map((cat, i) => {
              const max = Math.max(...analytics.patterns.byCategory.map(c => c.count), 1)
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700 truncate">{getCategoryLabel(cat.name)}</span>
                    <div className="flex items-center gap-2">
                      {cat.openCount > 0 && <span className="text-xs text-orange-500">{cat.openCount} откр.</span>}
                      <span className="text-slate-500 font-medium">{cat.count}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(cat.count / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DemandingChannelsTable({ analytics }: { analytics: AnalyticsData }) {
  if (!analytics.topDemandingChannels || analytics.topDemandingChannels.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          Каналы требующие внимания
          <span className="text-xs font-normal text-slate-400 ml-2">Топ по нагрузке, проблемам и срочности</span>
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-5 py-3 text-slate-600 font-medium">Канал</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Индекс</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Проблемы</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Негатив</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Срочные</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Кейсы</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {analytics.topDemandingChannels.slice(0, 10).map(ch => (
              <tr key={ch.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${ch.attentionScore >= 30 ? 'bg-red-500' : ch.attentionScore >= 15 ? 'bg-orange-500' : 'bg-yellow-500'}`} />
                    <span className="font-medium text-slate-800 truncate max-w-[200px]" title={ch.name}>{ch.name}</span>
                  </div>
                </td>
                <td className="text-center px-3 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ch.attentionScore >= 30 ? 'bg-red-100 text-red-700' : ch.attentionScore >= 15 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {ch.attentionScore}
                  </span>
                </td>
                <td className="text-center px-3 py-3">{ch.problemCount > 0 ? <span className="text-red-600 font-medium">{ch.problemCount}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="text-center px-3 py-3">{ch.negativeCount > 0 ? <span className="text-orange-600 font-medium">{ch.negativeCount}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="text-center px-3 py-3">{ch.urgentCount > 0 ? <span className="text-amber-600 font-medium">{ch.urgentCount}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="text-center px-3 py-3">{ch.openCases > 0 ? <span className="text-blue-600 font-medium">{ch.openCases}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="text-center px-3 py-3">
                  <div className="flex items-center justify-center gap-1">
                    {ch.awaitingReply && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700">Ждёт</span>}
                    {ch.unreadCount > 0 && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{ch.unreadCount}</span>}
                    {!ch.awaitingReply && ch.unreadCount === 0 && <span className="text-slate-400">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SlowestClientsTable({ analytics }: { analytics: AnalyticsData }) {
  if (!analytics.slowestClients || analytics.slowestClients.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          Медленно отвечающие клиенты
          <span className="text-xs font-normal text-slate-400 ml-2">Для аргументации при претензиях о скорости</span>
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-5 py-3 text-slate-600 font-medium">Канал</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Мы отвечаем</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Клиент отвечает</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Разница</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Ответов</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {analytics.slowestClients.slice(0, 10).map(ch => (
              <tr key={ch.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="font-medium text-slate-800 truncate max-w-[200px]" title={ch.name}>{ch.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      ch.slaCategory === 'partner' ? 'bg-purple-100 text-purple-700' :
                      ch.slaCategory === 'client_integration' ? 'bg-blue-100 text-blue-700' :
                      ch.slaCategory === 'internal' ? 'bg-slate-100 text-slate-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {ch.slaCategory === 'partner' ? 'Партнёр' : ch.slaCategory === 'client_integration' ? 'Интеграция' : ch.slaCategory === 'internal' ? 'Внутренний' : 'Клиент'}
                    </span>
                  </div>
                </td>
                <td className="text-center px-3 py-3"><span className="text-green-600 font-medium">~{ch.agentAvgFormatted}</span></td>
                <td className="text-center px-3 py-3">
                  <span className={`font-medium ${ch.slowerParty === 'client' ? 'text-amber-600' : 'text-slate-600'}`}>~{ch.clientAvgFormatted}</span>
                </td>
                <td className="text-center px-3 py-3">
                  {ch.slowerParty === 'client' ? <span className="text-amber-600 text-xs">Клиент на {ch.differenceFormatted} медленнее</span> : <span className="text-slate-400 text-xs">—</span>}
                </td>
                <td className="text-center px-3 py-3 text-slate-500 text-xs">{ch.clientResponseCount + ch.agentResponseCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TeamMetricsTable({ analytics }: { analytics: AnalyticsData }) {
  if (!analytics.team?.byManager || analytics.team.byManager.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />Активность команды
          </h2>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">за {analytics.periodDays || 30} дней</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">Статистика по сотрудникам на основе отправленных сообщений в каналах поддержки</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-5 py-3 text-slate-600 font-medium">Сотрудник</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Отправлено</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Каналов</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Кейсы</th>
              <th className="text-center px-3 py-3 text-slate-600 font-medium">Ср. ответ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {analytics.team.byManager.slice(0, 8).map((m, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-800">{m.name || 'Неизвестный'}</div>
                  {m.channelsServed > 10 && <div className="text-xs text-green-600">Активный</div>}
                </td>
                <td className="text-center px-3 py-3">
                  <span className="text-lg font-semibold text-blue-600">{m.totalMessages}</span>
                  <div className="text-[10px] text-slate-400">сообщ.</div>
                </td>
                <td className="text-center px-3 py-3">
                  <span className="text-slate-700 font-medium">{m.channelsServed}</span>
                  <div className="text-[10px] text-slate-400">каналов</div>
                </td>
                <td className="text-center px-3 py-3">
                  {m.totalCases > 0 ? (
                    <div>
                      <span className="text-slate-700">{m.resolved}/{m.totalCases}</span>
                      <div className="text-[10px] text-green-600">{Math.round((m.resolved / m.totalCases) * 100)}% решено</div>
                    </div>
                  ) : <span className="text-slate-400 text-xs">нет кейсов</span>}
                </td>
                <td className="text-center px-3 py-3">
                  {m.avgTime && m.avgTime > 0 ? (
                    <span className={`font-medium ${m.avgTime <= 15 ? 'text-green-600' : m.avgTime <= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                      {m.avgTime < 60 ? `${m.avgTime}м` : `${Math.round(m.avgTime / 60)}ч`}
                    </span>
                  ) : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 rounded-b-xl">
        Данные собраны из сообщений где сотрудник отвечал клиентам (по telegram ID, username или имени)
      </div>
    </div>
  )
}

function ProblemsAndSentiment({ analytics, onProblemClick }: { analytics: AnalyticsData; onProblemClick: (cat: string, label: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-orange-500" />
          Повторяющиеся проблемы
          <span className="text-xs text-slate-400 font-normal ml-auto">Кликните для деталей</span>
        </h2>
        {!analytics.patterns?.recurringProblems || analytics.patterns.recurringProblems.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">Нет данных</div>
        ) : (
          <div className="space-y-2">
            {analytics.patterns.recurringProblems.slice(0, 6).map((p, i) => (
              <div key={i}
                className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors"
                onClick={() => onProblemClick(p.category || p.issue, p.issue)}>
                <span className="text-slate-700 text-sm truncate flex-1">{p.issue}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{p.affected} комп.</span>
                  <Badge variant="warning" size="sm">{p.count}</Badge>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h2 className="font-semibold text-slate-800 mb-4">Настроение клиентов</h2>
        {!analytics.patterns?.bySentiment || analytics.patterns.bySentiment.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">Нет данных</div>
        ) : (
          <div className="space-y-3">
            {analytics.patterns.bySentiment.map((s, i) => {
              const max = Math.max(...analytics.patterns.bySentiment.map(x => x.count), 1)
              const colors: Record<string, string> = { positive: 'bg-green-500', neutral: 'bg-slate-400', negative: 'bg-red-500', frustrated: 'bg-orange-500' }
              const labels: Record<string, string> = { positive: 'Позитивное', neutral: 'Нейтральное', negative: 'Негативное', frustrated: 'Разочарование' }
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{labels[s.sentiment] || s.sentiment}</span>
                    <span className="text-slate-500">{s.count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${colors[s.sentiment] || 'bg-slate-400'} rounded-full`} style={{ width: `${(s.count / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
