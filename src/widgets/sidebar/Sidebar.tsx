import { 
  LayoutDashboard, 
  MessageSquare, 
  FolderKanban, 
  BarChart3, 
  Settings,
  Users
} from 'lucide-react'

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  unreadChats?: number
  openCases?: number
}

const navItems = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { id: 'chats', label: 'Чаты', icon: MessageSquare, badge: 'unreadChats' },
  { id: 'cases', label: 'Кейсы', icon: FolderKanban, badge: 'openCases' },
  { id: 'users', label: 'Клиенты', icon: Users },
  { id: 'reports', label: 'Отчёты', icon: BarChart3 },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

export function Sidebar({ activeTab, onTabChange, unreadChats = 0, openCases = 0 }: SidebarProps) {
  const badges: Record<string, number> = {
    unreadChats,
    openCases
  }

  return (
    <aside className="w-[200px] bg-brand-darkBlue min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-blue rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-semibold">SUPPORT</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon
          const badgeCount = item.badge ? badges[item.badge] : 0
          const isActive = activeTab === item.id

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-brand-blue text-white' 
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="flex-1 text-left text-sm">{item.label}</span>
              {badgeCount > 0 && (
                <span className={`min-w-[20px] h-5 px-1.5 flex items-center justify-center text-xs font-medium rounded-full ${
                  isActive ? 'bg-white/20 text-white' : 'bg-brand-blue text-white'
                }`}>
                  {badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Settings at bottom */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => onTabChange('settings')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-brand-blue text-white'
              : 'text-slate-300 hover:bg-white/10'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-sm">Настройки</span>
        </button>
      </div>
    </aside>
  )
}
