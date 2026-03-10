import { useState, useEffect, useCallback, createContext, useContext } from 'react'

export interface OrgInfo {
  id: string
  name: string
  slug: string
  plan: string
  logoUrl?: string
}

interface OrgState {
  orgId: string | null
  org: OrgInfo | null
  isLoading: boolean
}

const ORG_ID_KEY = 'support_org_id'
const ORG_DATA_KEY = 'support_org_data'

export function useOrg() {
  const [state, setState] = useState<OrgState>(() => {
    const orgId = localStorage.getItem(ORG_ID_KEY)
    const orgData = localStorage.getItem(ORG_DATA_KEY)
    return {
      orgId,
      org: orgData ? JSON.parse(orgData) : null,
      isLoading: false,
    }
  })

  useEffect(() => {
    if (state.orgId && !state.org) {
      detectOrgFromSubdomain()
    }
  }, [])

  const detectOrgFromSubdomain = useCallback(() => {
    const host = window.location.hostname
    const parts = host.split('.')
    if (parts.length >= 3) {
      const sub = parts[0]
      const reserved = ['www', 'app', 'admin', 'api', 'localhost']
      if (!reserved.includes(sub) && sub !== 'gfsupport') {
        setState(prev => ({ ...prev, isLoading: true }))
        fetch(`/api/support/webhook/register`, {
          headers: {
            'X-Org-Id': sub,
            'Content-Type': 'application/json',
          },
        })
          .then(r => r.json())
          .then(data => {
            if (data.orgId) {
              localStorage.setItem(ORG_ID_KEY, data.orgId)
            }
          })
          .catch(() => {})
          .finally(() => setState(prev => ({ ...prev, isLoading: false })))
      }
    }
  }, [])

  const setOrg = useCallback((org: OrgInfo | null) => {
    if (org) {
      localStorage.setItem(ORG_ID_KEY, org.id)
      localStorage.setItem(ORG_DATA_KEY, JSON.stringify(org))
      setState({ orgId: org.id, org, isLoading: false })
    } else {
      localStorage.removeItem(ORG_ID_KEY)
      localStorage.removeItem(ORG_DATA_KEY)
      setState({ orgId: null, org: null, isLoading: false })
    }
  }, [])

  const clearOrg = useCallback(() => {
    localStorage.removeItem(ORG_ID_KEY)
    localStorage.removeItem(ORG_DATA_KEY)
    setState({ orgId: null, org: null, isLoading: false })
  }, [])

  return {
    ...state,
    setOrg,
    clearOrg,
  }
}

export const OrgContext = createContext<ReturnType<typeof useOrg> | null>(null)

export function useOrgContext() {
  const ctx = useContext(OrgContext)
  if (!ctx) {
    const orgId = localStorage.getItem(ORG_ID_KEY)
    const orgData = localStorage.getItem(ORG_DATA_KEY)
    return {
      orgId,
      org: orgData ? JSON.parse(orgData) : null,
      isLoading: false,
      setOrg: () => {},
      clearOrg: () => {},
    }
  }
  return ctx
}
