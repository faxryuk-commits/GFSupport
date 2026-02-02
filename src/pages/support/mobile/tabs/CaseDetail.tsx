import { useState, useEffect } from 'react'
import { 
  ChevronLeft, Clock, User, Tag, AlertCircle, 
  CheckCircle, MessageSquare, Edit2, MoreVertical,
  Calendar, Building, Hash
} from 'lucide-react'
import type { SupportCase } from '../types'

interface CaseDetailProps {
  caseId: string
  caseData: SupportCase | null
  onBack: () => void
  onRefresh: () => void
}

// Status configuration
const STATUS_CONFIG = {
  open: { label: 'Открыт', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_progress: { label: 'В работе', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  waiting: { label: 'Ожидание', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  resolved: { label: 'Решён', color: 'bg-green-100 text-green-700 border-green-200' },
  closed: { label: 'Закрыт', color: 'bg-slate-100 text-slate-600 border-slate-200' },
}

// Priority configuration  
const PRIORITY_CONFIG = {
  critical: { label: 'Критический', color: 'text-red-600 bg-red-50' },
  high: { label: 'Высокий', color: 'text-orange-600 bg-orange-50' },
  medium: { label: 'Средний', color: 'text-yellow-600 bg-yellow-50' },
  low: { label: 'Низкий', color: 'text-slate-500 bg-slate-50' },
}

export function CaseDetail({ caseId, caseData, onBack, onRefresh }: CaseDetailProps) {
  const [isLoading, setIsLoading] = useState(!caseData)
  const [caseDetail, setCaseDetail] = useState<SupportCase | null>(caseData)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  
  // Fetch case details if not provided
  useEffect(() => {
    if (!caseData && caseId) {
      fetch(`/api/support/cases/${caseId}`)
        .then(res => res.json())
        .then(data => {
          setCaseDetail(data.case || data)
          setIsLoading(false)
        })
        .catch(err => {
          console.error('Failed to fetch case:', err)
          setIsLoading(false)
        })
    }
  }, [caseId, caseData])
  
  // Update status
  const handleStatusUpdate = async (newStatus: string) => {
    if (!caseDetail || isUpdating) return
    
    setIsUpdating(true)
    setShowStatusMenu(false)
    
    try {
      const res = await fetch(`/api/support/cases/${caseDetail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      
      if (res.ok) {
        const data = await res.json()
        setCaseDetail(prev => prev ? { ...prev, status: newStatus } : null)
        onRefresh()
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setIsUpdating(false)
    }
  }
  
  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // Time since creation
  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} д ${hours % 24} ч`
    return `${hours} ч`
  }
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Clock className="w-8 h-8 animate-pulse text-slate-400" />
      </div>
    )
  }
  
  if (!caseDetail) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-2 py-2 flex items-center gap-2">
          <button onClick={onBack} className="p-2 text-slate-600">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <span className="font-medium">Кейс не найден</span>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-slate-300" />
        </div>
      </div>
    )
  }
  
  const statusConfig = STATUS_CONFIG[caseDetail.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.open
  const priorityConfig = PRIORITY_CONFIG[caseDetail.priority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG.medium
  
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-2 py-2 flex items-center gap-2 sticky top-0 z-40">
        <button onClick={onBack} className="p-2 -ml-1 text-slate-600">
          <ChevronLeft className="w-6 h-6" />
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {caseDetail.ticketNumber && (
              <span className="text-sm text-slate-500 font-mono">
                #{String(caseDetail.ticketNumber).padStart(3, '0')}
              </span>
            )}
            <span className="font-medium text-slate-800 truncate">Кейс</span>
          </div>
        </div>
        
        <button className="p-2 text-slate-500">
          <MoreVertical className="w-5 h-5" />
        </button>
      </header>
      
      {/* Content */}
      <main className="flex-1 overflow-auto">
        {/* Status card */}
        <div className="bg-white p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold text-slate-800">
              {caseDetail.title}
            </h1>
          </div>
          
          {/* Status button */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              disabled={isUpdating}
              className={`px-4 py-2 rounded-lg border font-medium ${statusConfig.color} ${isUpdating ? 'opacity-50' : ''}`}
            >
              {statusConfig.label}
            </button>
            
            {/* Status dropdown */}
            {showStatusMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10 min-w-[150px]">
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => handleStatusUpdate(key)}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${
                      caseDetail.status === key ? 'font-medium' : ''
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Description */}
        {caseDetail.description && (
          <div className="bg-white p-4 border-b border-slate-100">
            <h3 className="text-sm font-medium text-slate-500 mb-2">Описание</h3>
            <p className="text-slate-700 whitespace-pre-wrap">
              {caseDetail.description}
            </p>
          </div>
        )}
        
        {/* Details */}
        <div className="bg-white p-4 border-b border-slate-100">
          <h3 className="text-sm font-medium text-slate-500 mb-3">Детали</h3>
          
          <div className="space-y-3">
            {/* Priority */}
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-slate-400" />
              <span className="text-sm text-slate-500 w-24">Приоритет</span>
              <span className={`px-2 py-1 rounded text-sm ${priorityConfig.color}`}>
                {priorityConfig.label}
              </span>
            </div>
            
            {/* Category */}
            <div className="flex items-center gap-3">
              <Tag className="w-5 h-5 text-slate-400" />
              <span className="text-sm text-slate-500 w-24">Категория</span>
              <span className="text-sm text-slate-700">{caseDetail.category}</span>
            </div>
            
            {/* Channel */}
            <div className="flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-slate-400" />
              <span className="text-sm text-slate-500 w-24">Канал</span>
              <span className="text-sm text-slate-700">{caseDetail.channelName}</span>
            </div>
            
            {/* Company */}
            {caseDetail.companyName && (
              <div className="flex items-center gap-3">
                <Building className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-500 w-24">Компания</span>
                <span className="text-sm text-slate-700">{caseDetail.companyName}</span>
              </div>
            )}
            
            {/* Assignee */}
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-slate-400" />
              <span className="text-sm text-slate-500 w-24">Ответственный</span>
              <span className="text-sm text-slate-700">
                {caseDetail.assigneeName || 'Не назначен'}
              </span>
            </div>
          </div>
        </div>
        
        {/* Timeline */}
        <div className="bg-white p-4 border-b border-slate-100">
          <h3 className="text-sm font-medium text-slate-500 mb-3">История</h3>
          
          <div className="space-y-3">
            {/* Created */}
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
              <div>
                <p className="text-sm text-slate-700">Создан</p>
                <p className="text-xs text-slate-400">{formatDate(caseDetail.createdAt)}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {getTimeSince(caseDetail.createdAt)} назад
                </p>
              </div>
            </div>
            
            {/* Updated */}
            {caseDetail.updatedAt && caseDetail.updatedAt !== caseDetail.createdAt && (
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 mt-2 rounded-full bg-yellow-500" />
                <div>
                  <p className="text-sm text-slate-700">
                    Обновлён {caseDetail.updatedByName && `• ${caseDetail.updatedByName}`}
                  </p>
                  <p className="text-xs text-slate-400">{formatDate(caseDetail.updatedAt)}</p>
                </div>
              </div>
            )}
            
            {/* Resolved */}
            {caseDetail.resolvedAt && (
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 mt-2 rounded-full bg-green-500" />
                <div>
                  <p className="text-sm text-slate-700">Решён</p>
                  <p className="text-xs text-slate-400">{formatDate(caseDetail.resolvedAt)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Messages count */}
        <div className="bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-600">
              <MessageSquare className="w-5 h-5" />
              <span className="text-sm">{caseDetail.messagesCount} сообщений</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default CaseDetail
