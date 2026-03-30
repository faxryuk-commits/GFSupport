import { getAgentLevel, type AgentLevel } from '@/entities/agent'

export interface DisplayAgent {
  id: string
  name: string
  role: string
  status: 'online' | 'offline'
  avatar: string
  email?: string
  username?: string
  lastSeenAt?: string
  createdAt?: string
  cases: number
  sla: number
  avgTime: string
  messagesHandled: number
  level: { name: string; icon: string; progress: number; current: number; max: number }
}

export { getAgentLevel }

export function mapPointsToLevel(points: number) {
  const lvl = getAgentLevel(points)
  const max = lvl.nextLevel?.minPoints || lvl.minPoints + 1000
  return { name: lvl.name, icon: lvl.icon, progress: lvl.progress, current: points, max }
}

export function AgentCard({
  agent, onViewProfile, onEdit, onDeactivate,
}: {
  agent: DisplayAgent
  onViewProfile: () => void
  onEdit?: () => void
  onDeactivate?: () => void
}) {
  return (
    <div className={`bg-white rounded-xl p-5 border-2 ${
      agent.status === 'online' ? 'border-green-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start gap-4">
        <div className="relative">
          <img
            src={agent.avatar}
            alt={agent.name}
            className="w-16 h-16 rounded-full object-cover bg-slate-100"
          />
          <span className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
            agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
          }`} />
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">{agent.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${
                  agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
                }`} />
                <span className="text-sm text-slate-500">
                  {agent.status === 'online' ? 'В сети' : 'Не в сети'}
                </span>
              </div>
            </div>
            <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {agent.role}
            </span>
          </div>

          <div className="flex gap-6 mt-4">
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.cases}</span>
              <p className="text-xs text-slate-500">обращений</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.sla}%</span>
              <p className="text-xs text-slate-500">SLA</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.avgTime}</span>
              <p className="text-xs text-slate-500">сред.</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span>{agent.level.icon}</span>
              <span className="text-sm font-medium text-slate-700">{agent.level.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-2 bg-slate-100 rounded-full">
                <div
                  className="h-2 bg-blue-500 rounded-full"
                  style={{ width: `${agent.level.progress}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">
                {agent.level.current}/{agent.level.max} XP
              </span>
            </div>
          </div>

          <div className="flex gap-4 mt-3">
            <button
              onClick={onViewProfile}
              className="text-blue-500 text-sm font-medium hover:underline"
            >
              Профиль
            </button>
            {onEdit && (
              <button
                onClick={onEdit}
                className="text-slate-500 text-sm font-medium hover:underline hover:text-slate-700"
              >
                Редактировать
              </button>
            )}
            {onDeactivate && (
              <button
                onClick={onDeactivate}
                className="text-red-400 text-sm font-medium hover:underline hover:text-red-600"
              >
                Деактивировать
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
