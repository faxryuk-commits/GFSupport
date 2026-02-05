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
  RefreshCw
} from 'lucide-react'

interface Commitment {
  id: string
  channelId: string
  channelName?: string
  messageId?: string
  agentId?: string
  agentName?: string
  text: string
  type: string
  dueDate: string
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
          <p className="text-slate-500 mt-1">Отслеживание обещаний и напоминаний</p>
        </div>
        <button
          onClick={() => loadCommitments(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Обновить
        </button>
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

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setStatusFilter('pending')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'pending'
              ? 'bg-blue-500 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          В ожидании ({stats.pending})
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

      {/* Content */}
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
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {typeLabels[commitment.type] || commitment.type}
                        </span>
                        {overdue && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                            Просрочено
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
    </div>
  )
}
