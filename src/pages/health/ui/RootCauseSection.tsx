import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Brain, Loader2, RefreshCw, AlertTriangle, CheckCircle2, ArrowRight,
  Flame, Wrench, Lightbulb,
} from 'lucide-react'
import {
  fetchRootCauseAnalysis,
  runRootCauseAnalysis,
  type HealthPeriod,
  type RootCauseResult,
  type RootCauseAnalysisPayload,
} from '@/shared/api'

interface Props {
  period: HealthPeriod
}

const SEV_STYLES: Record<string, { badge: string; border: string; icon: string }> = {
  critical: { badge: 'bg-red-100 text-red-800', border: 'border-red-300', icon: 'text-red-600 bg-red-50' },
  high: { badge: 'bg-red-50 text-red-700', border: 'border-red-200', icon: 'text-red-500 bg-red-50' },
  medium: { badge: 'bg-amber-50 text-amber-700', border: 'border-amber-200', icon: 'text-amber-600 bg-amber-50' },
  low: { badge: 'bg-slate-100 text-slate-600', border: 'border-slate-200', icon: 'text-slate-500 bg-slate-100' },
}

const SEV_LABELS: Record<string, string> = {
  critical: 'критично',
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
}

const OWNER_LABELS: Record<string, string> = {
  support: 'Поддержка',
  dev: 'Разработка',
  product: 'Продукт',
  ops: 'Операции',
  sales: 'Продажи',
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Техническое',
  integration: 'Интеграции',
  complaint: 'Жалобы',
  billing: 'Оплата / биллинг',
  feature_request: 'Запросы функций',
  onboarding: 'Подключение',
  question: 'Вопросы',
  feedback: 'Обратная связь',
  order: 'Заказы',
  delivery: 'Доставка',
  menu: 'Меню',
  app: 'Приложение',
}

function formatCluster(c: string): string {
  return CATEGORY_LABELS[c?.toLowerCase()] || c.charAt(0).toUpperCase() + c.slice(1)
}

function formatAge(iso: string | null): string {
  if (!iso) return 'ещё не запускался'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`
  return `${Math.round(diff / 86400)} дн назад`
}

export function RootCauseSection({ period }: Props) {
  const navigate = useNavigate()
  const [data, setData] = useState<RootCauseAnalysisPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadCached = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)
      const r = await fetchRootCauseAnalysis({ period })
      setData(r)
    } catch (e) {
      console.error(e)
      setErr('Не удалось загрузить анализ')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadCached()
  }, [loadCached])

  const runAnalysis = async (force = false) => {
    try {
      setRunning(true)
      setErr(null)
      const r = await runRootCauseAnalysis({ period, force })
      setData(r)
      if (r.error) setErr(r.error)
    } catch (e) {
      console.error(e)
      setErr('Не удалось запустить анализ. Проверь, что подключён OpenAI-ключ в настройках.')
    } finally {
      setRunning(false)
    }
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const hasResults = data && data.results.length > 0
  const isStale = data?.generatedAt
    ? (Date.now() - new Date(data.generatedAt).getTime()) / 3600000 > 12
    : true

  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl overflow-hidden mb-5">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
          <Brain className="w-4 h-4 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800">Корневые причины (AI)</div>
          <div className="text-xs text-slate-500">
            {data?.generatedAt
              ? `Обновлено ${formatAge(data.generatedAt)}${data.fromCache ? ' · из кэша' : ''}`
              : 'Запусти анализ, чтобы найти системные проблемы'}
          </div>
        </div>
        <button
          onClick={() => runAnalysis(true)}
          disabled={running}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {running ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Анализ…
            </>
          ) : hasResults ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              Обновить
            </>
          ) : (
            <>
              <Brain className="w-3.5 h-3.5" />
              Проанализировать
            </>
          )}
        </button>
      </div>

      {err && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {loading && !data && (
        <div className="px-5 py-10 flex justify-center">
          <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
        </div>
      )}

      {!loading && !hasResults && !err && (
        <div className="px-5 py-10 text-center">
          <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600 mb-1">
            {data?.note || 'AI ещё не анализировал корневые причины за этот период'}
          </p>
          <p className="text-xs text-slate-400">
            Нажми «Проанализировать» — AI прочитает обращения, найдёт системные причины и предложит конкретные шаги.
          </p>
        </div>
      )}

      {hasResults && (
        <>
          {data!.partial && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
              {data!.note || 'Часть кластеров не успела проанализироваться — нажми «Обновить», чтобы дойти до остальных'}
            </div>
          )}
          {!data!.partial && isStale && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
              Анализ устарел — рекомендуем обновить
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {data!.results.map((r) => (
              <RootCauseItem
                key={r.clusterKey}
                r={r}
                expanded={expanded.has(r.clusterKey)}
                onToggle={() => toggle(r.clusterKey)}
                onOpenChannel={(id) => navigate(`/chats?channel=${id}`)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

interface ItemProps {
  r: RootCauseResult
  expanded: boolean
  onToggle: () => void
  onOpenChannel: (id: string) => void
}

function RootCauseItem({ r, expanded, onToggle, onOpenChannel }: ItemProps) {
  const sev = SEV_STYLES[r.severity] || SEV_STYLES.medium
  return (
    <li className={`px-5 py-3 ${expanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
      <div className="flex items-start gap-3 cursor-pointer" onClick={onToggle}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${sev.icon}`}>
          <Flame className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide ${sev.badge}`}>
              {SEV_LABELS[r.severity] || r.severity}
            </span>
            <span className="text-xs text-slate-500">{formatCluster(r.clusterLabel)}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500">
              {r.affectedCount} из {r.sampleCount} примеров
            </span>
            {r.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                {t}
              </span>
            ))}
          </div>
          <div className="font-semibold text-slate-900 text-sm">{r.rootCause}</div>
          {r.whatBreaks && !expanded && (
            <div className="text-xs text-slate-600 mt-1 line-clamp-2">{r.whatBreaks}</div>
          )}
        </div>
        <ArrowRight
          className={`w-4 h-4 text-slate-400 mt-1 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      {expanded && (
        <div className="mt-3 ml-11 space-y-3">
          {r.whatBreaks && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Что ломается</div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{r.whatBreaks}</div>
            </div>
          )}
          {r.whyItHappens && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Почему происходит</div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{r.whyItHappens}</div>
            </div>
          )}
          {r.fixSteps.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                Что делать
              </div>
              <ul className="space-y-1.5">
                {r.fixSteps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="text-slate-800">{s.step}</span>
                      {s.owner && (
                        <span className="ml-2 text-[10px] font-semibold text-slate-500 uppercase">
                          → {OWNER_LABELS[s.owner.toLowerCase()] || s.owner}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.affectedChannels.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Затронутые каналы</div>
              <div className="flex flex-wrap gap-1.5">
                {r.affectedChannels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenChannel(ch.id)
                    }}
                    className="px-2 py-0.5 text-xs bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded flex items-center gap-1 transition-colors"
                  >
                    <span>{ch.name}</span>
                    <span className="text-slate-400">×{ch.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
