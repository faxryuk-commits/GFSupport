import { AlertTriangle, XCircle } from 'lucide-react'

interface SLAViolation {
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
  channelName: string
  clientName: string
  messagePreview: string
  messageAt: string
  waitingMinutes: number
}

interface ResponseDistribution {
  within1min: number
  within5min: number
  within10min: number
  within30min: number
  within60min: number
  over60min: number
  noResponse: number
}

interface Props {
  distribution: ResponseDistribution
  violations: SLAViolation[]
  unanswered: UnansweredMessage[]
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

export function ResponseTimeTab({ distribution, violations, unanswered }: Props) {
  const bars = [
    { label: '≤1 мин', value: distribution.within1min, color: 'bg-green-500' },
    { label: '1-5 мин', value: distribution.within5min, color: 'bg-green-400' },
    { label: '5-10 мин', value: distribution.within10min, color: 'bg-lime-500' },
    { label: '10-30 мин', value: distribution.within30min, color: 'bg-yellow-500' },
    { label: '30-60 мин', value: distribution.within60min, color: 'bg-orange-500' },
    { label: '>60 мин', value: distribution.over60min, color: 'bg-red-500' },
    { label: 'Нет ответа', value: distribution.noResponse, color: 'bg-slate-400' },
  ]

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900 mb-4">Распределение времени ответа</h3>
        <div className="grid grid-cols-7 gap-2 text-center">
          {bars.map((item) => (
            <div key={item.label} className="flex flex-col items-center">
              <div className={`w-full h-24 rounded-lg ${item.color} flex items-end justify-center relative`}>
                <span className="absolute top-2 text-white font-bold text-lg">{item.value}</span>
              </div>
              <span className="text-xs text-slate-600 mt-2">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {violations.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Нарушения SLA ({violations.length})
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
                {violations.map((v, i) => (
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

      {unanswered.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-500" />
            Сообщения без ответа ({unanswered.length})
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
                {unanswered.map((m, i) => (
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
  )
}
