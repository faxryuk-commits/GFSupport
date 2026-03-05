import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Send, History, MessageSquare, Link2, ExternalLink, Clock, Timer, Loader2 } from 'lucide-react'
import { Modal, Avatar, Badge, EmptyState, Tabs, TabPanel } from '@/shared/ui'
import { CASE_STATUS_CONFIG, CASE_PRIORITY_CONFIG, KANBAN_STATUSES, type CaseStatus, type CasePriority } from '@/entities/case'
import { fetchCaseComments, type CaseComment } from '@/shared/api'

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return 'Не указано'
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}д назад`
  if (hrs > 0) return `${hrs}ч назад`
  if (mins > 0) return `${mins}м назад`
  return 'только что'
}

interface Agent {
  id: string
  name: string
}

export interface CaseDetail {
  id: string
  number: string
  ticketNumber?: number
  title: string
  description: string
  company: string
  channelId?: string
  channelName?: string
  contactName: string
  contactEmail: string
  priority: CasePriority
  category: string
  status: CaseStatus
  createdAt: string
  updatedAt?: string
  assignee?: Agent
  comments: CaseComment[]
  tags: string[]
  linkedChats: string[]
  attachments: { name: string; size: string }[]
  history: { id: string; action: string; user: string; time: string }[]
}

interface CaseDetailModalProps {
  isOpen: boolean
  onClose: () => void
  caseData: CaseDetail | null
  agents: Agent[]
  onStatusChange: (caseId: string, status: CaseStatus) => void
  onAssign: (caseId: string, agent: Agent | null) => void
  onAddComment: (caseId: string, text: string, isInternal: boolean) => void
  onDelete: () => void
}

export function CaseDetailModal({
  isOpen, onClose, caseData, agents, onStatusChange, onAssign, onAddComment, onDelete,
}: CaseDetailModalProps) {
  const navigate = useNavigate()
  const [detailTab, setDetailTab] = useState('details')
  const [newComment, setNewComment] = useState('')
  const [isInternalComment, setIsInternalComment] = useState(false)
  const [comments, setComments] = useState<CaseComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)

  const loadComments = useCallback(async () => {
    if (!caseData?.id) return
    setLoadingComments(true)
    try {
      const data = await fetchCaseComments(caseData.id)
      setComments(data)
    } catch {
      setComments([])
    } finally {
      setLoadingComments(false)
    }
  }, [caseData?.id])

  useEffect(() => {
    if (isOpen && caseData?.id) {
      loadComments()
    }
  }, [isOpen, caseData?.id, loadComments])

  if (!caseData) return null

  const handleAddComment = async () => {
    if (!newComment.trim()) return
    onAddComment(caseData.id, newComment, isInternalComment)
    setComments(prev => [...prev, {
      id: `temp_${Date.now()}`,
      author: 'Вы',
      text: newComment,
      isInternal: isInternalComment,
      time: new Date().toISOString(),
    }])
    setNewComment('')
  }

  const handleOpenChat = () => {
    if (caseData.channelId) {
      onClose()
      navigate(`/chats?channel=${caseData.channelId}`)
    }
  }

  const displayNumber = caseData.ticketNumber ? `#${caseData.ticketNumber}` : caseData.number

  const agingHours = (Date.now() - new Date(caseData.createdAt).getTime()) / 3600000
  const agingText = agingHours < 1 ? 'Менее часа' : agingHours < 24 ? `${Math.floor(agingHours)} ч` : `${Math.floor(agingHours / 24)} д ${Math.floor(agingHours % 24)} ч`
  const agingColor = agingHours < 4 ? 'text-green-600' : agingHours < 24 ? 'text-amber-600' : 'text-red-600'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Тикет ${displayNumber}`} size="xl">
      <div className="flex gap-6 -mx-6 -mb-6">
        <div className="flex-1 pl-6 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">{caseData.title}</h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${CASE_PRIORITY_CONFIG[caseData.priority].bgColor} ${CASE_PRIORITY_CONFIG[caseData.priority].color}`}>
                  {CASE_PRIORITY_CONFIG[caseData.priority].label}
                </span>
                <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
                  {caseData.category}
                </span>
                <span className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-slate-50 ${agingColor}`}>
                  <Timer className="w-3 h-3" />
                  {agingText}
                </span>
                {caseData.tags.map(tag => (
                  <Badge key={tag} size="sm">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={caseData.status}
                onChange={(e) => onStatusChange(caseData.id, e.target.value as CaseStatus)}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {KANBAN_STATUSES.map(s => (
                  <option key={s} value={s}>{CASE_STATUS_CONFIG[s].label}</option>
                ))}
              </select>
              <button onClick={onDelete} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <Tabs
            tabs={[
              { id: 'details', label: 'Детали' },
              { id: 'comments', label: 'Комментарии', badge: comments.length },
              { id: 'history', label: 'История' },
            ]}
            activeTab={detailTab}
            onChange={setDetailTab}
            variant="underline"
            className="mb-4"
          />

          <TabPanel tabId="details" activeTab={detailTab}>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-500">Описание</label>
                <p className="mt-1 text-slate-800">{caseData.description || 'Нет описания'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-500">Создан</label>
                  <p className="mt-1 text-slate-800">{formatDate(caseData.createdAt)}</p>
                </div>
                {caseData.updatedAt && caseData.updatedAt !== caseData.createdAt && (
                  <div>
                    <label className="text-sm font-medium text-slate-500">Обновлён</label>
                    <p className="mt-1 text-slate-800">{formatDate(caseData.updatedAt)}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium text-slate-500">Назначен</label>
                  <div className="mt-1 flex items-center gap-2">
                    {caseData.assignee ? (
                      <>
                        <Avatar name={caseData.assignee.name} size="sm" />
                        <span className="text-slate-800">{caseData.assignee.name}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Не назначен</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel tabId="comments" activeTab={detailTab}>
            <div className="space-y-4">
              {loadingComments ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : comments.length === 0 ? (
                <EmptyState title="Нет комментариев" description="Добавьте комментарий" size="sm" />
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className={`flex gap-3 ${comment.isInternal ? 'bg-amber-50 -mx-2 px-2 py-2 rounded-lg' : ''}`}>
                    <Avatar name={comment.author} size="sm" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{comment.author}</span>
                        <span className="text-xs text-slate-400">{formatRelativeTime(comment.time)}</span>
                        {comment.isInternal && <Badge variant="warning" size="sm">Внутренний</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{comment.text}</p>
                    </div>
                  </div>
                ))
              )}
              
              <div className="border-t border-slate-200 pt-4 mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternalComment}
                      onChange={(e) => setIsInternalComment(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded"
                    />
                    Внутренняя заметка
                  </label>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Добавить комментарий..."
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel tabId="history" activeTab={detailTab}>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-800">Кейс создан</p>
                  <p className="text-xs text-slate-500">{formatDate(caseData.createdAt)}</p>
                </div>
              </div>
              {caseData.assignee && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <History className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-800">Назначен на {caseData.assignee.name}</p>
                  </div>
                </div>
              )}
              {caseData.updatedAt && caseData.updatedAt !== caseData.createdAt && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <History className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-800">Обновлён</p>
                    <p className="text-xs text-slate-500">{formatDate(caseData.updatedAt)}</p>
                  </div>
                </div>
              )}
              {comments.length > 0 && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-800">{comments.length} комментариев</p>
                    <p className="text-xs text-slate-500">Последний: {formatRelativeTime(comments[comments.length - 1].time)}</p>
                  </div>
                </div>
              )}
            </div>
          </TabPanel>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-slate-50 p-4 border-l border-slate-200">
          <h4 className="font-medium text-slate-700 mb-3">Канал / Клиент</h4>
          <div className="flex items-center gap-3 mb-4">
            <Avatar name={caseData.channelName || caseData.company} size="md" />
            <div>
              <p className="font-medium text-slate-800 text-sm">{caseData.channelName || caseData.company}</p>
              {caseData.contactName && <p className="text-xs text-slate-500">{caseData.contactName}</p>}
            </div>
          </div>

          <h4 className="font-medium text-slate-700 mb-3">Назначен</h4>
          <select
            value={caseData.assignee?.id || ''}
            onChange={(e) => {
              const agent = agents.find(a => a.id === e.target.value)
              onAssign(caseData.id, agent || null)
            }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 mb-4"
          >
            <option value="">Не назначен</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>

          <h4 className="font-medium text-slate-700 mb-3">Связанные чаты</h4>
          {!caseData.channelId && caseData.linkedChats.length === 0 ? (
            <p className="text-sm text-slate-400 mb-4">Нет связанных чатов</p>
          ) : (
            <div className="space-y-2 mb-4">
              {caseData.channelId && (
                <button onClick={handleOpenChat} className="flex items-center gap-2 text-sm text-blue-500 hover:underline">
                  <Link2 className="w-4 h-4" />
                  {caseData.channelName || 'Открыть чат'}
                </button>
              )}
            </div>
          )}

          {caseData.channelId && (
            <button onClick={handleOpenChat} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600">
              <ExternalLink className="w-4 h-4" />
              Открыть чат
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
