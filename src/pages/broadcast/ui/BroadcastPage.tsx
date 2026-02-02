import { useState } from 'react'
import { Plus, Send, Clock, Users, CheckCircle, XCircle, Eye, Edit, Trash2, Calendar } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'

interface Broadcast {
  id: string
  name: string
  message: string
  audience: string
  audienceCount: number
  status: 'draft' | 'scheduled' | 'sent' | 'failed'
  sentCount?: number
  deliveredCount?: number
  scheduledAt?: string
  sentAt?: string
  createdAt: string
}

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-slate-100 text-slate-600', icon: Edit },
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700', icon: Clock },
  sent: { label: 'Sent', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
}

const mockBroadcasts: Broadcast[] = [
  { 
    id: '1', 
    name: 'New Feature Announcement', 
    message: 'We are excited to announce our new AI-powered support features! Check it out now.',
    audience: 'All Customers',
    audienceCount: 1250,
    status: 'sent',
    sentCount: 1250,
    deliveredCount: 1198,
    sentAt: 'Jan 15, 2024 10:30 AM',
    createdAt: 'Jan 14, 2024'
  },
  { 
    id: '2', 
    name: 'Maintenance Notice', 
    message: 'Scheduled maintenance on Feb 1st from 2-4 AM EST. Services may be temporarily unavailable.',
    audience: 'Active Users',
    audienceCount: 890,
    status: 'scheduled',
    scheduledAt: 'Feb 1, 2024 12:00 AM',
    createdAt: 'Jan 28, 2024'
  },
  { 
    id: '3', 
    name: 'VIP Exclusive Offer', 
    message: 'As a valued VIP customer, you get exclusive early access to our premium features.',
    audience: 'VIP Customers',
    audienceCount: 156,
    status: 'sent',
    sentCount: 156,
    deliveredCount: 156,
    sentAt: 'Jan 10, 2024 3:00 PM',
    createdAt: 'Jan 10, 2024'
  },
  { 
    id: '4', 
    name: 'Survey Request', 
    message: 'Help us improve! Take our 2-minute survey and get 10% off your next purchase.',
    audience: 'Recent Customers',
    audienceCount: 450,
    status: 'draft',
    createdAt: 'Jan 29, 2024'
  },
  { 
    id: '5', 
    name: 'Holiday Greetings', 
    message: 'Happy holidays from our team! Wishing you joy and success in the new year.',
    audience: 'All Customers',
    audienceCount: 1250,
    status: 'failed',
    sentCount: 1250,
    deliveredCount: 0,
    sentAt: 'Dec 25, 2023',
    createdAt: 'Dec 24, 2023'
  },
]

export function BroadcastPage() {
  const [broadcasts, setBroadcasts] = useState(mockBroadcasts)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filteredBroadcasts = statusFilter === 'all' 
    ? broadcasts 
    : broadcasts.filter(b => b.status === statusFilter)

  const totalSent = broadcasts.filter(b => b.status === 'sent').reduce((sum, b) => sum + (b.sentCount || 0), 0)
  const totalDelivered = broadcasts.filter(b => b.status === 'sent').reduce((sum, b) => sum + (b.deliveredCount || 0), 0)

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Broadcast</h1>
            <p className="text-slate-500 mt-1">Send messages to multiple users at once</p>
          </div>
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Broadcast
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Send className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{broadcasts.length}</p>
                <p className="text-sm text-slate-500">Total Broadcasts</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalSent.toLocaleString()}</p>
                <p className="text-sm text-slate-500">Messages Sent</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalDelivered.toLocaleString()}</p>
                <p className="text-sm text-slate-500">Delivered</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{broadcasts.filter(b => b.status === 'scheduled').length}</p>
                <p className="text-sm text-slate-500">Scheduled</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {['all', 'draft', 'scheduled', 'sent', 'failed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              {status === 'all' ? 'All' : statusConfig[status as keyof typeof statusConfig]?.label}
            </button>
          ))}
        </div>

        {/* Broadcasts List */}
        <div className="space-y-4">
          {filteredBroadcasts.map(broadcast => {
            const config = statusConfig[broadcast.status]
            const StatusIcon = config.icon
            
            return (
              <div 
                key={broadcast.id}
                className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-slate-800">{broadcast.name}</h3>
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {config.label}
                      </span>
                    </div>
                    
                    <p className="text-sm text-slate-600 line-clamp-2 mb-3">{broadcast.message}</p>
                    
                    <div className="flex items-center gap-6 text-sm text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        <span>{broadcast.audience} ({broadcast.audienceCount})</span>
                      </div>
                      {broadcast.scheduledAt && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" />
                          <span>Scheduled: {broadcast.scheduledAt}</span>
                        </div>
                      )}
                      {broadcast.sentAt && (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4" />
                          <span>Sent: {broadcast.sentAt}</span>
                        </div>
                      )}
                      {broadcast.status === 'sent' && (
                        <span className="text-green-600">
                          {broadcast.deliveredCount}/{broadcast.sentCount} delivered
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    <button 
                      onClick={() => { setSelectedBroadcast(broadcast); setIsViewModalOpen(true) }}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                    </button>
                    {broadcast.status === 'draft' && (
                      <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                        <Edit className="w-4 h-4 text-slate-500" />
                      </button>
                    )}
                    <button 
                      onClick={() => { setSelectedBroadcast(broadcast); setIsDeleteDialogOpen(true) }}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                    {broadcast.status === 'draft' && (
                      <button className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors">
                        Send Now
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="New Broadcast" size="lg">
        <form className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              placeholder="e.g., Feature Announcement"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
            <textarea
              placeholder="Write your message here..."
              rows={4}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Audience</label>
            <select className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="all">All Customers (1,250)</option>
              <option value="active">Active Users (890)</option>
              <option value="vip">VIP Customers (156)</option>
              <option value="recent">Recent Customers (450)</option>
              <option value="partners">Partners (45)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Schedule (optional)</label>
            <input
              type="datetime-local"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="text-xs text-slate-500 mt-1">Leave empty to save as draft</p>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">Cancel</button>
            <button type="button" className="px-6 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200">Save as Draft</button>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">Schedule</button>
          </div>
        </form>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Broadcast Details" size="md">
        {selectedBroadcast && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500">Name</p>
              <p className="font-medium text-slate-800">{selectedBroadcast.name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Message</p>
              <p className="text-slate-800">{selectedBroadcast.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500">Audience</p>
                <p className="font-medium text-slate-800">{selectedBroadcast.audience}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Recipients</p>
                <p className="font-medium text-slate-800">{selectedBroadcast.audienceCount}</p>
              </div>
            </div>
            {selectedBroadcast.status === 'sent' && (
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                <div>
                  <p className="text-sm text-slate-500">Sent</p>
                  <p className="font-medium text-slate-800">{selectedBroadcast.sentCount}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Delivered</p>
                  <p className="font-medium text-green-600">{selectedBroadcast.deliveredCount}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => { 
          setBroadcasts(prev => prev.filter(b => b.id !== selectedBroadcast?.id))
          setIsDeleteDialogOpen(false)
          setSelectedBroadcast(null) 
        }}
        title="Delete Broadcast"
        message={`Are you sure you want to delete "${selectedBroadcast?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}
