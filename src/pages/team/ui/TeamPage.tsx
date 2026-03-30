import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { fetchAgents } from '@/shared/api'
import { apiDelete } from '@/shared/services/api.service'
import type { Agent } from '@/entities/agent'
import { TeamHeader } from './TeamHeader'
import { AgentTable } from './AgentTable'
import { AgentDetailPanel } from './AgentDetailPanel'
import { AgentEditModal } from './AgentEditModal'
import { InviteModal } from './InviteModal'
import { ConfirmDialog } from '@/shared/ui'

interface TeamPageProps {
  embedded?: boolean
}

export function TeamPage({ embedded = false }: TeamPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deactivateAgent, setDeactivateAgent] = useState<Agent | null>(null)

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
      if (selectedAgent?.id === deactivateAgent.id) {
        setPanelOpen(false)
        setSelectedAgent(null)
      }
      loadAgents()
    } catch {
      alert('Ошибка деактивации')
    }
  }

  const filtered = useMemo(() => {
    let list = agents
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.username || '').toLowerCase().includes(q)
      )
    }
    if (roleFilter) list = list.filter(a => a.role === roleFilter)
    if (statusFilter) list = list.filter(a => (a.status || 'offline') === statusFilter)
    return list
  }, [agents, search, roleFilter, statusFilter])

  const onlineCount = agents.filter(a => a.status === 'online').length
  const avgResponseMinutes = agents.length > 0
    ? agents.reduce((sum, a) => sum + (a.metrics?.avgFirstResponseMin || 0), 0) / agents.length
    : 0
  const avgResponse = avgResponseMinutes > 0 ? `${Math.round(avgResponseMinutes)}м` : '—'
  const totalCases = agents.reduce((sum, a) => sum + (a.metrics?.resolvedConversations || 0), 0)

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
    <div className="p-6 space-y-4">
      <TeamHeader
        total={agents.length}
        onlineCount={onlineCount}
        avgResponse={avgResponse}
        totalCases={totalCases}
        search={search}
        onSearchChange={setSearch}
        roleFilter={roleFilter}
        onRoleChange={setRoleFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onInvite={() => setInviteOpen(true)}
        embedded={embedded}
      />

      <AgentTable
        agents={filtered}
        selectedId={selectedAgent?.id}
        onSelect={agent => {
          setSelectedAgent(agent)
          setPanelOpen(true)
        }}
        onEdit={setEditingAgent}
        onDeactivate={setDeactivateAgent}
      />

      <AgentDetailPanel
        agent={selectedAgent}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onEdit={agent => { setPanelOpen(false); setEditingAgent(agent) }}
        onDeactivate={agent => { setPanelOpen(false); setDeactivateAgent(agent) }}
      />

      <InviteModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />

      <AgentEditModal
        agent={editingAgent}
        onClose={() => setEditingAgent(null)}
        onSaved={loadAgents}
      />

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
