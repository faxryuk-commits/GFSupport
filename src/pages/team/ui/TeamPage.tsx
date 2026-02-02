import { useState, useEffect } from 'react'
import { Plus, Loader2, AlertCircle } from 'lucide-react'
import { fetchAgents } from '@/shared/api'
import type { Agent } from '@/entities/agent'

interface DisplayAgent {
  id: string
  name: string
  role: string
  status: 'online' | 'offline'
  avatar: string
  cases: number
  sla: number
  avgTime: string
  level: { name: string; icon: string; progress: number; current: number; max: number }
}

function mapAgentToDisplay(agent: Agent): DisplayAgent {
  const points = agent.points || 0
  const level = Math.floor(points / 100) + 1
  const levelNames = ['Новичок', 'Начинающий', 'Опытный', 'Продвинутый', 'Эксперт', 'Мастер']
  const levelIcons = ['🌱', '📚', '🎯', '🚀', '⭐', '👑']
  const levelIndex = Math.min(level - 1, levelNames.length - 1)
  const currentLevelMin = (level - 1) * 100
  const nextLevelMax = level * 100
  const progress = ((points - currentLevelMin) / (nextLevelMax - currentLevelMin)) * 100

  const roleLabels: Record<string, string> = {
    admin: 'Администратор',
    manager: 'Менеджер',
    agent: 'Агент поддержки'
  }

  const avgResponseMin = agent.metrics?.avgFirstResponseMin || 0

  return {
    id: agent.id,
    name: agent.name,
    role: roleLabels[agent.role] || agent.role,
    status: agent.status === 'online' ? 'online' : 'offline',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${agent.email}`,
    cases: agent.metrics?.resolvedConversations || 0,
    sla: agent.metrics?.satisfactionScore ? Math.round(agent.metrics.satisfactionScore * 100) : 0,
    avgTime: avgResponseMin > 0 ? `${Math.round(avgResponseMin)}м` : '—',
    level: {
      name: levelNames[levelIndex],
      icon: levelIcons[levelIndex],
      progress: Math.round(progress),
      current: points,
      max: nextLevelMax
    }
  }
}

interface TeamPageProps {
  embedded?: boolean
}

export function TeamPage({ embedded = false }: TeamPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAgents()
  }, [])

  async function loadAgents() {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchAgents()
      setAgents(data)
    } catch (err) {
      setError('Не удалось загрузить список команды')
      console.error('Failed to fetch agents:', err)
    } finally {
      setLoading(false)
    }
  }

  // Calculate metrics from agents data
  const displayAgents = agents.map(mapAgentToDisplay)
  const onlineCount = agents.filter(a => a.status === 'online').length
  const totalAgents = agents.length
  const totalCasesToday = displayAgents.reduce((sum, a) => sum + a.cases, 0)
  
  const avgResponseMinutes = agents.length > 0
    ? agents.reduce((sum, a) => sum + (a.metrics?.avgFirstResponseMin || 0), 0) / agents.length
    : 0
  const avgResponse = avgResponseMinutes > 0 ? `${Math.round(avgResponseMinutes)}м` : '—'

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
        <button 
          onClick={loadAgents}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className={embedded ? "p-6 space-y-6" : "p-6 space-y-6"}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Команда</h1>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            <Plus className="w-4 h-4" />
            Пригласить
          </button>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-end">
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            <Plus className="w-4 h-4" />
            Пригласить
          </button>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard value={onlineCount} label="Онлайн сейчас" hasOnline />
        <MetricCard value={totalAgents} label="Всего агентов" />
        <MetricCard value={avgResponse} label="Сред. ответ" />
        <MetricCard value={totalCasesToday} label="Обращений" />
      </div>

      {/* Agents Grid */}
      {displayAgents.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg">Агенты не найдены</p>
          <p className="text-sm mt-1">Пригласите членов команды для начала работы</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {displayAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
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

function AgentCard({ agent }: { agent: DisplayAgent }) {
  return (
    <div className={`bg-white rounded-xl p-5 border-2 ${
      agent.status === 'online' ? 'border-green-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start gap-4">
        {/* Avatar */}
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

        {/* Info */}
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

          {/* Stats */}
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

          {/* Level */}
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
                Уровень {Math.floor(agent.level.current / 100) + 1} - {agent.level.current}/{agent.level.max} XP
              </span>
            </div>
          </div>

          {/* Actions */}
          <button className="text-blue-500 text-sm font-medium mt-3 hover:underline">
            Профиль
          </button>
        </div>
      </div>
    </div>
  )
}
