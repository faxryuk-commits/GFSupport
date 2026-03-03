import { Link } from 'react-router-dom'
import {
  Clock, AlertTriangle, ChevronRight, Users, ArrowUpRight, Shield,
} from 'lucide-react'
import { Avatar, Badge, EmptyState } from '@/shared/ui'
import type { Agent } from '@/entities/agent'
import type { AttentionItem } from '../model/types'

interface Props {
  needsAttention: AttentionItem[]
  agents: Agent[]
}

const priorityColors = {
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
  high: 'bg-orange-50 text-orange-600 border-orange-200',
  urgent: 'bg-red-50 text-red-600 border-red-200 animate-pulse',
}

const statusColors: Record<string, string> = {
  online: 'bg-green-500',
  away: 'bg-amber-500',
  busy: 'bg-red-500',
  offline: 'bg-slate-300',
}

function getOnlineTime(agent: Agent): string | null {
  if (agent.status !== 'online' && agent.status !== 'away') return null
  if (!agent.lastActiveAt) return 'Только что'
  const diff = Date.now() - new Date(agent.lastActiveAt).getTime()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (hours > 0) return `${hours}ч ${minutes}м онлайн`
  if (minutes > 0) return `${minutes}м онлайн`
  return 'Только что'
}

export function OperationsSection({ needsAttention, agents }: Props) {
  const onlineAgents = agents.filter(a => a.status === 'online' || a.status === 'away')

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-600">Операционная деятельность</h3>
          <span className="text-xs text-slate-400">• Текущие задачи и команда</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Needs Attention */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <h2 className="font-semibold text-slate-800">Требует внимания</h2>
              <span className="text-xs text-slate-400 ml-2">Диалоги ожидающие ответа</span>
              <Badge variant="warning" size="sm">{needsAttention.length}</Badge>
            </div>
            <Link to="/chats" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              Все <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {needsAttention.length === 0 ? (
              <EmptyState title="Всё обработано!" description="Нет диалогов, требующих внимания" size="sm" />
            ) : (
              needsAttention.map(item => (
                <Link key={item.id} to={`/chats/${item.id}`}
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors border-l-4 ${
                    item.priority === 'urgent' ? 'border-l-red-500 bg-red-50/30' :
                    item.priority === 'high' ? 'border-l-orange-500' : 'border-l-transparent'
                  }`}>
                  <Avatar name={item.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{item.name}</span>
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${priorityColors[item.priority]}`}>
                        <Clock className="w-3 h-3" />{item.waitTime}
                      </span>
                      {item.priority === 'urgent' && <Badge variant="danger" size="sm">СРОЧНО</Badge>}
                    </div>
                    <p className="text-sm text-slate-600 truncate mt-0.5">{item.issue}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Team Status */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Команда</h2>
            </div>
            <Link to="/team" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
              Все <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <EmptyState title="Нет агентов" description="Добавьте агентов в команду" size="sm" />
            ) : (
              [...agents]
                .sort((a, b) => {
                  const order = { online: 0, away: 1, offline: 2 }
                  return (order[a.status || 'offline'] || 2) - (order[b.status || 'offline'] || 2)
                })
                .slice(0, 15)
                .map(agent => {
                  const onlineTime = getOnlineTime(agent)
                  return (
                    <div key={agent.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                      <div className="relative">
                        <Avatar name={agent.name} size="sm" />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusColors[agent.status || 'offline']}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                        <p className="text-xs text-slate-500">
                          {onlineTime || (agent.status === 'offline' ? 'Офлайн' : agent.status || 'Офлайн')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <div className="text-center" title="Отвечено сообщений">
                          <p className="font-semibold text-blue-600">{agent.metrics?.messagesHandled || 0}</p>
                          <p className="text-slate-400">сообщ.</p>
                        </div>
                        <div className="text-center" title="Закрыто тикетов">
                          <p className="font-semibold text-green-600">{agent.metrics?.resolvedConversations || 0}</p>
                          <p className="text-slate-400">закрыто</p>
                        </div>
                        <div className="text-center" title="Тикетов в процессе">
                          <p className="font-semibold text-orange-500">{agent.activeChats || 0}</p>
                          <p className="text-slate-400">в работе</p>
                        </div>
                      </div>
                    </div>
                  )
                })
            )}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Онлайн сейчас:</span>
              <span className="font-semibold text-green-600">{onlineAgents.length} из {agents.length}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
