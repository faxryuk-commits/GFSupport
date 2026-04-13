import { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from '@/widgets/sidebar'
import { ErrorBoundary } from '@/shared/ui'
import { useBackgroundNotifications } from '@/shared/hooks/useBackgroundNotifications'
import { useMarket } from '@/shared/hooks/useMarket'
import { useOrg, OrgContext } from '@/shared/hooks/useOrg'
import { playCaseSoundIfEnabled, playMessageSoundIfEnabled } from '@/shared/lib'
import { clearCache } from '@/shared/services/api.service'
import { OnboardingWizard, DemoBanner } from '@/features/onboarding'


export function MainLayout() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<{ name: string; role?: string; avatarUrl?: string } | null>(null)
  const [unreadChats, setUnreadChats] = useState(0)
  const [openCases, setOpenCases] = useState(0)
  const [pendingCommitments, setPendingCommitments] = useState(0)
  const [onlineAgentsCount, setOnlineAgentsCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(0) // Timestamp последнего обновления счётчиков
  
  // Track previous values for sound notifications
  const prevCasesRef = useRef<number>(0)
  const prevUnreadRef = useRef<number>(0)
  const isFirstLoadRef = useRef<boolean>(true)
  
  useBackgroundNotifications()
  const { markets, selectedMarket, setSelectedMarket } = useMarket()
  const orgState = useOrg()

  const handleMarketChange = useCallback((marketId: string | null) => {
    setSelectedMarket(marketId)
    clearCache()
    fetchCounts()
  }, [setSelectedMarket])

  const fetchCounts = useCallback(async () => {
    try {
      const token = localStorage.getItem('support_agent_token')
      if (!token) return
      if (document.visibilityState === 'hidden') return

      const headers = { Authorization: `Bearer ${token}` }

      const [channelsRes, casesRes, commitmentsRes, agentsRes] = await Promise.all([
        fetch('/api/support/channels?active=true&limit=1000', { headers }),
        fetch('/api/support/cases?status=detected,in_progress,waiting,blocked&limit=500', { headers }),
        fetch('/api/support/commitments?status=pending', { headers }),
        fetch('/api/support/agents', { headers }),
      ])

      if (channelsRes.ok) {
        const data = await channelsRes.json()
        const unread = data.channels?.reduce((sum: number, ch: { unreadCount?: number }) => 
          sum + (ch.unreadCount || 0), 0) || 0
        setUnreadChats(unread)
      }

      if (casesRes.ok) {
        const data = await casesRes.json()
        setOpenCases(data.cases?.length || 0)
      }
      
      if (commitmentsRes.ok) {
        const data = await commitmentsRes.json()
        setPendingCommitments(data.stats?.pending || data.commitments?.length || 0)
      }
      
      if (agentsRes.ok) {
        const data = await agentsRes.json()
        const online = data.agents?.filter((a: { status?: string }) => a.status === 'online').length || 0
        setOnlineAgentsCount(online)
      }
      
      setLastUpdated(Date.now())
    } catch {
      // Игнорируем ошибки - покажем нули
    }
  }, [])

  useEffect(() => {
    const agentData = localStorage.getItem('support_agent')
    if (agentData) {
      try {
        const agent = JSON.parse(agentData)
        setCurrentUser({
          name: agent.name || agent.username,
          role: agent.role === 'manager' ? 'Менеджер' : 
                agent.role === 'lead' ? 'Руководитель' : 
                agent.role === 'admin' ? 'Администратор' : 'Агент',
          avatarUrl: agent.avatarUrl || agent.avatar_url
        })
      } catch {
        const auth = localStorage.getItem('auth')
        if (auth) {
          const parsed = JSON.parse(auth)
          setCurrentUser({ name: parsed.name || parsed.email, role: parsed.role })
        }
      }
    }

    fetchCounts()
    
    const countsInterval = setInterval(fetchCounts, 30000)
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCounts()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      clearInterval(countsInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchCounts])

  // Sound notifications for new cases and messages
  useEffect(() => {
    // Skip first load to avoid sound on page refresh
    if (isFirstLoadRef.current) {
      prevCasesRef.current = openCases
      prevUnreadRef.current = unreadChats
      isFirstLoadRef.current = false
      return
    }

    // Play sound for new cases
    if (openCases > prevCasesRef.current) {
      playCaseSoundIfEnabled()
    }
    prevCasesRef.current = openCases

    // Play sound for new unread messages (only if not on chats page - to avoid double sound)
    if (unreadChats > prevUnreadRef.current && !window.location.pathname.startsWith('/chats')) {
      playMessageSoundIfEnabled()
    }
    prevUnreadRef.current = unreadChats
  }, [openCases, unreadChats])

  const handleLogout = async () => {
    // Отправляем logout на сервер
    const token = localStorage.getItem('support_agent_token')
    const agentId = localStorage.getItem('support_agent_id')
    if (token && agentId) {
      try {
        await fetch('/api/support/agents/activity', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}` 
          },
          body: JSON.stringify({ action: 'logout', agentId })
        })
      } catch { /* ignore */ }
    }
    
    localStorage.removeItem('auth')
    localStorage.removeItem('support_agent')
    localStorage.removeItem('support_agent_data')
    localStorage.removeItem('support_agent_token')
    localStorage.removeItem('support_agent_id')
    localStorage.removeItem('support_org_id')
    localStorage.removeItem('support_org_data')
    navigate('/login')
  }

  // Heartbeat для отслеживания онлайн статуса
  useEffect(() => {
    const token = localStorage.getItem('support_agent_token')
    const agentId = localStorage.getItem('support_agent_id')
    if (!token || !agentId) return

    // Отправляем heartbeat каждые 60 секунд
    const sendHeartbeat = async () => {
      try {
        await fetch('/api/support/agents/activity', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}` 
          },
          body: JSON.stringify({ 
            action: 'heartbeat', 
            agentId,
            metadata: { page: window.location.pathname }
          })
        })
      } catch { /* ignore */ }
    }

    sendHeartbeat()
    const interval = setInterval(sendHeartbeat, 45000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  // Проверяем авторизацию
  useEffect(() => {
    const token = localStorage.getItem('support_agent_token')
    const auth = localStorage.getItem('auth')
    if (!token && !auth) {
      navigate('/login')
    }
  }, [navigate])

  return (
    <OrgContext.Provider value={orgState}>
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <Sidebar 
          unreadChats={unreadChats} 
          openCases={openCases}
          pendingCommitments={pendingCommitments}
          onlineAgentsCount={onlineAgentsCount}
          currentUser={currentUser || undefined}
          onLogout={handleLogout}
          lastUpdated={lastUpdated}
          markets={markets}
          selectedMarket={selectedMarket}
          onMarketChange={handleMarketChange}
          orgName={orgState.org?.name}
          orgLogo={orgState.org?.logoUrl}
          orgPlan={orgState.org?.plan}
        />
        <main className="flex-1 h-full overflow-auto">
          <DemoBanner />
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <OnboardingWizard />
    </OrgContext.Provider>
  )
}
