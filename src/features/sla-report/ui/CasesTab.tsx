import { Clock, CheckCircle, ArrowRight } from 'lucide-react'

interface PendingCase {
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

interface Props {
  pending: PendingCase[]
  resolved: ResolvedCase[]
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent'
  })
}

function formatMinutes(mins: number) {
  if (mins < 60) return `${Math.round(mins)} мин`
  const hours = Math.floor(mins / 60)
  const minutes = Math.round(mins % 60)
  return `${hours}ч ${minutes}м`
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-slate-100 text-slate-700',
}

export function CasesTab({ pending, resolved }: Props) {
  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 p-4">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            Открытые кейсы ({pending.length})
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
                {pending.map((c, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-orange-50">
                    <td className="py-2 px-3 font-mono text-blue-600">{c.ticketNumber}</td>
                    <td className="py-2 px-3 max-w-48 truncate">{c.title}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[c.priority] || PRIORITY_COLORS.medium}`}>
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

      {resolved.length > 0 && (
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            Решённые кейсы ({resolved.length})
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
                {resolved.map((c, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-green-50">
                    <td className="py-2 px-3 font-mono text-blue-600">{c.ticketNumber}</td>
                    <td className="py-2 px-3 max-w-40 truncate">{c.title}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[c.priority] || PRIORITY_COLORS.medium}`}>
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
  )
}
