import { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { AgentRow } from './AgentRow'
import type { Agent } from '@/entities/agent'

export type SortField = 'name' | 'role' | 'status' | 'messages' | 'response' | 'points'
type SortDir = 'asc' | 'desc'

const COLUMNS: { field: SortField; label: string; className?: string }[] = [
  { field: 'name', label: 'Сотрудник' },
  { field: 'role', label: 'Роль' },
  { field: 'status', label: 'Статус' },
  { field: 'messages', label: 'Сообщения', className: 'text-right' },
  { field: 'response', label: 'Ответ', className: 'text-right' },
  { field: 'points', label: 'Уровень', className: 'text-right' },
]

function sortAgents(agents: Agent[], field: SortField, dir: SortDir): Agent[] {
  const m = dir === 'asc' ? 1 : -1
  return [...agents].sort((a, b) => {
    switch (field) {
      case 'name': return m * a.name.localeCompare(b.name)
      case 'role': return m * (a.role || '').localeCompare(b.role || '')
      case 'status': {
        const ord = { online: 0, away: 1, offline: 2 }
        return m * ((ord[a.status || 'offline'] || 2) - (ord[b.status || 'offline'] || 2))
      }
      case 'messages': return m * ((a.metrics?.messagesHandled || 0) - (b.metrics?.messagesHandled || 0))
      case 'response': return m * ((a.metrics?.avgFirstResponseMin || 0) - (b.metrics?.avgFirstResponseMin || 0))
      case 'points': return m * ((a.points || 0) - (b.points || 0))
      default: return 0
    }
  })
}

interface AgentTableProps {
  agents: Agent[]
  selectedId?: string
  onSelect: (agent: Agent) => void
  onEdit: (agent: Agent) => void
  onDeactivate: (agent: Agent) => void
}

export function AgentTable({ agents, selectedId, onSelect, onEdit, onDeactivate }: AgentTableProps) {
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = sortAgents(agents, sortField, sortDir)

  if (agents.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-500">Нет агентов по выбранным фильтрам</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            {COLUMNS.map(col => (
              <th
                key={col.field}
                onClick={() => handleSort(col.field)}
                className={`px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none ${col.className || ''}`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortField === col.field && (
                    sortDir === 'asc'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {sorted.map(agent => (
            <AgentRow
              key={agent.id}
              agent={agent}
              isSelected={agent.id === selectedId}
              onClick={() => onSelect(agent)}
              onEdit={() => onEdit(agent)}
              onDeactivate={() => onDeactivate(agent)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
