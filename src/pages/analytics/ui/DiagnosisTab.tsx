import type { HealthPeriod, HealthSource } from '@/shared/api/support-health'
import { CategoryFlowSection } from '../../health/ui/CategoryFlowSection'
import { RootCauseSection } from '../../health/ui/RootCauseSection'

interface DiagnosisTabProps {
  /** Период из верхнего фильтра. Маппим в HealthPeriod (поддерживает только 7d/30d/90d). */
  period: '7d' | '30d' | '90d'
  source?: 'all' | 'telegram' | 'whatsapp'
}

export function DiagnosisTab({ period, source }: DiagnosisTabProps) {
  const healthPeriod: HealthPeriod = period
  const healthSource: HealthSource = (source || 'all') as HealthSource

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Diagnosis</strong> — поиск, где у Delever болит. Какие категории обращений
        накапливаются, какие игнорируются и почему. Source данных — старая страница «Где болит».
      </div>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Поток по категориям</h3>
        <CategoryFlowSection period={healthPeriod} source={healthSource} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Корневые причины</h3>
        <RootCauseSection period={healthPeriod} />
      </section>
    </div>
  )
}
