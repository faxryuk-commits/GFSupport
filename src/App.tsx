import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/app/layouts'
import { 
  DashboardPage, 
  ChatsPage,
  ChannelsListPage,
  CasesPage, 
  BroadcastPage,
  SettingsPage,
  LoginPage,
  RegisterPage,
  KnowledgePage,
  DocsPage,
  ProblemAnalysisPage,
} from '@/pages'
import { CommitmentsPage } from '@/pages/commitments'
import { SLAReportPage } from '@/pages/sla-report'
import './index.css'

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/support/register/:token" element={<RegisterPage />} />
      <Route path="/register/:token" element={<RegisterPage />} />

      {/* Protected routes with layout */}
      <Route element={<MainLayout />}>
        {/* Main */}
        <Route path="/overview" element={<DashboardPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/chats/:id" element={<ChatsPage />} />
        <Route path="/channels" element={<ChannelsListPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/commitments" element={<CommitmentsPage />} />
        <Route path="/sla-report" element={<SLAReportPage />} />
        
        {/* Knowledge & Docs */}
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/docs" element={<DocsPage />} />
        
        {/* Learning & AI */}
        <Route path="/learning/problems" element={<ProblemAnalysisPage />} />
        
        {/* Manage */}
        <Route path="/broadcast" element={<BroadcastPage />} />
        
        {/* Settings */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Redirects - old routes to settings */}
      <Route path="/reports" element={<Navigate to="/overview" replace />} />
      <Route path="/team" element={<Navigate to="/settings" replace />} />
      <Route path="/users" element={<Navigate to="/settings" replace />} />
      <Route path="/automations" element={<Navigate to="/settings" replace />} />
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}
