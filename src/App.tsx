import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/app/layouts'
import { 
  DashboardPage, 
  ChatsPage, 
  CasesPage, 
  AnalyticsPage, 
  TeamPage, 
  UsersPage,
  AutomationsPage,
  BroadcastPage,
  SettingsPage,
  LoginPage 
} from '@/pages'
import './index.css'

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes with layout */}
      <Route element={<MainLayout />}>
        {/* Main */}
        <Route path="/overview" element={<DashboardPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/chats/:id" element={<ChatsPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/reports" element={<AnalyticsPage />} />
        
        {/* Manage */}
        <Route path="/team" element={<TeamPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/broadcast" element={<BroadcastPage />} />
        
        {/* Settings */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}
