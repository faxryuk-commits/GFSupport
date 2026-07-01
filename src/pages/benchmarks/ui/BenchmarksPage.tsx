import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, RefreshCw, Bot, User, Pencil, Trash2, Info, AlertCircle, Check } from 'lucide-react'
import {
  fetchBenchmarks,
  recomputeBenchmarks,
  upsertBenchmark,
  deleteBenchmark,
} from '@/shared/api'
import type {
  BenchmarkMetric,
  BenchmarkRow,
  RecomputeSummaryItem,
} from '@/shared/api'

type Tier = 'bronze' | 'silver' | 'gold'

interface ScopeKey {
  role: string | null
  market: string | null
  source: string | null
}

function scopeLabel(scope: ScopeKey): string {
  const parts: string[] = []
  if (scope.source) parts.push(scope.source)
  if (scope.market) parts.push(scope.market)
  if (scope.role) parts.push(scope.role)
  return parts.length === 0 ? 'Все каналы' : parts.join(' · ')
}

function scopeKey(scope: ScopeKey): string {
  return `${scope.role || ''}|${scope.market || ''}|${scope.source || ''}`
}

function formatValue(v: number, unit: BenchmarkMetric['unit']): string {
  switch (unit) {
    case 'minutes':
      return `${v.toFixed(1)} мин`
    case 'hours':
      return `${v.toFixed(1)} ч`
    case 'seconds':
      return `${v.toFixed(0)} с`
    case 'percent':
      return `${v.toFixed(1)}%`
    case 'ratio':
      return v.toFixed(2)
    case 'count':
      return v.toFixed(0)
    case 'currency':
      return `${v.toFixed(0)} ₽`
  }
}

const TIER_LABEL: Record<Tier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
}
const TIER_COLOR: Record<Tier, string> = {
  bronze: 'bg-amber-50 border-amber-200 text-amber-900',
  silver: 'bg-slate-50 border-[#e8edf3] text-slate-900',
  gold: 'bg-yellow-50 border-yellow-300 text-yellow-900',
}
const TIER_HELP: Record<Tier, string> = {
  bronze: 'Минимально приемлемо (≈75% команды на этом уровне или лучше)',
  silver: 'Хорошо (медиана команды)',
  gold: 'Отлично (топ-25% команды или ручной стрейч-таргет)',
}

interface EditState {
  metricKey: string
  scope: ScopeKey
  tier: Tier
  value: string
}

