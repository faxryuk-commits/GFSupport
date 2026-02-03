import { useState } from 'react'
import { Clock, Calendar, User, AlertCircle, X, Loader2 } from 'lucide-react'
import { createCommitment } from '@/shared/api/commitments'
import type { CommitmentPriority } from '@/entities/commitment'

interface CommitmentFormProps {
  channelId: string
  channelName?: string
  caseId?: string
  messageId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function CommitmentForm({
  channelId,
  channelName,
  caseId,
  messageId,
  onSuccess,
  onCancel,
}: CommitmentFormProps) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('12:00')
  const [priority, setPriority] = useState<CommitmentPriority>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Quick due date options
  const quickDates = [
    { label: 'Сегодня', getValue: () => new Date().toISOString().split('T')[0] },
    { label: 'Завтра', getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return d.toISOString().split('T')[0]
    }},
    { label: 'Через 3 дня', getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      return d.toISOString().split('T')[0]
    }},
    { label: 'Через неделю', getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return d.toISOString().split('T')[0]
    }},
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!text.trim()) {
      setError('Введите текст обязательства')
      return
    }
    
    if (!dueDate) {
      setError('Выберите дату')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const dueDatetime = `${dueDate}T${dueTime}:00`
      
      await createCommitment({
        channelId,
        caseId,
        messageId,
        text: text.trim(),
        dueDate: dueDatetime,
        priority,
      })
      
      onSuccess?.()
    } catch (e: any) {
      setError(e.message || 'Ошибка создания обязательства')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          Новое обязательство
        </h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Channel info */}
      {channelName && (
        <div className="mb-4 text-sm text-slate-500">
          Канал: <span className="font-medium text-slate-700">{channelName}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Text */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Что нужно сделать?
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: Перезвонить клиенту по вопросу интеграции..."
          className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          rows={3}
        />
      </div>

      {/* Quick dates */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Срок
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {quickDates.map((qd) => (
            <button
              key={qd.label}
              type="button"
              onClick={() => setDueDate(qd.getValue())}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                dueDate === qd.getValue()
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {qd.label}
            </button>
          ))}
        </div>
        
        {/* Date & Time inputs */}
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="w-28">
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Priority */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Приоритет
        </label>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                priority === p
                  ? p === 'low' ? 'bg-slate-500 text-white' :
                    p === 'medium' ? 'bg-yellow-500 text-white' :
                    'bg-red-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'low' ? 'Низкий' : p === 'medium' ? 'Средний' : 'Высокий'}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            Отмена
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Clock className="w-4 h-4" />
          )}
          Создать
        </button>
      </div>
    </form>
  )
}
