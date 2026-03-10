import { lazy, Suspense, useMemo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/app/layouts'
import { SuperAdminLayout } from '@/app/layouts/SuperAdminLayout'
import { LoadingSpinner } from '@/shared/ui'
import './index.css'

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

const SALoginPage = lazy(() => import('@/pages/sa-login/ui/SALoginPage'))
const SADashboardPage = lazy(() => import('@/pages/sa-dashboard/ui/SADashboardPage'))
const SAOrganizationsPage = lazy(() => import('@/pages/sa-organizations/ui/SAOrganizationsPage'))
const SAAuditPage = lazy(() => import('@/pages/sa-audit/ui/SAAuditPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <LoadingSpinner size="lg" />
    </div>
  )
}

function isAdminSubdomain(): boolean {
  const host = window.location.hostname
  return host.startsWith('admin.') || host === 'admin'
}

function SuperAdminRoutes() {
  return (
    <Routes>
      <Route path="/sa/login" element={<Suspense fallback={<PageLoader />}><SALoginPage /></Suspense>} />
      <Route element={<SuperAdminLayout />}>
        <Route path="/sa/dashboard" element={<Suspense fallback={<PageLoader />}><SADashboardPage /></Suspense>} />
        <Route path="/sa/organizations" element={<Suspense fallback={<PageLoader />}><SAOrganizationsPage /></Suspense>} />
        <Route path="/sa/audit" element={<Suspense fallback={<PageLoader />}><SAAuditPage /></Suspense>} />
      </Route>
      <Route path="/" element={<Navigate to="/sa/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/sa/dashboard" replace />} />
    </Routes>
  )
}

function ClientRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<Suspense fallback={<PageLoader />}><OrgRegisterPage /></Suspense>} />
      <Route path="/support/register/:token" element={<RegisterPage />} />
      <Route path="/register/:token" element={<RegisterPage />} />

      <Route element={<MainLayout />}>
        <Route path="/overview" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
        <Route path="/chats" element={<Suspense fallback={<PageLoader />}><ChatsPage /></Suspense>} />
        <Route path="/chats/:id" element={<Suspense fallback={<PageLoader />}><ChatsPage /></Suspense>} />
        <Route path="/channels" element={<Suspense fallback={<PageLoader />}><ChannelsListPage /></Suspense>} />
        <Route path="/cases" element={<Suspense fallback={<PageLoader />}><CasesPage /></Suspense>} />
        <Route path="/commitments" element={<Suspense fallback={<PageLoader />}><CommitmentsPage /></Suspense>} />
        <Route path="/sla-report" element={<Suspense fallback={<PageLoader />}><SLAReportPage /></Suspense>} />
        <Route path="/knowledge" element={<Suspense fallback={<PageLoader />}><KnowledgePage /></Suspense>} />
        <Route path="/docs" element={<Suspense fallback={<PageLoader />}><DocsPage /></Suspense>} />
        <Route path="/learning/problems" element={<Suspense fallback={<PageLoader />}><ProblemAnalysisPage /></Suspense>} />
        <Route path="/broadcast" element={<Suspense fallback={<PageLoader />}><BroadcastPage /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
      </Route>

      <Route path="/sa/*" element={<SuperAdminRoutes />} />

      <Route path="/reports" element={<Navigate to="/overview" replace />} />
      <Route path="/team" element={<Navigate to="/settings" replace />} />
      <Route path="/users" element={<Navigate to="/settings" replace />} />
      <Route path="/automations" element={<Navigate to="/settings" replace />} />
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}

export default function App() {
  const isSA = useMemo(() => isAdminSubdomain(), [])

  return (
    <Suspense fallback={<PageLoader />}>
      {isSA ? <SuperAdminRoutes /> : <ClientRoutes />}
    </Suspense>
  )
}
