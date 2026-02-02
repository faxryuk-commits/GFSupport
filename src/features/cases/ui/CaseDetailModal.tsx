import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Paperclip, Send, History, MessageSquare, Link2, ExternalLink } from 'lucide-react'
import { Modal, Avatar, Badge, EmptyState, Tabs, TabPanel } from '@/shared/ui'
import { CASE_STATUS_CONFIG, CASE_PRIORITY_CONFIG, KANBAN_STATUSES, type CaseStatus, type CasePriority } from '@/entities/case'

// Форматирование даты
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface Comment {
  id: string
  author: string
  text: string
  time: string
  isInternal: boolean
}

interface HistoryItem {
  id: string
  action: string
  user: string
  time: string
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
  comments: Comment[]
  tags: string[]
  linkedChats: string[]
  attachments: { name: string; size: string }[]
  history: HistoryItem[]
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
  isOpen,
  onClose,
  caseData,
  agents,
  onStatusChange,
  onAssign,
  onAddComment,
  onDelete,
}: CaseDetailModalProps) {
  const navigate = useNavigate()
  const [detailTab, setDetailTab] = useState('details')
  const [newComment, setNewComment] = useState('')
  const [isInternalComment, setIsInternalComment] = useState(false)

  if (!caseData) return null

  const handleAddComment = () => {
    if (!newComment.trim()) return
    onAddComment(caseData.id, newComment, isInternalComment)
    setNewComment('')
  }

  const handleOpenChat = () => {
    if (caseData.channelId) {
      onClose()
      navigate(`/chats?channel=${caseData.channelId}`)
    }
  }

  // Формируем номер тикета
  const displayNumber = caseData.ticketNumber 
    ? `#${caseData.ticketNumber}` 
    : caseData.number

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={`Тикет ${displayNumber}`} 
      size="xl"
    >
      <div className="flex gap-6 -mx-6 -mb-6">
        {/* Main Content */}
        <div className="flex-1 pl-6 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">{caseData.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${CASE_PRIORITY_CONFIG[caseData.priority].bgColor} ${CASE_PRIORITY_CONFIG[caseData.priority].color}`}>
                  {CASE_PRIORITY_CONFIG[caseData.priority].label}
                </span>
                <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
                  {caseData.category}
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
              <button 
                onClick={onDelete}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <Tabs
            tabs={[
              { id: 'details', label: 'Детали' },
              { id: 'comments', label: 'Комментарии', badge: caseData.comments.length },
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
              {caseData.attachments.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-slate-500">Вложения</label>
                  <div className="mt-2 space-y-2">
                    {caseData.attachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg">
                        <Paperclip className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-700">{att.name}</span>
                        <span className="text-xs text-slate-400">{att.size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabPanel>

          <TabPanel tabId="comments" activeTab={detailTab}>
            <div className="space-y-4">
              {caseData.comments.length === 0 ? (
                <EmptyState title="Нет комментариев" description="Добавьте комментарий" size="sm" />
              ) : (
                caseData.comments.map(comment => (
                  <div key={comment.id} className={`flex gap-3 ${comment.isInternal ? 'bg-amber-50 -mx-2 px-2 py-2 rounded-lg' : ''}`}>
                    <Avatar name={comment.author} size="sm" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{comment.author}</span>
                        <span className="text-xs text-slate-400">{comment.time}</span>
                        {comment.isInternal && (
                          <Badge variant="warning" size="sm">Внутренний</Badge>
                        )}
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
                    Внутренняя заметка (не видна клиенту)
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
            {caseData.history.length === 0 ? (
              <EmptyState title="Нет истории" description="Действия будут отображаться здесь" size="sm" />
            ) : (
              <div className="space-y-3">
                {caseData.history.map(item => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                      <History className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-800">{item.action}</p>
                      <p className="text-xs text-slate-500">{item.user} • {item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabPanel>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-slate-50 p-4 border-l border-slate-200">
          <h4 className="font-medium text-slate-700 mb-3">Клиент</h4>
          <div className="flex items-center gap-3 mb-4">
            <Avatar name={caseData.company} size="md" />
            <div>
              <p className="font-medium text-slate-800">{caseData.company}</p>
              <p className="text-sm text-slate-500">{caseData.contactName}</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-4">{caseData.contactEmail}</p>

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
                <button 
                  onClick={handleOpenChat}
                  className="flex items-center gap-2 text-sm text-blue-500 hover:underline"
                >
                  <Link2 className="w-4 h-4" />
                  {caseData.channelName || 'Открыть чат'}
                </button>
              )}
              {caseData.linkedChats.filter(id => id !== caseData.channelId).map(chatId => (
                <button 
                  key={chatId} 
                  onClick={() => {
                    onClose()
                    navigate(`/chats?channel=${chatId}`)
                  }}
                  className="flex items-center gap-2 text-sm text-blue-500 hover:underline"
                >
                  <Link2 className="w-4 h-4" />
                  Открыть чат
                </button>
              ))}
            </div>
          )}

          {caseData.channelId && (
            <button 
              onClick={handleOpenChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
            >
              <ExternalLink className="w-4 h-4" />
              Открыть чат
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
