import { AlertTriangle, Clock, TrendingUp, MessageSquare, Zap, Activity, Users } from 'lucide-react'
import type { AgentPerformanceData } from './AgentPerformanceTable'

export interface Recommendation {
  type: 'warning' | 'improvement' | 'strength'
  icon: typeof AlertTriangle
  text: string
}

export interface TeamAvg {
  sla: number
  avgTime: number
  responses: number
  engagement: number
}

function formatChars(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function getRecommendations(agent: AgentPerformanceData, teamAvg: TeamAvg): Recommendation[] {
  const recs: Recommendation[] = []
  const isLeader = agent.role === 'admin' || agent.role === 'manager'

  if (agent.isInactive) {
    recs.push({ type: 'warning', icon: AlertTriangle, text: 'Нет активности за период. Необходимо выяснить причину отсутствия.' })
    return recs
  }

  if (agent.slaCompliance !== null && agent.slaCompliance < 70) {
    recs.push({ type: 'warning', icon: Clock, text: `SLA ${agent.slaCompliance}% — критически низкий. Нужно сократить время первого ответа до ${isLeader ? '15' : '10'} минут.` })
  } else if (agent.slaCompliance !== null && agent.slaCompliance < 85) {
    recs.push({ type: 'improvement', icon: Clock, text: `SLA ${agent.slaCompliance}% — ниже нормы. Рекомендуется сократить время реакции на входящие.` })
  } else if (agent.slaCompliance !== null && agent.slaCompliance >= 90) {
    recs.push({ type: 'strength', icon: TrendingUp, text: `SLA ${agent.slaCompliance}% — отличный показатель, держит высокую планку.` })
  }

  if (agent.avgMinutes > teamAvg.avgTime * 1.5 && agent.totalResponses > 5) {
    recs.push({ type: 'improvement', icon: Clock, text: `Среднее время ответа ${agent.avgMinutes} мин (команда: ${teamAvg.avgTime} мин). Стоит быстрее подхватывать новые обращения.` })
  }

  if (agent.maxMinutes > 120 && agent.totalResponses > 3) {
    recs.push({ type: 'warning', icon: AlertTriangle, text: `Максимальное время ответа ${agent.maxMinutes} мин. Есть просроченные обращения — нужна дисциплина в мониторинге.` })
  }

  if (agent.violatedSLA > agent.withinSLA && agent.totalResponses > 5) {
    recs.push({ type: 'warning', icon: AlertTriangle, text: `Нарушений SLA (${agent.violatedSLA}) больше, чем ответов в срок (${agent.withinSLA}). Приоритет: снизить число нарушений.` })
  }

  if (!isLeader && agent.totalResponses < teamAvg.responses * 0.3 && agent.totalResponses > 0) {
    recs.push({ type: 'improvement', icon: MessageSquare, text: `Всего ${agent.totalResponses} ответов — значительно ниже среднего (${teamAvg.responses}). Нужно повысить вовлечённость.` })
  }

  if (agent.totalResponses > teamAvg.responses * 1.5) {
    recs.push({ type: 'strength', icon: Zap, text: `${agent.totalResponses} ответов — выше среднего. Высокая нагрузка, рассмотреть перераспределение.` })
  }

  if (agent.engagementScore < 15 && !agent.isInactive) {
    recs.push({ type: 'warning', icon: Activity, text: `Вовлечённость ${agent.engagementScore}/100 — очень низкая. Нужна беседа и выявление причин.` })
  } else if (agent.engagementScore > 0 && agent.engagementScore < 30) {
    recs.push({ type: 'improvement', icon: Activity, text: `Вовлечённость ${agent.engagementScore}/100. Рекомендуется активнее участвовать в решении обращений.` })
  }

  if (agent.engagementBreakdown) {
    const { activity, speed, quality, responsibility } = agent.engagementBreakdown
    const weakest = [
      { name: 'Активность', val: activity },
      { name: 'Скорость', val: speed },
      { name: 'Качество', val: quality },
      { name: 'Ответственность', val: responsibility },
    ].sort((a, b) => a.val - b.val)[0]

    if (weakest.val < 10 && agent.engagementScore > 0) {
      recs.push({ type: 'improvement', icon: TrendingUp, text: `Слабая сторона: ${weakest.name} (${weakest.val}/25). Рекомендуется целенаправленно развивать.` })
    }
  }

  if (isLeader && agent.totalResponses > teamAvg.responses * 1.2) {
    recs.push({ type: 'improvement', icon: Users, text: 'Руководитель обрабатывает слишком много обращений лично. Рекомендуется больше делегировать.' })
  }

  if (agent.efficiencyRatio > 2000 && agent.resolvedCases > 0) {
    recs.push({ type: 'improvement', icon: MessageSquare, text: `${formatChars(agent.efficiencyRatio)} символов на тикет — избыточно. Стоит быть лаконичнее в ответах.` })
  }

  if (recs.length === 0) {
    recs.push({ type: 'strength', icon: TrendingUp, text: 'Показатели в норме. Продолжать в том же режиме.' })
  }

  return recs
}
