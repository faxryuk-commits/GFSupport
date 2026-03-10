import { useState, useEffect, useCallback } from 'react'
import type { SupportAgent } from '../types'

interface OrgInfo {
  id: string
  name: string
  slug: string
  plan: string
  logoUrl?: string
}

interface AuthState {
  isAuthenticated: boolean
  agent: SupportAgent | null
  token: string | null
  orgId: string | null
  org: OrgInfo | null
  permissions: {
    canAccessCases: boolean
    canAccessChannels: boolean
    canAccessMessages: boolean
    canAccessAnalytics: boolean
    canAccessUsers: boolean
    canAccessSettings: boolean
    canManageAgents: boolean
  }
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = localStorage.getItem('support_agent_token')
    const agentData = localStorage.getItem('support_agent_data')
    const orgData = localStorage.getItem('support_org_data')
    const orgId = localStorage.getItem('support_org_id')
    const agent = agentData ? JSON.parse(agentData) : null
    const org = orgData ? JSON.parse(orgData) : null
    
    return {
      isAuthenticated: !!token,
      agent,
      token,
      orgId: orgId || agent?.orgId || null,
      org,
      permissions: getPermissions(agent?.role),
    }
  })

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'support_agent_token') {
        const token = e.newValue
        if (!token) {
          setAuth({
            isAuthenticated: false,
            agent: null,
            token: null,
            orgId: null,
            org: null,
            permissions: getPermissions(null),
          })
        }
      }
    }
    
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const login = useCallback((token: string, agent: SupportAgent, org?: OrgInfo | null) => {
    localStorage.setItem('support_agent_token', token)
    localStorage.setItem('support_agent_data', JSON.stringify(agent))
    localStorage.setItem('support_agent_id', agent.id)
    const agentOrgId = (agent as any).orgId || null
    if (org) {
      localStorage.setItem('support_org_id', org.id)
      localStorage.setItem('support_org_data', JSON.stringify(org))
    } else if (agentOrgId) {
      localStorage.setItem('support_org_id', agentOrgId)
    }
    
    setAuth({
      isAuthenticated: true,
      agent,
      token,
      orgId: org?.id || agentOrgId,
      org: org || null,
      permissions: getPermissions(agent.role),
    })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('support_agent_token')
    localStorage.removeItem('support_agent_data')
    localStorage.removeItem('support_agent_id')
    localStorage.removeItem('support_org_id')
    localStorage.removeItem('support_org_data')
    
    setAuth({
      isAuthenticated: false,
      agent: null,
      token: null,
      orgId: null,
      org: null,
      permissions: getPermissions(null),
    })
  }, [])

  const updateAgent = useCallback((updates: Partial<SupportAgent>) => {
    if (!auth.agent) return
    
    const updatedAgent = { ...auth.agent, ...updates }
    localStorage.setItem('support_agent_data', JSON.stringify(updatedAgent))
    
    setAuth(prev => ({
      ...prev,
      agent: updatedAgent,
    }))
  }, [auth.agent])

  return {
    ...auth,
    login,
    logout,
    updateAgent,
  }
}

function getPermissions(role: string | null | undefined) {
  if (!role) {
    return {
      canAccessCases: false,
      canAccessChannels: false,
      canAccessMessages: false,
      canAccessAnalytics: false,
      canAccessUsers: false,
      canAccessSettings: false,
      canManageAgents: false
    }
  }

  const isAdmin = role === 'admin'
  const isManager = role === 'manager' || isAdmin

  return {
    canAccessCases: true,
    canAccessChannels: true,
    canAccessMessages: true,
    canAccessAnalytics: isManager,
    canAccessUsers: isManager,
    canAccessSettings: isManager,
    canManageAgents: isAdmin
  }
}
