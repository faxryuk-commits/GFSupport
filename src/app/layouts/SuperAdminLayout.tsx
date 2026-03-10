import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Building2, ScrollText, Settings, LogOut, Shield,
  ChevronLeft, ChevronRight
} from 'lucide-react'

const SA_TOKEN_KEY = 'sa_token'
const SA_DATA_KEY = 'sa_data'

interface SAData {
  id: string
  email: string
  name: string
  role: string
}

const navItems = [
  { path: '/sa/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { path: '/sa/organizations', label: 'Организации', icon: Building2 },
  { path: '/sa/audit', label: 'Аудит логи', icon: ScrollText },
  { path: '/sa/settings', label: 'Настройки', icon: Settings },
]

export function SuperAdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [admin, setAdmin] = useState<SAData | null>(null)

  useEffect(() => {
    const token = localStorage.getItem(SA_TOKEN_KEY)
    if (!token) {
      navigate('/sa/login')
      return
    }
    try {
      const data = JSON.parse(localStorage.getItem(SA_DATA_KEY) || '{}')
      setAdmin(data)
    } catch {
      navigate('/sa/login')
    }
  }, [navigate])

  const handleLogout = () => {
    localStorage.removeItem(SA_TOKEN_KEY)
    localStorage.removeItem(SA_DATA_KEY)
    navigate('/sa/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-900 text-white flex flex-col transition-all duration-200`}
      >
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="w-6 h-6 text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">GFSupport</div>
                <div className="text-[10px] text-gray-400">Platform Admin</div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-gray-700 rounded text-gray-400"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-4 border-t border-gray-700">
          {!collapsed && admin && (
            <div className="mb-3">
              <div className="text-sm font-medium truncate">{admin.name}</div>
              <div className="text-xs text-gray-400 truncate">{admin.email}</div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 w-full text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Выйти</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
