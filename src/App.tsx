import { lazy, Suspense } from 'react'
import { lazyLoad } from '@/shared/lib/stale-chunk'
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

const DashboardPage = lazy(lazyLoad(() => import('@/pages/dashboard/ui/DashboardPage').then(m => ({ default: m.DashboardPage }))))
const ChatsPage = lazy(lazyLoad(() => import('@/pages/chats/ui/ChatsPage').then(m => ({ default: m.ChatsPage }))))
const ChannelsListPage = lazy(lazyLoad(() => import('@/pages/channels/ui/ChannelsListPage').then(m => ({ default: m.ChannelsListPage }))))
const CasesPage = lazy(lazyLoad(() => import('@/pages/cases/ui/CasesPage').then(m => ({ default: m.CasesPage }))))
const BroadcastPage = lazy(lazyLoad(() => import('@/pages/broadcast/ui/BroadcastPage').then(m => ({ default: m.BroadcastPage }))))
const SettingsPage = lazy(lazyLoad(() => import('@/pages/settings/ui/SettingsPage').then(m => ({ default: m.SettingsPage }))))
const LoginPage = lazy(lazyLoad(() => import('@/pages/login/ui/LoginPage').then(m => ({ default: m.LoginPage }))))
const RegisterPage = lazy(lazyLoad(() => import('@/pages/register/ui/RegisterPage').then(m => ({ default: m.RegisterPage }))))
const KnowledgePage = lazy(lazyLoad(() => import('@/pages/knowledge/ui/KnowledgePage').then(m => ({ default: m.KnowledgePage }))))
const CommitmentsPage = lazy(lazyLoad(() => import('@/pages/commitments/ui/CommitmentsPage').then(m => ({ default: m.CommitmentsPage }))))
const OnboardingPage = lazy(lazyLoad(() => import('@/pages/onboarding/ui/OnboardingPage').then(m => ({ default: m.OnboardingPage }))))
const MyWorkspacePage = lazy(lazyLoad(() => import('@/pages/me/ui/MyWorkspacePage').then(m => ({ default: m.MyWorkspacePage }))))
const OrgRegisterPage = lazy(lazyLoad(() => import('@/pages/org-register/ui/OrgRegisterPage')))
const LandingPage = lazy(lazyLoad(() => import('@/pages/landing/ui/LandingPage')))
const PublicDocPage = lazy(lazyLoad(() => import('@/pages/doc/ui/PublicDocPage')))
const ClientPortalPage = lazy(lazyLoad(() => import('@/pages/portal/ui/ClientPortalPage')))
const PublicBookPage = lazy(lazyLoad(() => import('@/pages/book/ui/PublicBookPage')))
const PublicJobPage = lazy(lazyLoad(() => import('@/pages/jobs/ui/PublicJobPage')))
const HiringPage = lazy(lazyLoad(() => import('@/pages/hiring/ui/HiringPage')))
const SalesQueuePage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesQueuePage')))
const SalesDealPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesDealPage')))
const SalesLeadPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesLeadPage')))
const SalesAccountsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesAccountsPage')))
const SalesAccountPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesAccountPage')))
const SalesReportsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesReportsPage')))
const SalesSettingsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesSettingsPage')))
const SalesAssistantPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesAssistantPage')))
const SalesFunnelPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesFunnelPage')))
const SalesCommentsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesCommentsPage')))
const SalesCallsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesCallsPage')))
const SalesActivityPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesActivityPage')))
const SalesSignalsPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesSignalsPage')))
const WhatsNewPage = lazy(lazyLoad(() => import('@/pages/whatsnew/ui/WhatsNewPage')))
const CreatorPage = lazy(lazyLoad(() => import('@/pages/creator/ui/CreatorPage')))
const SalesTasksPage = lazy(lazyLoad(() => import('@/pages/sales/ui/SalesTasksPage')))
const ReleasesPage = lazy(lazyLoad(() => import('@/pages/releases/ui/ReleasesPage')))
const AIAgentPage = lazy(lazyLoad(() => import('@/pages/ai-agent/ui/AIAgentPage')))
const InsightsChatPage = lazy(lazyLoad(() => import('@/pages/insights-chat/ui/InsightsChatPage').then(m => ({ default: m.InsightsChatPage }))))
const BenchmarksPage = lazy(lazyLoad(() => import('@/pages/benchmarks/ui/BenchmarksPage').then(m => ({ default: m.BenchmarksPage }))))
const AnalyticsPage = lazy(lazyLoad(() => import('@/pages/analytics/ui/AnalyticsPage').then(m => ({ default: m.AnalyticsPage }))))
const RoutingPage = lazy(lazyLoad(() => import('@/pages/routing/ui/RoutingPage').then(m => ({ default: m.RoutingPage }))))
const SystemMapPage = lazy(lazyLoad(() => import('@/pages/system-map/ui/SystemMapPage').then(m => ({ default: m.SystemMapPage }))))

