import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MessageSquare,
  Hash,
  Briefcase, 
  BarChart3, 
  Users,
  Settings,
  Zap,
  Megaphone,
  UsersRound,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Brain,
  FileText,
  Sparkles,
  Clock,
} from 'lucide-react'

// CSS for coin flip and shine animations
const badgeAnimationStyles = `
@keyframes coinFlip {
  0% { transform: perspective(400px) rotateX(0deg); }
  50% { transform: perspective(400px) rotateX(180deg); }
  100% { transform: perspective(400px) rotateX(360deg); }
}

@keyframes shine {
  0% { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

.badge-animate {
  animation: coinFlip 0.6s ease-in-out;
}

.badge-shine::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg, 
    transparent 0%, 
    rgba(255,255,255,0.4) 50%, 
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shine 1s ease-in-out;
}
`

interface SidebarProps {
  unreadChats?: number
  openCases?: number
  pendingCommitments?: number
  lastUpdated?: number // Timestamp последнего обновления - для анимации
  currentUser?: {
    name: string
    avatar?: string
    role?: string
  }
  onLogout?: () => void
}

const mainNavItems = [
  { path: '/overview', label: 'Обзор', icon: LayoutDashboard },
  { path: '/chats', label: 'Чаты', icon: MessageSquare, badgeKey: 'unreadChats' },
  { path: '/channels', label: 'Каналы', icon: Hash },
  { path: '/cases', label: 'Кейсы', icon: Briefcase, badgeKey: 'openCases' },
  { path: '/commitments', label: 'Обязательства', icon: Clock, badgeKey: 'pendingCommitments' },
  { path: '/knowledge', label: 'База знаний', icon: Brain },
  { path: '/learning/problems', label: 'AI Обучение', icon: Sparkles },
  { path: '/docs', label: 'Документы', icon: FileText },
  { path: '/broadcast', label: 'Рассылки', icon: Megaphone },
]

const bottomItems = [
  { path: '/settings', label: 'Настройки', icon: Settings },
]

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'

export function Sidebar({ unreadChats = 0, openCases = 0, pendingCommitments = 0, lastUpdated = 0, currentUser, onLogout }: SidebarProps) {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    return saved === 'true'
  })
  
  // Track animated badges
  const [animatingBadges, setAnimatingBadges] = useState<Set<string>>(new Set())
  const prevUpdatedRef = useRef(0) // Трекаем последний timestamp обновления
  const isFirstRenderRef = useRef(true) // Чтобы не анимировать при первом рендере
  
  const badges: Record<string, number> = {
    unreadChats,
    openCases,
    pendingCommitments
  }

  // Trigger animation when data is updated (every 30 seconds)
  // Animation shows that the system is actively syncing, not frozen
  useEffect(() => {
    // Skip first render to avoid animation on page load
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      prevUpdatedRef.current = lastUpdated
      return
    }
    
    // Only animate if lastUpdated actually changed (new fetch completed)
    if (lastUpdated > 0 && lastUpdated !== prevUpdatedRef.current) {
      const badgesToAnimate = new Set<string>()
      
      // Animate badges that have non-zero values
      if (unreadChats > 0) {
        badgesToAnimate.add('unreadChats')
      }
      if (openCases > 0) {
        badgesToAnimate.add('openCases')
      }
      if (pendingCommitments > 0) {
        badgesToAnimate.add('pendingCommitments')
      }
      
      if (badgesToAnimate.size > 0) {
        setAnimatingBadges(badgesToAnimate)
        
        // Remove animation class after animation completes
        setTimeout(() => {
          setAnimatingBadges(new Set())
        }, 1000)
      }
      
      prevUpdatedRef.current = lastUpdated
    }
  }, [lastUpdated, unreadChats, openCases, pendingCommitments])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed))
  }, [isCollapsed])

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  const toggleCollapse = () => setIsCollapsed(!isCollapsed)

  const NavItem = ({ path, label, icon: Icon, badgeKey }: { 
    path: string
    label: string
    icon: typeof LayoutDashboard
    badgeKey?: string 
  }) => {
    const active = isActive(path)
    const badgeCount = badgeKey ? badges[badgeKey] : 0
    const isAnimating = badgeKey && animatingBadges.has(badgeKey)

    return (
      <Link
        to={path}
        title={isCollapsed ? label : undefined}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group ${
          active 
            ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' 
            : 'text-slate-300 hover:bg-white/10'
        } ${isCollapsed ? 'justify-center px-3 relative' : ''}`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        {!isCollapsed && (
          <>
            <span className="flex-1 font-medium">{label}</span>
            {badgeCount > 0 && (
              <span 
                className={`min-w-[22px] h-5 px-1.5 flex items-center justify-center text-xs font-semibold rounded-full overflow-hidden ${
                  active ? 'bg-white/20 text-white' : 'bg-blue-500 text-white'
                } ${isAnimating ? 'badge-animate badge-shine' : ''}`}
                style={{ transformStyle: 'preserve-3d', position: 'relative' }}
              >
                {badgeCount}
              </span>
            )}
          </>
        )}
        {isCollapsed && badgeCount > 0 && (
          <span 
            className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white overflow-hidden ${
              isAnimating ? 'badge-animate badge-shine' : ''
            }`}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </Link>
    )
  }

  return (
    <>
      {/* Inject animation styles */}
      <style>{badgeAnimationStyles}</style>
      <aside 
        className={`bg-[#1a2b4b] h-full flex flex-col flex-shrink-0 transition-all duration-300 ${
          isCollapsed ? 'w-[72px]' : 'w-[240px]'
        }`}
      >
      {/* Logo */}
      <div className={`p-4 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        <Link to="/overview" className="flex items-center gap-2">
          <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          {!isCollapsed && <span className="text-white font-bold text-lg">SUPPORT</span>}
        </Link>
        <button
          onClick={toggleCollapse}
          className={`p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors ${
            isCollapsed ? 'absolute left-[72px] top-4 -translate-x-1/2 bg-[#1a2b4b] border border-white/10 shadow-lg z-10' : ''
          }`}
          title={isCollapsed ? 'Развернуть' : 'Свернуть'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <div className="space-y-1">
          {mainNavItems.map(item => (
            <NavItem key={item.path} {...item} />
          ))}
        </div>
      </nav>

      {/* Bottom Navigation */}
      <div className="px-3 pb-4">
        {/* Settings */}
        <div className="space-y-1 mb-4">
          {bottomItems.map(item => (
            <NavItem key={item.path} {...item} />
          ))}
        </div>

        {/* User */}
        {currentUser && (
          <div className="border-t border-white/10 pt-4">
            <div className={`flex items-center gap-3 px-2 py-2 ${isCollapsed ? 'justify-center' : ''}`}>
              <div 
                className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium flex-shrink-0"
                title={isCollapsed ? currentUser.name : undefined}
              >
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  currentUser.name.charAt(0).toUpperCase()
                )}
              </div>
              {!isCollapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
                    {currentUser.role && (
                      <p className="text-xs text-slate-400 truncate">{currentUser.role}</p>
                    )}
                  </div>
                  {onLogout && (
                    <button 
                      onClick={onLogout}
                      className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="Выйти"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
            {isCollapsed && onLogout && (
              <button 
                onClick={onLogout}
                className="w-full mt-2 p-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors flex items-center justify-center"
                title="Выйти"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
    </>
  )
}
