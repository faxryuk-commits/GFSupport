export type { Agent, AgentRole, AgentStatus, AgentMetrics } from '@/shared/types'
import type { AgentRole } from '@/shared/types'

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

// Ключ — строка, а не AgentRole: в базе живут и продажные, и поддержечные
// роли, и таблица команды обязана называть их своими именами. Раньше все
// нестандартные роли рисовались «Агентом», и назначение выглядело
// несохранившимся
export const AGENT_ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  admin: { label: 'Админ', color: 'text-purple-600' },
  org_admin: { label: 'Админ организации', color: 'text-purple-600' },
  manager: { label: 'Менеджер', color: 'text-blue-600' },
  agent: { label: 'Агент', color: 'text-slate-600' },
  support: { label: 'Поддержка', color: 'text-teal-600' },
  support_agent: { label: 'Агент поддержки', color: 'text-teal-600' },
  team_lead: { label: 'Тимлид', color: 'text-teal-700' },
  cco: { label: 'CCO', color: 'text-emerald-700' },
  kam: { label: 'KAM', color: 'text-emerald-700' },
  sales: { label: 'Сейлз', color: 'text-emerald-600' },
  sale: { label: 'Сейлз', color: 'text-emerald-600' },
  sdr: { label: 'SDR', color: 'text-emerald-600' },
  pm: { label: 'PM', color: 'text-indigo-600' },
  developer: { label: 'Разработчик', color: 'text-indigo-600' },
  designer: { label: 'Дизайнер', color: 'text-indigo-600' },
}
