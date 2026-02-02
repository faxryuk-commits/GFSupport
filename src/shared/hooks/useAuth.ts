import { useState, useEffect, useCallback } from 'react'
import type { SupportAgent } from '../types'

interface AuthState {
  isAuthenticated: boolean
  agent: SupportAgent | null
  token: string | null
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
    const agent = agentData ? JSON.parse(agentData) : null
    
    return {
      isAuthenticated: !!token,
      agent,
      token,
      permissions: getPermissions(agent?.role)
    }
  })

  useEffect(() => {
    // Listen for storage changes (logout in other tab)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'support_agent_token') {
        const token = e.newValue
        if (!token) {
          setAuth({
            isAuthenticated: false,
            agent: null,
            token: null,
            permissions: getPermissions(null)
          })
        }
      }
    }
    
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const login = useCallback((token: string, agent: SupportAgent) => {
    localStorage.setItem('support_agent_token', token)
    localStorage.setItem('support_agent_data', JSON.stringify(agent))
    localStorage.setItem('support_agent_id', agent.id)
    
    setAuth({
      isAuthenticated: true,
      agent,
      token,
      permissions: getPermissions(agent.role)
    })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('support_agent_token')
    localStorage.removeItem('support_agent_data')
    localStorage.removeItem('support_agent_id')
    
    setAuth({
      isAuthenticated: false,
      agent: null,
      token: null,
      permissions: getPermissions(null)
    })
  }, [])

  const updateAgent = useCallback((updates: Partial<SupportAgent>) => {
    if (!auth.agent) return
    
    const updatedAgent = { ...auth.agent, ...updates }
    localStorage.setItem('support_agent_data', JSON.stringify(updatedAgent))
    
    setAuth(prev => ({
      ...prev,
      agent: updatedAgent
    }))
  }, [auth.agent])

  return {
    ...auth,
    login,
    logout,
    updateAgent
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
