import { useState, useEffect } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { fetchAgents } from '@/shared/api'
import { apiDelete } from '@/shared/services/api.service'
import type { Agent } from '@/entities/agent'
import { AgentCard, mapPointsToLevel, type DisplayAgent } from './AgentCard'
import { AgentProfileModal } from './AgentProfileModal'
import { AgentEditModal } from './AgentEditModal'
import { InviteButton, InviteModal } from './InviteModal'
import { ConfirmDialog } from '@/shared/ui'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  agent: 'Агент поддержки',
}

function mapAgentToDisplay(agent: Agent): DisplayAgent {
  const points = agent.points || 0
  const avgResponseMin = agent.metrics?.avgFirstResponseMin || 0
  return {
    id: agent.id,
    name: agent.name,
    role: ROLE_LABELS[agent.role] || agent.role,
    status: agent.status === 'online' ? 'online' : 'offline',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${agent.email || agent.id}`,
    email: agent.email,
    username: agent.username,
    lastSeenAt: agent.lastSeenAt,
    createdAt: agent.createdAt,
    cases: agent.metrics?.resolvedConversations || 0,
    sla: agent.metrics?.satisfactionScore ? Math.round(Number(agent.metrics.satisfactionScore) * 100) : 0,
    avgTime: avgResponseMin > 0 ? `${Math.round(avgResponseMin)}м` : '—',
    messagesHandled: agent.metrics?.messagesHandled || 0,
    level: mapPointsToLevel(points),
  }
}

interface TeamPageProps {
  embedded?: boolean
}

export function TeamPage({ embedded = false }: TeamPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<DisplayAgent | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [deactivateAgent, setDeactivateAgent] = useState<DisplayAgent | null>(null)

  useEffect(() => { loadAgents() }, [])

  async function loadAgents() {
    try {
      setLoading(true)
      setError(null)
      setAgents(await fetchAgents())
    } catch {
      setError('Не удалось загрузить список команды')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivateAgent) return
    try {
      await apiDelete(`/agents?id=${deactivateAgent.id}`)
      setDeactivateAgent(null)
      loadAgents()
    } catch {
      alert('Ошибка деактивации')
    }
  }

  const displayAgents = agents.map(mapAgentToDisplay)
  const onlineCount = agents.filter(a => a.status === 'online').length
  const avgResponseMinutes = agents.length > 0
    ? agents.reduce((sum, a) => sum + (a.metrics?.avgFirstResponseMin || 0), 0) / agents.length
    : 0
  const avgResponse = avgResponseMinutes > 0 ? `${Math.round(avgResponseMinutes)}м` : '—'
  const totalCases = displayAgents.reduce((sum, a) => sum + a.cases, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-600">Загрузка команды...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <AlertCircle className="w-12 h-12 mb-3" />
        <p className="text-lg font-medium">{error}</p>
        <button onClick={loadAgents} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className={`flex items-center ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && <h1 className="text-2xl font-bold text-slate-800">Команда</h1>}
        <InviteButton onClick={() => setInviteOpen(true)} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard value={onlineCount} label="Онлайн сейчас" hasOnline />
        <MetricCard value={agents.length} label="Всего агентов" />
        <MetricCard value={avgResponse} label="Сред. ответ" />
        <MetricCard value={totalCases} label="Обращений" />
      </div>

      {/* Agents Grid */}
      {displayAgents.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg">Агенты не найдены</p>
          <p className="text-sm mt-1">Пригласите членов команды для начала работы</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {displayAgents.map(agent => {
            const full = agents.find(a => a.id === agent.id)
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                onViewProfile={() => { setSelectedAgent(agent); setProfileOpen(true) }}
                onEdit={() => full && setEditingAgent(full)}
                onDeactivate={() => setDeactivateAgent(agent)}
              />
            )
          })}
        </div>
      )}

      {/* Modals */}
      <InviteModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
      <AgentProfileModal agent={selectedAgent} isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      <AgentEditModal agent={editingAgent} onClose={() => setEditingAgent(null)} onSaved={loadAgents} />
      <ConfirmDialog
        isOpen={!!deactivateAgent}
        onClose={() => setDeactivateAgent(null)}
        onConfirm={handleDeactivate}
        title="Деактивировать сотрудника?"
        message={`${deactivateAgent?.name} будет удалён из команды. Это действие нельзя отменить.`}
        confirmText="Деактивировать"
        variant="danger"
      />
    </div>
  )
}

function MetricCard({ value, label, hasOnline }: { value: string | number; label: string; hasOnline?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold text-slate-800">{value}</span>
        {hasOnline && <span className="w-2 h-2 bg-green-500 rounded-full" />}
      </div>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  )
}
