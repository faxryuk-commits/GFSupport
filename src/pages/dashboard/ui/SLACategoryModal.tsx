import { XCircle, RefreshCw } from 'lucide-react'

interface Props {
  category: string
  label: string
  messages: any[]
  loading: boolean
  onClose: () => void
}

export function SLACategoryModal({ label, messages, loading, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="font-semibold text-lg text-slate-900">{label} — Время ответа</h3>
            <p className="text-sm text-slate-500">Сообщения клиентов и время ответа сотрудников</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-auto max-h-[65vh]">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16 text-slate-500">Нет данных за выбранный период</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-4 font-medium text-slate-600">Канал</th>
                  <th className="text-left py-2 px-4 font-medium text-slate-600">Клиент</th>
                  <th className="text-left py-2 px-4 font-medium text-slate-600">Сообщение</th>
                  <th className="text-left py-2 px-4 font-medium text-slate-600">Время</th>
                  <th className="text-center py-2 px-4 font-medium text-slate-600">Ответ</th>
                  <th className="text-left py-2 px-4 font-medium text-slate-600">Ответил</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m: any, i: number) => (
                  <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 ${!m.respondedAt ? 'bg-red-50' : m.responseMinutes > 10 ? 'bg-yellow-50' : ''}`}>
                    <td className="py-2 px-4 font-medium">{m.channelName}</td>
                    <td className="py-2 px-4">{m.senderName}</td>
                    <td className="py-2 px-4 text-slate-500 max-w-48 truncate">{m.textPreview || '[медиа]'}</td>
                    <td className="py-2 px-4 text-xs text-slate-500">
                      {new Date(m.messageAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {m.respondedAt ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.responseMinutes <= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {Math.round(m.responseMinutes)} мин
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">Нет ответа</span>
                      )}
                    </td>
                    <td className="py-2 px-4">{m.responderName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
