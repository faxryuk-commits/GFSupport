import { useState, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from '@/widgets/sidebar'
import { ErrorBoundary } from '@/shared/ui'

interface AgentData {
  id: string
  name: string
  username: string
  role: string
}

export function MainLayout() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<{ name: string; role?: string } | null>(null)
  const [unreadChats, setUnreadChats] = useState(0)
  const [openCases, setOpenCases] = useState(0)

  useEffect(() => {
    // Загружаем данные агента из localStorage
    const agentData = localStorage.getItem('support_agent')
    if (agentData) {
      try {
        const agent: AgentData = JSON.parse(agentData)
        setCurrentUser({
          name: agent.name || agent.username,
          role: agent.role === 'manager' ? 'Менеджер' : 
                agent.role === 'lead' ? 'Руководитель' : 
                agent.role === 'admin' ? 'Администратор' : 'Агент'
        })
      } catch {
        // Fallback на старый формат
        const auth = localStorage.getItem('auth')
        if (auth) {
          const parsed = JSON.parse(auth)
          setCurrentUser({ name: parsed.name || parsed.email, role: parsed.role })
        }
      }
    }

    // Загружаем счётчики (можно добавить реальный API)
    fetchCounts()
  }, [])

  const fetchCounts = async () => {
    try {
      const token = localStorage.getItem('support_agent_token')
      if (!token) return

      // Каналы с непрочитанными
      const channelsRes = await fetch('/api/support/channels?active=true', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (channelsRes.ok) {
        const data = await channelsRes.json()
        const unread = data.channels?.reduce((sum: number, ch: { unreadCount?: number }) => 
          sum + (ch.unreadCount || 0), 0) || 0
        setUnreadChats(unread)
      }

      // Открытые кейсы (только активные статусы)
      const casesRes = await fetch('/api/support/cases?status=detected,in_progress,waiting,blocked&limit=500', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (casesRes.ok) {
        const data = await casesRes.json()
        // Используем длину массива отфильтрованных кейсов, не total
        setOpenCases(data.cases?.length || 0)
      }
    } catch {
      // Игнорируем ошибки - покажем нули
    }
  }

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

    // Первый heartbeat сразу
    sendHeartbeat()
    
    // Затем каждую минуту
    const interval = setInterval(sendHeartbeat, 60000)
    
    // При закрытии вкладки - logout
    const handleUnload = () => {
      navigator.sendBeacon('/api/support/agents/activity', JSON.stringify({
        action: 'logout',
        agentId
      }))
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      clearInterval(interval)
      window.removeEventListener('beforeunload', handleUnload)
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
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar 
        unreadChats={unreadChats} 
        openCases={openCases}
        currentUser={currentUser || undefined}
        onLogout={handleLogout}
      />
      <main className="flex-1 h-full overflow-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
