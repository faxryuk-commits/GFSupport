import type { AnalyticsData, DashboardMetrics } from '@/shared/api'
import type { Agent } from '@/entities/agent'
import type { AIRecommendation } from './types'

export function generateAIRecommendations(
  analytics: AnalyticsData | null,
  metrics: DashboardMetrics | null,
  agents: Agent[]
): AIRecommendation[] {
  const recommendations: AIRecommendation[] = []
  if (!analytics || !metrics) return recommendations

  const avgResponse = analytics.channels?.avgFirstResponse || 0
  if (avgResponse > 30) {
    recommendations.push({
      id: 'response-time',
      type: 'warning',
      title: 'Высокое время ответа',
      description: `Среднее время первого ответа ${avgResponse} минут. Рекомендуется сократить до 15 минут для лучшего клиентского опыта.`,
      priority: 'high',
      action: { label: 'Посмотреть очередь', link: '/chats' }
    })
  } else if (avgResponse > 0 && avgResponse <= 10) {
    recommendations.push({
      id: 'response-time-good',
      type: 'success',
      title: 'Отличное время ответа!',
      description: `Среднее время ответа ${avgResponse} минут - это отличный показатель.`,
      priority: 'low'
    })
  }

  const urgentOpenCases = analytics.cases?.urgentOpen || 0
  if (urgentOpenCases > 0) {
    recommendations.push({
      id: 'urgent-cases',
      type: 'warning',
      title: `${urgentOpenCases} срочных кейсов`,
      description: 'Есть открытые кейсы требующие немедленного внимания. Приоритизируйте их обработку.',
      priority: 'high',
      action: { label: 'Открыть кейсы', link: '/cases?priority=urgent' }
    })
  }

  const frustrated = analytics.patterns?.bySentiment?.find(s => s.sentiment === 'frustrated')
  const negative = analytics.patterns?.bySentiment?.find(s => s.sentiment === 'negative')
  const totalNegative = (frustrated?.count || 0) + (negative?.count || 0)
  const totalMessages = analytics.messages?.total || 1
  const negativePercent = (totalNegative / totalMessages) * 100

  if (negativePercent > 15) {
    recommendations.push({
      id: 'negative-sentiment',
      type: 'warning',
      title: 'Повышенный негатив',
      description: `${negativePercent.toFixed(0)}% обращений с негативным настроением. Проанализируйте причины и улучшите качество сервиса.`,
      priority: 'medium'
    })
  }

  const onlineAgents = agents.filter(a => a.status === 'online').length
  const awayAgents = agents.filter(a => a.status === 'away').length
  const totalAgents = agents.length

  if (totalAgents > 0 && onlineAgents === 0 && metrics.waiting > 0) {
    recommendations.push({
      id: 'no-online',
      type: 'warning',
      title: 'Нет агентов онлайн',
      description: `${metrics.waiting} клиентов ожидают ответа, но все агенты офлайн.`,
      priority: 'high'
    })
  } else if (onlineAgents > 0) {
    recommendations.push({
      id: 'team-online',
      type: 'info',
      title: `${onlineAgents} агентов онлайн`,
      description: awayAgents > 0 ? `Ещё ${awayAgents} отошли ненадолго` : 'Команда готова обрабатывать обращения',
      priority: 'low'
    })
  }

  const topProblem = analytics.patterns?.recurringProblems?.[0]
  if (topProblem && topProblem.count >= 5) {
    recommendations.push({
      id: 'recurring-problem',
      type: 'action',
      title: `Частая проблема: ${topProblem.issue}`,
      description: `${topProblem.count} обращений. Рассмотрите создание FAQ или автоматизацию ответа.`,
      priority: 'medium',
      action: { label: 'Автоматизация', link: '/settings?tab=automations' }
    })
  }

  const sla = metrics.slaPercent || 0
  if (sla < 80) {
    recommendations.push({
      id: 'sla-low',
      type: 'warning',
      title: 'SLA ниже нормы',
      description: `Текущий SLA ${sla}%. Целевой показатель 90%+.`,
      priority: 'high'
    })
  } else if (sla >= 95) {
    recommendations.push({
      id: 'sla-excellent',
      type: 'success',
      title: 'Отличный SLA!',
      description: `${sla}% обращений обработано вовремя.`,
      priority: 'low'
    })
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}
