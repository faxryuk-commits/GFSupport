import { Pencil, UserX } from 'lucide-react'
import { getAgentLevel, AGENT_ROLE_CONFIG } from '@/entities/agent'
import type { Agent, AgentStatus } from '@/entities/agent'

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
]

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  online: { dot: 'bg-green-500', label: 'Онлайн' },
  away: { dot: 'bg-amber-400', label: 'Отошёл' },
  offline: { dot: 'bg-slate-300', label: 'Офлайн' },
}

interface AgentRowProps {
  agent: Agent
  /** Среднее FRT за период из SLA-отчёта (первый ответ после сообщения клиента). */
  frt: { avgMinutes: number; totalResponses: number } | null
  isSelected: boolean
  onClick: () => void
  onEdit: () => void
  onDeactivate: () => void
}

export function AgentRow({ agent, frt, isSelected, onClick, onEdit, onDeactivate }: AgentRowProps) {
  const status = STATUS_CONFIG[agent.status || 'offline'] || STATUS_CONFIG.offline
  const role = AGENT_ROLE_CONFIG[agent.role] || AGENT_ROLE_CONFIG.agent
  const level = getAgentLevel(agent.points || 0)
  const color = AVATAR_COLORS[hashName(agent.name) % AVATAR_COLORS.length]
  const msgs = agent.metrics?.messagesHandled || 0
  const respLabel = frt && frt.totalResponses > 0
    ? `${frt.avgMinutes % 1 === 0 ? Math.round(frt.avgMinutes) : frt.avgMinutes.toFixed(1)}м`
    : null

  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors ${
        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
      }`}
    >
      {/* Name + Avatar */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`relative w-8 h-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
            {getInitials(agent.name)}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${status.dot}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
            {agent.email && (
              <p className="text-xs text-slate-400 truncate">{agent.email}</p>
            )}
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${role.color}`}>
          {role.label}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </td>

      {/* Messages */}
      <td className="px-4 py-3 text-right">
        <span className="text-sm text-slate-700 tabular-nums">{msgs}</span>
      </td>

      {/* Response time */}
      <td className="px-4 py-3 text-right">
        <span className="text-sm text-slate-700 tabular-nums">
          {respLabel ?? '—'}
        </span>
      </td>

      {/* Level */}
      <td className="px-4 py-3 text-right">
        <span className="inline-flex items-center gap-1 text-xs text-slate-600">
          <span>{level.icon}</span>
          <span className="font-medium">{agent.points || 0}</span>
        </span>
      </td>

      {/* Actions */}
      <td className="px-2 py-3">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Редактировать"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDeactivate() }}
            className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
            title="Деактивировать"
          >
            <UserX className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}
