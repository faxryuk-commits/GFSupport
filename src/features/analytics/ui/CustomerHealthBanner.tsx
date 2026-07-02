/**
 * Сводный баннер по Client Health Score — для верха Pulse / Dashboard.
 *
 * Показывает 4 числа: total / healthy / at_risk / critical. Если кто-то
 * в критической зоне — баннер становится красным акцентом, чтобы
 * руководитель видел тревогу с первого экрана.
 *
 * Клик на любую зону или на баннер целиком → /analytics?tab=diagnosis
 * с автофокусом на CustomerHealthSection.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import {
  fetchCustomerHealth,
  type CustomerHealthResponse,
  type FetchCustomerHealthParams,
  type HealthBand,
} from '@/shared/api'

interface CustomerHealthBannerProps {
  period?: FetchCustomerHealthParams['period']
  source?: string
  marketKey?: string | null
  /** URL клика — куда уходит при «Подробнее». */
  detailsHref?: string
}

export function CustomerHealthBanner({
  period = '30d',
  source,
  marketKey,
  detailsHref = '/analytics?tab=diagnosis',
}: CustomerHealthBannerProps) {
  const [data, setData] = useState<CustomerHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCustomerHealth({
      period,
      source: source === 'all' ? undefined : source,
      limit: 1, // только summary важен — строки не нужны
    })
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, source, marketKey])

  const critical = data?.summary.critical ?? 0
  const atRisk = data?.summary.atRisk ?? 0
  const healthy = data?.summary.healthy ?? 0
  const total = data?.summary.total ?? 0
  const hasCritical = critical > 0

  const wrapperClass = hasCritical
    ? 'bg-gradient-to-r from-rose-50 to-white border-rose-200'
    : atRisk > 0
    ? 'bg-gradient-to-r from-amber-50 to-white border-amber-200'
    : 'bg-white border-[#e8edf3]'

  return (
    <Link
      to={detailsHref}
      className={`flex items-center gap-4 border rounded-xl p-4 hover:shadow-sm transition ${wrapperClass}`}
    >
      <div
        className={`p-2 rounded-lg ${
          hasCritical ? 'bg-rose-100 text-rose-600' : atRisk > 0 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
        }`}
      >
        {hasCritical ? <AlertTriangle className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Загрузка состояния покупателей...
            </span>
          ) : data ? (
            <>Состояние покупателей Delever · {total} активных за {period}</>
          ) : (
            'Не удалось загрузить состояние покупателей'
          )}
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
            <BandBadge band="critical" count={critical} hint="Не пишут или негатив + открытые кейсы" />
            <BandBadge band="at_risk" count={atRisk} hint="Снижается активность или sentiment" />
            <BandBadge band="healthy" count={healthy} hint="Активные, позитивные, кейсы решаются" />
          </div>
        )}
      </div>

      <ArrowRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
    </Link>
  )
}

function BandBadge({
  band,
  count,
  hint,
}: {
  band: HealthBand
  count: number
  hint?: string
}) {
  const styles: Record<HealthBand, { chip: string; label: string }> = {
    healthy: { chip: 'bg-emerald-100 text-emerald-800', label: 'здоровы' },
    at_risk: { chip: 'bg-amber-100 text-amber-800', label: 'в зоне риска' },
    critical: { chip: 'bg-rose-100 text-rose-800', label: 'критично' },
    unknown: { chip: 'bg-slate-100 text-slate-500', label: 'нет данных' },
  }
  const s = styles[band]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${s.chip}`}
      title={hint}
    >
      <span className="tabular-nums">{count}</span>
      <span className="opacity-80 font-normal">{s.label}</span>
    </span>
  )
}
