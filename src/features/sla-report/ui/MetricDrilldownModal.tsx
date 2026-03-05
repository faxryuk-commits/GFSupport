import { Modal } from '@/shared/ui'
import { AlertTriangle, CheckCircle, Clock, MessageSquare, XCircle, Lightbulb, TrendingUp } from 'lucide-react'

export type DrilldownMetric = 
  | 'sla' | 'avgTime' | 'caseResolution' | 'avgResolution'
  | 'totalMessages' | 'responseRate' | 'withinSLA' | 'violations' 
  | 'noResponse' | 'totalCases' | 'openCases'

interface SLAViolation {
  channelId?: string
  channelName: string
  clientName: string
  messagePreview: string
  messageAt: string
  responseAt: string
  responseMinutes: number
  responder: string
  exceededBy: number
}

interface UnansweredMessage {
  channelId?: string
  channelName: string
  clientName: string
  messagePreview: string
  messageAt: string
  waitingMinutes: number
}

interface PendingCase {
  caseId?: string
  ticketNumber: string
  title: string
  status: string
  priority: string
  channelName: string
  agentName: string
  createdAt: string
  waitingHours: number
}

interface ResolvedCase {
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
}

interface ReportSummary {
  slaCompliancePercent: number
  avgResponseMinutes: number
  responseRatePercent: number
  totalClientMessages: number
  withinSLA: number
  violatedSLA: number
  noResponse: number
  slaMinutes: number
}

interface CaseSummary {
  totalCases: number
  resolved: number
  open: number
  resolutionRatePercent: number
  avgResolutionHours: number
}

interface AgentPerf {
  name: string
  avgMinutes: number
  slaCompliance: number | null
  totalResponses: number
}

interface Props {
  metric: DrilldownMetric
  onClose: () => void
  violations: SLAViolation[]
  unanswered: UnansweredMessage[]
  pending: PendingCase[]
  resolved: ResolvedCase[]
  responseSummary: ReportSummary
  caseSummary: CaseSummary
  agents: AgentPerf[]
}

const METRIC_TITLES: Record<DrilldownMetric, string> = {
  sla: 'SLA — соответствие нормативу',
  avgTime: 'Среднее время ответа',
  caseResolution: 'Решение кейсов',
  avgResolution: 'Среднее время решения кейсов',
  totalMessages: 'Сообщения от клиентов',
  responseRate: 'Охват ответов',
  withinSLA: 'Ответы в рамках SLA',
  violations: 'Нарушения SLA',
  noResponse: 'Сообщения без ответа',
  totalCases: 'Все кейсы',
  openCases: 'Открытые кейсы',
}

function fmtDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent'
  })
}

function fmtMin(m: number) {
  if (m < 60) return `${Math.round(m)} мин`
  return `${Math.floor(m / 60)}ч ${Math.round(m % 60)}м`
}

const PRIO: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-slate-100 text-slate-700',
}

