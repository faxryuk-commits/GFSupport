import type { TeamFrtAgentPerformance } from '@/shared/api/team-frt'

export function matchSlaAgentFrt(
  performances: TeamFrtAgentPerformance[],
  agentName: string
): TeamFrtAgentPerformance | undefined {
  const n = agentName.trim().toLowerCase()
  return performances.find(p => p.name.trim().toLowerCase() === n)
}
