import { MessageSquare, CheckCircle, Clock } from 'lucide-react'
import type { Agent } from '../model'
import { AGENT_ROLE_CONFIG, getAgentLevel, formatLastActive } from '../model'

interface AgentCardProps {
  agent: Agent
  onClick?: () => void
  showMetrics?: boolean
}

export function AgentCard({ agent, onClick, showMetrics = true }: AgentCardProps) {
  const roleConfig = AGENT_ROLE_CONFIG[agent.role]
  const level = agent.points ? getAgentLevel(agent.points) : null
  
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg p-4 border border-slate-200 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-medium text-lg">
            {agent.name.charAt(0).toUpperCase()}
          </div>
          {/* Status indicator */}
          <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${
            agent.status === 'online' ? 'bg-green-500' :
            agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-300'
          }`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-800 truncate">{agent.name}</h3>
            {level && (
              <span title={level.name}>{level.icon}</span>
            )}
          </div>
          
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs ${roleConfig.color}`}>
              {roleConfig.label}
            </span>
            {agent.username && (
              <span className="text-xs text-slate-400">@{agent.username}</span>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-1">
            {formatLastActive(agent.lastActiveAt)}
          </p>
        </div>
      </div>

      {/* Metrics */}
      {showMetrics && agent.metrics && (
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-600">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="font-medium">{agent.metrics.messagesHandled}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Сообщений</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-600">
              <CheckCircle className="w-3.5 h-3.5" />
              <span className="font-medium">{agent.metrics.resolvedConversations}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Решено</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-600">
              <Clock className="w-3.5 h-3.5" />
              <span className="font-medium">{agent.metrics.avgFirstResponseMin}м</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Ответ</p>
          </div>
        </div>
      )}

      {/* Level progress */}
      {level && level.nextLevel && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-500">{level.name}</span>
            <span className="text-slate-400">{agent.points} / {level.nextLevel.minPoints}</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all"
              style={{ width: `${level.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