const SALoginPage = lazy(lazyLoad(() => import('@/pages/sa-login/ui/SALoginPage')))
const SADashboardPage = lazy(lazyLoad(() => import('@/pages/sa-dashboard/ui/SADashboardPage')))
const SAOrganizationsPage = lazy(lazyLoad(() => import('@/pages/sa-organizations/ui/SAOrganizationsPage')))
const SAAuditPage = lazy(lazyLoad(() => import('@/pages/sa-audit/ui/SAAuditPage')))
const SASettingsPage = lazy(lazyLoad(() => import('@/pages/sa-settings/ui/SASettingsPage')))
const SuperAdminLayout = lazy(lazyLoad(() => import('@/app/layouts/SuperAdminLayout').then(m => ({ default: m.SuperAdminLayout }))))

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
        {/* Публичная страница документа: открывает клиент, авторизация не нужна */}
        <Route path="/d/:token" element={<PublicDocPage />} />
        {/* Клиентский статус-портал: ссылка живёт в группе клиента */}
        <Route path="/r/:token" element={<ClientPortalPage />} />
        {/* Публичная бронь встречи: ссылку ставит сайт, авторизация не нужна */}
        <Route path="/b/:token" element={<PublicBookPage />} />
        {/* Публичная вакансия: лендинг + ИИ-интервью кандидата, без авторизации */}
        <Route path="/jobs/:slug" element={<PublicJobPage />} />

        <Route element={<MainLayout />}>
          <Route path="/overview" element={<DashboardPage />} />
          <Route path="/me" element={<MyWorkspacePage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/:id" element={<ChatsPage />} />
          {/* Тот же экран, но только разговоры продаж: у них другой смысл,
              и мешать их с четырьмя сотнями чатов поддержки нельзя */}
          <Route path="/sales/chats" element={<ChatsPage scope="sales" />} />
          <Route path="/sales/chats/:id" element={<ChatsPage scope="sales" />} />
          <Route path="/channels" element={<ChannelsListPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/health" element={<Navigate to="/analytics?tab=diagnosis" replace />} />
          <Route path="/health-legacy" element={<Navigate to="/analytics?tab=diagnosis" replace />} />
          <Route path="/commitments" element={<CommitmentsPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/hiring" element={<HiringPage />} />
          <Route path="/sales/queue" element={<SalesQueuePage />} />
          <Route path="/sales/deals/:id" element={<SalesDealPage />} />
          <Route path="/sales/leads/:id" element={<SalesLeadPage />} />
          <Route path="/sales/accounts" element={<SalesAccountsPage />} />
          <Route path="/sales/partners" element={<SalesAccountsPage />} />
          <Route path="/sales/accounts/:id" element={<SalesAccountPage />} />
          <Route path="/sales/reports" element={<SalesReportsPage />} />
          <Route path="/sales/funnel" element={<SalesFunnelPage />} />
          <Route path="/sales/comments" element={<SalesCommentsPage />} />
          <Route path="/sales/calls" element={<SalesCallsPage />} />
          <Route path="/sales/activity" element={<SalesActivityPage />} />
          <Route path="/sales/signals" element={<SalesSignalsPage />} />
          <Route path="/whats-new" element={<WhatsNewPage />} />
          {/* Креатор — личный модуль владельца; API закрыт по agent_id */}
          <Route path="/creator" element={<CreatorPage />} />
          <Route path="/sales/tasks" element={<SalesTasksPage />} />
          <Route path="/whats-new" element={<ReleasesPage />} />
          <Route path="/sales/assistant" element={<SalesAssistantPage />} />
          <Route path="/sales/kpi" element={<Navigate to="/settings?tab=team" replace />} />
          <Route path="/sales/settings" element={<SalesSettingsPage />} />
          <Route path="/sla-report" element={<Navigate to="/analytics?tab=detail" replace />} />
          <Route path="/sla-report-legacy" element={<Navigate to="/analytics?tab=detail" replace />} />
          <Route path="/benchmarks" element={<BenchmarksPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          {/* Консолидация в Knowledge Hub: документы и анализ проблем — вкладки */}
          <Route path="/docs" element={<Navigate to="/knowledge?tab=docs" replace />} />
          <Route path="/learning/problems" element={<Navigate to="/knowledge?tab=patterns" replace />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/ai-agent" element={<AIAgentPage />} />
          <Route path="/routing" element={<RoutingPage />} />
          <Route path="/system-map" element={<SystemMapPage />} />
          <Route path="/insights-chat" element={<InsightsChatPage />} />
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
