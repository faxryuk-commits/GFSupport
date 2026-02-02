import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from '@/widgets/sidebar'

export function MainLayout() {
  const navigate = useNavigate()
  
  const currentUser = {
    name: 'Admin User',
    role: 'Administrator',
  }

  const handleLogout = () => {
    localStorage.removeItem('auth')
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar 
        unreadChats={5} 
        openCases={3}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
