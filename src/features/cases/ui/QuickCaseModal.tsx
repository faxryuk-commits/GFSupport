import { useState } from 'react'
import { ClipboardList, Loader2, Sparkles } from 'lucide-react'
import { Modal } from '@/shared/ui'
import { createCaseFromMessage } from '@/shared/api'

interface QuickCaseModalProps {
  isOpen: boolean
  onClose: () => void
  messageId: string
  messageText: string
  senderName: string
  channelName: string
  aiSummary?: string
  aiCategory?: string
  aiUrgency?: number
  onCaseCreated?: (caseId: string) => void
}

const PRIORITIES = [
  { value: 'low', label: 'Низкий', color: 'bg-slate-100 text-slate-600' },
  { value: 'medium', label: 'Средний', color: 'bg-blue-100 text-blue-600' },
  { value: 'high', label: 'Высокий', color: 'bg-orange-100 text-orange-600' },
  { value: 'critical', label: 'Критичный', color: 'bg-red-100 text-red-600' },
]

export function QuickCaseModal({
  isOpen, onClose, messageId, messageText, senderName, channelName,
  aiSummary, aiCategory, aiUrgency, onCaseCreated
}: QuickCaseModalProps) {
  const suggestedTitle = aiSummary || messageText.slice(0, 100) || 'Новое обращение'
  const suggestedPriority = aiUrgency && aiUrgency >= 4 ? 'high' : aiUrgency && aiUrgency >= 3 ? 'medium' : 'low'

  const [title, setTitle] = useState(suggestedTitle)
  const [description, setDescription] = useState(messageText.slice(0, 500))
  const [priority, setPriority] = useState(suggestedPriority)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const result = await createCaseFromMessage(messageId, { title, description, priority })
      onCaseCreated?.(result?.id || '')
      onClose()
    } catch (e: any) {
      setError(e.message || 'Ошибка создания кейса')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Создать кейс из сообщения" size="md">
      <div className="space-y-4">
        {/* Context */}
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span className="font-medium">{senderName}</span>
            <span>в</span>
            <span className="font-medium">{channelName}</span>
          </div>
          <p className="text-sm text-slate-700 line-clamp-3">{messageText}</p>
        </div>

        {aiSummary && (
          <div className="flex items-start gap-2 bg-blue-50 rounded-lg p-3 border border-blue-100">
            <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-600 font-medium mb-0.5">AI анализ</p>
              <p className="text-sm text-blue-800">{aiSummary}</p>
              {aiCategory && <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-600 rounded">{aiCategory}</span>}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Название кейса</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Опишите проблему..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            placeholder="Детали проблемы..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Приоритет</label>
          <div className="flex gap-2">
            {PRIORITIES.map(p => (
              <button
                key={p.value}
                onClick={() => setPriority(p.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  priority === p.value
                    ? `${p.color} ring-2 ring-offset-1 ring-blue-400`
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
            Создать кейс
          </button>
        </div>
      </div>
    </Modal>
  )
}
