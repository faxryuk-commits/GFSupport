import { Search, Bell, MoreHorizontal } from 'lucide-react'
import type { SupportAgent } from '../../shared/types'

interface HeaderProps {
  agent: SupportAgent | null
  metrics?: {
    waiting: number
    avgResponse: string
    slaPercent: number
    urgent: number
  }
  onProfileClick?: () => void
  onNotificationClick?: () => void
}

export function Header({ agent, metrics, onProfileClick, onNotificationClick }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search for chats, cases..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue"
          />
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="flex items-center gap-4 mx-6">
          <MetricCard 
            value={metrics.waiting} 
            label="waiting" 
            variant={metrics.waiting > 0 ? 'warning' : 'default'} 
          />
          <MetricCard 
            value={metrics.avgResponse} 
            label="response" 
            variant={parseInt(metrics.avgResponse) > 30 ? 'danger' : 'default'} 
          />
          <MetricCard 
            value={`${metrics.slaPercent}%`} 
            label="SLA" 
            variant={metrics.slaPercent < 90 ? 'danger' : 'default'} 
          />
          <MetricCard 
            value={metrics.urgent} 
            label="urgent" 
            variant={metrics.urgent > 0 ? 'danger' : 'default'} 
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Avatar */}
        <button 
          onClick={onProfileClick}
          className="w-9 h-9 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          {agent?.name?.charAt(0) || 'U'}
        </button>

        {/* Notifications */}
        <button 
          onClick={onNotificationClick}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors relative"
        >
          <Bell className="w-5 h-5 text-slate-500" />
        </button>

        {/* More */}
        <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <MoreHorizontal className="w-5 h-5 text-slate-500" />
        </button>
      </div>
    </header>
  )
}

function MetricCard({ 
  value, 
  label, 
  variant = 'default' 
}: { 
  value: string | number
  label: string
  variant?: 'default' | 'warning' | 'danger'
}) {
  const variants = {
    default: 'bg-white border-slate-200 text-slate-800',
    warning: 'bg-orange-50 border-orange-200 text-orange-700',
    danger: 'bg-red-50 border-red-200 text-red-700'
  }

  return (
    <div className={`px-4 py-2 rounded-lg border ${variants[variant]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
