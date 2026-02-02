import { useState, useEffect } from 'react'
import { 
  X, Clock, User, MessageSquare, Building, AlertTriangle, 
  ChevronRight, Loader2, Calendar, ArrowRight
} from 'lucide-react'
import { Modal, Avatar, Badge } from '@/shared/ui'

interface ResponseTimeDetail {
  id: string
  channelId: string
  channelName: string
  companyName: string
  clientName: string
  clientMessage: string
  clientMessageTime: string
  responderName: string
  responseMessage: string
  responseTime: string
  responseMinutes: number
  wasEscalated: boolean
  assignedTo?: string
}

interface ResponseTimeDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  bucket: string
  bucketLabel: string
  count: number
  avgMinutes: number
  period: string
  color: string
}

// Mock data for now - will be replaced with API call
const mockDetails: ResponseTimeDetail[] = [
  {
    id: '1',
    channelId: 'ch1',
    channelName: 'Brasserie x Delever',
    companyName: 'Brasserie Restaurant',
    clientName: 'Шохрух Скуад',
    clientMessage: 'Добрый день! Не могу оформить заказ, приложение выдаёт ошибку при оплате',
    clientMessageTime: '2026-02-01T10:15:00',
    responderName: 'Jamoliddin Jamolov',
    responseMessage: 'Здравствуйте! Уже проверяем, одну минуту',
    responseTime: '2026-02-01T10:17:00',
    responseMinutes: 2,
    wasEscalated: false,
  },
  {
    id: '2',
    channelId: 'ch2',
    channelName: 'TechCorp Support',
    companyName: 'TechCorp Solutions',
    clientName: 'Гулрух Юсупова',
    clientMessage: 'Срочно нужна помощь с интеграцией API',
    clientMessageTime: '2026-02-01T14:30:00',
    responderName: 'Fakhriddin Yusupov',
    responseMessage: 'Привет! Смотрю ваш запрос',
    responseTime: '2026-02-01T14:33:00',
    responseMinutes: 3,
    wasEscalated: false,
  },
  {
    id: '3',
    channelId: 'ch3',
    channelName: 'Global Finance',
    companyName: 'Global Finance Ltd',
    clientName: 'Алексей Петров',
    clientMessage: 'Платёж не проходит уже 2 часа, клиенты жалуются!',
    clientMessageTime: '2026-02-01T09:00:00',
    responderName: 'Delever Support',
    responseMessage: 'Добрый день! Передаю техническим специалистам',
    responseTime: '2026-02-01T10:45:00',
    responseMinutes: 105,
    wasEscalated: true,
    assignedTo: 'Tech Team',
  },
]

function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return `${hours} ч ${mins > 0 ? `${mins} мин` : ''}`
  const days = Math.floor(hours / 24)
  return `${days} д ${hours % 24} ч`
}

function getUrgencyColor(minutes: number): string {
  if (minutes <= 5) return 'text-green-600 bg-green-50'
  if (minutes <= 10) return 'text-emerald-600 bg-emerald-50'
  if (minutes <= 30) return 'text-amber-600 bg-amber-50'
  if (minutes <= 60) return 'text-orange-600 bg-orange-50'
  return 'text-red-600 bg-red-50'
}

