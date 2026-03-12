import { useState, useEffect } from 'react'
import { FlaskConical, Send, Loader2, MessageSquare } from 'lucide-react'
import { testAgentDecision } from '@/shared/api'

interface Channel { id: string; name: string }

export function AgentTestPanel({ channels }: { channels: Channel[] }) {
  const [channelId, setChannelId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (channels.length > 0 && !channelId) setChannelId(channels[0].id)
  }, [channels])

  async function handleTest() {
    if (!channelId || !message.trim()) return
    setLoading(true)
    setResult(null)
    setError('')
    try {
      const ch = channels.find(c => c.id === channelId)
      const res = await testAgentDecision(channelId, message, ch?.name) as any
      console.log('[AI Agent Test] Response:', JSON.stringify(res))
      if (res?.result) {
        setResult(res.result)
      } else if (res?.error) {
        setError(res.error)
      } else {
        setResult({ skipped: true, reason: 'Агент не вернул результат. Проверьте настройки и API ключ.' })
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка запроса')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-semibold text-slate-900">Тестирование агента</h2>
      </div>
      <p className="text-sm text-slate-500">Отправьте тестовое сообщение, чтобы увидеть как агент отреагирует.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Канал</label>
          <select
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            {channels.length === 0 && <option value="">Нет каналов</option>}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Сообщение клиента</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTest()}
              placeholder="Напишите тестовое сообщение..."
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <button
              onClick={handleTest}
              disabled={loading || !message.trim()}
              className="flex items-center gap-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Тест
            </button>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {result && (
        <div className="mt-4 space-y-3">
          {result.skipped ? (
            <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg">
              <p className="text-sm text-yellow-800">Агент пропустил: {result.reason}</p>
            </div>
          ) : result.decision ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">Действие:</span>
                <span className="text-sm font-bold text-blue-700">{result.decision.action}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                  result.decision.confidence >= 0.8 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {Math.round(result.decision.confidence * 100)}%
                </span>
              </div>
              {result.decision.replyText && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                  <MessageSquare className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-800">{result.decision.replyText}</p>
                </div>
              )}
              <p className="text-sm text-slate-600"><span className="font-medium">Рассуждение:</span> {result.decision.reasoning}</p>
              {result.decision.tagAgentName && (
                <p className="text-sm text-purple-700">Тег: @{result.decision.tagAgentName}</p>
              )}
              {result.decision.caseTitle && (
                <p className="text-sm text-orange-700">Кейс: [{result.decision.casePriority}] {result.decision.caseTitle}</p>
              )}
            </div>
          ) : (
            <div className="p-4 bg-slate-50 text-slate-600 text-sm rounded-lg">Агент не вернул результат.</div>
          )}
        </div>
      )}
    </div>
  )
}
