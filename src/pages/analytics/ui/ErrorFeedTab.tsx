/**
 * Вкладка «Ошибки заказов» — аналитика по фид-каналу ошибок.
 * Категория → подкатегория, чья вина, расшифровка и что делать.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Wrench } from 'lucide-react'
import { fetchErrorFeed, type ErrorFeedResponse, type ErrorFault, type ErrorSubcategory } from '@/shared/api'

const FAULT_COLOR: Record<ErrorFault, string> = {
  delever: 'bg-rose-500',
  integration: 'bg-orange-500',
  pos: 'bg-amber-500',
  merchant: 'bg-blue-500',
  customer: 'bg-slate-400',
  aggregator: 'bg-violet-500',
  unknown: 'bg-slate-300',
}
const FAULT_BADGE: Record<ErrorFault, string> = {
  delever: 'bg-rose-50 text-rose-700 border-rose-200',
  integration: 'bg-orange-50 text-orange-700 border-orange-200',
  pos: 'bg-amber-50 text-amber-700 border-amber-200',
  merchant: 'bg-blue-50 text-blue-700 border-blue-200',
  customer: 'bg-slate-50 text-slate-600 border-slate-200',
  aggregator: 'bg-violet-50 text-violet-700 border-violet-200',
  unknown: 'bg-slate-50 text-slate-500 border-slate-200',
}

type Period = 'today' | '7d' | '30d' | '90d'

export function ErrorFeedTab({ period = '7d' }: { period?: Period }) {
  const [data, setData] = useState<ErrorFeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchErrorFeed(period)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [period])

  if (loading) return <div className="p-8 text-center text-slate-400">Загрузка аналитики ошибок…</div>
  if (!data || !data.hasFeed) return (
    <div className="p-8 text-center text-slate-500">
      Фид-канал ошибок не подключён. Добавьте бот-ингест админом в канал ошибок.
    </div>
  )
  if (!data.total) return <div className="p-8 text-center text-slate-500">За период ошибок нет.</div>

  const ourPct = data.ourFaultPct ?? 0

  return (
    <div className="space-y-6">
      {/* Сводка */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat
          label="Настоящих ошибок"
          value={(data.errorsTotal ?? data.total).toLocaleString('ru-RU')}
          sub={`${data.feedName || 'фид'} · ${period} · классиф. ${data.classifiedPct ?? 0}%`}
        />
        <Stat
          label="Ожидаемых отклонений"
          value={(data.rejectionsTotal ?? 0).toLocaleString('ru-RU')}
          sub="стоп-лист, вне зоны — не баг"
          valueClass="text-slate-500"
        />
        <Stat
          label="Наша зона ответственности"
          value={`${ourPct}%`}
          sub="от настоящих ошибок (Delever + интеграция)"
          valueClass={ourPct >= 60 ? 'text-rose-600' : ourPct >= 30 ? 'text-orange-500' : 'text-emerald-600'}
        />
      </div>

      {/* Чья вина */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Чья вина</h3>
        <div className="flex h-3 w-full overflow-hidden rounded-full mb-3">
          {(data.byFault || []).map(f => (
            <div key={f.fault} className={FAULT_COLOR[f.fault as ErrorFault] || 'bg-slate-300'} style={{ width: `${f.pct}%` }} title={`${f.label}: ${f.pct}%`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(data.byFault || []).map(f => (
            <div key={f.fault} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className={`w-2.5 h-2.5 rounded-sm ${FAULT_COLOR[f.fault as ErrorFault] || 'bg-slate-300'}`} />
              {f.label} <span className="font-semibold text-slate-800">{f.count.toLocaleString('ru-RU')}</span> ({f.pct}%)
            </div>
          ))}
        </div>
      </section>

      {/* Категории → подкатегории */}
      <section className="space-y-3">
        {(data.categories || []).map(cat => (
          <div key={cat.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpen(o => ({ ...o, [cat.key]: !o[cat.key] }))}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${open[cat.key] ? 'rotate-90' : ''}`} />
                <span className="font-semibold text-slate-800">{cat.label}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-bold text-slate-900">{cat.count.toLocaleString('ru-RU')}</span>
                <span className="text-slate-400 w-10 text-right">{cat.pct}%</span>
              </div>
            </button>
            {(open[cat.key] ?? cat.pct >= 20) && (
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {cat.subcategories.map(s => <SubRow key={s.key} s={s} />)}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Срезы */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniList title="По источникам" items={data.bySource || []} />
        <MiniList title="По сервисам" items={data.byService || []} />
        <MiniList title="Топ ресторанов" items={data.topRestaurants || []} />
      </div>
    </div>
  )
}

function SubRow({ s }: { s: ErrorSubcategory }) {
  const [exp, setExp] = useState(false)
  return (
    <div className="px-5 py-3">
      <button onClick={() => setExp(v => !v)} className="w-full text-left">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${exp ? 'rotate-90' : ''}`} />
            <span className="text-sm font-medium text-slate-800">{s.label}</span>
            {s.nature === 'rejection'
              ? <span className="text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">ожидаемое — не баг</span>
              : <span className={`text-[11px] px-1.5 py-0.5 rounded border ${FAULT_BADGE[s.fault] || FAULT_BADGE.unknown}`}>{s.faultLabel}</span>}
            {s.concentrated && s.topRestaurant && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                <AlertTriangle className="w-3 h-3" /> {s.topRestaurant} {s.topRestaurantShare}%
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-slate-900 tabular-nums">{s.count.toLocaleString('ru-RU')} <span className="text-slate-400 font-normal">({s.pct}%)</span></span>
        </div>
      </button>

      {exp && (
        <div className="mt-3 pl-5 space-y-3">
          {/* Проблема */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Проблема</div>
            <p className="text-sm text-slate-700 leading-relaxed">{s.decode}</p>
          </div>

          {/* Решение */}
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              <Wrench className="w-3.5 h-3.5 text-blue-500" /> Решение · ответственный: {s.owner}
            </div>
            <ol className="space-y-1">
              {s.fixSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Задетые рестораны */}
          {s.restaurants?.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                Задетые рестораны {s.restaurantsAffected > s.restaurants.length ? `(топ ${s.restaurants.length} из ${s.restaurantsAffected})` : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.restaurants.map(r => (
                  <span key={r.name} className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-0.5">{r.name} <b>{r.count}</b></span>
                ))}
              </div>
            </div>
          )}

          {/* Реальные примеры */}
          {s.examples?.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Примеры из фида</div>
              <div className="space-y-1">
                {s.examples.map((ex, i) => (
                  <div key={i} className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-100 rounded px-2 py-1 break-words">{ex}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass || 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function MiniList({ title, items }: { title: string; items: Array<{ name: string; count: number }> }) {
  const max = items[0]?.count || 1
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{title}</h4>
      <div className="space-y-1.5">
        {items.slice(0, 8).map(it => (
          <div key={it.name} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate text-slate-700" title={it.name}>{it.name}</span>
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums text-slate-600">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ErrorFeedTab
