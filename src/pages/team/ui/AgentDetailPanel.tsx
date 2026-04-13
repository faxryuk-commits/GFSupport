import { X, Mail, Phone, MessageSquare, Clock, Star, Trophy, Pencil, UserX } from 'lucide-react'
import { getAgentLevel, formatLastActive, AGENT_ROLE_CONFIG } from '@/entities/agent'
import type { Agent } from '@/entities/agent'

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

const STATUS_MAP: Record<string, { dot: string; label: string }> = {
  online: { dot: 'bg-green-500', label: 'Онлайн' },
  away: { dot: 'bg-amber-400', label: 'Отошёл' },
  offline: { dot: 'bg-slate-300', label: 'Офлайн' },
}

interface AgentDetailPanelProps {
  agent: Agent | null
  /** FRT за выбранный период (SLA-отчёт), если были ответы. */
  frt: { avgMinutes: number; totalResponses: number } | null
  frtPeriodLabel: string
  isOpen: boolean
  onClose: () => void
  onEdit: (agent: Agent) => void
  onDeactivate: (agent: Agent) => void
}

export function AgentDetailPanel({
  agent, frt, frtPeriodLabel, isOpen, onClose, onEdit, onDeactivate,
}: AgentDetailPanelProps) {
  if (!agent) return null

  const status = STATUS_MAP[agent.status || 'offline'] || STATUS_MAP.offline
  const role = AGENT_ROLE_CONFIG[agent.role] || AGENT_ROLE_CONFIG.agent
  const level = getAgentLevel(agent.points || 0)
  const color = AVATAR_COLORS[hashName(agent.name) % AVATAR_COLORS.length]
  const m = agent.metrics

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/10 z-40" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] bg-white border-l border-slate-200 shadow-xl z-50 transform transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-full overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between z-10">
            <h3 className="text-sm font-semibold text-slate-700">Профиль агента</h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Profile */}
          <div className="px-5 pt-6 pb-4 text-center border-b border-slate-100">
            <div className={`mx-auto w-16 h-16 rounded-full ${color} flex items-center justify-center text-white text-xl font-semibold relative`}>
              {getInitials(agent.name)}
              <span className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-white ${status.dot}`} />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-800">{agent.name}</h2>
            <div className="mt-1 flex items-center justify-center gap-2 text-sm">
              <span className={`font-medium ${role.color}`}>{role.label}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">{status.label}</span>
            </div>
            {agent.lastActiveAt && (
              <p className="mt-1 text-xs text-slate-400">
                Последняя активность: {formatLastActive(agent.lastActiveAt)}
              </p>
            )}
          </div>

          {/* Contact info */}
          <div className="px-5 py-4 border-b border-slate-100 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Контакты</h4>
            {agent.email && (
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">{agent.email}</span>
              </div>
            )}
            {agent.phone && (
              <div className="flex items-center gap-2.5 text-sm">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">{agent.phone}</span>
              </div>
            )}
            {agent.position && (
              <div className="flex items-center gap-2.5 text-sm">
                <Trophy className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">{agent.position}</span>
              </div>
            )}
            {!agent.email && !agent.phone && !agent.position && (
              <p className="text-xs text-slate-400">Контактные данные не заполнены</p>
            )}
          </div>

          {/* Metrics */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Метрики</h4>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<MessageSquare className="w-4 h-4" />}
                label="Сообщения"
                value={String(m?.messagesHandled || 0)}
              />
              <MetricCard
                icon={<Clock className="w-4 h-4" />}
                label={`Ср. FRT (${frtPeriodLabel})`}
                value={
                  frt && frt.totalResponses > 0
                    ? `${frt.avgMinutes % 1 === 0 ? Math.round(frt.avgMinutes) : frt.avgMinutes.toFixed(1)}м`
                    : '—'
                }
              />
              <MetricCard
                icon={<Star className="w-4 h-4" />}
                label="Оценка"
                value={m?.satisfactionScore ? `${(m.satisfactionScore * 100).toFixed(0)}%` : '—'}
              />
              <MetricCard
                icon={<Trophy className="w-4 h-4" />}
                label="Решено"
                value={String(m?.resolvedConversations || 0)}
              />
            </div>
          </div>

          {/* Level */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Уровень</h4>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{level.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">{level.name}</p>
                <p className="text-xs text-slate-400">{agent.points || 0} XP</p>
                <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${level.progress}%` }}
                  />
                </div>
                {level.nextLevel && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    До {level.nextLevel.icon} {level.nextLevel.name}: {level.nextLevel.minPoints - (agent.points || 0)} XP
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="px-5 py-4 space-y-2">
            <button
              onClick={() => onEdit(agent)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Редактировать
            </button>
            <button
              onClick={() => onDeactivate(agent)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50/50 rounded-lg hover:bg-red-50 transition-colors"
            >
              <UserX className="w-4 h-4" />
              Деактивировать
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  )
}
