import { useState, useEffect } from 'react'
import { Brain, MessageSquare, Folder, Lightbulb, User, Clock, AlertTriangle, Loader2 } from 'lucide-react'
import { getAIContext, type AIContextResponse } from '@/shared/api/ai'

interface AIContextPanelProps {
  channelId: string
  isOpen: boolean
  onClose?: () => void
  className?: string
}

export function AIContextPanel({ channelId, isOpen, onClose, className = '' }: AIContextPanelProps) {
  const [context, setContext] = useState<AIContextResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && channelId) {
      loadContext()
    }
  }, [isOpen, channelId])

  const loadContext = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const data = await getAIContext(channelId)
      setContext(data)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки контекста')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className={`bg-white border-l border-slate-200 h-full overflow-y-auto ${className}`}>
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-slate-200 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-slate-900">AI Контекст</h3>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {context && (
          <>
            {/* AI Recommendation */}
            {context.aiRecommendation && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl">
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-1">Рекомендация</h4>
                    <p className="text-sm text-blue-800">{context.aiRecommendation}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Channel Info */}
            {context.context.channelInfo && (
              <div>
                <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Клиент
                </h4>
                <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Канал</span>
                    <span className="font-medium">{context.context.channelInfo.name}</span>
                  </div>
                  {context.context.channelInfo.type && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Тип</span>
                      <span>{context.context.channelInfo.type}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Client History */}
            {context.context.clientHistory && (
              <div>
                <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  История клиента
                </h4>
                <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-sm">
                  {context.context.clientHistory.totalMessages && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Сообщений</span>
                      <span>{context.context.clientHistory.totalMessages}</span>
                    </div>
                  )}
                  {context.context.clientHistory.totalCases && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Кейсов</span>
                      <span>{context.context.clientHistory.totalCases}</span>
                    </div>
                  )}
                  {context.context.clientHistory.firstContact && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Первый контакт</span>
                      <span>{new Date(context.context.clientHistory.firstContact).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recent Messages Summary */}
            {context.context.recentMessages?.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Последние сообщения
                </h4>
                <div className="space-y-2">
                  {context.context.recentMessages.slice(0, 5).map((msg: any, i: number) => (
                    <div 
                      key={i}
                      className={`p-2 rounded-lg text-sm ${
                        msg.isClient ? 'bg-slate-100' : 'bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-xs">
                          {msg.senderName || (msg.isClient ? 'Клиент' : 'Поддержка')}
                        </span>
                        {msg.isProblem && (
                          <AlertTriangle className="w-3 h-3 text-orange-500" />
                        )}
                      </div>
                      <p className="text-slate-600 line-clamp-2">{msg.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Cases */}
            {context.context.relatedCases?.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <Folder className="w-4 h-4" />
                  Связанные кейсы
                </h4>
                <div className="space-y-2">
                  {context.context.relatedCases.map((c: any) => (
                    <div key={c.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                      <div className="font-medium text-slate-900">{c.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          c.status === 'resolved' ? 'bg-green-100 text-green-700' :
                          c.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {c.status}
                        </span>
                        {c.category && (
                          <span className="text-xs text-slate-500">{c.category}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested Solutions */}
            {context.context.suggestedSolutions?.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  Предложенные решения
                </h4>
                <div className="space-y-2">
                  {context.context.suggestedSolutions.map((s: any, i: number) => (
                    <div key={i} className="bg-green-50 rounded-lg p-3 text-sm">
                      <p className="text-green-800">{s.text || s.solutionText}</p>
                      {s.successScore && (
                        <span className="text-xs text-green-600 mt-1 block">
                          Успешность: {s.successScore}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
