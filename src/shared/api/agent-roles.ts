import { apiGet } from '../services/api.service'

export interface AgentRoleItem {
  role: string | null
  count: number
}

export interface AgentRolesResponse {
  roles: AgentRoleItem[]
  presets: {
    /** Роли из support_agents, попадающие в пресет «команда поддержки». */
    support: string[]
  }
}

export const fetchAgentRoles = (): Promise<AgentRolesResponse> =>
  apiGet<AgentRolesResponse>('/analytics/agent-roles')
