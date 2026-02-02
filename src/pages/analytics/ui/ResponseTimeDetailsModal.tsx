import { useState, useEffect } from 'react'
import { 
  X, Clock, User, MessageSquare, Building, AlertTriangle, 
  ChevronRight, Loader2, Calendar, ArrowRight, Users, TrendingUp
} from 'lucide-react'
import { Modal, Avatar, Badge } from '@/shared/ui'

interface ResponseTimeDetail {
  id: string
  channelId: string
  channelName: string
  companyName: string
  channelPhoto?: string
  clientName: string
  clientMessage: string
  clientMessageTime: string
  responderName: string
  responseMessage: string
  responseTime: string
  responseMinutes: number
  wasEscalated: boolean
}

interface TopResponder {
  name: string
  count: number
  avgMinutes: number
}

interface ApiResponse {
  bucket: string
  period: string
  stats: {
    totalCount: number
    avgMinutes: number
    minMinutes: number
    maxMinutes: number
    uniqueResponders: number
    uniqueChannels: number
  }
  topResponders: TopResponder[]
  details: ResponseTimeDetail[]
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
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<ResponseTimeDetail[]>([])
  const [topResponders, setTopResponders] = useState<TopResponder[]>([])
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null)
  const [sortBy, setSortBy] = useState<'time' | 'duration'>('duration')
  const [showResponders, setShowResponders] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadDetails()
    }
  }, [isOpen, bucket, period])

  const loadDetails = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || 'demo'
      const response = await fetch(
        `/api/support/analytics/response-time-details?bucket=${encodeURIComponent(bucket)}&period=${period}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      const data: ApiResponse = await response.json()
      setDetails(data.details || [])
      setTopResponders(data.topResponders || [])
      setStats(data.stats || null)
    } catch (err) {
      console.error('Failed to load details:', err)
      setError('Не удалось загрузить данные')
      setDetails([])
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
              <span className="ml-3 text-slate-500">Загрузка данных из базы...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertTriangle className="w-12 h-12 text-red-300 mb-3" />
              <p className="text-slate-700 font-medium">Ошибка загрузки</p>
              <p className="text-slate-500 text-sm">{error}</p>
              <button 
                onClick={loadDetails}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
              >
                Повторить
              </button>
            </div>
          ) : details.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-slate-500">Нет данных для отображения</p>
              <p className="text-slate-400 text-sm mt-1">В этом интервале нет записей о времени ответа</p>
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
                  {detail.wasEscalated && (
                    <div className="mt-3 ml-5 flex items-center gap-2 text-xs text-orange-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Возможно эскалировано</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with insights */}
        {!loading && (details.length > 0 || stats) && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 text-center mb-4">
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {stats?.totalCount || details.length}
                </p>
                <p className="text-xs text-slate-500">Всего ответов</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {details.filter(d => d.wasEscalated).length}
                </p>
                <p className="text-xs text-slate-500">Эскалаций</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {stats?.uniqueResponders || new Set(details.map(d => d.responderName)).size}
                </p>
                <p className="text-xs text-slate-500">Операторов</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">
                  {stats?.uniqueChannels || new Set(details.map(d => d.companyName)).size}
                </p>
                <p className="text-xs text-slate-500">Компаний</p>
              </div>
            </div>

            {/* Top Responders */}
            {topResponders.length > 0 && (
              <div>
                <button 
                  onClick={() => setShowResponders(!showResponders)}
                  className="w-full flex items-center justify-between py-2 text-sm text-slate-600 hover:text-slate-800"
                >
                  <span className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Топ операторов в этом интервале
                  </span>
                  <ChevronRight className={`w-4 h-4 transition-transform ${showResponders ? 'rotate-90' : ''}`} />
                </button>
                {showResponders && (
                  <div className="mt-2 space-y-2">
                    {topResponders.slice(0, 5).map((r, i) => (
                      <div key={i} className="flex items-center justify-between py-2 px-3 bg-white rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-slate-400">
                            {i + 1}
                          </span>
                          <Avatar name={r.name} size="sm" />
                          <span className="text-sm font-medium text-slate-700">{r.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-500">{r.count} ответов</span>
                          <span className={`font-medium ${getUrgencyColor(r.avgMinutes).split(' ')[0]}`}>
                            ~{formatDuration(r.avgMinutes)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
