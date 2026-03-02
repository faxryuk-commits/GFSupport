import { TrendingUp, Clock, CheckCircle, Users } from 'lucide-react'
import type { OnboardingAnalytics } from '@/entities/onboarding'

interface OnboardingKPICardsProps {
  analytics: OnboardingAnalytics
}

interface KPICardProps {
  icon: React.ReactNode
  title: string
  value: number | string
  subtitle: string
  subtitleColor?: string
}

function KPICard({ icon, title, value, subtitle, subtitleColor = 'text-gray-500' }: KPICardProps) {
  return (
    <div className="flex-1 rounded-xl border border-gray-100 bg-white p-5">
      <div className="mb-2 flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">
          {title}
        </span>
      </div>
      <p className="text-3xl font-bold text-gray-800">{value}</p>
      <p className={`mt-1 text-sm ${subtitleColor}`}>{subtitle}</p>
    </div>
  )
}

export function OnboardingKPICards({ analytics }: OnboardingKPICardsProps) {
  const {
    totalConnections,
    avgLaunchDays,
    onTimePercentage,
    activeCount,
    overdueCount,
  } = analytics

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KPICard
        icon={<TrendingUp className="h-4 w-4" />}
        title="Всего подключений"
        value={totalConnections}
        subtitle={`+${activeCount} за месяц`}
        subtitleColor="text-green-600"
      />
      <KPICard
        icon={<Clock className="h-4 w-4" />}
        title="Среднее время запуска"
        value={`${avgLaunchDays} дн.`}
        subtitle={`план: ${Math.round(avgLaunchDays * 0.9)} дней`}
      />
      <KPICard
        icon={<CheckCircle className="h-4 w-4" />}
        title="Вовремя"
        value={`${onTimePercentage}%`}
        subtitle={`+${Math.max(0, onTimePercentage - 80)}% к прошлому`}
        subtitleColor="text-green-600"
      />
      <KPICard
        icon={<Users className="h-4 w-4" />}
        title="Активных сейчас"
        value={activeCount}
        subtitle={overdueCount > 0 ? `${overdueCount} просрочено` : 'Нет просроченных'}
        subtitleColor={overdueCount > 0 ? 'text-red-600' : 'text-green-600'}
      />
    </div>
  )
}
