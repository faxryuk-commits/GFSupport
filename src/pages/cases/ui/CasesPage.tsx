import { useState } from 'react'
import { Search, Plus, Filter, User, AlertTriangle } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { CaseCard, NewCaseForm, CaseDetailModal, type CaseCardData, type CaseDetail } from '@/features/cases/ui'
import { CASE_STATUS_CONFIG, KANBAN_STATUSES, type CaseStatus } from '@/entities/case'

// Mock agents
const agents = [
  { id: '1', name: 'Sarah Jenkins' },
  { id: '2', name: 'Mike Chen' },
  { id: '3', name: 'Emily Patel' },
  { id: '4', name: 'David Lee' },
]

// Mock data
const mockCases: CaseDetail[] = [
  { 
    id: '1', number: '#001', title: 'Ошибка API интеграции', 
    description: 'Клиент сообщает об ошибке 500 при создании заказов.',
    company: 'Acme Corp', contactName: 'John Smith', contactEmail: 'john@acmecorp.com',
    priority: 'high', category: 'Техническая', status: 'detected', createdAt: '30 янв 2024, 10:15',
    assignee: { id: '1', name: 'Sarah Jenkins' },
    comments: [
      { id: '1', author: 'John Smith', text: 'Срочно, заказы не проходят!', time: '2ч назад', isInternal: false },
    ],
    tags: ['API', 'Срочно'],
    linkedChats: ['chat-123'],
    attachments: [{ name: 'error_log.txt', size: '12 KB' }],
    history: [{ id: '1', action: 'Кейс создан', user: 'Система', time: '2ч назад' }]
  },
  { 
    id: '2', number: '#002', title: 'Ошибка платёжного шлюза',
    description: 'Платежи не проходят для карт Visa.',
    company: 'TechSolutions', contactName: 'Maria Garcia', contactEmail: 'maria@techsolutions.io',
    priority: 'critical', category: 'Оплата', status: 'in_progress', createdAt: '30 янв 2024, 09:30',
    assignee: { id: '2', name: 'Mike Chen' },
    comments: [], tags: ['Платежи', 'Критично'], linkedChats: [], attachments: [], history: []
  },
  { 
    id: '3', number: '#003', title: 'Проблема с правами доступа',
    description: 'Админы не могут зайти в настройки.',
    company: 'Cyberdyne', contactName: 'Alex Johnson', contactEmail: 'alex@cyberdyne.io',
    priority: 'medium', category: 'Безопасность', status: 'waiting', createdAt: '29 янв 2024, 14:00',
    comments: [], tags: ['Права'], linkedChats: [], attachments: [], history: []
  },
  { 
    id: '4', number: '#004', title: 'Таймаут базы данных',
    description: 'Периодические таймауты БД.',
    company: 'Umbrella Corp', contactName: 'Emma Wilson', contactEmail: 'emma@umbrella.io',
    priority: 'high', category: 'Инфраструктура', status: 'blocked', createdAt: '30 янв 2024, 08:00',
    assignee: { id: '3', name: 'Emily Patel' },
    comments: [], tags: ['БД'], linkedChats: [], attachments: [], history: []
  },
  { 
    id: '5', number: '#005', title: 'Ошибка входа',
    description: 'Пользователи не могут войти.',
    company: 'Globex Inc', contactName: 'Robert Kim', contactEmail: 'robert@globex.io',
    priority: 'medium', category: 'Доступ', status: 'detected', createdAt: '30 янв 2024, 07:45',
    comments: [], tags: ['Вход'], linkedChats: [], attachments: [], history: []
  },
  { 
    id: '6', number: '#006', title: 'Email рассылка не работает',
    description: 'Уведомления не доставляются.',
    company: 'Hooli', contactName: 'James Brown', contactEmail: 'james@hooli.io',
    priority: 'medium', category: 'Коммуникация', status: 'resolved', createdAt: '29 янв 2024, 11:00',
    assignee: { id: '1', name: 'Sarah Jenkins' },
    comments: [], tags: ['Email'], linkedChats: [], attachments: [], history: []
  },
]

