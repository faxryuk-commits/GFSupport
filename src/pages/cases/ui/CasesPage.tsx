import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Filter, User, AlertTriangle, Loader2 } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { CaseCard, NewCaseForm, CaseDetailModal, type CaseCardData, type CaseDetail } from '@/features/cases/ui'
import { CASE_STATUS_CONFIG, KANBAN_STATUSES, type CaseStatus, type Case } from '@/entities/case'
import { fetchCases, createCase, updateCaseStatus, assignCase } from '@/shared/api'

// Маппинг Case в CaseCardData для отображения
function mapCaseToCardData(c: Case): CaseCardData {
  return {
    id: c.id,
    number: c.ticketNumber ? `#${c.ticketNumber}` : c.id.slice(0, 8),
    title: c.title,
    company: c.companyName,
    priority: c.priority,
    category: c.category,
    time: c.createdAt,
    assignee: c.assignedTo ? { id: c.assignedTo, name: c.assigneeName } : undefined,
    commentsCount: c.messagesCount,
  }
}

// Маппинг Case в CaseDetail для модального окна
function mapCaseToCaseDetail(c: Case): CaseDetail {
  return {
    id: c.id,
    number: c.ticketNumber ? `#${c.ticketNumber}` : c.id.slice(0, 8),
    title: c.title,
    description: c.description,
    company: c.companyName,
    contactName: '',
    contactEmail: '',
    priority: c.priority,
    category: c.category,
    status: c.status,
    createdAt: c.createdAt,
    assignee: c.assignedTo ? { id: c.assignedTo, name: c.assigneeName } : undefined,
    comments: [],
    tags: [],
    linkedChats: [c.channelId],
    attachments: [],
    history: [],
  }
}

export function CasesPage() {
  const [cases, setCases] = useState<Case[]>([])
  const [agents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'my' | 'urgent'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCase, setSelectedCase] = useState<Case | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [draggedCase, setDraggedCase] = useState<string | null>(null)
  const [_updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  // Загрузка кейсов при монтировании
  const loadCases = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetchCases()
      setCases(response.cases)
    } catch (err) {
      setError('Ошибка загрузки кейсов. Попробуйте обновить страницу.')
      console.error('Ошибка загрузки кейсов:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  const getCasesByStatus = (status: CaseStatus): CaseCardData[] => {
    return cases
      .filter(c => {
        const matchesStatus = c.status === status
        const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             c.companyName.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesFilter = filter === 'all' || 
                            (filter === 'my' && c.assignedTo === '1') ||
                            (filter === 'urgent' && (c.priority === 'high' || c.priority === 'critical'))
        return matchesStatus && matchesSearch && matchesFilter
      })
      .map(mapCaseToCardData)
  }

  const handleDragStart = (caseId: string) => setDraggedCase(caseId)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  
  const handleDrop = async (status: CaseStatus) => {
    if (!draggedCase) return
    
    const caseId = draggedCase
    setDraggedCase(null)
    
    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, status } : c))
    
    try {
      setUpdatingStatus(caseId)
      await updateCaseStatus(caseId, status)
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      console.error('Ошибка обновления статуса:', err)
    } finally {
      setUpdatingStatus(null)
    }
  }

  const handleViewCase = (caseId: string) => {
    const caseItem = cases.find(c => c.id === caseId)
    if (caseItem) {
      setSelectedCase(caseItem)
      setIsDetailModalOpen(true)
    }
  }

  const handleStatusChange = async (caseId: string, newStatus: CaseStatus) => {
    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, status: newStatus } : c))
    if (selectedCase?.id === caseId) {
      setSelectedCase(prev => prev ? { ...prev, status: newStatus } : null)
    }
    
    try {
      await updateCaseStatus(caseId, newStatus)
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      if (selectedCase?.id === caseId) {
        const originalCase = previousCases.find(c => c.id === caseId)
        if (originalCase) {
          setSelectedCase(originalCase)
        }
      }
      console.error('Ошибка обновления статуса:', err)
    }
  }

  const handleAssign = async (caseId: string, agent: { id: string; name: string } | null) => {
    // Оптимистичное обновление UI
    const previousCases = [...cases]
    setCases(prev => prev.map(c => c.id === caseId ? { 
      ...c, 
      assignedTo: agent?.id || '', 
      assigneeName: agent?.name || '' 
    } : c))
    
    try {
      await assignCase(caseId, agent?.id || '')
    } catch (err) {
      // Откат при ошибке
      setCases(previousCases)
      console.error('Ошибка назначения агента:', err)
    }
  }

  const handleAddComment = (_caseId: string, _text: string, _isInternal: boolean) => {
    // TODO: Implement comment API
  }

  const handleDeleteCase = () => {
    if (selectedCase) {
      setCases(prev => prev.filter(c => c.id !== selectedCase.id))
      setIsDeleteDialogOpen(false)
      setIsDetailModalOpen(false)
      setSelectedCase(null)
    }
  }

  const handleCreateCase = async (data: { title: string; description?: string; category?: string; priority?: string }) => {
    try {
      const newCase = await createCase({
        channelId: '', // Будет создан без привязки к каналу
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
      })
      setCases(prev => [...prev, newCase])
      setIsCreateModalOpen(false)
    } catch (err) {
      console.error('Ошибка создания кейса:', err)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-500">Загрузка кейсов...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-slate-700 font-medium">Ошибка загрузки</p>
          <p className="text-slate-500 text-sm">{error}</p>
          <button 
            onClick={loadCases}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    )
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
            { key: 'my', label: 'Мои', icon: User, count: cases.filter(c => c.assignedTo === '1').length },
            { key: 'urgent', label: 'Срочные', icon: AlertTriangle, count: cases.filter(c => c.priority === 'high' || c.priority === 'critical').length },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as 'all' | 'my' | 'urgent')}
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
        caseData={selectedCase ? mapCaseToCaseDetail(selectedCase) : null}
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
        message={`Вы уверены, что хотите удалить кейс ${selectedCase?.ticketNumber ? `#${selectedCase.ticketNumber}` : selectedCase?.id}?`}
        confirmText="Удалить"
        variant="danger"
      />
    </>
  )
}