export function BenchmarksPage() {
  const [metrics, setMetrics] = useState<BenchmarkMetric[]>([])
  const [rows, setRows] = useState<BenchmarkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeResult, setRecomputeResult] = useState<RecomputeSummaryItem[] | null>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchBenchmarks()
      setMetrics(data.metrics)
      setRows(data.benchmarks)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить бенчмарки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleRecompute = async () => {
    setRecomputing(true)
    setRecomputeResult(null)
    setError(null)
    try {
      const result = await recomputeBenchmarks('all', 60)
      setRecomputeResult(result.summary)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Recompute не удался')
    } finally {
      setRecomputing(false)
    }
  }

  const handleSave = async () => {
    if (!editing) return
    const num = parseFloat(editing.value.replace(',', '.'))
    if (!Number.isFinite(num) || num <= 0) {
      setError('Введите положительное число')
      return
    }
    try {
      await upsertBenchmark({
        metric_key: editing.metricKey,
        tier: editing.tier,
        target_value: num,
        scope_role: editing.scope.role,
        scope_market: editing.scope.market,
        scope_source: editing.scope.source,
        period_type: 'monthly',
      })
      setEditing(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот ручной стрейч-таргет? Перцентильный baseline останется.')) return
    try {
      await deleteBenchmark(id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  // Группировка: metric → scope → { bronze, silver, gold }
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, { scope: ScopeKey; tiers: Record<Tier, BenchmarkRow | null> }>>()
    for (const m of metrics) {
      map.set(m.key, new Map())
    }
    for (const r of rows) {
      const inner = map.get(r.metricKey)
      if (!inner) continue
      const k = scopeKey(r.scope)
      const existing = inner.get(k) ?? {
        scope: r.scope,
        tiers: { bronze: null, silver: null, gold: null },
      }
      existing.tiers[r.tier as Tier] = r
      inner.set(k, existing)
    }
    return map
  }, [metrics, rows])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-[22px] font-extrabold text-slate-900 tracking-tight">Бенчмарки</h1>
          <p className="text-sm text-slate-600 mt-1">
            Целевые значения метрик команды. Bronze / Silver / Gold — три уровня соответствия,
            от минимально приемлемого до отличного.
          </p>
        </div>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_3px_10px_rgba(37,99,235,0.22)] rounded-md hover:brightness-[1.04] hover:shadow-[0_5px_16px_rgba(37,99,235,0.34)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {recomputing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Пересчитать из истории (60 дней)
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">{error}</div>
        </div>
      )}

      {recomputeResult && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 mb-2">
            <Check className="w-4 h-4" />
            Пересчёт завершён
          </div>
          <div className="text-xs text-emerald-800 space-y-1">
            {recomputeResult.map((r, i) => (
              <div key={i}>
                <span className="font-mono">{r.metric}</span> · {r.scope} · {r.observations} агентов · {r.reason}
                {r.reason === 'ok' && r.bronze !== undefined && (
                  <>
                    {' '}— bronze {r.bronze?.toFixed(1)}, silver {r.silver?.toFixed(1)}, gold {r.gold?.toFixed(1)}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {metrics.length === 0 && (
          <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-lg">
            Метрики пока не зарегистрированы.
          </div>
        )}

        {metrics.map((m) => {
          const inner = grouped.get(m.key)
          const scopes = inner ? Array.from(inner.values()) : []
          // Если для метрики нет ни одного scope в БД — показываем «глобальный пустой»
          const visibleScopes =
            scopes.length === 0
              ? [{ scope: { role: null, market: null, source: null }, tiers: { bronze: null, silver: null, gold: null } as Record<Tier, BenchmarkRow | null> }]
              : scopes

          return (
            <section key={m.key} className="bg-white rounded-lg border border-[#e8edf3]">
              <header className="px-5 py-4 border-b border-[#e8edf3]">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
                      m.level === 'outcome'
                        ? 'bg-purple-100 text-purple-800'
                        : m.level === 'driver'
                        ? 'bg-blue-100 text-blue-800'
                        : m.level === 'indicator'
                        ? 'bg-teal-100 text-teal-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {m.level}
                  </span>
                  <h2 className="text-lg font-medium text-slate-900">{m.labelRu}</h2>
                  <span className="text-xs text-slate-400 font-mono">{m.key}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {m.formulaRu}
                </p>
              </header>

              <div className="p-5 space-y-3">
                {visibleScopes.map((sc) => (
                  <div key={scopeKey(sc.scope)} className="border border-[#e8edf3] rounded-md p-4">
                    <div className="text-sm font-medium text-slate-700 mb-3">
                      Scope: {scopeLabel(sc.scope)}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {(['bronze', 'silver', 'gold'] as Tier[]).map((tier) => {
                        const row = sc.tiers[tier]
                        const isEditing =
                          editing?.metricKey === m.key &&
                          scopeKey(editing.scope) === scopeKey(sc.scope) &&
                          editing.tier === tier
                        return (
                          <div
                            key={tier}
                            className={`border rounded-md p-3 ${TIER_COLOR[tier]}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                                  {TIER_LABEL[tier]}
                                </div>
                                <div className="text-[10px] opacity-60 mt-0.5">{TIER_HELP[tier]}</div>
                              </div>
                              {row && (
                                <div className="flex items-center gap-1">
                                  {row.sourceType === 'manual' ? (
                                    <span title="Ручной стрейч-таргет">
                                      <User className="w-3.5 h-3.5" />
                                    </span>
                                  ) : (
                                    <span title={`Перцентиль на ${row.sampleSize ?? 0} агентах`}>
                                      <Bot className="w-3.5 h-3.5" />
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editing.value}
                                  onChange={(e) =>
                                    setEditing({ ...editing, value: e.target.value })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSave()
                                    if (e.key === 'Escape') setEditing(null)
                                  }}
                                  autoFocus
                                  className="w-full px-2 py-1 text-sm border border-slate-300 rounded bg-white"
                                  placeholder="число"
                                />
                                <button
                                  onClick={handleSave}
                                  className="text-emerald-700 hover:text-emerald-900"
                                  title="Сохранить (Enter)"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div className="text-xl font-semibold">
                                  {row ? formatValue(row.value, m.unit) : <span className="text-slate-400 text-base font-normal">—</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() =>
                                      setEditing({
                                        metricKey: m.key,
                                        scope: sc.scope,
                                        tier,
                                        value: row ? String(row.value) : '',
                                      })
                                    }
                                    className="p-1 hover:bg-white/60 rounded"
                                    title="Поставить вручную"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  {row && row.sourceType === 'manual' && (
                                    <button
                                      onClick={() => handleDelete(row.id)}
                                      className="p-1 hover:bg-white/60 rounded"
                                      title="Удалить ручной таргет (вернётся перцентиль)"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {row && row.sourceType === 'percentile_internal' && row.computedAt && (
                              <div className="text-[10px] opacity-60 mt-2">
                                Авто · {new Date(row.computedAt).toLocaleDateString('ru-RU')}
                              </div>
                            )}
                            {row && row.sourceType === 'manual' && row.setAt && (
                              <div className="text-[10px] opacity-60 mt-2">
                                Вручную · {new Date(row.setAt).toLocaleDateString('ru-RU')}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
