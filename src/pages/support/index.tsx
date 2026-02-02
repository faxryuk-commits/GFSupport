import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SupportLogin } from './Login'
import { SupportDashboard } from './Dashboard'
import { SupportRegister } from './Register'

// Lazy load Guide page
const SupportGuide = lazy(() => import('./Guide'))

// Lazy load Mobile version
const MobileSupportRoutes = lazy(() => import('./mobile'))

// Protected route wrapper - использует support_agent_token
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [isChecking, setIsChecking] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // Проверяем токен на клиенте
    const token = localStorage.getItem('support_agent_token')
    setIsAuthenticated(!!token)
    setIsChecking(false)
  }, [])

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/support/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

// Support Routes - добавлены отдельные пути для вкладок
function SupportRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SupportLogin />} />
      <Route path="/register/:token" element={<SupportRegister />} />
      <Route path="/" element={
        <ProtectedRoute>
          <SupportDashboard />
        </ProtectedRoute>
      } />
      {/* Отдельные пути для вкладок */}
      <Route path="/channels" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="channels" />
        </ProtectedRoute>
      } />
      <Route path="/channels/:channelId" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="channels" />
        </ProtectedRoute>
      } />
      <Route path="/messages" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="messages" />
        </ProtectedRoute>
      } />
      <Route path="/messages/:channelId" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="messages" />
        </ProtectedRoute>
      } />
      <Route path="/messages/:channelId/:messageId" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="messages" />
        </ProtectedRoute>
      } />
      <Route path="/cases" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="cases" />
        </ProtectedRoute>
      } />
      <Route path="/cases/:caseId" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="cases" />
        </ProtectedRoute>
      } />
      <Route path="/analytics" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="analytics" />
        </ProtectedRoute>
      } />
      <Route path="/agents" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="agents" />
        </ProtectedRoute>
      } />
      <Route path="/users" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="users" />
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute>
          <SupportDashboard defaultTab="settings" />
        </ProtectedRoute>
      } />
      <Route path="/guide" element={
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
          <SupportGuide />
        </Suspense>
      } />
      {/* Mobile version routes */}
      <Route path="/m/*" element={
        <ProtectedRoute>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>}>
            <MobileSupportRoutes />
          </Suspense>
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/support" replace />} />
    </Routes>
  )
}

// Main Support App
export function SupportApp() {
  return <SupportRoutes />
}
