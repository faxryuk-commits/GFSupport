import { useState, useMemo } from 'react'
import { 
  Search, Briefcase, Clock, User, ChevronRight, 
  AlertCircle, CheckCircle, Loader, Filter
} from 'lucide-react'
import type { SupportCase } from '../types'

interface CasesTabProps {
  cases: SupportCase[]
  onCaseSelect: (caseId: string) => void
  onRefresh: () => void
}

// Status configuration
const STATUS_CONFIG = {
  open: { label: 'Открыт', color: 'bg-blue-100 text-blue-700', icon: Loader },
  in_progress: { label: 'В работе', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  waiting: { label: 'Ожидание', color: 'bg-orange-100 text-orange-700', icon: Clock },
  resolved: { label: 'Решён', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  closed: { label: 'Закрыт', color: 'bg-slate-100 text-slate-600', icon: CheckCircle },
}

// Priority configuration
const PRIORITY_CONFIG = {
  critical: { label: 'Критический', color: 'text-red-600', badge: 'bg-red-500' },
  high: { label: 'Высокий', color: 'text-orange-600', badge: 'bg-orange-500' },
  medium: { label: 'Средний', color: 'text-yellow-600', badge: 'bg-yellow-500' },
  low: { label: 'Низкий', color: 'text-slate-500', badge: 'bg-slate-400' },
}

export function CasesTab({ cases, onCaseSelect, onRefresh }: CasesTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  // Filter and sort cases
  const filteredCases = useMemo(() => {
    let result = cases
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(c => 
        c.title.toLowerCase().includes(query) ||
        c.channelName.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query) ||
        c.ticketNumber?.toString().includes(query)
      )
    }
    
    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(c => c.status === statusFilter)
    }
    
    // Sort by priority and date
    return result.sort((a, b) => {
      // Critical first
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      const priorityA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3
      const priorityB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3
      
      if (priorityA !== priorityB) return priorityA - priorityB
      
      // Then by date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [cases, searchQuery, statusFilter])
  
  // Count by status
  const statusCounts = useMemo(() => {
    return cases.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [cases])
  
  // Format time ago
  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 60) return `${minutes} мин`
    if (hours < 24) return `${hours} ч`
    if (days < 7) return `${days} д`
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }
  
  // Get status config
  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.open
  }
  
  // Get priority config
  const getPriorityConfig = (priority: string) => {
    return PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG.medium
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск кейсов..."
            className="w-full pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>
      
      {/* Status filter tabs */}
      <div className="flex gap-2 px-3 py-2 bg-white border-b border-slate-100 overflow-x-auto">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            statusFilter === 'all' 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Все ({cases.length})
        </button>
        <button
          onClick={() => setStatusFilter('open')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            statusFilter === 'open' 
              ? 'bg-blue-100 text-blue-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Открыт ({statusCounts.open || 0})
        </button>
        <button
          onClick={() => setStatusFilter('in_progress')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            statusFilter === 'in_progress' 
              ? 'bg-yellow-100 text-yellow-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          В работе ({statusCounts.in_progress || 0})
        </button>
        <button
          onClick={() => setStatusFilter('resolved')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            statusFilter === 'resolved' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Решён ({statusCounts.resolved || 0})
        </button>
      </div>
      
      {/* Cases list */}
      <div className="flex-1 overflow-auto">
        {filteredCases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Briefcase className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">Кейсы не найдены</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredCases.map(caseItem => {
              const statusConfig = getStatusConfig(caseItem.status)
              const priorityConfig = getPriorityConfig(caseItem.priority)
              const StatusIcon = statusConfig.icon
              
              return (
                <button
                  key={caseItem.id}
                  onClick={() => onCaseSelect(caseItem.id)}
                  className="w-full flex items-start gap-3 p-3 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left"
                >
                  {/* Priority indicator */}
                  <div className={`w-1 h-full min-h-[60px] rounded-full ${priorityConfig.badge}`} />
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1">
                      {caseItem.ticketNumber && (
                        <span className="text-xs text-slate-400 font-mono">
                          #{String(caseItem.ticketNumber).padStart(3, '0')}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs ${statusConfig.color}`}>
                        {statusConfig.label}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto">
                        {formatTimeAgo(caseItem.createdAt)}
                      </span>
                    </div>
                    
                    {/* Title */}
                    <h3 className="font-medium text-slate-800 truncate">
                      {caseItem.title}
                    </h3>
                    
                    {/* Description */}
                    {caseItem.description && (
                      <p className="text-sm text-slate-500 truncate mt-0.5">
                        {caseItem.description}
                      </p>
                    )}
                    
                    {/* Footer */}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                      <span className="truncate">{caseItem.channelName}</span>
                      {caseItem.assigneeName && (
                        <span className="flex items-center gap-1 truncate">
                          <User className="w-3 h-3" />
                          {caseItem.assigneeName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {caseItem.category}
                      </span>
                    </div>
                  </div>
                  
                  <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0 mt-1" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default CasesTab
