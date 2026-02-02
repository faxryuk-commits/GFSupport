import { useState } from 'react'
import { 
  Search, Plus, Filter, User, AlertTriangle, MessageSquare, Clock, X,
  MoreHorizontal, Edit, Trash2, CheckCircle, ArrowRight, Tag, Users,
  Calendar, Paperclip, Send, History, Flag, Link2, ExternalLink
} from 'lucide-react'
import { Modal, ConfirmDialog, Avatar, Badge, EmptyState, Tabs, TabPanel } from '@/shared/ui'

// Types
type CaseStatus = 'detected' | 'in_progress' | 'waiting' | 'blocked' | 'resolved'
type CasePriority = 'low' | 'medium' | 'high' | 'critical'

interface Case {
  id: string
  number: string
  title: string
  description: string
  company: string
  companyAvatar: string
  contactName: string
  contactEmail: string
  priority: CasePriority
  category: string
  status: CaseStatus
  time: string
  createdAt: string
  assignee?: { id: string; name: string; avatar?: string }
  comments: Comment[]
  tags: string[]
  linkedChats: string[]
  attachments: { name: string; size: string; type: string }[]
  history: HistoryItem[]
}

interface Comment {
  id: string
  author: string
  authorAvatar?: string
  text: string
  time: string
  isInternal: boolean
}

interface HistoryItem {
  id: string
  action: string
  user: string
  time: string
  details?: string
}

// Config
const statusConfig: Record<CaseStatus, { label: string; color: string; bgColor: string }> = {
  detected: { label: 'Detected', color: 'text-slate-700', bgColor: 'bg-slate-200' },
  in_progress: { label: 'In Progress', color: 'text-blue-700', bgColor: 'bg-blue-500' },
  waiting: { label: 'Waiting', color: 'text-yellow-700', bgColor: 'bg-yellow-400' },
  blocked: { label: 'Blocked', color: 'text-red-700', bgColor: 'bg-red-500' },
  resolved: { label: 'Resolved', color: 'text-green-700', bgColor: 'bg-green-200' },
}

