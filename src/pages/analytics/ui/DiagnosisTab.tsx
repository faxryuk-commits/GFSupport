import type { HealthPeriod, HealthSource } from '@/shared/api/support-health'
import { CategoryFlowSection } from '../../health/ui/CategoryFlowSection'
import { RootCauseSection } from '../../health/ui/RootCauseSection'
import { CustomerHealthSection } from './CustomerHealthSection'

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
        <strong>Diagnosis</strong> — где у Delever болит. Состояние покупателей, поток
        обращений по категориям, корневые причины проблем.
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Состояние покупателей Delever</h3>
          <span className="text-xs text-slate-400">
            Composite Health Score: 40% активность + 35% sentiment + 25% решение кейсов
          </span>
        </div>
        <CustomerHealthSection period={healthPeriod} source={healthSource} />
      </section>

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
