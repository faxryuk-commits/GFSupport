import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MessageSquare, 
  Briefcase, 
  BarChart3, 
  Users,
  Settings,
  Zap,
  Megaphone,
  UsersRound,
  LogOut
} from 'lucide-react'

interface SidebarProps {
  unreadChats?: number
  openCases?: number
  currentUser?: {
    name: string
    avatar?: string
    role?: string
  }
  onLogout?: () => void
}

const mainNavItems = [
  { path: '/overview', label: 'Overview', icon: LayoutDashboard },
  { path: '/chats', label: 'Chats', icon: MessageSquare, badgeKey: 'unreadChats' },
  { path: '/cases', label: 'Cases', icon: Briefcase, badgeKey: 'openCases' },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
]

const manageNavItems = [
  { path: '/team', label: 'Team', icon: UsersRound },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/automations', label: 'Automations', icon: Zap },
  { path: '/broadcast', label: 'Broadcast', icon: Megaphone },
]

const bottomItems = [
  { path: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ unreadChats = 0, openCases = 0, currentUser, onLogout }: SidebarProps) {
  const location = useLocation()
  
  const badges: Record<string, number> = {
    unreadChats,
    openCases
  }

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <aside className="w-[240px] bg-[#1a2b4b] min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-5">
        <Link to="/overview" className="flex items-center gap-2">
          <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg">SUPPORT</span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3">
        {/* Main */}
        <div className="mb-6">
          <p className="px-4 mb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Main</p>
          <div className="space-y-1">
            {mainNavItems.map(item => {
              const Icon = item.icon
              const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0
              const active = isActive(item.path)

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                    active 
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' 
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="flex-1 font-medium">{item.label}</span>
                  {badgeCount > 0 && (
                    <span className={`min-w-[22px] h-5 px-1.5 flex items-center justify-center text-xs font-semibold rounded-full ${
                      active ? 'bg-white/20 text-white' : 'bg-blue-500 text-white'
                    }`}>
                      {badgeCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>

        {/* Manage */}
        <div className="mb-6">
          <p className="px-4 mb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Manage</p>
          <div className="space-y-1">
            {manageNavItems.map(item => {
              const Icon = item.icon
              const active = isActive(item.path)

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                    active 
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' 
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Bottom Navigation */}
      <div className="px-3 pb-4">
        {/* Settings */}
        <div className="space-y-1 mb-4">
          {bottomItems.map(item => {
            const Icon = item.icon
            const active = isActive(item.path)

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                  active 
                    ? 'bg-blue-500 text-white' 
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>

        {/* User */}
        {currentUser && (
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  currentUser.name.charAt(0)
                )}
              </div>
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
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