export function CasesPage() {
  const [cases, setCases] = useState(mockCases)
  const [filter, setFilter] = useState<'all' | 'my' | 'urgent'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [draggedCase, setDraggedCase] = useState<string | null>(null)

  const getCasesByStatus = (status: CaseStatus): CaseCardData[] => {
    return cases
      .filter(c => {
        const matchesStatus = c.status === status
        const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             c.company.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesFilter = filter === 'all' || 
                            (filter === 'my' && c.assignee?.id === '1') ||
                            (filter === 'urgent' && (c.priority === 'high' || c.priority === 'critical'))
        return matchesStatus && matchesSearch && matchesFilter
      })
      .map(c => ({
        id: c.id,
        number: c.number,
        title: c.title,
        company: c.company,
        priority: c.priority,
        category: c.category,
        time: c.createdAt,
        assignee: c.assignee,
        commentsCount: c.comments.length,
      }))
  }

  const handleDragStart = (caseId: string) => setDraggedCase(caseId)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleDrop = (status: CaseStatus) => {
    if (draggedCase) {
      setCases(prev => prev.map(c => c.id === draggedCase ? { ...c, status } : c))
      setDraggedCase(null)
    }
  }

  const handleViewCase = (caseId: string) => {
    const caseItem = cases.find(c => c.id === caseId)
    if (caseItem) {
      setSelectedCase(caseItem)
      setIsDetailModalOpen(true)
    }
  }

  const handleStatusChange = (caseId: string, newStatus: CaseStatus) => {
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, status: newStatus } : c))
    if (selectedCase?.id === caseId) {
      setSelectedCase(prev => prev ? { ...prev, status: newStatus } : null)
    }
  }

  const handleAssign = (caseId: string, agent: { id: string; name: string } | null) => {
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, assignee: agent || undefined } : c))
  }

  const handleAddComment = (caseId: string, text: string, isInternal: boolean) => {
    const comment = { id: Date.now().toString(), author: 'Вы', text, time: 'Только что', isInternal }
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, comments: [...c.comments, comment] } : c))
    setSelectedCase(prev => prev ? { ...prev, comments: [...prev.comments, comment] } : null)
  }

  const handleDeleteCase = () => {
    if (selectedCase) {
      setCases(prev => prev.filter(c => c.id !== selectedCase.id))
      setIsDeleteDialogOpen(false)
      setIsDetailModalOpen(false)
      setSelectedCase(null)
    }
  }

  const handleCreateCase = (data: any) => {
    const newCase: CaseDetail = {
      id: Date.now().toString(),
      number: `#${String(cases.length + 1).padStart(3, '0')}`,
      ...data,
      status: 'detected' as CaseStatus,
      createdAt: new Date().toLocaleString('ru-RU'),
      comments: [],
      tags: [],
      linkedChats: [],
      attachments: [],
      history: [{ id: '1', action: 'Кейс создан', user: 'Вы', time: 'Только что' }]
    }
    setCases(prev => [...prev, newCase])
    setIsCreateModalOpen(false)
  }

  return (
    <>
      <div className="h-full flex flex-col p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Кейсы</h1>
            <p className="text-slate-500 mt-0.5">Управление обращениями</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск кейсов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Новый кейс
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6 flex-shrink-0">
          {[
            { key: 'all', label: 'Все', icon: Filter, count: cases.length },
            { key: 'my', label: 'Мои', icon: User, count: cases.filter(c => c.assignee?.id === '1').length },
            { key: 'urgent', label: 'Срочные', icon: AlertTriangle, count: cases.filter(c => c.priority === 'high' || c.priority === 'critical').length },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <f.icon className="w-4 h-4" />
              {f.label}
              <span className={`px-1.5 py-0.5 rounded text-xs ${filter === f.key ? 'bg-white/20' : 'bg-slate-100'}`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Kanban Board */}
        <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
          {KANBAN_STATUSES.map(status => {
            const config = CASE_STATUS_CONFIG[status]
            const statusCases = getCasesByStatus(status)
            
            return (
              <div 
                key={status} 
                className="flex-shrink-0 w-72 flex flex-col"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(status)}
              >
                <div className={`px-3 py-2 rounded-t-xl ${config.bgColor}`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${status === 'resolved' ? 'text-green-800' : 'text-white'}`}>
                      {config.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-white/20 text-white'
                    }`}>
                      {statusCases.length}
                    </span>
                  </div>
                </div>

                <div className="flex-1 bg-slate-100 rounded-b-xl p-2 space-y-2 min-h-[400px] overflow-y-auto">
                  {statusCases.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                      Перетащите сюда
                    </div>
                  ) : (
                    statusCases.map(caseItem => (
                      <CaseCard 
                        key={caseItem.id} 
                        caseItem={caseItem}
                        onView={() => handleViewCase(caseItem.id)}
                        onDragStart={() => handleDragStart(caseItem.id)}
                        isDragging={draggedCase === caseItem.id}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Case Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новый кейс" size="lg">
        <NewCaseForm onClose={() => setIsCreateModalOpen(false)} onSubmit={handleCreateCase} />
      </Modal>

      {/* Case Detail Modal */}
      <CaseDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        caseData={selectedCase}
        agents={agents}
        onStatusChange={handleStatusChange}
        onAssign={handleAssign}
        onAddComment={handleAddComment}
        onDelete={() => setIsDeleteDialogOpen(true)}
      />

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteCase}
        title="Удалить кейс"
        message={`Вы уверены, что хотите удалить кейс ${selectedCase?.number}?`}
        confirmText="Удалить"
        variant="danger"
      />
    </>
  )
}