function getRecommendations(metric: DrilldownMetric, rs: ReportSummary, cs: CaseSummary, agents: AgentPerf[], violations: SLAViolation[], unanswered: UnansweredMessage[], pending: PendingCase[]): string[] {
  const recs: string[] = []
  switch (metric) {
    case 'sla':
    case 'withinSLA':
      if (rs.slaCompliancePercent < 80) recs.push('Критический уровень SLA. Необходимо срочно увеличить количество агентов или сократить SLA-норматив.')
      if (rs.slaCompliancePercent < 95) recs.push('Рассмотрите настройку автоответов для подтверждения получения запроса клиента.')
      if (agents.some(a => (a.avgMinutes || 0) > rs.slaMinutes * 2)) {
        const slow = agents.filter(a => (a.avgMinutes || 0) > rs.slaMinutes * 2).map(a => a.name)
        recs.push(`Агенты с замедленной реакцией: ${slow.join(', ')}. Провести обучение или перераспределить нагрузку.`)
      }
      if (rs.slaCompliancePercent >= 95) recs.push('Отличный показатель SLA! Поддерживайте текущий уровень.')
      break
    case 'violations': {
      const channels = new Map<string, number>()
      violations.forEach(v => channels.set(v.channelName, (channels.get(v.channelName) || 0) + 1))
      const topChannels = [...channels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      if (topChannels.length) recs.push(`Каналы с наибольшим числом нарушений: ${topChannels.map(([n, c]) => `${n} (${c})`).join(', ')}. Назначьте приоритетных агентов.`)
      const responders = new Map<string, number[]>()
      violations.forEach(v => { if (v.responder) { const arr = responders.get(v.responder) || []; arr.push(v.responseMinutes); responders.set(v.responder, arr) } })
      const slowResp = [...responders.entries()].map(([n, times]) => ({ name: n, avg: times.reduce((a, b) => a + b, 0) / times.length })).sort((a, b) => b.avg - a.avg).slice(0, 3)
      if (slowResp.length) recs.push(`Самые медленные ответчики: ${slowResp.map(r => `${r.name} (${fmtMin(r.avg)})`).join(', ')}.`)
      recs.push('Настройте уведомления при приближении к SLA-лимиту для превентивной реакции.')
      break
    }
    case 'noResponse':
      if (unanswered.length > 10) recs.push(`${unanswered.length} сообщений без ответа — критическая ситуация. Немедленно распределите их между агентами.`)
      else if (unanswered.length > 0) recs.push('Есть неотвеченные сообщения. Проверьте, не потерялись ли они в потоке.')
      { const ch = new Map<string, number>(); unanswered.forEach(u => ch.set(u.channelName, (ch.get(u.channelName) || 0) + 1))
        const top = [...ch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        if (top.length) recs.push(`Каналы с пропущенными сообщениями: ${top.map(([n, c]) => `${n} (${c})`).join(', ')}. Рассмотрите назначение ответственных.`)
      }
      recs.push('Внедрите систему эскалации для сообщений, ожидающих ответа более 15 минут.')
      break
    case 'avgTime':
      if (rs.avgResponseMinutes > rs.slaMinutes) recs.push(`Среднее время (${rs.avgResponseMinutes} мин) превышает норматив (${rs.slaMinutes} мин). Проанализируйте пиковые часы нагрузки.`)
      else recs.push(`Среднее время ответа в пределах нормы (${rs.avgResponseMinutes} мин при нормативе ${rs.slaMinutes} мин).`)
      { const sorted = [...agents].filter(a => a.totalResponses > 0).sort((a, b) => b.avgMinutes - a.avgMinutes)
        if (sorted.length > 1) recs.push(`Разброс по агентам: от ${fmtMin(sorted[sorted.length - 1].avgMinutes)} до ${fmtMin(sorted[0].avgMinutes)}. Выровняйте нагрузку.`)
      }
      break
    case 'responseRate':
      if (rs.responseRatePercent < 80) recs.push('Охват менее 80% — много сообщений остаётся без внимания. Нужен мониторинг входящих.')
      if (rs.responseRatePercent < 95) recs.push('Настройте автоматические напоминания агентам о неотвеченных сообщениях.')
      if (rs.responseRatePercent >= 95) recs.push('Отличный охват! Продолжайте в том же темпе.')
      break
    case 'caseResolution':
      if (cs.resolutionRatePercent < 90) recs.push('Процент решения кейсов ниже 90%. Проверьте, нет ли зависших кейсов, требующих эскалации.')
      if (cs.resolutionRatePercent >= 95) recs.push('Высокий процент решения кейсов!')
      break
    case 'avgResolution':
      if (cs.avgResolutionHours > 8) recs.push('Среднее время решения превышает рабочий день. Рассмотрите шаблоны для типовых обращений.')
      if (cs.avgResolutionHours > 24) recs.push('Кейсы решаются более суток. Необходима система приоритизации и эскалации.')
      break
    case 'openCases':
      { const old = pending.filter(p => p.waitingHours > 24)
        if (old.length) recs.push(`${old.length} кейсов ожидают более 24 часов. Рекомендуется эскалация руководителю.`)
      }
      { const noAgent = pending.filter(p => !p.agentName)
        if (noAgent.length) recs.push(`${noAgent.length} кейсов без назначенного агента. Распределите ответственных.`)
      }
      break
    case 'totalCases':
    case 'totalMessages':
      recs.push('Используйте данные для планирования ресурсов и прогнозирования нагрузки.')
      break
  }
  return recs
}

function ViolationsTable({ data }: { data: SLAViolation[] }) {
  if (!data.length) return <p className="text-sm text-slate-500">Нет нарушений SLA</p>
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-slate-50">
        <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Клиент</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Сообщение</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Когда</th>
        <th className="text-center py-2 px-3 font-medium text-slate-600">Ответ</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Кто</th>
      </tr></thead>
      <tbody>{data.map((v, i) => (
        <tr key={i} className="border-b border-slate-100 hover:bg-red-50/50">
          <td className="py-2 px-3 font-medium text-xs">{v.channelName}</td>
          <td className="py-2 px-3 text-xs">{v.clientName}</td>
          <td className="py-2 px-3 text-slate-500 text-xs max-w-40 truncate">{v.messagePreview}</td>
          <td className="py-2 px-3 text-slate-500 text-[11px]">{fmtDate(v.messageAt)}</td>
          <td className="py-2 px-3 text-center"><span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">{fmtMin(v.responseMinutes)}</span></td>
          <td className="py-2 px-3 text-xs">{v.responder || '-'}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

function UnansweredTable({ data }: { data: UnansweredMessage[] }) {
  if (!data.length) return <p className="text-sm text-slate-500">Все сообщения получили ответ</p>
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b bg-red-50">
        <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Клиент</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Сообщение</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Когда</th>
        <th className="text-center py-2 px-3 font-medium text-slate-600">Ожидание</th>
      </tr></thead>
      <tbody>{data.map((m, i) => (
        <tr key={i} className="border-b border-slate-100 hover:bg-red-50/50">
          <td className="py-2 px-3 font-medium text-xs">{m.channelName}</td>
          <td className="py-2 px-3 text-xs">{m.clientName}</td>
          <td className="py-2 px-3 text-slate-500 text-xs max-w-40 truncate">{m.messagePreview || '[медиа]'}</td>
          <td className="py-2 px-3 text-slate-500 text-[11px]">{fmtDate(m.messageAt)}</td>
          <td className="py-2 px-3 text-center"><span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">{fmtMin(m.waitingMinutes)}</span></td>
        </tr>
      ))}</tbody>
    </table>
  )
}

function CasesTable({ data, type }: { data: (PendingCase | ResolvedCase)[]; type: 'pending' | 'resolved' }) {
  if (!data.length) return <p className="text-sm text-slate-500">{type === 'pending' ? 'Нет открытых кейсов' : 'Нет решённых кейсов'}</p>
  return (
    <table className="w-full text-sm">
      <thead><tr className={`border-b ${type === 'pending' ? 'bg-orange-50' : 'bg-green-50'}`}>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Номер</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Тема</th>
        <th className="text-center py-2 px-3 font-medium text-slate-600">Приоритет</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Канал</th>
        <th className="text-left py-2 px-3 font-medium text-slate-600">Агент</th>
        <th className="text-center py-2 px-3 font-medium text-slate-600">{type === 'pending' ? 'Ожидает' : 'Решено за'}</th>
      </tr></thead>
      <tbody>{data.map((c, i) => (
        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="py-2 px-3 font-mono text-blue-600 text-xs">{c.ticketNumber}</td>
          <td className="py-2 px-3 text-xs max-w-40 truncate">{c.title}</td>
          <td className="py-2 px-3 text-center"><span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${PRIO[c.priority] || PRIO.medium}`}>{c.priority}</span></td>
          <td className="py-2 px-3 text-xs">{c.channelName}</td>
          <td className="py-2 px-3 text-xs">{'agentName' in c ? c.agentName || '-' : '-'}</td>
          <td className="py-2 px-3 text-center">
            {'waitingHours' in c
              ? <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${(c as PendingCase).waitingHours > 24 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{(c as PendingCase).waitingHours}ч</span>
              : <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700">{(c as ResolvedCase).resolutionHours ? `${(c as ResolvedCase).resolutionHours}ч` : fmtMin((c as ResolvedCase).resolutionMinutes || 0)}</span>
            }
          </td>
        </tr>
      ))}</tbody>
    </table>
  )
}

function MetricContent({ metric, violations, unanswered, pending, resolved, rs, cs, agents }: {
  metric: DrilldownMetric
  violations: SLAViolation[]
  unanswered: UnansweredMessage[]
  pending: PendingCase[]
  resolved: ResolvedCase[]
  rs: ReportSummary
  cs: CaseSummary
  agents: AgentPerf[]
}) {
  switch (metric) {
    case 'sla':
    case 'withinSLA':
      return (<div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{rs.withinSLA}</p><p className="text-xs text-slate-500">В рамках SLA</p></div>
          <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-600">{rs.violatedSLA}</p><p className="text-xs text-slate-500">Нарушений</p></div>
          <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-slate-600">{rs.noResponse}</p><p className="text-xs text-slate-500">Без ответа</p></div>
        </div>
        {violations.length > 0 && <><h4 className="font-medium text-sm text-slate-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-red-500" />Нарушения SLA</h4><div className="overflow-x-auto max-h-60 overflow-y-auto"><ViolationsTable data={violations} /></div></>}
      </div>)
    case 'violations':
      return <div className="overflow-x-auto max-h-80 overflow-y-auto"><ViolationsTable data={violations} /></div>
    case 'noResponse':
      return <div className="overflow-x-auto max-h-80 overflow-y-auto"><UnansweredTable data={unanswered} /></div>
    case 'avgTime':
      return (<div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-600">{rs.avgResponseMinutes} мин</p><p className="text-xs text-slate-500">Среднее время</p></div>
          <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-slate-600">{rs.slaMinutes} мин</p><p className="text-xs text-slate-500">Норматив SLA</p></div>
        </div>
        {agents.filter(a => a.totalResponses > 0).length > 0 && (<div>
          <h4 className="font-medium text-sm text-slate-700 mb-2 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-blue-500" />Время ответа по агентам</h4>
          <div className="space-y-1.5">{[...agents].filter(a => a.totalResponses > 0).sort((a, b) => b.avgMinutes - a.avgMinutes).slice(0, 8).map((a, i) => (
            <div key={i} className="flex items-center gap-2"><span className="text-xs w-28 truncate">{a.name}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                <div className={`h-full rounded-full ${a.avgMinutes > rs.slaMinutes ? 'bg-red-400' : 'bg-green-400'}`} style={{ width: `${Math.min(100, (a.avgMinutes / Math.max(...agents.map(x => x.avgMinutes))) * 100)}%` }} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">{fmtMin(a.avgMinutes)}</span>
              </div>
            </div>
          ))}</div>
        </div>)}
      </div>)
    case 'responseRate':
      return (<div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-600">{rs.totalClientMessages}</p><p className="text-xs text-slate-500">Всего запросов</p></div>
          <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{rs.totalClientMessages - rs.noResponse}</p><p className="text-xs text-slate-500">Получили ответ</p></div>
          <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-600">{rs.noResponse}</p><p className="text-xs text-slate-500">Без ответа</p></div>
        </div>
        {unanswered.length > 0 && <><h4 className="font-medium text-sm text-slate-700 flex items-center gap-1.5"><XCircle className="w-4 h-4 text-red-500" />Без ответа</h4><div className="overflow-x-auto max-h-48 overflow-y-auto"><UnansweredTable data={unanswered} /></div></>}
      </div>)
    case 'caseResolution':
      return (<div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-600">{cs.totalCases}</p><p className="text-xs text-slate-500">Всего</p></div>
          <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{cs.resolved}</p><p className="text-xs text-slate-500">Решено</p></div>
          <div className="bg-orange-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-orange-600">{cs.open}</p><p className="text-xs text-slate-500">Открыто</p></div>
        </div>
        {resolved.length > 0 && <><h4 className="font-medium text-sm text-slate-700 flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" />Решённые кейсы</h4><div className="overflow-x-auto max-h-48 overflow-y-auto"><CasesTable data={resolved} type="resolved" /></div></>}
      </div>)
    case 'avgResolution':
      return (<div className="space-y-4">
        <div className="bg-purple-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-purple-600">{cs.avgResolutionHours}ч</p><p className="text-xs text-slate-500">Среднее время решения</p></div>
        {resolved.length > 0 && <><h4 className="font-medium text-sm text-slate-700">Кейсы по времени решения (сначала долгие)</h4><div className="overflow-x-auto max-h-60 overflow-y-auto"><CasesTable data={[...resolved].sort((a, b) => (b.resolutionMinutes || 0) - (a.resolutionMinutes || 0))} type="resolved" /></div></>}
      </div>)
    case 'totalMessages':
      return (<div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-600">{rs.totalClientMessages}</p><p className="text-xs text-slate-500">Всего сообщений</p></div>
          <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{rs.responseRatePercent}%</p><p className="text-xs text-slate-500">Процент охвата</p></div>
        </div>
      </div>)
    case 'totalCases':
      return (<div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-blue-600">{cs.totalCases}</p><p className="text-xs text-slate-500">Всего</p></div>
          <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-600">{cs.resolved}</p><p className="text-xs text-slate-500">Решено</p></div>
          <div className="bg-orange-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-orange-600">{cs.open}</p><p className="text-xs text-slate-500">Открыто</p></div>
        </div>
        {pending.length > 0 && <><h4 className="font-medium text-sm text-slate-700 flex items-center gap-1.5"><Clock className="w-4 h-4 text-orange-500" />Открытые</h4><div className="overflow-x-auto max-h-40 overflow-y-auto"><CasesTable data={pending} type="pending" /></div></>}
        {resolved.length > 0 && <><h4 className="font-medium text-sm text-slate-700 flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" />Решённые</h4><div className="overflow-x-auto max-h-40 overflow-y-auto"><CasesTable data={resolved} type="resolved" /></div></>}
      </div>)
    case 'openCases':
      return <div className="overflow-x-auto max-h-80 overflow-y-auto"><CasesTable data={pending} type="pending" /></div>
    default:
      return null
  }
}

export function MetricDrilldownModal({ metric, onClose, violations, unanswered, pending, resolved, responseSummary, caseSummary, agents }: Props) {
  const recs = getRecommendations(metric, responseSummary, caseSummary, agents, violations, unanswered, pending)
  return (
    <Modal isOpen onClose={onClose} title={METRIC_TITLES[metric]} size="xl">
      <div className="space-y-5">
        <MetricContent metric={metric} violations={violations} unanswered={unanswered} pending={pending} resolved={resolved} rs={responseSummary} cs={caseSummary} agents={agents} />
        {recs.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h4 className="font-semibold text-sm text-amber-800 mb-2 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4" />Рекомендации
            </h4>
            <ul className="space-y-1.5">
              {recs.map((r, i) => <li key={i} className="text-sm text-amber-900 flex gap-2"><MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />{r}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
