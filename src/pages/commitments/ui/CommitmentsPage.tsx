import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  Calendar, 
  User,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Bell,
  CalendarDays
} from 'lucide-react'

interface Commitment {
  id: string
  channelId: string
  channelName?: string
  telegramChatId?: string
  messageId?: string
  agentId?: string
  agentName?: string
  senderRole?: string
  text: string
  type: string
  isVague?: boolean
  dueDate: string
  reminderAt?: string
  reminderSent?: boolean
  status: string
  completedAt?: string
  createdAt: string
}

interface Stats {
  pending: number
  completed: number
  overdue: number
  cancelled: number
}

export function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [stats, setStats] = useState<Stats>({ pending: 0, completed: 0, overdue: 0, cancelled: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed'>('pending')
  const [refreshing, setRefreshing] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')

  const loadCommitments = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch(`/api/support/commitments?status=${statusFilter}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCommitments(data.commitments || [])
        setStats(data.stats || { pending: 0, completed: 0, overdue: 0, cancelled: 0 })
      }
    } catch (e) {
      console.error('Failed to load commitments:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadCommitments()
  }, [loadCommitments])

  const handleComplete = async (id: string) => {
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/commitments', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ id, status: 'completed' })
      })
      if (res.ok) {
        loadCommitments(true)
      }
    } catch (e) {
      console.error('Failed to complete commitment:', e)
    }
  }

  const handleSendReminder = async (id: string) => {
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/commitments/remind', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ commitmentId: id })
      })
      if (res.ok) {
        alert('Напоминание отправлено!')
        loadCommitments(true)
      } else {
        alert('Ошибка отправки напоминания')
      }
    } catch (e) {
      console.error('Failed to send reminder:', e)
    }
  }

  const handleCheckReminders = async () => {
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/commitments/remind', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.processed > 0) {
          alert(`Отправлено ${data.processed} напоминаний`)
        } else {
          alert('Нет просроченных напоминаний')
        }
        loadCommitments(true)
      }
    } catch (e) {
      console.error('Failed to check reminders:', e)
    }
  }

  const roleLabels: Record<string, { label: string; color: string }> = {
    client: { label: 'Клиент', color: 'bg-purple-100 text-purple-700' },
    support: { label: 'Поддержка', color: 'bg-blue-100 text-blue-700' },
    team: { label: 'Команда', color: 'bg-green-100 text-green-700' },
    partner: { label: 'Партнёр', color: 'bg-amber-100 text-amber-700' },
    unknown: { label: 'Неизвестно', color: 'bg-slate-100 text-slate-700' },
  }

  const formatDueDate = (dateStr: string) => {
    const due = new Date(dateStr)
    const now = new Date()
    const diffMs = due.getTime() - now.getTime()
    const diffHours = Math.round(diffMs / (1000 * 60 * 60))
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

    if (diffMs < 0) {
      if (diffHours > -24) return `Просрочено на ${Math.abs(diffHours)} ч.`
      return `Просрочено на ${Math.abs(diffDays)} дн.`
    }
    if (diffHours < 1) return 'Менее часа'
    if (diffHours < 24) return `Через ${diffHours} ч.`
    if (diffDays === 1) return 'Завтра'
    return `Через ${diffDays} дн.`
  }

  const isOverdue = (dateStr: string) => new Date(dateStr) < new Date()

  const typeLabels: Record<string, string> = {
    time: '⏰ Временное',
    action: '✅ Действие',
    vague: '❓ Неопределённое',
    promise: '🤝 Обещание'
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Clock className="w-7 h-7 text-blue-500" />
            Обязательства
          </h1>
          <p className="text-slate-500 mt-1">Отслеживание обещаний и напоминаний от всех участников</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCheckReminders}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange-600 hover:text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
          >
            <Bell className="w-4 h-4" />
            Проверить напоминания
          </button>
          <button
            onClick={() => loadCommitments(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.pending}</p>
              <p className="text-sm text-slate-500">В ожидании</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
              <p className="text-sm text-slate-500">Просрочено</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              <p className="text-sm text-slate-500">Выполнено</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Filter className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {stats.pending + stats.completed + stats.overdue}
              </p>
              <p className="text-sm text-slate-500">Всего</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs & View Toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'pending'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            В ожидании ({stats.pending + stats.overdue})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'completed'
                ? 'bg-green-500 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            Выполнено ({stats.completed})
          </button>
        </div>
        
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Список
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
              viewMode === 'calendar'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            Календарь
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'calendar' ? (
        <CalendarView 
          commitments={commitments} 
          roleLabels={roleLabels} 
          onComplete={handleComplete}
          onSendReminder={handleSendReminder}
          loading={loading}
        />
      ) : (
      <div className="bg-white rounded-xl border border-slate-200">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : commitments.length === 0 ? (
          <div className="text-center py-20">
            <Clock className="w-16 h-16 mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              {statusFilter === 'pending' ? 'Нет активных обязательств' : 'Нет выполненных обязательств'}
            </h3>
            <p className="text-slate-500">
              Обязательства создаются автоматически когда сотрудник даёт обещание клиенту
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {commitments.map((commitment) => {
              const overdue = commitment.status === 'pending' && isOverdue(commitment.dueDate)
              
              return (
                <div
                  key={commitment.id}
                  className={`p-4 hover:bg-slate-50 transition-colors ${
                    overdue ? 'bg-red-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Checkbox */}
                    {commitment.status === 'pending' && (
                      <button
                        onClick={() => handleComplete(commitment.id)}
                        className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full border-2 border-slate-300 hover:border-green-500 hover:bg-green-50 transition-colors flex items-center justify-center group"
                        title="Отметить как выполненное"
                      >
                        <CheckCircle className="w-4 h-4 text-transparent group-hover:text-green-500" />
                      </button>
                    )}
                    {commitment.status === 'completed' && (
                      <div className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-white" />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {typeLabels[commitment.type] || commitment.type}
                        </span>
                        {commitment.senderRole && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            roleLabels[commitment.senderRole]?.color || 'bg-slate-100 text-slate-600'
                          }`}>
                            {roleLabels[commitment.senderRole]?.label || commitment.senderRole}
                          </span>
                        )}
                        {commitment.isVague && (
                          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            Неточный срок
                          </span>
                        )}
                        {overdue && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                            Просрочено
                          </span>
                        )}
                        {commitment.reminderSent && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-600">
                            📬 Напомнено
                          </span>
                        )}
                      </div>
                      
                      <p className={`text-sm font-medium ${
                        commitment.status === 'completed' 
                          ? 'text-slate-400 line-through' 
                          : 'text-slate-900'
                      }`}>
                        "{commitment.text}"
                      </p>

                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        {/* Due Date */}
                        <span className={`flex items-center gap-1 ${
                          overdue ? 'text-red-600 font-medium' : ''
                        }`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDueDate(commitment.dueDate)}
                        </span>

                        {/* Agent */}
                        {commitment.agentName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {commitment.agentName}
                          </span>
                        )}

                        {/* Channel */}
                        {commitment.channelName && (
                          <Link
                            to={`/chats?channel=${commitment.channelId}`}
                            className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                          >
                            {commitment.channelName}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        )}

                        {/* Send Reminder Button */}
                        {commitment.status === 'pending' && !commitment.reminderSent && commitment.telegramChatId && (
                          <button
                            onClick={() => handleSendReminder(commitment.id)}
                            className="flex items-center gap-1 text-orange-500 hover:text-orange-600"
                          >
                            <Bell className="w-3.5 h-3.5" />
                            Напомнить
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Created At */}
                    <div className="text-xs text-slate-400">
                      {new Date(commitment.createdAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// Calendar View Component
function CalendarView({ 
  commitments, 
  roleLabels, 
  onComplete, 
  onSendReminder,
  loading
}: { 
  commitments: Commitment[]
  roleLabels: Record<string, { label: string; color: string }>
  onComplete: (id: string) => void
  onSendReminder: (id: string) => void
  loading: boolean
}) {
  // Group commitments by date
  const groupedByDate = commitments.reduce((acc, c) => {
    const date = new Date(c.dueDate).toISOString().split('T')[0]
    if (!acc[date]) acc[date] = []
    acc[date].push(c)
    return acc
  }, {} as Record<string, Commitment[]>)

  // Get dates for next 14 days
  const dates: string[] = []
  const today = new Date()
  for (let i = -3; i < 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const isToday = date.toDateString() === today.toDateString()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    const isTomorrow = date.toDateString() === tomorrow.toDateString()
    
    const dayName = date.toLocaleDateString('ru-RU', { weekday: 'short' })
    const dayNum = date.getDate()
    const month = date.toLocaleDateString('ru-RU', { month: 'short' })
    
    if (isToday) return { label: 'Сегодня', sub: `${dayNum} ${month}`, isToday: true }
    if (isTomorrow) return { label: 'Завтра', sub: `${dayNum} ${month}`, isToday: false }
    return { label: `${dayName}, ${dayNum}`, sub: month, isToday: false }
  }

  const isOverdue = (dateStr: string) => new Date(dateStr) < new Date()

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="flex min-w-max">
          {dates.map(dateStr => {
            const items = groupedByDate[dateStr] || []
            const { label, sub, isToday } = formatDateHeader(dateStr)
            const isPast = new Date(dateStr) < new Date(new Date().toDateString())
            
            return (
              <div 
                key={dateStr} 
                className={`w-48 flex-shrink-0 border-r border-slate-100 ${
                  isToday ? 'bg-blue-50' : isPast ? 'bg-slate-50' : ''
                }`}
              >
                {/* Date Header */}
                <div className={`px-3 py-2 border-b ${
                  isToday ? 'bg-blue-100 border-blue-200' : 'bg-slate-50 border-slate-100'
                }`}>
                  <div className={`font-medium text-sm ${isToday ? 'text-blue-700' : 'text-slate-700'}`}>
                    {label}
                  </div>
                  <div className="text-xs text-slate-500">{sub}</div>
                </div>
                
                {/* Items */}
                <div className="p-2 min-h-[150px] space-y-2">
                  {items.length === 0 && !isPast && (
                    <div className="text-xs text-slate-400 text-center py-4">
                      Нет обязательств
                    </div>
                  )}
                  {items.map(commitment => {
                    const overdue = commitment.status === 'pending' && isOverdue(commitment.dueDate)
                    const role = roleLabels[commitment.senderRole || 'unknown']
                    
                    return (
                      <div
                        key={commitment.id}
                        className={`p-2 rounded-lg text-xs ${
                          commitment.status === 'completed'
                            ? 'bg-green-50 border border-green-200'
                            : overdue
                              ? 'bg-red-50 border border-red-200'
                              : 'bg-white border border-slate-200 shadow-sm'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          {commitment.status === 'pending' ? (
                            <button
                              onClick={() => onComplete(commitment.id)}
                              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded border border-slate-300 hover:border-green-500 hover:bg-green-50"
                            />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`line-clamp-2 ${
                              commitment.status === 'completed' ? 'line-through text-slate-400' : ''
                            }`}>
                              {commitment.text}
                            </p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className={`px-1 py-0.5 rounded text-[10px] ${role?.color || 'bg-slate-100'}`}>
                                {role?.label || commitment.senderRole}
                              </span>
                              {overdue && (
                                <span className="px-1 py-0.5 rounded text-[10px] bg-red-100 text-red-600">
                                  !
                                </span>
                              )}
                            </div>
                            {commitment.agentName && (
                              <div className="text-slate-400 mt-1 truncate">
                                {commitment.agentName}
                              </div>
                            )}
                            {commitment.status === 'pending' && !commitment.reminderSent && commitment.telegramChatId && (
                              <button
                                onClick={() => onSendReminder(commitment.id)}
                                className="mt-1 text-orange-500 hover:text-orange-600 flex items-center gap-0.5"
                              >
                                <Bell className="w-3 h-3" />
                                Напомнить
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
