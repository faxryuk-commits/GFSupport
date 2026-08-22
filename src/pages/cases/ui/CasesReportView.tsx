import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Отчёт по тикетам: сколько пришло, о чём, сколько решили, за какое время и кто.
 *
 * Раздел показывал текущую очередь — что горит сейчас. На вопрос «как мы
 * отработали неделю» ответа не было. Здесь ровно пять ответов, и каждый —
 * с опорой: цифра рядом с прошлым периодом, время решения медианой, а не
 * средним, темы — из текста обращений.
 */

interface Report {
  period: { key: string; from: string; to: string }
  totals: {
    created?: number; resolved?: number
    median_min?: number | null; p90_min?: number | null; avg_min?: number | null
    first_reply_min?: number | null
  }
  prev: { created?: number; resolved?: number; median_min?: number | null }
  topics: Array<{ category: string; label: string; created: number; resolved: number; median_min: number | null; unknown: boolean }>
  people: Array<{ name: string; unassigned: boolean; taken: number; resolved: number; median_min: number | null }>
  weekly: Array<{ week: string; created: number; resolved: number }>
  unresolved: Array<{ id: string; ticket_number: string | null; title: string; status: string; hours_open: number }>
}

const PERIODS: Array<[string, string]> = [
  ['week', 'Эта неделя'], ['month', 'Этот месяц'], ['quarter', 'Квартал'], ['year', 'Год'],
]

/** Минуты в человеческий вид: «40 мин», «5,4 ч», «2,1 дн». */
function dur(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  if (min < 60) return `${Math.round(min)} мин`
  if (min < 1440) return `${(min / 60).toFixed(1).replace('.', ',')} ч`
  return `${(min / 1440).toFixed(1).replace('.', ',')} дн`
}

/** Отклонение от прошлого периода. Рост тикетов — не всегда плохо, поэтому без цвета. */
function Delta({ now, was }: { now?: number; was?: number }) {
  if (!was || now === undefined) return null
  const diff = now - was
  if (!diff) return <span className="text-[11px] text-slate-400"> = как в прошлый</span>
  const pct = Math.round((diff / was) * 100)
  return (
    <span className="text-[11px] text-slate-400">
      {' '}{diff > 0 ? '+' : ''}{diff} к прошлому ({pct > 0 ? '+' : ''}{pct}%)
    </span>
  )
}

