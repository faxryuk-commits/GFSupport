import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Chip, Kpis, money, pct, PageShell, Skeleton } from './kit'
import { RegionBadge, useRegion } from './region'

/**
 * Отчёты продаж: воронка, деньги в воронке, источники, портрет покупателя,
 * качество ведения.
 *
 * Финансовых метрик нет: «деньги в воронке» — суммы предложений и взвешенный
 * прогноз, то есть обещания. Факт выручки живёт в админке и план-факте.
 */
export function SalesReportsPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState('90')
  const region = useRegion()

  const load = useCallback(() => {
    const from = new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10)
    apiGet<any>(`/sales/reports?from=${from}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить отчёты'))
  }, [period, region])

  useEffect(() => { load() }, [load])

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={6} />

  const funnel = (data.funnel || []).filter((f: any) => f.reached > 0)
  const top = funnel[0]?.reached || 0
  const totalWeighted = (data.money || []).reduce((s: number, m: any) => s + Number(m.weighted || 0), 0)
  const totalPipeline = (data.money || []).reduce((s: number, m: any) => s + Number(m.amount || 0), 0)
  const launch = data.launch || {}

  return (
    <PageShell header={
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Отчёты</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Период с {data.period?.from} по {data.period?.to} · когорта считается по дате создания сделки
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <RegionBadge />
        <div className="flex gap-1 border border-gray-300 rounded-lg overflow-hidden">
          {[['30', 'Месяц'], ['90', 'Квартал'], ['365', 'Год']].map(([v, l]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={`text-[12.5px] px-3 py-1.5 ${period === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
              {l}
            </button>
          ))}
        </div>
        </div>
      </div>
    }>

      <Kpis items={[
        ['Пайплайн', money(totalPipeline, 'UZS'), 'сумма предложений в месяц'],
        ['Взвешенный прогноз', money(totalWeighted, 'UZS'), 'с учётом вероятности этапов'],
        ['Выиграно', String(launch.won ?? 0), 'сделок за период'],
        ['Дошли до первого заказа', pct(launch.launched ?? 0, launch.won ?? 0),
          `${launch.launched ?? 0} из ${launch.won ?? 0}`],
        ['Подпись → запуск', launch.avg_days ? `${Math.round(launch.avg_days)} дн` : '—', 'в среднем'],
      ]} />

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Воронка по когорте" sub="сделки, созданные в периоде, доведённые до конца">
          <div className="p-4 space-y-2">
            {funnel.length === 0 && <div className="text-[12.5px] text-gray-400">Данных за период нет</div>}
            {funnel.map((f: any, i: number) => {
              const prev = i > 0 ? funnel[i - 1].reached : f.reached
              const conv = prev ? Math.round((f.reached / prev) * 100) : 100
              const leak = i > 0 && conv < 50
              return (
                <div key={f.key} className="grid grid-cols-[130px_1fr_92px] gap-3 items-center text-[12.5px]">
                  <span className="text-gray-700">{f.label}</span>
                  <div className="h-5 rounded-md bg-blue-50 overflow-hidden">
                    <div className={`h-full rounded-md ${leak ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.max(3, (f.reached / Math.max(top, 1)) * 100)}%` }} />
                  </div>
                  <span className={`text-right tabular-nums text-[11.5px] ${leak ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    {f.reached} · {conv}%
                  </span>
                </div>
              )
            })}
            <div className="text-[11.5px] text-gray-400 pt-1">
              Красным помечен переход, где теряется больше половины — это и есть узкое место.
            </div>
          </div>
        </Card>

        <Card title="Деньги в воронке" sub="обещания, а не выручка">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Этап</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Сделок</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">В месяц</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Вероятн.</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Взвешенно</th>
                </tr>
              </thead>
              <tbody>
                {(data.money || []).map((m: any) => (
                  <tr key={m.key} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-900">{m.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.deals}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(m.amount, '')}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">{m.probability}%</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{money(m.weighted, '')}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td className="px-4 py-2 font-semibold text-gray-900">Итого</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {(data.money || []).reduce((s: number, m: any) => s + m.deals, 0)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(totalPipeline, '')}</td>
                  <td />
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(totalWeighted, '')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Источники" sub="атрибуция приходит с лидом, а не восстанавливается по тегам">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Источник</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Лидов</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">В работу</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Выиграно</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Конверсия</th>
                </tr>
              </thead>
              <tbody>
                {(data.sources || []).map((s: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-900">{s.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.leads}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.converted}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.won}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">{pct(s.won, s.leads)}</td>
                  </tr>
                ))}
                {(data.sources || []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-4 text-gray-400">Лидов за период нет</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Портрет покупателя" sub="по POS-системе — самый сильный признак покупки">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">POS клиента</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Закрытых</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Покупают</th>
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10"></th>
                </tr>
              </thead>
              <tbody>
                {(data.icp || []).map((r: any, i: number) => {
                  const rate = r.total ? Math.round((r.won / r.total) * 100) : 0
                  return (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-2 text-gray-900">{r.value}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{rate}%</td>
                      <td className="px-4 py-2">
                        <Chip tone={rate >= 20 ? 'green' : rate >= 10 ? 'amber' : 'red'}>
                          {rate >= 20 ? 'брать' : rate >= 10 ? 'проверять' : 'nurture'}
                        </Chip>
                      </td>
                    </tr>
                  )
                })}
                {(data.icp || []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-4 text-gray-400">
                    Закрытых сделок пока мало для выводов
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Как команда ведёт сделки" sub="качество ведения важнее количества звонков">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Сотрудник</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Сделок</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Выиграно</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Доля побед</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Квалифицировано</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Без след. шага</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Подписано</th>
              </tr>
            </thead>
            <tbody>
              {(data.team || []).map((t: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-4 py-2 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.deals}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.won}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(t.won, t.won + t.lost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(t.qualified, t.deals)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {t.no_next_step > 0
                      ? <span className="text-red-600 font-semibold">{t.no_next_step}</span>
                      : t.no_next_step}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(t.won_amount, '')}</td>
                </tr>
              ))}
              {(data.team || []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-4 text-gray-400">Сделок за период нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

export default SalesReportsPage
