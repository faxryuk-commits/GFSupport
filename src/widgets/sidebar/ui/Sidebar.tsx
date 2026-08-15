import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MessageSquare,
  Hash,
  Briefcase, 
  Settings,
  Megaphone,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Target,
  Globe,
  ChevronDown,
  Bell,
  Activity,
  Sparkles,
  Trophy,
  Bot,
  Waypoints,
} from 'lucide-react'
import {
  BarChart3, Plug, ListChecks, Handshake, Inbox, Building2, PieChart, SlidersHorizontal,
} from 'lucide-react'
import { getPlanConfig } from '@/shared/lib/plan-features'

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

@keyframes avatarFlip {
  0% { transform: perspective(400px) rotateY(0deg); }
  50% { transform: perspective(400px) rotateY(90deg); }
  100% { transform: perspective(400px) rotateY(180deg); }
}

@keyframes avatarFlipBack {
  0% { transform: perspective(400px) rotateY(180deg); }
  50% { transform: perspective(400px) rotateY(90deg); }
  100% { transform: perspective(400px) rotateY(0deg); }
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

.avatar-container {
  perspective: 400px;
  position: relative;
}

.avatar-flip {
  transform-style: preserve-3d;
  transition: transform 0.6s ease-in-out;
}

.avatar-flip.flipped {
  transform: rotateY(180deg);
}

.avatar-front, .avatar-back {
  backface-visibility: hidden;
  position: absolute;
  inset: 0;
}

.avatar-back {
  transform: rotateY(180deg);
}
`

function NotificationBellSidebar() {
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('auth_token')
        if (!token) return
        const res = await fetch('/api/support/notifications?limit=10', {
          headers: { 'Authorization': `Bearer ${token}`, 'X-Org-Id': localStorage.getItem('org_id') || '' },
        })
        if (res.ok) {
          const data = await res.json()
          setCount(data.unreadCount || 0)
          setItems(data.notifications || [])
        }
      } catch {}
    }
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const icons: Record<string, string> = { escalation: '🔴', tag: '⚡', critical_case: '🚨', agent_decision: '🤖', sla_breach: '⏰' }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors relative"
        title="Уведомления"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-full bottom-0 ml-2 w-[340px] bg-white rounded-xl shadow-2xl border border-[#e8edf3] z-50 max-h-[400px] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Уведомления</span>
            {count > 0 && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{count} новых</span>}
          </div>
          <div className="overflow-y-auto max-h-[340px]">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">Нет уведомлений</div>
            ) : (
              items.slice(0, 8).map((n: any) => (
                <div key={n.id} className={`px-4 py-2.5 border-b border-slate-50 ${!n.isRead ? 'bg-blue-50/50' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-sm">{icons[n.type] || '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${!n.isRead ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{n.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface MarketOption {
  id: string
  name: string
  code: string
}

interface SidebarProps {
  unreadChats?: number
  openCases?: number
  pendingCommitments?: number
  onlineAgentsCount?: number
  lastUpdated?: number
  currentUser?: {
    name: string
    avatar?: string
    avatarUrl?: string
    role?: string
  }
  onLogout?: () => void
  markets?: MarketOption[]
  selectedMarket?: string | null
  onMarketChange?: (marketId: string | null) => void
  orgName?: string
  orgLogo?: string
  orgPlan?: string
  /** Активен ли AI-агент — зелёная точка-индикатор у пункта «AI Агент». */
  aiAgentActive?: boolean
}

// Редизайн (спецификация GFSupport): меню сгруппировано в 4 секции.
// statusDot — индикатор активности (AI Агент).
interface NavItemDef {
  path: string
  label: string
  icon: typeof LayoutDashboard
  badgeKey?: string
  statusDot?: boolean
}
interface NavGroup {
  label: string
  items: NavItemDef[]
}

const navGroups: NavGroup[] = [
  {
    label: 'Продажи',
    items: [
      // Иконки у продаж свои: раньше «Лиды» и «Чаты» делили один значок, а
      // «Аккаунты» и «Каналы» — решётку, и в свёрнутом меню они были неразличимы
      { path: '/sales/queue', label: 'Очередь дня', icon: ListChecks, badgeKey: 'salesQueue' },
      // Новый общий экран: обращения и сделки вместе. Старые разделы пока на
      // месте — пусть новое докажет себя на живой работе, прежде чем ломать
      // привычную навигацию
      { path: '/sales/funnel', label: 'Воронка', icon: Waypoints },
      { path: '/sales/deals', label: 'Сделки', icon: Handshake, badgeKey: 'salesDeals' },
      { path: '/sales/leads', label: 'Лиды', icon: Inbox, badgeKey: 'salesLeads' },
      { path: '/sales/accounts', label: 'Аккаунты', icon: Building2 },
      { path: '/sales/assistant', label: 'ИИ-ассистент', icon: Bot },
      { path: '/sales/reports', label: 'Отчёты продаж', icon: PieChart },
      { path: '/sales/settings', label: 'Справочники продаж', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'Операции',
    items: [
      { path: '/overview', label: 'Обзор', icon: LayoutDashboard },
      { path: '/chats', label: 'Чаты', icon: MessageSquare, badgeKey: 'unreadChats' },
      { path: '/channels', label: 'Каналы', icon: Hash },
      { path: '/cases', label: 'Кейсы', icon: Briefcase, badgeKey: 'openCases' },
      { path: '/onboarding', label: 'Подключения', icon: Plug },
      // { path: '/commitments', label: 'Обязательства', icon: Clock, badgeKey: 'pendingCommitments' },
    ],
  },
  {
    label: 'Аналитика',
    items: [
      { path: '/analytics', label: 'Аналитика', icon: BarChart3 },
      { path: '/benchmarks', label: 'Бенчмарки', icon: Trophy },
      { path: '/insights-chat', label: 'ИИ-чат', icon: Sparkles },
    ],
  },
  {
    label: 'Автоматизация',
    items: [
      { path: '/ai-agent', label: 'AI Агент', icon: Bot, statusDot: true },
      { path: '/routing', label: 'Маршрутизация', icon: Waypoints },
      // { path: '/knowledge', label: 'База знаний', icon: BookOpen },
      { path: '/broadcast', label: 'Рассылки', icon: Megaphone },
    ],
  },
  {
    label: 'Система',
    items: [
      { path: '/settings', label: 'Настройки', icon: Settings },
      // { path: '/system-map', label: 'Карта системы', icon: Map },
    ],
  },
]

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'

export function Sidebar({ unreadChats = 0, openCases = 0, pendingCommitments = 0, onlineAgentsCount = 0, lastUpdated = 0, currentUser, onLogout, markets = [], selectedMarket, onMarketChange, orgName, orgLogo, orgPlan, aiAgentActive = true }: SidebarProps) {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    return saved === 'true'
  })
  
  // Свёрнутые разделы запоминаем: у каждого своя половина системы, и каждый
  // раз сворачивать чужое заново — раздражение на ровном месте
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sidebar_collapsed_groups') || '[]') } catch { return [] }
  })
  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
      localStorage.setItem('sidebar_collapsed_groups', JSON.stringify(next))
      return next
    })
  }

  // Счётчики продаж: сколько ждёт лично тебя, а не сколько всего в системе
  const [salesBadges, setSalesBadges] = useState<Record<string, number>>({})
  useEffect(() => {
    let alive = true
    const load = () => {
      const token = localStorage.getItem('support_agent_token')
      if (!token || document.visibilityState === 'hidden') return
      fetch('/api/support/sales/queue', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!alive || !d) return
          setSalesBadges({
            salesQueue: (d.sla?.length || 0) + (d.tasks?.length || 0),
            salesDeals: d.stats?.hot_deals ?? 0,
            salesLeads: d.stats?.new_leads ?? 0,
          })
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // Track animated badges
  const [animatingBadges, setAnimatingBadges] = useState<Set<string>>(new Set())
  const prevUpdatedRef = useRef(0) // Трекаем последний timestamp обновления
  const isFirstRenderRef = useRef(true) // Чтобы не анимировать при первом рендере
  
  // Avatar flip animation state - shows online count
  const [showOnlineCount, setShowOnlineCount] = useState(false)
  const flipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  
  // Start/stop avatar flip animation every 30 seconds
  useEffect(() => {
    const startFlip = () => {
      setShowOnlineCount(true)
      // Show online count for 3 seconds
      setTimeout(() => setShowOnlineCount(false), 3000)
    }
    
    // First flip after 5 seconds
    const initialTimeout = setTimeout(startFlip, 5000)
    
    // Then flip every 30 seconds
    flipIntervalRef.current = setInterval(startFlip, 30000)
    
    return () => {
      clearTimeout(initialTimeout)
      if (flipIntervalRef.current) clearInterval(flipIntervalRef.current)
    }
  }, [])
  
  const badges: Record<string, number> = {
    unreadChats,
    openCases,
    pendingCommitments,
    ...salesBadges,
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

  const planConfig = getPlanConfig(orgPlan)
  // Фильтруем пункты по плану, оставляем только непустые группы.
  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(item => planConfig.navPaths.includes(item.path)) }))
    .filter(g => g.items.length > 0)

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  const toggleCollapse = () => setIsCollapsed(!isCollapsed)

  const NavItem = ({ path, label, icon: Icon, badgeKey, statusDot }: NavItemDef) => {
    const active = isActive(path)
    const badgeCount = badgeKey ? badges[badgeKey] : 0
    const isAnimating = badgeKey && animatingBadges.has(badgeKey)
    const showDot = statusDot && aiAgentActive

    return (
      <Link
        to={path}
        title={isCollapsed ? label : undefined}
        style={active ? { background: 'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow: '0 6px 16px rgba(37,99,235,.35)' } : undefined}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-[10px] transition-all group ${
          active
            ? 'text-white'
            : 'text-[#aab8d4] hover:bg-white/10 hover:text-white'
        } ${isCollapsed ? 'justify-center px-3 relative' : ''}`}
      >
        <span className="relative flex-shrink-0">
          <Icon className="w-5 h-5" />
          {isCollapsed && showDot && (
            <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-green-500" style={{ boxShadow: '0 0 0 2px #13213d' }} />
          )}
        </span>
        {!isCollapsed && (
          <>
            <span className="flex-1 font-medium">{label}</span>
            {showDot && (
              <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" style={{ boxShadow: '0 0 0 3px rgba(34,197,94,.18)' }} title="Агент активен" />
            )}
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
        className={`bg-[#13213d] h-full flex flex-col flex-shrink-0 transition-all duration-300 ${
          isCollapsed ? 'w-[72px]' : 'w-[240px]'
        }`}
      >
      {/* Logo + Org */}
      <div className={`p-4 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        <Link to="/overview" className="flex items-center gap-2 min-w-0">
          {orgLogo ? (
            <img src={orgLogo} alt={orgName || 'Org'} className="w-[38px] h-[38px] rounded-xl flex-shrink-0 object-cover" />
          ) : (
            <div
              className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow: '0 4px 14px rgba(37,99,235,.4)' }}
            >
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
          )}
          {!isCollapsed && (
            <div className="min-w-0">
              <span className="text-white font-extrabold text-[17px] block truncate" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>{orgName || 'SUPPORT'}</span>
              <span className="text-[10px] text-[#7e8db0] uppercase tracking-wider">{orgPlan ? `${orgPlan} · OMNICHANNEL` : 'OMNICHANNEL'}</span>
            </div>
          )}
        </Link>
        <button
          onClick={toggleCollapse}
          className={`p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors ${
            isCollapsed ? 'absolute left-[72px] top-4 -translate-x-1/2 bg-[#13213d] border border-white/10 shadow-lg z-10' : ''
          }`}
          title={isCollapsed ? 'Развернуть' : 'Свернуть'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Переключатель рынка убран: регион задаётся в самом разделе.
          Общий на всю систему менял область сразу всему — из сделок по
          Узбекистану нельзя было заглянуть в казахстанские лиды, не переключив
          заодно чаты и аналитику. */}

      {/* Main Navigation — 4 группы (Операции / Аналитика / Автоматизация / Система) */}
      <nav className="flex-1 px-3 overflow-y-auto py-2">
        {visibleGroups.map((group, gi) => {
          // Сворачивается любой раздел, включая тот, где открыта страница:
          // запрет выглядел поломкой — по клику ничего не происходило
          const open = !collapsedGroups.includes(group.label)
          // Сумма по разделу: свёрнутый раздел не должен прятать, что там горит
          const groupCount = group.items.reduce(
            (sum, i) => sum + (i.badgeKey ? badges[i.badgeKey] || 0 : 0), 0)

          return (
            <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>
              {!isCollapsed && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-1.5 px-3 pb-1.5 text-[10px] font-bold
                             uppercase tracking-[0.09em] text-[#5d6f96] hover:text-[#8fa3c8]"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
                  />
                  <span>{group.label}</span>
                  {groupCount > 0 && (
                    <span className={`ml-auto min-w-[18px] text-center text-[10px] font-bold px-1.5 py-0.5
                                     rounded-full ${open ? 'bg-white/10 text-[#8fa3c8]' : 'bg-blue-600 text-white'}`}>
                      {groupCount > 99 ? '99+' : groupCount}
                    </span>
                  )}
                </button>
              )}
              {isCollapsed && gi > 0 && <div className="my-2 mx-3 border-t border-white/10" />}
              {(open || isCollapsed) && (
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <NavItem key={item.path} {...item} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Bottom — пользователь */}
      <div className="px-3 pb-4">
        {/* User */}
        {currentUser && (
          <div className="border-t border-white/10 pt-4">
            <div className={`flex items-center gap-3 px-2 py-2 ${isCollapsed ? 'justify-center' : ''}`}>
              {/* Avatar with flip animation showing online count */}
              <div 
                className="avatar-container w-10 h-10 flex-shrink-0"
                title={isCollapsed ? `${currentUser.name} • ${onlineAgentsCount} онлайн` : undefined}
              >
                <div className={`avatar-flip w-full h-full ${showOnlineCount ? 'flipped' : ''}`}>
                  {/* Front - User Avatar */}
                  <div className="avatar-front w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium overflow-hidden relative">
                    <span className="absolute inset-0 flex items-center justify-center">
                      {currentUser.name.charAt(0).toUpperCase()}
                    </span>
                    {(currentUser.avatar || currentUser.avatarUrl) && (
                      <img 
                        src={currentUser.avatar || currentUser.avatarUrl} 
                        alt="" 
                        className="w-full h-full object-cover relative z-10" 
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                        }}
                      />
                    )}
                  </div>
                  {/* Back - Online Count */}
                  <div className="avatar-back w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold text-sm">
                    {onlineAgentsCount}
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900 animate-pulse" />
                  </div>
                </div>
              </div>
              {!isCollapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
                    <div className="flex items-center gap-2">
                      {currentUser.role && (
                        <p className="text-xs text-slate-400 truncate">{currentUser.role}</p>
                      )}
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                        {onlineAgentsCount} онлайн
                      </span>
                    </div>
                  </div>
                  <NotificationBellSidebar />
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