export function CasesReportView() {
  const [data, setData] = useState<Report | null>(null)
  const [period, setPeriod] = useState('week')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<Report>(`/cases/report?period=${period}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось построить отчёт'))
  }, [period])

  useEffect(() => { load() }, [load])

  if (error) return <div className="p-6 text-sm text-slate-700">{error}</div>
  if (!data) return <div className="p-6 text-sm text-slate-400">Считаем…</div>

  const t = data.totals
  const resolvedPct = t.created ? Math.round(((t.resolved || 0) / t.created) * 100) : 0
  const maxWeek = Math.max(1, ...data.weekly.map(w => w.created))
  const known = data.topics.filter(x => !x.unknown)
  const unknown = data.topics.find(x => x.unknown)
  const maxTopic = Math.max(1, ...data.topics.map(x => x.created))

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODS.map(([key, label]) => (
          <button key={key} onClick={() => setPeriod(key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              period === key ? 'bg-slate-900 text-white border-slate-900'
                             : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Четыре числа, на которые смотрят в первую очередь */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
        {[
          ['Создано', String(t.created ?? 0), <Delta key="c" now={t.created} was={data.prev.created} />],
          ['Решено', `${t.resolved ?? 0}`, <span key="r" className="text-[11px] text-slate-400"> {resolvedPct}% от созданных</span>],
          ['Время решения', dur(t.median_min), <span key="m" className="text-[11px] text-slate-400"> медиана · p90 {dur(t.p90_min)}</span>],
          ['Первый ответ', dur(t.first_reply_min), <span key="f" className="text-[11px] text-slate-400"> в среднем</span>],
        ].map(([label, value, extra], i) => (
          <div key={i} className="bg-white px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label as string}</div>
            <div className="text-[21px] text-slate-900 tabular-nums leading-tight mt-0.5">{value as string}</div>
            <div className="leading-tight">{extra as React.ReactNode}</div>
          </div>
        ))}
      </div>

      {/* Среднее рядом с медианой: расхождение показывает хвост из забытых заявок */}
      {t.avg_min && t.median_min && t.avg_min > t.median_min * 1.5 && (
        <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Половина тикетов закрывается за {dur(t.median_min)}, но среднее — {dur(t.avg_min)}.
          Значит часть заявок висит подолгу и тянет статистику: смотрите нерешённые внизу.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-slate-900 mb-3">О чём пишут</h3>
          {known.length === 0 ? (
            <div className="text-[12px] text-slate-400">Темы ещё не размечены</div>
          ) : (
            <div className="space-y-1.5">
              {known.map(x => (
                <div key={x.category}>
                  <div className="flex justify-between text-[12px] text-slate-700">
                    <span className="truncate">{x.label}</span>
                    <span className="tabular-nums text-slate-500 flex-none pl-2">
                      {x.created}{x.median_min ? ` · ${dur(x.median_min)}` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full"
                         style={{ width: `${(x.created / maxTopic) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Неразмеченное показываем отдельно и честно: смешать его с темами
              значит нарисовать самый крупный сегмент из отсутствия данных */}
          {unknown && (
            <div className="mt-3 pt-2 border-t border-slate-100 text-[11.5px] text-slate-400">
              Ещё {unknown.created} без темы — разбираются в фоне
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-slate-900 mb-3">Кто решает</h3>
          <div className="space-y-1.5">
            {data.people.map(p => (
              <div key={p.name} className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className={`truncate ${p.unassigned ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                  {p.name}
                </span>
                <span className="tabular-nums text-slate-500 flex-none">
                  решил {p.resolved} из {p.taken}
                  {p.median_min ? ` · ${dur(p.median_min)}` : ''}
                </span>
              </div>
            ))}
          </div>
          {data.people.some(p => p.unassigned) && (
            <div className="mt-3 pt-2 border-t border-slate-100 text-[11.5px] text-slate-400">
              Тикеты без исполнителя решаются, но неизвестно кем — заслуга не видна в отчёте
            </div>
          )}
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-[13px] font-medium text-slate-900 mb-3">Восемь недель</h3>
        <div className="flex items-end gap-2 h-28">
          {data.weekly.map(w => (
            <div key={w.week} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex flex-col justify-end h-20" title={`создано ${w.created}, решено ${w.resolved}`}>
                <div className="w-full bg-blue-100 rounded-t relative"
                     style={{ height: `${(w.created / maxWeek) * 100}%` }}>
                  {/* Решённые — заливка внутри созданных: разрыв виден сразу */}
                  <div className="absolute bottom-0 left-0 right-0 bg-blue-500 rounded-t"
                       style={{ height: `${(w.resolved / Math.max(1, w.created)) * 100}%` }} />
                </div>
              </div>
              <div className="text-[10px] text-slate-400 tabular-nums truncate w-full text-center">{w.week}</div>
              <div className="text-[10.5px] text-slate-600 tabular-nums">{w.created}</div>
            </div>
          ))}
        </div>
      </section>

      {data.unresolved.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-slate-900 mb-1">
            Ещё не решены — {data.unresolved.length}
          </h3>
          <p className="text-[11px] text-slate-400 mb-3">от самых старых</p>
          <div className="divide-y divide-slate-100">
            {data.unresolved.map(c => (
              <div key={c.id} className="py-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-slate-700 truncate">
                  {c.ticket_number ? <span className="text-slate-400">#{c.ticket_number} </span> : null}
                  {String(c.title).replace(/\s+/g, ' ').slice(0, 80)}
                </span>
                <span className={`text-[11.5px] tabular-nums flex-none ${
                  c.hours_open > 72 ? 'text-red-600' : 'text-slate-500'}`}>
                  {c.hours_open < 48 ? `${c.hours_open} ч` : `${Math.round(c.hours_open / 24)} дн`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
