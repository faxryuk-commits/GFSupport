import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

// Lazy load mobile dashboard for code splitting
const MobileDashboard = lazy(() => import('./MobileDashboard'))

// Loading component
function MobileLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
    </div>
  )
}

// Mobile Support Routes
export function MobileSupportRoutes() {
  return (
    <Suspense fallback={<MobileLoader />}>
      <Routes>
        <Route path="/" element={<MobileDashboard />} />
        <Route path="/messages" element={<MobileDashboard defaultTab="messages" />} />
        <Route path="/messages/:channelId" element={<MobileDashboard defaultTab="messages" />} />
        <Route path="/cases" element={<MobileDashboard defaultTab="cases" />} />
        <Route path="/cases/:caseId" element={<MobileDashboard defaultTab="cases" />} />
        <Route path="/analytics" element={<MobileDashboard defaultTab="analytics" />} />
        <Route path="*" element={<Navigate to="/support/m" replace />} />
      </Routes>
    </Suspense>
  )
}

export default MobileSupportRoutes
