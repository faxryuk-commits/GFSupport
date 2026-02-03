import { useState, useEffect } from 'react'
import { Clock, CheckCircle, AlertTriangle, Plus, Calendar, User, Loader2 } from 'lucide-react'
import { 
  fetchCommitments, 
  completeCommitment, 
  type Commitment 
} from '@/shared/api/commitments'
import { 
  COMMITMENT_STATUS_CONFIG, 
  COMMITMENT_PRIORITY_CONFIG,
  getDaysUntilDue,
  isCommitmentOverdue 
} from '@/entities/commitment'

interface CommitmentsPanelProps {
  channelId?: string
  caseId?: string
  onAddNew?: () => void
  className?: string
}

export function CommitmentsPanel({ 
  channelId, 
  caseId, 
  onAddNew,
  className = '' 
}: CommitmentsPanelProps) {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ overdue: 0, pending: 0, completed: 0 })

  useEffect(() => {
    loadCommitments()
  }, [channelId, caseId])

  const loadCommitments = async () => {
    setLoading(true)
    try {
      const response = await fetchCommitments({ 
        channelId, 
        caseId, 
        status: 'all',
        limit: 20 
      })
      setCommitments(response.commitments)
      setStats({
        overdue: response.overdue,
        pending: response.pending,
        completed: response.completed,
      })
    } catch (e) {
      console.error('Failed to load commitments:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleComplete = async (id: string) => {
    try {
      await completeCommitment(id)
      loadCommitments()
    } catch (e) {
      console.error('Failed to complete commitment:', e)
    }
  }

  const formatDueDate = (dueDate: string) => {
    const days = getDaysUntilDue(dueDate)
    if (days < 0) return `Просрочено на ${Math.abs(days)} дн.`
    if (days === 0) return 'Сегодня'
    if (days === 1) return 'Завтра'
    return `Через ${days} дн.`
  }

  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" />
            Обязательства
          </h3>
          {onAddNew && (
            <button
              onClick={onAddNew}
              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
        
        {/* Stats */}
        <div className="flex gap-4 text-sm">
          {stats.overdue > 0 && (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              {stats.overdue} просрочено
            </span>
          )}
          <span className="text-slate-500">
            {stats.pending} в ожидании
          </span>
          <span className="text-green-600">
            {stats.completed} выполнено
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : commitments.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Нет активных обязательств</p>
          </div>
        ) : (
          <div className="space-y-3">
            {commitments.map((commitment) => {
              const overdue = isCommitmentOverdue(commitment)
              const statusConfig = COMMITMENT_STATUS_CONFIG[commitment.status]
              const priorityConfig = COMMITMENT_PRIORITY_CONFIG[commitment.priority]
              
              return (
                <div
                  key={commitment.id}
                  className={`p-3 rounded-lg border transition-all ${
                    overdue && commitment.status === 'pending'
                      ? 'border-red-200 bg-red-50'
                      : commitment.status === 'completed'
                      ? 'border-green-200 bg-green-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => commitment.status === 'pending' && handleComplete(commitment.id)}
                      disabled={commitment.status !== 'pending'}
                      className={`mt-0.5 flex-shrink-0 ${
                        commitment.status === 'completed' 
                          ? 'text-green-500' 
                          : 'text-slate-300 hover:text-green-500'
                      }`}
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${
                        commitment.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}>
                        {commitment.text}
                      </p>
                      
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        {/* Due Date */}
                        <span className={`flex items-center gap-1 ${
                          overdue && commitment.status === 'pending'
                            ? 'text-red-600 font-medium'
                            : 'text-slate-500'
                        }`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDueDate(commitment.dueDate)}
                        </span>
                        
                        {/* Assignee */}
                        {commitment.assigneeName && (
                          <span className="flex items-center gap-1 text-slate-500">
                            <User className="w-3.5 h-3.5" />
                            {commitment.assigneeName}
                          </span>
                        )}
                        
                        {/* Priority */}
                        <span className={`px-1.5 py-0.5 rounded ${priorityConfig.bgColor} ${priorityConfig.color}`}>
                          {priorityConfig.label}
                        </span>
                        
                        {/* Status */}
                        {commitment.status !== 'pending' && (
                          <span className={`px-1.5 py-0.5 rounded ${statusConfig.bgColor} ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                        )}
                      </div>
                      
                      {/* Channel name */}
                      {commitment.channelName && (
                        <div className="mt-1 text-xs text-slate-400">
                          {commitment.channelName}
                        </div>
                      )}
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
