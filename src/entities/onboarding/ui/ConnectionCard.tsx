import { Pause, Snowflake } from 'lucide-react'
import type { OnboardingConnection } from '../model/types'
import { AvatarGroup } from '@/shared/ui/Avatar'
import { ProgressDots } from './ProgressDots'
import { BallIndicator } from './BallIndicator'
import { StatusBadge } from './StatusBadge'

interface ConnectionCardProps {
  connection: OnboardingConnection
  onClick: () => void
  teamAvatars?: { src?: string | null; name: string }[]
}

function getIndicatorColor(connection: OnboardingConnection) {
  if (connection.isOverdue ?? connection.stageOverdue) return 'bg-red-500'
  if (connection.status === 'paused' || connection.status === 'frozen') return 'bg-amber-500'
  return 'bg-green-500'
}

function getBorderColor(connection: OnboardingConnection) {
  if (connection.isOverdue ?? connection.stageOverdue) return 'border-l-red-500'
  if (connection.status === 'paused' || connection.status === 'frozen') return 'border-l-amber-500'
  return 'border-l-green-500'
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

export function ConnectionCard({
  connection,
  onClick,
  teamAvatars = [],
}: ConnectionCardProps) {
  const isPausedOrFrozen = connection.status === 'paused' || connection.status === 'frozen'
  const avatars = teamAvatars.length > 0
    ? teamAvatars
    : connection.managerName
      ? [{ name: connection.managerName }]
      : []

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`
        flex items-center gap-4 w-full p-4 rounded-lg border-l-4 cursor-pointer
        hover:bg-slate-50 transition-colors
        ${getBorderColor(connection)}
        ${isPausedOrFrozen ? 'opacity-75' : ''}
      `}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getIndicatorColor(connection)}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900">{connection.clientName}</span>
          {connection.templateName && (
            <span className="text-sm text-slate-500">{connection.templateName}</span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-1 flex-wrap">
          <ProgressDots
            completed={connection.completedStages ?? 0}
            total={connection.totalStages ?? 0}
            size="sm"
          />
          {connection.currentStageName && (
            <span className="text-sm text-slate-600">{connection.currentStageName}</span>
          )}
          {connection.ballHolder && connection.ballHolderType && (
            <BallIndicator
              holder={connection.ballHolder}
              type={connection.ballHolderType}
              days={connection.daysOnStage ?? 0}
            />
          )}
          {connection.daysOnStage != null && (
            <span className={`text-sm ${(connection.isOverdue ?? connection.stageOverdue) ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
              {connection.daysOnStage} дн. на этапе
              {(connection.isOverdue ?? connection.stageOverdue) && connection.overdueBy != null && (
                <span className="text-red-600"> · +{connection.overdueBy} дн. просрочка</span>
              )}
            </span>
          )}
          <span className="text-sm text-slate-500">{formatDate(connection.plannedDeadline)}</span>
        </div>
        {isPausedOrFrozen && connection.pauseReason && (
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-slate-500">
            {connection.status === 'paused' && <Pause className="w-4 h-4" />}
            {connection.status === 'frozen' && <Snowflake className="w-4 h-4" />}
            <span>{connection.pauseReason}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <StatusBadge
          status={(connection.isOverdue ?? connection.stageOverdue) ? 'overdue' : (connection.status as Parameters<typeof StatusBadge>[0]['status'])}
          size="sm"
        />
        {avatars.length > 0 && <AvatarGroup avatars={avatars} max={3} size="sm" />}
      </div>
    </div>
  )
}
