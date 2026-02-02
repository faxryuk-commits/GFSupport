import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { 
  MessageSquare, Briefcase, BarChart3, Bell, LogOut, 
  RefreshCw, ChevronLeft
} from 'lucide-react'
import type { MobileTab, SupportChannel, SupportCase, AnalyticsData } from './types'

// Lazy imports for tabs
import ChannelsList from './tabs/ChannelsList'
import ChatView from './tabs/ChatView'
import CasesTab from './tabs/CasesTab'
import CaseDetail from './tabs/CaseDetail'
import AnalyticsTab from './tabs/AnalyticsTab'

interface MobileDashboardProps {
  defaultTab?: MobileTab
}

export function MobileDashboard({ defaultTab = 'messages' }: MobileDashboardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ channelId?: string; caseId?: string }>()
  
  // Current tab
  const [activeTab, setActiveTab] = useState<MobileTab>(defaultTab)
  
  // Data states
  const [channels, setChannels] = useState<SupportChannel[]>([])
  const [cases, setCases] = useState<SupportCase[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  
  // UI states
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  
  // Current agent
  const [currentAgent, setCurrentAgent] = useState<{ id: string; name: string } | null>(null)
  
  // View states for navigation
  const selectedChannelId = params.channelId || null
  const selectedCaseId = params.caseId || null
  
  // Sync tab with URL
  useEffect(() => {
    const path = location.pathname
    if (path.includes('/messages')) setActiveTab('messages')
    else if (path.includes('/cases')) setActiveTab('cases')
    else if (path.includes('/analytics')) setActiveTab('analytics')
  }, [location.pathname])
  
  // Load current agent
  useEffect(() => {
    const agentData = localStorage.getItem('support_agent')
    if (agentData) {
      try {
        setCurrentAgent(JSON.parse(agentData))
      } catch { /* ignore */ }
    }
  }, [])
  
  // Get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('support_agent_token')
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? (token.startsWith('Bearer') ? token : `Bearer ${token}`) : ''
    }
  }, [])
  
  // Fetch channels
  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/support/channels', { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setChannels(data.channels || [])
        const unread = (data.channels || []).reduce((acc: number, ch: SupportChannel) => acc + (ch.unreadCount || 0), 0)
        setUnreadCount(unread)
      }
    } catch (err) {
      console.error('Failed to fetch channels:', err)
    }
  }, [getAuthHeaders])
  
  // Fetch cases
  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch('/api/support/cases', { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setCases(data.cases || [])
      }
    } catch (err) {
      console.error('Failed to fetch cases:', err)
    }
  }, [getAuthHeaders])
  
  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/support/analytics', { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        // Transform to simple format for mobile
        setAnalytics({
          totalChannels: data.overview?.totalChannels || 0,
          activeChannels: data.overview?.activeChannels || 0,
          totalMessages: data.overview?.totalMessages || 0,
          todayMessages: data.overview?.todayMessages || 0,
          openCases: data.overview?.openCases || 0,
          resolvedCases: data.overview?.resolvedCases || 0,
          avgResponseTime: data.overview?.avgResolutionHours ? data.overview.avgResolutionHours * 60 : 0,
          slaCompliance: data.overview?.slaCompliance || 0
        })
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    }
  }, [getAuthHeaders])
  
  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      await Promise.all([fetchChannels(), fetchCases(), fetchAnalytics()])
      setIsLoading(false)
    }
    loadData()
  }, [fetchChannels, fetchCases, fetchAnalytics])
  
  // Refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([fetchChannels(), fetchCases(), fetchAnalytics()])
    setIsRefreshing(false)
  }
  
  // Tab change handler
  const handleTabChange = (tab: MobileTab) => {
    setActiveTab(tab)
    navigate(`/support/m/${tab === 'messages' ? '' : tab}`)
  }
  
  // Navigate to channel
  const handleChannelSelect = (channelId: string) => {
    navigate(`/support/m/messages/${channelId}`)
  }
  
  // Navigate back from chat
  const handleBackFromChat = () => {
    navigate('/support/m/messages')
  }
  
  // Navigate to case
  const handleCaseSelect = (caseId: string) => {
    navigate(`/support/m/cases/${caseId}`)
  }
  
  // Navigate back from case detail
  const handleBackFromCase = () => {
    navigate('/support/m/cases')
  }
  
  // Logout
  const handleLogout = () => {
    localStorage.removeItem('support_agent_token')
    localStorage.removeItem('support_agent')
    navigate('/support/login')
  }
  
  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }
  
  // Chat view (full screen)
  if (activeTab === 'messages' && selectedChannelId) {
    const channel = channels.find(c => c.id === selectedChannelId)
    return (
      <ChatView 
        channelId={selectedChannelId}
        channel={channel || null}
        onBack={handleBackFromChat}
        currentAgentId={currentAgent?.id || ''}
      />
    )
  }
  
  // Case detail view (full screen)
  if (activeTab === 'cases' && selectedCaseId) {
    const caseItem = cases.find(c => c.id === selectedCaseId)
    return (
      <CaseDetail
        caseId={selectedCaseId}
        caseData={caseItem || null}
        onBack={handleBackFromCase}
        onRefresh={fetchCases}
      />
    )
  }
  
  // Main dashboard with tabs
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-800">Support</span>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 text-slate-500 hover:text-slate-700"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-500 hover:text-red-600"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>
      
      {/* Content */}
      <main className="flex-1 overflow-auto pb-16">
        {activeTab === 'messages' && (
          <ChannelsList 
            channels={channels}
            onChannelSelect={handleChannelSelect}
            onRefresh={handleRefresh}
          />
        )}
        
        {activeTab === 'cases' && (
          <CasesTab
            cases={cases}
            onCaseSelect={handleCaseSelect}
            onRefresh={fetchCases}
          />
        )}
        
        {activeTab === 'analytics' && analytics && (
          <AnalyticsTab
            data={analytics}
            channels={channels}
            cases={cases}
            onRefresh={handleRefresh}
          />
        )}
      </main>
      
      {/* Bottom Navigation */}
      <nav 
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          onClick={() => handleTabChange('messages')}
          className={`flex-1 flex flex-col items-center py-2 gap-1 ${
            activeTab === 'messages' ? 'text-emerald-600' : 'text-slate-500'
          }`}
        >
          <div className="relative">
            <MessageSquare className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <span className="text-xs">Сообщения</span>
        </button>
        
        <button
          onClick={() => handleTabChange('cases')}
          className={`flex-1 flex flex-col items-center py-2 gap-1 ${
            activeTab === 'cases' ? 'text-emerald-600' : 'text-slate-500'
          }`}
        >
          <div className="relative">
            <Briefcase className="w-6 h-6" />
            {cases.filter(c => c.status === 'open').length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {cases.filter(c => c.status === 'open').length > 9 ? '9+' : cases.filter(c => c.status === 'open').length}
              </span>
            )}
          </div>
          <span className="text-xs">Кейсы</span>
        </button>
        
        <button
          onClick={() => handleTabChange('analytics')}
          className={`flex-1 flex flex-col items-center py-2 gap-1 ${
            activeTab === 'analytics' ? 'text-emerald-600' : 'text-slate-500'
          }`}
        >
          <BarChart3 className="w-6 h-6" />
          <span className="text-xs">Аналитика</span>
        </button>
      </nav>
    </div>
  )
}

export default MobileDashboard
