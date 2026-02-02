export type AgentRole = 'admin' | 'manager' | 'agent'
export type AgentStatus = 'online' | 'away' | 'offline'

export interface Agent {
  id: string
  name: string
  email?: string
  username?: string
  telegramId?: number
  role: AgentRole
  status?: AgentStatus
  avatarUrl?: string
  isActive?: boolean
  lastActiveAt?: string
  lastSeenAt?: string
  createdAt?: string
  assignedChannels?: number
  activeChats?: number
  metrics?: AgentMetrics
  points?: number
  phone?: string
  position?: string
  department?: string
}

export interface AgentMetrics {
  messagesHandled: number
  resolvedConversations: number
  avgFirstResponseMin: number
  avgResolutionMin: number
  satisfactionScore: number
}

export interface AgentLevel {
  name: string
  icon: string
  minPoints: number
  index: number
  progress: number
  nextLevel?: { name: string; icon: string; minPoints: number }
}

export const AGENT_LEVELS = [
  { name: 'Новичок', icon: '🌱', minPoints: 0 },
  { name: 'Стажёр', icon: '📚', minPoints: 100 },
  { name: 'Агент', icon: '🎯', minPoints: 500 },
  { name: 'Старший', icon: '⭐', minPoints: 2000 },
  { name: 'Эксперт', icon: '🏆', minPoints: 5000 },
  { name: 'Мастер', icon: '👑', minPoints: 10000 },
]

export const AGENT_ROLE_CONFIG: Record<AgentRole, { label: string; color: string }> = {
  admin: { label: 'Админ', color: 'text-purple-600' },
  manager: { label: 'Менеджер', color: 'text-blue-600' },
  agent: { label: 'Агент', color: 'text-slate-600' },
}
