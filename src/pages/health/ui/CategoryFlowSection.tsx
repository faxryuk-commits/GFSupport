import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Flame, MessageSquareWarning, RefreshCw, ChevronRight, ArrowDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  fetchCategoryFlow,
  type CategoryFlowPayload,
  type CategoryFlowDomain,
  type HealthPeriod,
  type HealthSource,
  type FlowStatus,
} from '../../../shared/api/support-health'
import { PlatformBadge } from './PlatformBadge'

interface Props {
  period: HealthPeriod
  source?: HealthSource
}

const FLOW_COLORS: Record<FlowStatus, { bg: string; text: string; label: string }> = {
  resolved:    { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'Решено' },
  in_progress: { bg: 'bg-blue-500',    text: 'text-blue-700',    label: 'В работе' },
  stuck:       { bg: 'bg-amber-500',   text: 'text-amber-700',   label: 'Застряли' },
  ignored:     { bg: 'bg-rose-500',    text: 'text-rose-700',    label: 'Игнорят' },
  blocked:     { bg: 'bg-slate-500',   text: 'text-slate-700',   label: 'Заблокированы' },
}

export function CategoryFlowSection({ period, source = 'all' }: Props) {
  const [data, setData] = useState<CategoryFlowPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeDomain, setActiveDomain] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchCategoryFlow(period, source)
      setData(res)
      if (res.domains.length > 0 && !activeDomain) {
        const firstWithData = res.domains.find((d) => d.total > 0)
        if (firstWithData) setActiveDomain(firstWithData.domain)
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setActiveDomain(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, source])

  const selectedDomain: CategoryFlowDomain | null = useMemo(() => {
    if (!data || !activeDomain) return null
    return data.domains.find((d) => d.domain === activeDomain) || null
  }, [data, activeDomain])

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="h-5 bg-slate-100 rounded w-48 mb-4 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-24 bg-slate-50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-rose-200">
        <div className="flex items-center gap-2 text-rose-700">
          <AlertCircle className="w-5 h-5" />
          <span>Не удалось загрузить: {error}</span>
          <button onClick={load} className="ml-auto text-sm text-rose-600 hover:underline">Повторить</button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const visibleDomains = data.domains.filter((d) => d.total > 0)
  const maxDomainTotal = Math.max(1, ...visibleDomains.map((d) => d.total))

  return (
    <div className="space-y-6">
      {/* === KPI строка === */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              Обращения по категориям
              {source !== 'all' && <PlatformBadge source={source} size="sm" withLabel />}
            </h3>
            <p className="text-sm text-slate-500">
              Всего {data.kpi.total} обращений за {data.period.days} дн. · SLA ответа {data.sla.targetResponseTime} мин ·
              разрешение {data.sla.targetResolutionTime} мин (в рабочих часах)
            </p>
            {data.bySource && source === 'all' && (data.bySource.telegram.total > 0 || data.bySource.whatsapp.total > 0) && (
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className="inline-flex items-center gap-1 text-sky-700 font-medium">
                  <PlatformBadge source="telegram" withLabel />
                  {data.bySource.telegram.total} · решено {data.bySource.telegram.resolved} · игнор {data.bySource.telegram.ignored} · недов. {data.bySource.telegram.unhappy}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <PlatformBadge source="whatsapp" withLabel />
                  {data.bySource.whatsapp.total} · решено {data.bySource.whatsapp.resolved} · игнор {data.bySource.whatsapp.ignored} · недов. {data.bySource.whatsapp.unhappy}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            title="Обновить"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiBox label="Всего" value={data.kpi.total} color="bg-slate-100 text-slate-700" />
          <KpiBox label="Решено" value={data.kpi.resolved} color="bg-emerald-100 text-emerald-700" />
          <KpiBox label="В работе" value={data.kpi.in_progress} color="bg-blue-100 text-blue-700" />
          <KpiBox label="Застряли" value={data.kpi.stuck} color="bg-amber-100 text-amber-700" />
          <KpiBox label="Игнорят" value={data.kpi.ignored} color="bg-rose-100 text-rose-700" />
          <KpiBox label="Счастливые" value={data.kpi.happy} color="bg-emerald-50 text-emerald-700" />
          <KpiBox label="Недовольные" value={data.kpi.unhappy} color="bg-rose-50 text-rose-700" />
          <KpiBox label="Риск ухода" value={data.kpi.churnRisk} color="bg-purple-100 text-purple-700" />
        </div>
      </div>

      {/* === Treemap по доменам === */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Карта проблем по доменам</h3>
            <p className="text-sm text-slate-500">Размер = объём обращений. Клик — раскрыть подкатегории.</p>
          </div>
        </div>
        {visibleDomains.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            Нет данных за период. Проверь бекфилл таксономии.
          </div>
        ) : (
          <DomainTreemap
            domains={visibleDomains}
            maxTotal={maxDomainTotal}
            activeDomain={activeDomain}
            onSelect={setActiveDomain}
          />
        )}
      </div>

      {/* === Stacked-bar по подкатегориям внутри выбранного домена === */}
      {selectedDomain && selectedDomain.subcategories.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Поток внутри: {selectedDomain.label}
              </h3>
              <p className="text-sm text-slate-500">
                Каждая строка — подкатегория. Цвета — текущий статус обращения.
              </p>
            </div>
            <FlowLegend />
          </div>

          <div className="space-y-2.5">
            {selectedDomain.subcategories.map((sub) => (
              <SubcategoryBar key={sub.subcategory} sub={sub} />
            ))}
          </div>
        </div>
      )}

      {/* === Таблицы: игнор и недовольные === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <IgnoredTable items={data.ignoredList} />
        <UnhappyTable items={data.unhappyList} />
      </div>
    </div>
  )
}

// ==================================================================

function KpiBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl px-3 py-3 ${color}`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs mt-1 opacity-75">{label}</div>
    </div>
  )
}

function DomainTreemap({
  domains,
  maxTotal,
  activeDomain,
  onSelect,
}: {
  domains: CategoryFlowDomain[]
  maxTotal: number
  activeDomain: string | null
  onSelect: (domain: string) => void
}) {
  const total = domains.reduce((s, d) => s + d.total, 0) || 1
  return (
    <div className="grid grid-cols-3 md:grid-cols-5 gap-3 auto-rows-[minmax(100px,auto)]">
      {domains.map((d) => {
        const share = d.total / total
        const scale = d.total / maxTotal
        const size =
          scale > 0.4 ? 'col-span-2 row-span-2' :
          scale > 0.2 ? 'col-span-2' :
          scale > 0.1 ? 'col-span-1 row-span-2' :
          'col-span-1'

        const stuckShare = d.total > 0 ? d.stuck / d.total : 0
        const ignoredShare = d.total > 0 ? d.ignored / d.total : 0
        const unhappyShare = d.total > 0 ? d.unhappy / d.total : 0
        const isDanger = stuckShare > 0.3 || ignoredShare > 0.2 || unhappyShare > 0.25 || d.churnRisk > 0

        const isActive = d.domain === activeDomain

        return (
          <button
            key={d.domain}
            onClick={() => onSelect(d.domain)}
            className={`relative text-left rounded-xl p-4 transition-all border ${size} ${
              isActive
                ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50'
                : isDanger
                  ? 'border-rose-200 bg-rose-50 hover:bg-rose-100'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
            style={{ minHeight: `${Math.max(100, Math.min(220, 80 + scale * 140))}px` }}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 truncate">{d.label}</div>
              {isDanger && <Flame className="w-4 h-4 text-rose-500 flex-shrink-0" />}
            </div>
            <div className="text-3xl font-bold mt-2 text-slate-900">{d.total}</div>
            <div className="text-xs text-slate-500 mt-1">{Math.round(share * 100)}%</div>

            {/* Мини-полоска флоу */}
            <div className="mt-3 flex h-1.5 rounded-full overflow-hidden bg-slate-200">
              {(['resolved', 'in_progress', 'stuck', 'ignored', 'blocked'] as FlowStatus[]).map((s) => {
                const v = d[s] || 0
                const w = d.total > 0 ? (v / d.total) * 100 : 0
                if (w < 0.5) return null
                return <div key={s} className={FLOW_COLORS[s].bg} style={{ width: `${w}%` }} />
              })}
            </div>

            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-600">
              {d.stuck > 0 && <span className="text-amber-600">{d.stuck} застряли</span>}
              {d.ignored > 0 && <span className="text-rose-600">{d.ignored} игнор</span>}
              {d.unhappy > 0 && <span className="text-rose-500">{d.unhappy} недов.</span>}
              {d.churnRisk > 0 && <span className="text-purple-600">{d.churnRisk} риск</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function SubcategoryBar({ sub }: { sub: CategoryFlowDomain['subcategories'][number] }) {
  const total = Math.max(1, sub.total)
  const segments: Array<{ status: FlowStatus; value: number }> = [
    { status: 'resolved', value: sub.resolved },
    { status: 'in_progress', value: sub.in_progress },
    { status: 'stuck', value: sub.stuck },
    { status: 'ignored', value: sub.ignored },
    { status: 'blocked', value: sub.blocked },
  ]
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-700 truncate">{sub.label}</span>
        <span className="text-slate-500 flex items-center gap-2 flex-shrink-0">
          {sub.unhappy > 0 && <span className="text-rose-600">😠 {sub.unhappy}</span>}
          {sub.churnRisk > 0 && <span className="text-purple-600">⚠ {sub.churnRisk}</span>}
          <span className="font-medium text-slate-700">{sub.total}</span>
        </span>
      </div>
      <div className="flex h-6 rounded-lg overflow-hidden bg-slate-100">
        {segments.map((seg) => {
          const w = (seg.value / total) * 100
          if (w < 0.3) return null
          return (
            <div
              key={seg.status}
              className={`${FLOW_COLORS[seg.status].bg} h-full flex items-center justify-center text-[10px] text-white font-medium`}
              style={{ width: `${w}%` }}
              title={`${FLOW_COLORS[seg.status].label}: ${seg.value}`}
            >
              {w > 8 ? seg.value : ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FlowLegend() {
  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
      {(['resolved', 'in_progress', 'stuck', 'ignored', 'blocked'] as FlowStatus[]).map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded ${FLOW_COLORS[s].bg}`} />
          <span className={FLOW_COLORS[s].text}>{FLOW_COLORS[s].label}</span>
        </div>
      ))}
    </div>
  )
}

function IgnoredTable({ items }: { items: CategoryFlowPayload['ignoredList'] }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-rose-200 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquareWarning className="w-5 h-5 text-rose-500" />
        <h3 className="text-lg font-semibold text-slate-900">Игнорят</h3>
        <span className="text-sm text-slate-500">{items.length} шт.</span>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-400 py-6 text-center">Пусто — значит никому не забыли ответить.</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map((it) => (
            <Link
              key={it.messageId}
              to={it.channelId ? `/chats?channel=${it.channelId}` : '/chats'}
              className="block p-3 rounded-lg hover:bg-rose-50 border border-slate-100 transition-colors"
            >
              <div className="flex items-start gap-2">
                <ArrowDown className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 line-clamp-2">{it.text || '(без текста)'}</div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <PlatformBadge source={it.source} />
                    {it.channelName && <span className="text-slate-600 truncate max-w-[160px]">{it.channelName}</span>}
                    <span className="px-1.5 py-0.5 bg-slate-100 rounded">{it.domain}</span>
                    <span>·</span>
                    <span>{new Date(it.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function UnhappyTable({ items }: { items: CategoryFlowPayload['unhappyList'] }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-purple-200 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-purple-500" />
        <h3 className="text-lg font-semibold text-slate-900">Недовольные / риск ухода</h3>
        <span className="text-sm text-slate-500">{items.length} шт.</span>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-400 py-6 text-center">Нет признаков недовольства. Красота.</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map((it) => (
            <Link
              key={it.messageId}
              to={it.channelId ? `/chats?channel=${it.channelId}` : '/chats'}
              className="block p-3 rounded-lg hover:bg-purple-50 border border-slate-100 transition-colors"
            >
              <div className="flex items-start gap-2">
                {it.hasChurn ? (
                  <span className="inline-block w-4 h-4 text-xs rounded-full bg-purple-500 text-white text-center leading-4 font-bold flex-shrink-0 mt-0.5">!</span>
                ) : (
                  <span className="inline-block w-4 h-4 rounded-full bg-rose-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 line-clamp-2">{it.text || '(без текста)'}</div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <PlatformBadge source={it.source} />
                    {it.channelName && <span className="text-slate-600 truncate max-w-[160px]">{it.channelName}</span>}
                    <span className="px-1.5 py-0.5 bg-slate-100 rounded">{it.domain}</span>
                    {it.hasChurn && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">угрожает уйти</span>}
                    <span>·</span>
                    <span>{new Date(it.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
