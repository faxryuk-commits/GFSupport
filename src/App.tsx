import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/app/layouts'
import { LoadingSpinner } from '@/shared/ui'
import './index.css'

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <LoadingSpinner size="lg" />
    </div>
  )
}

const isAdmin = window.location.hostname.startsWith('admin.')

const DashboardPage = lazy(() => import('@/pages/dashboard/ui/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ChatsPage = lazy(() => import('@/pages/chats/ui/ChatsPage').then(m => ({ default: m.ChatsPage })))
const ChannelsListPage = lazy(() => import('@/pages/channels/ui/ChannelsListPage').then(m => ({ default: m.ChannelsListPage })))
const CasesPage = lazy(() => import('@/pages/cases/ui/CasesPage').then(m => ({ default: m.CasesPage })))
const BroadcastPage = lazy(() => import('@/pages/broadcast/ui/BroadcastPage').then(m => ({ default: m.BroadcastPage })))
const SettingsPage = lazy(() => import('@/pages/settings/ui/SettingsPage').then(m => ({ default: m.SettingsPage })))
const LoginPage = lazy(() => import('@/pages/login/ui/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/register/ui/RegisterPage').then(m => ({ default: m.RegisterPage })))
const KnowledgePage = lazy(() => import('@/pages/knowledge/ui/KnowledgePage').then(m => ({ default: m.KnowledgePage })))
const DocsPage = lazy(() => import('@/pages/docs/ui/DocsPage').then(m => ({ default: m.DocsPage })))
const ProblemAnalysisPage = lazy(() => import('@/pages/learning/ui/ProblemAnalysisPage'))
const CommitmentsPage = lazy(() => import('@/pages/commitments/ui/CommitmentsPage').then(m => ({ default: m.CommitmentsPage })))
const SLAReportPage = lazy(() => import('@/pages/sla-report/ui/SLAReportPage').then(m => ({ default: m.SLAReportPage })))
const OrgRegisterPage = lazy(() => import('@/pages/org-register/ui/OrgRegisterPage'))
const LandingPage = lazy(() => import('@/pages/landing/ui/LandingPage'))
const AIAgentPage = lazy(() => import('@/pages/ai-agent/ui/AIAgentPage'))
const HealthPage = lazy(() => import('@/pages/health/ui/HealthPage').then(m => ({ default: m.HealthPage })))

const SALoginPage = lazy(() => import('@/pages/sa-login/ui/SALoginPage'))
const SADashboardPage = lazy(() => import('@/pages/sa-dashboard/ui/SADashboardPage'))
const SAOrganizationsPage = lazy(() => import('@/pages/sa-organizations/ui/SAOrganizationsPage'))
const SAAuditPage = lazy(() => import('@/pages/sa-audit/ui/SAAuditPage'))
const SASettingsPage = lazy(() => import('@/pages/sa-settings/ui/SASettingsPage'))
const SuperAdminLayout = lazy(() => import('@/app/layouts/SuperAdminLayout').then(m => ({ default: m.SuperAdminLayout })))

function HomeRedirect() {
  const token = localStorage.getItem('support_agent_token')
  if (token) return <Navigate to="/overview" replace />
  return <LandingPage />
}

export default function App() {
  if (isAdmin) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<SALoginPage />} />
          <Route element={<SuperAdminLayout />}>
            <Route path="/dashboard" element={<SADashboardPage />} />
            <Route path="/organizations" element={<SAOrganizationsPage />} />
            <Route path="/audit" element={<SAAuditPage />} />
            <Route path="/settings" element={<SASettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<OrgRegisterPage />} />
        <Route path="/support/register/:token" element={<RegisterPage />} />
        <Route path="/register/:token" element={<RegisterPage />} />

        <Route element={<MainLayout />}>
          <Route path="/overview" element={<DashboardPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/:id" element={<ChatsPage />} />
          <Route path="/channels" element={<ChannelsListPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/commitments" element={<CommitmentsPage />} />
          <Route path="/sla-report" element={<SLAReportPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/learning/problems" element={<ProblemAnalysisPage />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/ai-agent" element={<AIAgentPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="/reports" element={<Navigate to="/overview" replace />} />
        <Route path="/team" element={<Navigate to="/settings" replace />} />
        <Route path="/users" element={<Navigate to="/settings" replace />} />
        <Route path="/automations" element={<Navigate to="/settings" replace />} />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  )
}
