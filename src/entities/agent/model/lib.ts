import { AGENT_LEVELS, type AgentLevel } from './types'

export function getAgentLevel(points: number): AgentLevel {
  const levels = AGENT_LEVELS
  for (let i = levels.length - 1; i >= 0; i--) {
    if (points >= levels[i].minPoints) {
      const nextLevel = levels[i + 1]
      const progress = nextLevel 
        ? Math.round(((points - levels[i].minPoints) / (nextLevel.minPoints - levels[i].minPoints)) * 100)
        : 100
      return { ...levels[i], index: i, progress, nextLevel }
    }
  }
  return { ...levels[0], index: 0, progress: 0, nextLevel: levels[1] }
}

export function formatLastActive(lastActiveAt?: string): string {
  if (!lastActiveAt) return 'Неизвестно'
  
  const diff = Date.now() - new Date(lastActiveAt).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (minutes < 1) return 'Только что'
  if (minutes < 60) return `${minutes} мин назад`
  if (hours < 24) return `${hours} ч назад`
  return `${days} дн назад`
}
