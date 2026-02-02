import { Clock, MessageSquare, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react'

interface Metrics {
  waiting: number
  avgResponseTime: string
  slaPercent: number
  urgentCases: number
  resolvedToday?: number
}

interface MetricsBarProps {
  metrics: Metrics
  className?: string
}

export function MetricsBar({ metrics, className = '' }: MetricsBarProps) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <MetricCard
        icon={<MessageSquare className="w-4 h-4" />}
        value={metrics.waiting}
        label="Ждут ответа"
        variant={metrics.waiting > 0 ? 'warning' : 'default'}
      />
      
      <MetricCard
        icon={<Clock className="w-4 h-4" />}
        value={metrics.avgResponseTime}
        label="Среднее время"
        variant={parseInt(metrics.avgResponseTime) > 30 ? 'danger' : 'default'}
      />
      
      <MetricCard
        icon={<TrendingUp className="w-4 h-4" />}
        value={`${metrics.slaPercent}%`}
        label="SLA"
        variant={metrics.slaPercent < 90 ? 'danger' : 'success'}
      />
      
      <MetricCard
        icon={<AlertTriangle className="w-4 h-4" />}
        value={metrics.urgentCases}
        label="Срочные"
        variant={metrics.urgentCases > 0 ? 'danger' : 'default'}
      />

      {metrics.resolvedToday !== undefined && (
        <MetricCard
          icon={<CheckCircle className="w-4 h-4" />}
          value={metrics.resolvedToday}
          label="Решено сегодня"
          variant="success"
        />
      )}
    </div>
  )
}

interface MetricCardProps {
  icon: React.ReactNode
  value: string | number
  label: string
  variant?: 'default' | 'warning' | 'danger' | 'success'
}

function MetricCard({ icon, value, label, variant = 'default' }: MetricCardProps) {
  const variants = {
    default: 'bg-white border-slate-200 text-slate-700',
    warning: 'bg-orange-50 border-orange-200 text-orange-700',
    danger: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-700',
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${variants[variant]}`}>
      {icon}
      <div>
        <div className="text-lg font-bold leading-tight">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  )
}