export function ResponseTimeDetailsModal({
  isOpen,
  onClose,
  bucket,
  bucketLabel,
  count,
  avgMinutes,
  period,
  color
}: ResponseTimeDetailsModalProps) {
  const [loading, setLoading] = useState(false)
  const [details, setDetails] = useState<ResponseTimeDetail[]>([])
  const [sortBy, setSortBy] = useState<'time' | 'duration'>('duration')

  useEffect(() => {
    if (isOpen) {
      loadDetails()
    }
  }, [isOpen, bucket, period])

  const loadDetails = async () => {
    setLoading(true)
    try {
      // TODO: Replace with actual API call
      // const response = await fetch(`/api/support/analytics/response-time-details?bucket=${bucket}&period=${period}`)
      // const data = await response.json()
      // setDetails(data)
      
      // For now, use mock data filtered by bucket
      await new Promise(resolve => setTimeout(resolve, 500))
      const filtered = mockDetails.filter(d => {
        if (bucket === 'до 5 мин') return d.responseMinutes <= 5
        if (bucket === 'до 10 мин') return d.responseMinutes > 5 && d.responseMinutes <= 10
        if (bucket === 'до 30 мин') return d.responseMinutes > 10 && d.responseMinutes <= 30
        if (bucket === 'до 1 часа') return d.responseMinutes > 30 && d.responseMinutes <= 60
        return d.responseMinutes > 60
      })
      setDetails(filtered.length > 0 ? filtered : mockDetails)
    } catch (error) {
      console.error('Failed to load details:', error)
    } finally {
      setLoading(false)
    }
  }

  const sortedDetails = [...details].sort((a, b) => {
    if (sortBy === 'duration') return b.responseMinutes - a.responseMinutes
    return new Date(b.clientMessageTime).getTime() - new Date(a.clientMessageTime).getTime()
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="-m-6">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center`}>
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  Детализация: {bucketLabel}
                </h2>
                <p className="text-sm text-slate-500">
                  {count} ответов • среднее время {formatDuration(avgMinutes)}
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Сортировка:</span>
            <button
              onClick={() => setSortBy('duration')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                sortBy === 'duration' 
                  ? 'bg-blue-100 text-blue-700 font-medium' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              По длительности
            </button>
            <button
              onClick={() => setSortBy('time')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                sortBy === 'time' 
                  ? 'bg-blue-100 text-blue-700 font-medium' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              По времени
            </button>
          </div>
          <Badge variant="default" size="sm">
            {details.length} записей
          </Badge>
        </div>

        {/* Content */}
        <div className="max-h-[500px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : details.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-slate-500">Нет данных для отображения</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedDetails.map((detail) => (
                <div 
                  key={detail.id}
                  className="px-6 py-4 hover:bg-slate-50 transition-colors"
                >
                  {/* Top row: Channel & Company */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={detail.channelName} size="sm" />
                      <div>
                        <p className="font-medium text-slate-800">{detail.channelName}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {detail.companyName}
                        </p>
                      </div>
                    </div>
                    <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${getUrgencyColor(detail.responseMinutes)}`}>
                      {formatDuration(detail.responseMinutes)}
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="ml-1 pl-4 border-l-2 border-slate-200 space-y-3">
                    {/* Client message */}
                    <div className="relative">
                      <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                      <div className="bg-blue-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <User className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-sm font-medium text-blue-800">{detail.clientName}</span>
                          <span className="text-xs text-blue-500">• {formatDateTime(detail.clientMessageTime)}</span>
                        </div>
                        <p className="text-sm text-blue-700">{detail.clientMessage}</p>
                      </div>
                    </div>

                    {/* Response */}
                    <div className="relative">
                      <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                      <div className="bg-green-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-sm font-medium text-green-800">{detail.responderName}</span>
                          <span className="text-xs text-green-500">• {formatDateTime(detail.responseTime)}</span>
                          {detail.wasEscalated && (
                            <Badge variant="warning" size="sm">Эскалация</Badge>
                          )}
                        </div>
                        <p className="text-sm text-green-700">{detail.responseMessage}</p>
                      </div>
                    </div>
                  </div>

                  {/* Footer info */}
                  {detail.wasEscalated && detail.assignedTo && (
                    <div className="mt-3 ml-5 flex items-center gap-2 text-xs text-orange-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Эскалировано: {detail.assignedTo}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with insights */}
        {!loading && details.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {details.filter(d => d.wasEscalated).length}
                </p>
                <p className="text-xs text-slate-500">Эскалаций</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {new Set(details.map(d => d.responderName)).size}
                </p>
                <p className="text-xs text-slate-500">Операторов</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {new Set(details.map(d => d.companyName)).size}
                </p>
                <p className="text-xs text-slate-500">Компаний</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