const priorityConfig: Record<CasePriority, { label: string; color: string; icon: string }> = {
  low: { label: 'Low', color: 'bg-slate-100 text-slate-600', icon: '○' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700', icon: '◐' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700', icon: '●' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700', icon: '◉' },
}

const categories = ['Technical', 'Billing', 'Access', 'Product', 'Security', 'UI/UX', 'Performance', 'Account', 'Other']
const agents = [
  { id: '1', name: 'Sarah Jenkins' },
  { id: '2', name: 'Mike Chen' },
  { id: '3', name: 'Emily Patel' },
  { id: '4', name: 'David Lee' },
]

// Mock data
const mockCases: Case[] = [
  { 
    id: '1', number: '#001', title: 'API Integration Issue', 
    description: 'Customer reports that the API integration is failing with a 500 error when trying to create new orders. This started happening after our latest deployment.',
    company: 'Acme Corp', companyAvatar: 'A', contactName: 'John Smith', contactEmail: 'john@acmecorp.com',
    priority: 'high', category: 'Technical', status: 'detected', time: '2h ago', createdAt: 'Jan 30, 2024 10:15 AM',
    assignee: { id: '1', name: 'Sarah Jenkins' },
    comments: [
      { id: '1', author: 'John Smith', text: 'This is urgent, our orders are not going through!', time: '2h ago', isInternal: false },
      { id: '2', author: 'Sarah Jenkins', text: 'Looking into this now. Checking server logs.', time: '1h ago', isInternal: true },
    ],
    tags: ['API', 'Urgent', 'Orders'],
    linkedChats: ['chat-123'],
    attachments: [{ name: 'error_log.txt', size: '12 KB', type: 'text' }],
    history: [
      { id: '1', action: 'Case created', user: 'System', time: '2h ago' },
      { id: '2', action: 'Assigned to Sarah Jenkins', user: 'Mike Chen', time: '1h 45m ago' },
      { id: '3', action: 'Priority changed to High', user: 'Sarah Jenkins', time: '1h ago' },
    ]
  },
  { 
    id: '2', number: '#002', title: 'Payment Gateway Error',
    description: 'Payments are failing for customers using Visa cards. Mastercard and Amex work fine.',
    company: 'TechSolutions', companyAvatar: 'T', contactName: 'Maria Garcia', contactEmail: 'maria@techsolutions.io',
    priority: 'critical', category: 'Billing', status: 'in_progress', time: '3h ago', createdAt: 'Jan 30, 2024 09:30 AM',
    assignee: { id: '2', name: 'Mike Chen' },
    comments: [],
    tags: ['Payment', 'Critical'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '3', number: '#003', title: 'User Permissions Mismatch',
    description: 'Admin users cannot access the settings panel after the recent update.',
    company: 'Cyberdyne', companyAvatar: 'C', contactName: 'Alex Johnson', contactEmail: 'alex@cyberdyne.io',
    priority: 'medium', category: 'Security', status: 'waiting', time: '1d ago', createdAt: 'Jan 29, 2024 2:00 PM',
    comments: [],
    tags: ['Permissions'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '4', number: '#004', title: 'Database Connection Timeout',
    description: 'Intermittent database timeouts causing slow page loads.',
    company: 'Umbrella Corp', companyAvatar: 'U', contactName: 'Emma Wilson', contactEmail: 'emma@umbrella.io',
    priority: 'high', category: 'Infrastructure', status: 'blocked', time: '4h ago', createdAt: 'Jan 30, 2024 08:00 AM',
    assignee: { id: '3', name: 'Emily Patel' },
    comments: [],
    tags: ['Database', 'Performance'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '5', number: '#005', title: 'Login Failure',
    description: 'Multiple users reporting they cannot log in.',
    company: 'Globex Inc', companyAvatar: 'G', contactName: 'Robert Kim', contactEmail: 'robert@globex.io',
    priority: 'medium', category: 'Access', status: 'detected', time: '4h ago', createdAt: 'Jan 30, 2024 07:45 AM',
    comments: [],
    tags: ['Login', 'Auth'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '6', number: '#006', title: 'Feature Request: Dark Mode',
    description: 'Multiple customers have requested dark mode support.',
    company: 'Innovatech', companyAvatar: 'I', contactName: 'Sophie Chen', contactEmail: 'sophie@innovatech.io',
    priority: 'low', category: 'Product', status: 'in_progress', time: '5h ago', createdAt: 'Jan 30, 2024 07:00 AM',
    comments: [],
    tags: ['Feature Request'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '7', number: '#007', title: 'Broken Link on Dashboard',
    description: 'The "Reports" link in the dashboard leads to a 404 page.',
    company: 'Massive Dynamic', companyAvatar: 'M', contactName: 'Lisa Park', contactEmail: 'lisa@massive.io',
    priority: 'low', category: 'UI/UX', status: 'waiting', time: '2d ago', createdAt: 'Jan 28, 2024 3:00 PM',
    comments: [],
    tags: ['Bug', 'UI'],
    linkedChats: [],
    attachments: [],
    history: []
  },
  { 
    id: '8', number: '#008', title: 'Email Delivery Failure',
    description: 'Notification emails are not being delivered to users.',
    company: 'Hooli', companyAvatar: 'H', contactName: 'James Brown', contactEmail: 'james@hooli.io',
    priority: 'medium', category: 'Communication', status: 'resolved', time: 'Yesterday', createdAt: 'Jan 29, 2024 11:00 AM',
    assignee: { id: '1', name: 'Sarah Jenkins' },
    comments: [],
    tags: ['Email', 'Resolved'],
    linkedChats: [],
    attachments: [],
    history: []
  },
]

export function CasesPage() {
  const [cases, setCases] = useState(mockCases)
  const [filter, setFilter] = useState<'all' | 'my' | 'urgent'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCase, setSelectedCase] = useState<Case | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [detailTab, setDetailTab] = useState('details')
  const [newComment, setNewComment] = useState('')
  const [isInternalComment, setIsInternalComment] = useState(false)
  const [draggedCase, setDraggedCase] = useState<string | null>(null)

  const statuses: CaseStatus[] = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved']

  const getCasesByStatus = (status: CaseStatus) => {
    return cases.filter(c => {
      const matchesStatus = c.status === status
      const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           c.company.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = filter === 'all' || 
                          (filter === 'my' && c.assignee?.id === '1') ||
                          (filter === 'urgent' && (c.priority === 'high' || c.priority === 'critical'))
      return matchesStatus && matchesSearch && matchesFilter
    })
  }

  const handleDragStart = (caseId: string) => {
    setDraggedCase(caseId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (status: CaseStatus) => {
    if (draggedCase) {
      setCases(prev => prev.map(c => 
        c.id === draggedCase ? { ...c, status } : c
      ))
      setDraggedCase(null)
    }
  }

  const handleViewCase = (caseItem: Case) => {
    setSelectedCase(caseItem)
    setIsDetailModalOpen(true)
    setDetailTab('details')
  }

  const handleStatusChange = (caseId: string, newStatus: CaseStatus) => {
    setCases(prev => prev.map(c => 
      c.id === caseId ? { ...c, status: newStatus } : c
    ))
    if (selectedCase?.id === caseId) {
      setSelectedCase(prev => prev ? { ...prev, status: newStatus } : null)
    }
  }

  const handleAssign = (caseId: string, agent: typeof agents[0] | null) => {
    setCases(prev => prev.map(c => 
      c.id === caseId ? { ...c, assignee: agent ? { id: agent.id, name: agent.name } : undefined } : c
    ))
  }

  const handleAddComment = () => {
    if (!newComment.trim() || !selectedCase) return
    
    const comment: Comment = {
      id: Date.now().toString(),
      author: 'You',
      text: newComment,
      time: 'Just now',
      isInternal: isInternalComment
    }
    
    setCases(prev => prev.map(c => 
      c.id === selectedCase.id ? { ...c, comments: [...c.comments, comment] } : c
    ))
    setSelectedCase(prev => prev ? { ...prev, comments: [...prev.comments, comment] } : null)
    setNewComment('')
  }

  const handleDeleteCase = () => {
    if (selectedCase) {
      setCases(prev => prev.filter(c => c.id !== selectedCase.id))
      setIsDeleteDialogOpen(false)
      setIsDetailModalOpen(false)
      setSelectedCase(null)
    }
  }

  return (
    <>
      <div className="h-full flex flex-col p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Cases</h1>
            <p className="text-slate-500 mt-0.5">Manage and track support cases</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search cases..."
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
              New Case
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Filter className="w-4 h-4" />
            All
            <span className={`px-1.5 py-0.5 rounded text-xs ${filter === 'all' ? 'bg-white/20' : 'bg-slate-100'}`}>
              {cases.length}
            </span>
          </button>
          <button
            onClick={() => setFilter('my')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'my' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <User className="w-4 h-4" />
            My Cases
            <span className={`px-1.5 py-0.5 rounded text-xs ${filter === 'my' ? 'bg-white/20' : 'bg-slate-100'}`}>
              {cases.filter(c => c.assignee?.id === '1').length}
            </span>
          </button>
          <button
            onClick={() => setFilter('urgent')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'urgent' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            Urgent
            <span className={`px-1.5 py-0.5 rounded text-xs ${filter === 'urgent' ? 'bg-white/20' : 'bg-slate-100'}`}>
              {cases.filter(c => c.priority === 'high' || c.priority === 'critical').length}
            </span>
          </button>
        </div>

        {/* Kanban Board */}
        <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
          {statuses.map(status => {
            const config = statusConfig[status]
            const statusCases = getCasesByStatus(status)
            
            return (
              <div 
                key={status} 
                className="flex-shrink-0 w-72 flex flex-col"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(status)}
              >
                {/* Column Header */}
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

                {/* Cards */}
                <div className="flex-1 bg-slate-100 rounded-b-xl p-2 space-y-2 min-h-[400px]">
                  {statusCases.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                      Drop cases here
                    </div>
                  ) : (
                    statusCases.map(caseItem => (
                      <CaseCard 
                        key={caseItem.id} 
                        caseItem={caseItem}
                        onView={() => handleViewCase(caseItem)}
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
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create New Case" size="lg">
        <NewCaseForm onClose={() => setIsCreateModalOpen(false)} onSubmit={(data) => {
          const newCase: Case = {
            id: Date.now().toString(),
            number: `#${String(cases.length + 1).padStart(3, '0')}`,
            ...data,
            status: 'detected',
            time: 'Just now',
            createdAt: new Date().toLocaleString(),
            comments: [],
            tags: [],
            linkedChats: [],
            attachments: [],
            history: [{ id: '1', action: 'Case created', user: 'You', time: 'Just now' }]
          }
          setCases(prev => [...prev, newCase])
          setIsCreateModalOpen(false)
        }} />
      </Modal>

      {/* Case Detail Modal */}
      <Modal 
        isOpen={isDetailModalOpen} 
        onClose={() => setIsDetailModalOpen(false)} 
        title={selectedCase ? `Case ${selectedCase.number}` : ''} 
        size="xl"
      >
        {selectedCase && (
          <div className="flex gap-6 -mx-6 -mb-6">
            {/* Main Content */}
            <div className="flex-1 pl-6 pb-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{selectedCase.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${priorityConfig[selectedCase.priority].color}`}>
                      {priorityConfig[selectedCase.priority].label}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
                      {selectedCase.category}
                    </span>
                    {selectedCase.tags.map(tag => (
                      <Badge key={tag} size="sm">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCase.status}
                    onChange={(e) => handleStatusChange(selectedCase.id, e.target.value as CaseStatus)}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {statuses.map(s => (
                      <option key={s} value={s}>{statusConfig[s].label}</option>
                    ))}
                  </select>
                  <button 
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <Tabs
                tabs={[
                  { id: 'details', label: 'Details' },
                  { id: 'comments', label: 'Comments', badge: selectedCase.comments.length },
                  { id: 'history', label: 'History' },
                ]}
                activeTab={detailTab}
                onChange={setDetailTab}
                variant="underline"
                className="mb-4"
              />

              <TabPanel tabId="details" activeTab={detailTab}>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-slate-500">Description</label>
                    <p className="mt-1 text-slate-800">{selectedCase.description}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-slate-500">Created</label>
                      <p className="mt-1 text-slate-800">{selectedCase.createdAt}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-slate-500">Assignee</label>
                      <div className="mt-1 flex items-center gap-2">
                        {selectedCase.assignee ? (
                          <>
                            <Avatar name={selectedCase.assignee.name} size="sm" />
                            <span className="text-slate-800">{selectedCase.assignee.name}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {selectedCase.attachments.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-500">Attachments</label>
                      <div className="mt-2 space-y-2">
                        {selectedCase.attachments.map((att, i) => (
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
                  {selectedCase.comments.length === 0 ? (
                    <EmptyState title="No comments yet" description="Add a comment to start the conversation" size="sm" />
                  ) : (
                    selectedCase.comments.map(comment => (
                      <div key={comment.id} className={`flex gap-3 ${comment.isInternal ? 'bg-amber-50 -mx-2 px-2 py-2 rounded-lg' : ''}`}>
                        <Avatar name={comment.author} size="sm" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800">{comment.author}</span>
                            <span className="text-xs text-slate-400">{comment.time}</span>
                            {comment.isInternal && (
                              <Badge variant="warning" size="sm">Internal</Badge>
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
                        Internal note (not visible to customer)
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
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
                {selectedCase.history.length === 0 ? (
                  <EmptyState title="No history" description="Actions will appear here" size="sm" />
                ) : (
                  <div className="space-y-3">
                    {selectedCase.history.map(item => (
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
              <h4 className="font-medium text-slate-700 mb-3">Customer</h4>
              <div className="flex items-center gap-3 mb-4">
                <Avatar name={selectedCase.company} size="md" />
                <div>
                  <p className="font-medium text-slate-800">{selectedCase.company}</p>
                  <p className="text-sm text-slate-500">{selectedCase.contactName}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-4">{selectedCase.contactEmail}</p>

              <h4 className="font-medium text-slate-700 mb-3">Assignee</h4>
              <select
                value={selectedCase.assignee?.id || ''}
                onChange={(e) => {
                  const agent = agents.find(a => a.id === e.target.value)
                  handleAssign(selectedCase.id, agent || null)
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 mb-4"
              >
                <option value="">Unassigned</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>

              <h4 className="font-medium text-slate-700 mb-3">Linked Chats</h4>
              {selectedCase.linkedChats.length === 0 ? (
                <p className="text-sm text-slate-400 mb-4">No linked chats</p>
              ) : (
                <div className="space-y-2 mb-4">
                  {selectedCase.linkedChats.map(chatId => (
                    <button key={chatId} className="flex items-center gap-2 text-sm text-blue-500 hover:underline">
                      <Link2 className="w-4 h-4" />
                      View chat
                    </button>
                  ))}
                </div>
              )}

              <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600">
                <MessageSquare className="w-4 h-4" />
                Open Chat
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteCase}
        title="Delete Case"
        message={`Are you sure you want to delete case ${selectedCase?.number}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}

// Case Card Component
function CaseCard({ 
  caseItem, 
  onView, 
  onDragStart,
  isDragging 
}: { 
  caseItem: Case
  onView: () => void
  onDragStart: () => void
  isDragging: boolean
}) {
  const priority = priorityConfig[caseItem.priority]

  return (
    <div 
      draggable
      onDragStart={onDragStart}
      onClick={onView}
      className={`bg-white rounded-xl p-3 shadow-sm border border-slate-200 hover:shadow-md transition-all cursor-pointer ${
        isDragging ? 'opacity-50 rotate-2' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-slate-400">{caseItem.number}</span>
        {caseItem.assignee && (
          <Avatar name={caseItem.assignee.name} size="xs" />
        )}
      </div>
      <h4 className="font-medium text-slate-800 text-sm mb-2 line-clamp-2">{caseItem.title}</h4>
      <div className="flex items-center gap-2 mb-3">
        <Avatar name={caseItem.company} size="xs" />
        <span className="text-xs text-slate-500 truncate">{caseItem.company}</span>
        {(caseItem.priority === 'high' || caseItem.priority === 'critical') && (
          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
        )}
        <span className="text-xs text-slate-400 ml-auto">{caseItem.time}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${priority.color}`}>
          {priority.label}
        </span>
        <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
          {caseItem.category}
        </span>
        {caseItem.comments.length > 0 && (
          <div className="flex items-center gap-1 ml-auto text-slate-400">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="text-xs">{caseItem.comments.length}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// New Case Form Component
function NewCaseForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    company: '',
    companyAvatar: '',
    contactName: '',
    contactEmail: '',
    priority: 'medium' as CasePriority,
    category: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      ...formData,
      companyAvatar: formData.company.charAt(0).toUpperCase(),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Brief description of the issue"
          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Detailed description of the issue..."
          rows={3}
          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Company *</label>
          <input
            type="text"
            value={formData.company}
            onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
            placeholder="Customer company"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            required
          >
            <option value="">Select category</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name</label>
          <input
            type="text"
            value={formData.contactName}
            onChange={(e) => setFormData(prev => ({ ...prev, contactName: e.target.value }))}
            placeholder="Contact person"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Contact Email</label>
          <input
            type="email"
            value={formData.contactEmail}
            onChange={(e) => setFormData(prev => ({ ...prev, contactEmail: e.target.value }))}
            placeholder="email@company.com"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
        <div className="flex gap-2">
          {(Object.keys(priorityConfig) as CasePriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, priority: p }))}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                formData.priority === p
                  ? priorityConfig[p].color
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {priorityConfig[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
        <button type="button" onClick={onClose} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">
          Cancel
        </button>
        <button type="submit" className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">
          Create Case
        </button>
      </div>
    </form>
  )
}
