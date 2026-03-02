import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight, Calendar, Clock, Pause, Play, XCircle,
  Rocket, User, Phone, Package, CircleDot,
} from 'lucide-react'
import { useToast, LoadingSpinner } from '@/shared/ui'
import { StageTimeline, BallIndicator } from '@/entities/onboarding'
import type {
  OnboardingConnection, OnboardingComment, ConnectionStatus,
} from '@/entities/onboarding'
import { TeamCard } from '@/features/onboarding/ui/TeamCard'
import { CommentFeed } from '@/features/onboarding/ui/CommentFeed'
import {
  fetchConnection, updateConnection, completeStage, updateTask,
  fetchComments, addComment,
} from '@/shared/api/onboarding'
import { fetchAgents } from '@/shared/api/agents'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function daysLeft(deadline: string | null): string {
  if (!deadline) return ''
  const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000)
  if (diff < 0) return `просрочено на ${Math.abs(diff)} дн.`
  return `осталось ${diff} дн.`
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-200">
      <div
        className="h-2 rounded-full bg-blue-500 transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: {
  icon: React.ElementType; label: string; value: string | null | undefined
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
      <div>
        <span className="text-slate-500">{label}</span>
        <p className="font-medium text-slate-800">{value || '—'}</p>
      </div>
    </div>
  )
}

function StatusActions({ status, onAction }: {
  status: ConnectionStatus
  onAction: (action: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'active' && (
        <>
          <button onClick={() => onAction('paused')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50">
            <Pause className="w-3.5 h-3.5" /> Пауза
          </button>
          <button onClick={() => onAction('cancelled')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50">
            <XCircle className="w-3.5 h-3.5" /> Отменить
          </button>
        </>
      )}
      {status === 'paused' && (
        <button onClick={() => onAction('active')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-green-300 text-green-700 hover:bg-green-50">
          <Play className="w-3.5 h-3.5" /> Возобновить
        </button>
      )}
      {status === 'active' && (
        <button onClick={() => onAction('launched')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">
          <Rocket className="w-3.5 h-3.5" /> Запустить
        </button>
      )}
    </div>
  )
}

export function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [conn, setConn] = useState<OnboardingConnection | null>(null)
  const [comments, setComments] = useState<OnboardingComment[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [commentLoading, setCommentLoading] = useState(false)

  const loadConnection = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const [data, commentsData, agentsList] = await Promise.all([
        fetchConnection(id),
        fetchComments(id),
        fetchAgents().catch(() => []),
      ])
      setConn(data)
      setComments(commentsData)
      setAgents(agentsList.map(a => ({ id: a.id, name: a.name })))
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить подключение')
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { loadConnection() }, [loadConnection])

  const handleCompleteStage = useCallback(async (stageId: string) => {
    try {
      await completeStage(stageId)
      toast.success('Этап завершён')
      loadConnection()
    } catch {
      toast.error('Ошибка', 'Не удалось завершить этап')
    }
  }, [loadConnection, toast])

  const handleTaskUpdate = useCallback(async (taskId: string, data: object) => {
    try {
      await updateTask(taskId, data as Parameters<typeof updateTask>[1])
      loadConnection()
    } catch {
      toast.error('Ошибка', 'Не удалось обновить задачу')
    }
  }, [loadConnection, toast])

  const handleAddComment = useCallback(async (text: string) => {
    if (!id) return
    try {
      setCommentLoading(true)
      await addComment(id, text)
      const fresh = await fetchComments(id)
      setComments(fresh)
    } catch {
      toast.error('Ошибка', 'Не удалось добавить комментарий')
    } finally {
      setCommentLoading(false)
    }
  }, [id, toast])

  const handleStatusAction = useCallback(async (newStatus: string) => {
    if (!id) return
    try {
      await updateConnection(id, { status: newStatus as ConnectionStatus })
      toast.success('Статус обновлён')
      loadConnection()
    } catch {
      toast.error('Ошибка', 'Не удалось обновить статус')
    }
  }, [id, loadConnection, toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!conn) {
    return (
      <div className="p-6 text-center text-slate-500">Подключение не найдено</div>
    )
  }

  const templateRoles = conn.stages?.[0]
    ? [
        ...new Set(
          conn.stages.flatMap(s => s.tasks.map(t => t.assignedRole)).filter(Boolean),
        ),
      ].map(r => ({ id: r, name: r, color: '#6366f1' }))
    : []

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4 flex-shrink-0">
        <button onClick={() => navigate('/onboarding')} className="hover:text-blue-600">
          Подключения
        </button>
        <ChevronRight className="w-4 h-4" />
        <span className="text-slate-800 font-medium">{conn.clientName}</span>
      </div>

      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{conn.clientName}</h1>
          {conn.templateName && (
            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {conn.templateName}
            </span>
          )}
        </div>
        <StatusActions status={conn.status} onAction={handleStatusAction} />
      </div>

      <div className="flex items-center gap-4 text-sm text-slate-600 mb-2 flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <Calendar className="w-4 h-4" /> Создано: {formatDate(conn.createdAt)}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" /> Дедлайн: {formatDate(conn.plannedDeadline)}
          {conn.plannedDeadline && (
            <span className={conn.isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}>
              ({daysLeft(conn.plannedDeadline)})
            </span>
          )}
        </span>
        {conn.ballHolder && conn.ballHolderType && (
          <BallIndicator holder={conn.ballHolder} type={conn.ballHolderType} days={conn.daysOnStage ?? 0} />
        )}
      </div>

      <div className="mb-6 flex-shrink-0">
        <ProgressBar value={conn.progress ?? 0} />
      </div>

      <div className="flex-1 grid grid-cols-5 gap-6 overflow-hidden">
        <div className="col-span-3 overflow-y-auto space-y-6 pr-2">
          <TeamCard team={conn.team} roles={templateRoles} agents={agents} />

          {conn.ballHolder && conn.ballHolderType && (
            <div className={`rounded-xl p-4 ${
              conn.ballHolderType === 'us' ? 'bg-blue-50' : conn.ballHolderType === 'client' ? 'bg-orange-50' : 'bg-purple-50'
            }`}>
              <div className="flex items-center gap-2">
                <CircleDot className="w-5 h-5" />
                <span className="font-medium text-sm">Мяч у: {conn.ballHolder}</span>
                <span className="text-sm text-slate-500">{conn.daysOnStage ?? 0} дн.</span>
              </div>
            </div>
          )}

          {conn.stages && conn.stages.length > 0 && (
            <StageTimeline
              stages={conn.stages}
              onCompleteStage={handleCompleteStage}
              onTaskUpdate={handleTaskUpdate}
            />
          )}
        </div>

        <div className="col-span-2 flex flex-col gap-6 overflow-y-auto pl-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Комментарии</h3>
            <CommentFeed
              comments={comments}
              onAddComment={handleAddComment}
              loading={commentLoading}
            />
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Информация</h3>
            <InfoRow icon={User} label="Клиент" value={conn.clientName} />
            <InfoRow icon={User} label="Контакт" value={conn.clientContact} />
            <InfoRow icon={Phone} label="Телефон" value={conn.clientPhone} />
            <InfoRow icon={Package} label="Шаблон" value={conn.templateName} />
            <InfoRow icon={User} label="Менеджер" value={conn.managerName} />
          </div>
        </div>
      </div>
    </div>
  )
}
