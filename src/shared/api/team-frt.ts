import { apiGet } from '../services/api.service'

export interface TeamFrtAgentPerformance {
  name: string
  avgMinutes: number
  totalResponses: number
}

export interface TeamFrtPayload {
  period: {
    from: string
    to: string
    slaMinutes: number
    source: string
  }
  responseTimeSummary: {
    avgResponseMinutes: number
  }
  agentPerformance: TeamFrtAgentPerformance[]
}

/** Лёгкий эндпоинт `/analytics/team-frt` — тот же расчёт FRT, что в SLA-отчёте, один SQL. */
export async function fetchTeamFrt(params: {
  from: string
  to: string
  slaMinutes?: number
  source?: 'all' | 'telegram' | 'whatsapp'
}): Promise<TeamFrtPayload> {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    sla_minutes: String(params.slaMinutes ?? 10),
    source: params.source ?? 'all',
  })
  return apiGet<TeamFrtPayload>(`/analytics/team-frt?${q.toString()}`, false)
}
