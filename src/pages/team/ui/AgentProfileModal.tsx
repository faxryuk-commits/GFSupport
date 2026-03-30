import { Mail, MessageCircle, Clock, Calendar } from 'lucide-react'
import { Modal } from '@/shared/ui'
import type { DisplayAgent } from './AgentCard'

export function AgentProfileModal({
  agent, isOpen, onClose,
}: {
  agent: DisplayAgent | null
  isOpen: boolean
  onClose: () => void
}) {
  if (!agent) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Профиль сотрудника">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <img
              src={agent.avatar}
              alt={agent.name}
              className="w-20 h-20 rounded-full object-cover bg-slate-100"
            />
            <span className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-white ${
              agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
            }`} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">{agent.name}</h3>
            <p className="text-slate-500">{agent.role}</p>
            <span className={`inline-flex items-center gap-1 text-sm mt-1 ${
              agent.status === 'online' ? 'text-green-600' : 'text-slate-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
              }`} />
              {agent.status === 'online' ? 'В сети' : 'Не в сети'}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-slate-700">Контакты</h4>
          {agent.email && (
            <div className="flex items-center gap-3 text-slate-600">
              <Mail className="w-4 h-4 text-slate-400" />
              <span>{agent.email}</span>
            </div>
          )}
          {agent.username && (
            <div className="flex items-center gap-3 text-slate-600">
              <MessageCircle className="w-4 h-4 text-slate-400" />
              <span>@{agent.username}</span>
            </div>
          )}
          {agent.lastSeenAt && (
            <div className="flex items-center gap-3 text-slate-600">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>В системе: {new Date(agent.lastSeenAt).toLocaleString('ru')}</span>
            </div>
          )}
          {agent.createdAt && (
            <div className="flex items-center gap-3 text-slate-600">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>В команде с {new Date(agent.createdAt).toLocaleDateString('ru')}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl">
          <div className="text-center">
            <span className="text-2xl font-bold text-slate-800">{agent.cases}</span>
            <p className="text-xs text-slate-500">Решено</p>
          </div>
          <div className="text-center">
            <span className="text-2xl font-bold text-slate-800">{agent.messagesHandled}</span>
            <p className="text-xs text-slate-500">Сообщений</p>
          </div>
          <div className="text-center">
            <span className="text-2xl font-bold text-slate-800">{agent.sla}%</span>
            <p className="text-xs text-slate-500">SLA</p>
          </div>
        </div>

        <div className="p-4 bg-blue-50 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{agent.level.icon}</span>
            <span className="font-medium text-blue-800">{agent.level.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 bg-blue-100 rounded-full">
              <div
                className="h-3 bg-blue-500 rounded-full transition-all"
                style={{ width: `${agent.level.progress}%` }}
              />
            </div>
            <span className="text-sm text-blue-600 font-medium">
              {agent.level.current}/{agent.level.max} XP
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
