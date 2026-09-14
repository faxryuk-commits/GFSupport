import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle, UserCheck } from 'lucide-react'
import { fetchAgents, updateAgent, fetchTeamFrt, type TeamFrtPayload } from '@/shared/api'
import { apiDelete, invalidateCache } from '@/shared/services/api.service'
import type { Agent } from '@/entities/agent'
import { TeamHeader } from './TeamHeader'
import { AgentTable } from './AgentTable'
import { WorkloadTable } from '@/features/analytics'
import { AgentDetailPanel } from './AgentDetailPanel'
import { AgentEditModal } from './AgentEditModal'
import { InviteModal } from './InviteModal'
import { DuplicatesBanner } from './DuplicatesBanner'
import { ShadowAgentsBanner } from './ShadowAgentsBanner'
import { ConfirmDialog, alertDialog } from '@/shared/ui'
import { matchSlaAgentFrt } from '../model/matchSlaFrt'

interface TeamPageProps {
  embedded?: boolean
}

function defaultDateRange() {
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  return {
    from: weekAgo.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0],
  }
}

export function TeamPage({ embedded = false }: TeamPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [{ from: frtFrom, to: frtTo }, setFrtRange] = useState(defaultDateRange)
  const [frtSource, setFrtSource] = useState<'all' | 'telegram' | 'whatsapp'>('all')
  const [teamFrt, setTeamFrt] = useState<TeamFrtPayload | null>(null)
  const [frtLoading, setFrtLoading] = useState(true)
  const [frtError, setFrtError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deactivateAgent, setDeactivateAgent] = useState<Agent | null>(null)

  useEffect(() => { loadAgents() }, [])

  useEffect(() => {
    let cancelled = false
    async function loadFrt() {
      setFrtLoading(true)
      setFrtError(null)
      try {
        const data = await fetchTeamFrt({
          from: frtFrom,
          to: frtTo,
          source: frtSource,
        })
        if (!cancelled) setTeamFrt(data)
      } catch {
        if (!cancelled) {
          setTeamFrt(null)
          setFrtError('Не удалось загрузить FRT')
        }
      } finally {
        if (!cancelled) setFrtLoading(false)
      }
    }
    loadFrt()
    return () => { cancelled = true }
  }, [frtFrom, frtTo, frtSource])

  async function loadAgents() {
    try {
      setLoading(true)
      setError(null)
      // Команде нужны и отключённые: их видно отдельным блоком, оттуда возвращают
      setAgents(await fetchAgents(true))
    } catch {
      setError('Не удалось загрузить список команды')
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore(agent: Agent) {
    try {
      await updateAgent(agent.id, { isActive: true })
      loadAgents()
    } catch {
      void alertDialog('Не удалось вернуть сотрудника')
    }
  }

  async function handleDeactivate() {
    if (!deactivateAgent) return
    try {
      await apiDelete(`/agents?id=${deactivateAgent.id}`)
      // Иначе перезагрузка списка отдаст кэш с ещё «живым» сотрудником
      invalidateCache('/agents')
      setDeactivateAgent(null)
      if (selectedAgent?.id === deactivateAgent.id) {
        setPanelOpen(false)
        setSelectedAgent(null)
      }
      loadAgents()
    } catch {
      void alertDialog('Ошибка деактивации')
    }
  }

  // Действующие — в таблицу и метрики; уволенные — в блок «Отключённые».
  // Склеенные дубли не показываем нигде: ими занимается баннер дублей
  const roster = useMemo(() => agents.filter(a => a.isActive !== false && !a.mergedInto), [agents])
  const dismissed = useMemo(() => agents.filter(a => a.isActive === false && !a.mergedInto), [agents])

  const filtered = useMemo(() => {
    let list = roster
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
  }, [roster, search, roleFilter, statusFilter])

  const onlineCount = roster.filter(a => a.status === 'online').length

  const perf = teamFrt?.agentPerformance ?? []
  const teamAvgFrt = teamFrt?.responseTimeSummary?.avgResponseMinutes
  const avgResponse = frtLoading
    ? '…'
    : teamAvgFrt != null && teamAvgFrt > 0
      ? `${Math.round(teamAvgFrt)}м`
      : '—'

  const totalCases = roster.reduce((sum, a) => sum + (a.metrics?.resolvedConversations || 0), 0)

  const frtByAgentId = useMemo(() => {
    const m: Record<string, { avgMinutes: number; totalResponses: number }> = {}
    for (const a of roster) {
      const row = matchSlaAgentFrt(perf, a.name)
      if (row && row.totalResponses > 0) {
        m[a.id] = { avgMinutes: row.avgMinutes, totalResponses: row.totalResponses }
      }
    }
    return m
  }, [roster, perf])

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
        <button onClick={loadAgents} className="mt-4 px-4 py-2 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_3px_10px_rgba(37,99,235,0.22)] rounded-lg hover:brightness-[1.04] hover:shadow-[0_5px_16px_rgba(37,99,235,0.34)] transition-all">
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <DuplicatesBanner onMerged={loadAgents} />
      <ShadowAgentsBanner onRestored={loadAgents} />

      <TeamHeader
        total={roster.length}
        onlineCount={onlineCount}
        avgResponse={avgResponse}
        totalCases={totalCases}
        frtFrom={frtFrom}
        frtTo={frtTo}
        frtSource={frtSource}
        onFrtFromChange={v => setFrtRange(r => ({ ...r, from: v }))}
        onFrtToChange={v => setFrtRange(r => ({ ...r, to: v }))}
        onFrtSourceChange={setFrtSource}
        frtError={frtError}
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
        frtByAgentId={frtByAgentId}
        selectedId={selectedAgent?.id}
        onSelect={agent => {
          setSelectedAgent(agent)
          setPanelOpen(true)
        }}
        onEdit={setEditingAgent}
        onDeactivate={setDeactivateAgent}
      />

      {/* Отключённые — свёрнуты и в самом низу ростера: в работе они не
          участвуют и в остальных списках системы не появляются, но отсюда
          сотрудника можно вернуть — вход снова откроется */}
      {dismissed.length > 0 && (
        <details className="bg-white border border-slate-200 rounded-xl">
          <summary className="px-4 py-3 text-sm text-slate-500 cursor-pointer select-none hover:text-slate-700">
            Отключённые ({dismissed.length}) — вход закрыт, в списках не участвуют
          </summary>
          <div className="border-t border-slate-100 divide-y divide-slate-50">
            {dismissed.map(a => (
              <div key={a.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-600 truncate">{a.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {[a.position, a.department].filter(Boolean).join(' · ') || a.username || a.email || ''}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(a)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Вернуть
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Загрузка — ПОСЛЕ ростера: вкладка Команда прежде всего про управление
          (роли, логины, приглашения); когда таблица загрузки стояла первой,
          владелец решил, что настройки сотрудников исчезли. */}
      <WorkloadTable />

      <AgentDetailPanel
        agent={selectedAgent}
        frt={selectedAgent ? frtByAgentId[selectedAgent.id] ?? null : null}
        frtPeriodLabel={`${frtFrom} — ${frtTo}`}
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
        message={`${deactivateAgent?.name} потеряет вход в систему и исчезнет из всех списков. Вернуть можно из блока «Отключённые» внизу.`}
        confirmText="Деактивировать"
        variant="danger"
      />
    </div>
  )
}
