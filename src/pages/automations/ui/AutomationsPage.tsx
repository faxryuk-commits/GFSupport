import { useState } from 'react'
import { Plus, Zap, Play, Pause, Edit, Trash2, Clock, MessageSquare, Users, AlertTriangle, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'

interface Automation {
  id: string
  name: string
  description: string
  trigger: string
  action: string
  isActive: boolean
  runsCount: number
  lastRun?: string
  createdAt: string
}

const triggerIcons: Record<string, typeof MessageSquare> = {
  'new_message': MessageSquare,
  'new_case': AlertTriangle,
  'user_inactive': Clock,
  'vip_contact': Users,
}

const mockAutomations: Automation[] = [
  { 
    id: '1', 
    name: 'Auto-assign VIP cases', 
    description: 'Automatically assign cases from VIP customers to senior agents',
    trigger: 'vip_contact',
    action: 'Assign to Senior Agent queue',
    isActive: true,
    runsCount: 156,
    lastRun: '5 min ago',
    createdAt: 'Jan 10, 2024'
  },
  { 
    id: '2', 
    name: 'Welcome message', 
    description: 'Send welcome message to new users when they first contact support',
    trigger: 'new_message',
    action: 'Send template: welcome_message',
    isActive: true,
    runsCount: 1240,
    lastRun: '2 min ago',
    createdAt: 'Dec 15, 2023'
  },
  { 
    id: '3', 
    name: 'Escalate urgent cases', 
    description: 'Escalate cases marked as urgent if not responded within 10 minutes',
    trigger: 'new_case',
    action: 'Notify team lead + change priority',
    isActive: true,
    runsCount: 45,
    lastRun: '1 hour ago',
    createdAt: 'Feb 1, 2024'
  },
  { 
    id: '4', 
    name: 'Follow-up reminder', 
    description: 'Send reminder to agent if case is waiting for response > 24h',
    trigger: 'user_inactive',
    action: 'Send notification to assigned agent',
    isActive: false,
    runsCount: 89,
    lastRun: '3 days ago',
    createdAt: 'Jan 25, 2024'
  },
  { 
    id: '5', 
    name: 'Auto-close resolved', 
    description: 'Automatically close cases marked as resolved after 48 hours',
    trigger: 'new_case',
    action: 'Change status to Closed',
    isActive: true,
    runsCount: 320,
    lastRun: '30 min ago',
    createdAt: 'Nov 20, 2023'
  },
]

export function AutomationsPage() {
  const [automations, setAutomations] = useState(mockAutomations)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const toggleAutomation = (id: string) => {
    setAutomations(prev => prev.map(a => 
      a.id === id ? { ...a, isActive: !a.isActive } : a
    ))
  }

  const activeCount = automations.filter(a => a.isActive).length
  const totalRuns = automations.reduce((sum, a) => sum + a.runsCount, 0)

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Automations</h1>
            <p className="text-slate-500 mt-1">Automate repetitive tasks and workflows</p>
          </div>
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Automation
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Zap className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{automations.length}</p>
                <p className="text-sm text-slate-500">Total Automations</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Play className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{activeCount}</p>
                <p className="text-sm text-slate-500">Active</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <Pause className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{automations.length - activeCount}</p>
                <p className="text-sm text-slate-500">Paused</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalRuns.toLocaleString()}</p>
                <p className="text-sm text-slate-500">Total Runs</p>
              </div>
            </div>
          </div>
        </div>

        {/* Automations List */}
        <div className="space-y-4">
          {automations.map(automation => {
            const TriggerIcon = triggerIcons[automation.trigger] || Zap
            
            return (
              <div 
                key={automation.id}
                className={`bg-white rounded-xl p-5 border-2 transition-colors ${
                  automation.isActive ? 'border-green-200' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      automation.isActive ? 'bg-green-100' : 'bg-slate-100'
                    }`}>
                      <TriggerIcon className={`w-6 h-6 ${
                        automation.isActive ? 'text-green-600' : 'text-slate-400'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-slate-800">{automation.name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          automation.isActive 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {automation.isActive ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{automation.description}</p>
                      
                      {/* Workflow */}
                      <div className="flex items-center gap-3 mt-3 text-sm">
                        <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
                          When: {automation.trigger.replace('_', ' ')}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                        <span className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg">
                          Then: {automation.action}
                        </span>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                        <span>{automation.runsCount} runs</span>
                        {automation.lastRun && <span>Last run: {automation.lastRun}</span>}
                        <span>Created: {automation.createdAt}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAutomation(automation.id)}
                      className={`p-2 rounded-lg transition-colors ${
                        automation.isActive 
                          ? 'text-green-600 hover:bg-green-50' 
                          : 'text-slate-400 hover:bg-slate-100'
                      }`}
                    >
                      {automation.isActive 
                        ? <ToggleRight className="w-6 h-6" />
                        : <ToggleLeft className="w-6 h-6" />
                      }
                    </button>
                    <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                      <Edit className="w-4 h-4 text-slate-500" />
                    </button>
                    <button 
                      onClick={() => { setSelectedAutomation(automation); setIsDeleteDialogOpen(true) }}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create Automation" size="lg">
        <form className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              placeholder="e.g., Auto-assign VIP cases"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              placeholder="Describe what this automation does..."
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Trigger (When)</label>
              <select className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                <option value="">Select trigger...</option>
                <option value="new_message">New message received</option>
                <option value="new_case">New case created</option>
                <option value="vip_contact">VIP customer contact</option>
                <option value="user_inactive">User inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Action (Then)</label>
              <select className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                <option value="">Select action...</option>
                <option value="assign">Assign to agent/queue</option>
                <option value="send_message">Send message</option>
                <option value="change_priority">Change priority</option>
                <option value="notify">Send notification</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">Cancel</button>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">Create Automation</button>
          </div>
        </form>
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => { 
          setAutomations(prev => prev.filter(a => a.id !== selectedAutomation?.id))
          setIsDeleteDialogOpen(false)
          setSelectedAutomation(null) 
        }}
        title="Delete Automation"
        message={`Are you sure you want to delete "${selectedAutomation?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}
