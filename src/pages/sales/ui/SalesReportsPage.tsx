import { useCallback, useEffect, useState, useRef } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis, money, pct, PageShell, Skeleton, Seg } from './kit'
import { RegionBadge, useRegion, REGION_NAMES } from './region'
import { SalesPulse } from './SalesPulse'
import { SalesActivity } from './SalesActivity'
import { AdsReport } from './AdsReport'
import { SalesFlow } from './SalesFlow'

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
  // Свободный диапазон: заданные руками даты выигрывают у пресетов
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // Верх воронки: сводку по сайту присылает бот delever.io
  const [site, setSite] = useState<any>(null)
  const [tab, setTab] = useState<'sales' | 'activity' | 'site' | 'ads'>('sales')
  const region = useRegion('reports')

  // Номер запроса: при автообновлении и быстрой смене фильтров ответ старого
  // запроса приходил позже нового и перетирал список — со стороны это выглядит
  // как «фильтр не применился»
  const reqRef = useRef(0)

  const fromStr = customFrom || new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10)
  const toStr = customTo || new Date().toISOString().slice(0, 10)

  const load = useCallback(() => {
    const from = fromStr
    const my = ++reqRef.current
    apiGet<any>(`/sales/reports?from=${from}&to=${toStr}&region=${region || 'all'}`, false)
      .then(d => { if (my !== reqRef.current) return; setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить отчёты'))
  }, [fromStr, toStr, region])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    apiGet<any>(`/sales/site-analytics?days=${period}`, false).then(setSite).catch(() => {})
  }, [period])

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={6} />

  /**
   * Подпись под заголовком блока: за какой период он посчитан и по какому
   * региону — иначе снимок «сейчас» и цифры за период выглядят несовместимыми.
   */
  const scope = (kind: 'period' | 'now') => {
    const region = data.market ? `регион ${REGION_NAMES[data.market] || data.market}` : 'все регионы'
    return kind === 'now'
      ? `на сейчас · ${region}`
      : `${data.period?.from} — ${data.period?.to} · ${region}`
  }

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
        <Seg value={tab} onChange={setTab}
          items={[{ key: 'sales', label: 'Продажи' }, { key: 'activity', label: 'Активность' }, { key: 'site', label: 'Сайт' }, { key: 'ads', label: 'Реклама' }]} />
        <RegionBadge scope="reports" />
        <Seg value={customFrom ? '' : period} onChange={v => { setPeriod(v); setCustomFrom(''); setCustomTo('') }}
          items={[{ key: '30', label: 'Месяц' }, { key: '90', label: 'Квартал' }, { key: '365', label: 'Год' }]} />
        <div className="flex items-center gap-1 border border-gray-300 rounded-lg px-2 py-1 bg-white">
          <input type="date" value={customFrom || fromStr} max={toStr}
            onChange={e => setCustomFrom(e.target.value)}
            className="text-[12px] text-gray-600 outline-none" />
          <span className="text-gray-400 text-[12px]">—</span>
          <input type="date" value={customTo || toStr} min={fromStr}
            onChange={e => setCustomTo(e.target.value)}
            className="text-[12px] text-gray-600 outline-none" />
        </div>
        </div>
      </div>
    }>


      {tab === 'activity' && <SalesActivity region={region} />}
      {tab === 'ads' && <AdsReport from={fromStr} to={toStr} region={region} />}

      {tab === 'site' && (
        <>
          {!site?.days?.length ? (
            <Card title="Аналитика сайта" sub="сводку присылает бот delever.io">
              <div className="px-4 py-5 text-[12.5px] text-gray-500 space-y-2">
                <p>Данных пока нет. Бот должен присылать дневную сводку сюда:</p>
                <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11.5px] text-gray-700 whitespace-pre-wrap">
                  POST /api/support/sales/site-analytics{'\n'}
                  Authorization: Bearer &lt;CRON_SECRET&gt;{'\n'}
                  {'{'} "text": "📊 Аналитика delever.io — 12.08.2026 …" {'}'}
                </code>
                <p>
                  Принимается тот же текст, что бот шлёт в Telegram, — переписывать его формат не нужно.
                  Повторная присылка за ту же дату обновляет день, а не плодит дубли.
                </p>
              </div>
            </Card>
          ) : (
            <>
              <Kpis items={[
                ['Просмотры', String(site.totals.views), `за ${site.totals.days} дн`],
                ['Уникальные', String(site.totals.uniques), 'посетителей'],
                ['Сессии', String(site.totals.sessions), 'визитов'],
                ['Лидов с сайта', String(site.totals.leads), 'из формы'],
                ['Медианное время', `${Math.floor(site.totals.avgMedianSeconds / 60)}м ${site.totals.avgMedianSeconds % 60}с`,
                  'в среднем по дням'],
              ]} />

              <div className="grid lg:grid-cols-2 gap-4">
                <Card title="По дням" sub="просмотры, уникальные, лиды">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                          <th className="text-left font-semibold px-4 py-2">День</th>
                          <th className="text-right font-semibold px-4 py-2">Просмотры</th>
                          <th className="text-right font-semibold px-4 py-2">Уники</th>
                          <th className="text-right font-semibold px-4 py-2">Лиды</th>
                        </tr>
                      </thead>
                      <tbody>
                        {site.days.slice(0, 14).map((d: any) => (
                          <tr key={d.day} className="border-b border-gray-100">
                            <td className="px-4 py-2 text-gray-700">{d.day}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{d.views ?? '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{d.uniques ?? '—'}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${d.leads ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                              {d.leads ?? 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title="Горячие посетители" sub="ходили по тарифам и интеграциям — верх воронки, который стоит ловить">
                  <div className="divide-y divide-gray-100">
                    {(site.latest?.hot_visitors || []).map((h: any, i: number) => (
                      <div key={i} className="px-4 py-2.5">
                        <div className="flex justify-between gap-2">
                          <span className="text-[12.5px] text-gray-900">{h.country} · {h.signal}</span>
                          <span className="text-[11.5px] font-semibold text-amber-600">score {h.score}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">{h.path}</div>
                      </div>
                    ))}
                    {!(site.latest?.hot_visitors || []).length && (
                      <div className="px-4 py-4 text-[12.5px] text-gray-400">В последней сводке горячих не было</div>
                    )}
                  </div>
                </Card>

                <Card title="Источники трафика" sub="последний день">
                  <div className="divide-y divide-gray-100">
                    {(site.latest?.sources || []).map((x: any, i: number) => (
                      <div key={i} className="px-4 py-2 flex justify-between text-[12.5px]">
                        <span className="text-gray-700">{x.label}</span>
                        <span className="tabular-nums text-gray-900">{x.hits}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Топ страниц" sub="последний день">
                  <div className="divide-y divide-gray-100">
                    {(site.latest?.top_pages || []).map((x: any, i: number) => (
                      <div key={i} className="px-4 py-2 flex justify-between gap-3 text-[12.5px]">
                        <span className="text-gray-700 truncate">{x.path}</span>
                        <span className="tabular-nums text-gray-900">{x.hits}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Страны и языки" sub="последний день">
                  <div className="px-4 py-3 flex flex-wrap gap-1.5">
                    {(site.latest?.countries || []).map((c: any) => (
                      <span key={c.code} className="text-[11.5px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
                        {c.code} {c.hits}
                      </span>
                    ))}
                    {Object.entries(site.latest?.langs || {}).map(([k, v]) => (
                      <span key={k} className="text-[11.5px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                        {k} {String(v)}
                      </span>
                    ))}
                  </div>
                </Card>

                <Card title="A/B тесты" sub="последний день">
                  <div className="divide-y divide-gray-100">
                    {(site.latest?.ab_tests || []).map((t: any, i: number) => (
                      <div key={i} className="px-4 py-2 flex justify-between gap-3 text-[12.5px]">
                        <span className="text-gray-700">{t.name} · {t.variant}</span>
                        <span className="tabular-nums text-gray-600">
                          {t.visits} → {t.conversions}
                          {t.visits ? ` (${Math.round((t.conversions / t.visits) * 100)}%)` : ''}
                        </span>
                      </div>
                    ))}
                    {!(site.latest?.ab_tests || []).length && (
                      <div className="px-4 py-4 text-[12.5px] text-gray-400">Тестов в сводке нет</div>
                    )}
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'sales' && <>
      {/* Порядок — рассказ: итоги периода → поток от канала до выигрыша →
          деньги → динамика и регионы → портрет → команда. Каждый вопрос
          отвечен один раз: дубли (три таблицы источников, два «почему
          проигрываем», три таблицы по сейлзам) сняты 18.09.2026 */}
      <SalesPulse from={fromStr} to={toStr} region={region}>
        <SalesFlow from={fromStr} to={toStr} region={region} />
      </SalesPulse>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Движение по дням" sub={`сколько заводили, выигрывали и теряли · ${scope('period')}`}>
          <div className="p-4">
            {(data.daily || []).length === 0 ? (
              <div className="text-[12.5px] text-gray-400">За период движения не было</div>
            ) : (
              <div className="flex items-end gap-1 h-28">
                {(data.daily || []).map((d: any) => {
                  const max = Math.max(...(data.daily || []).map((x: any) =>
                    Math.max(x.created, x.won, x.lost)), 1)
                  return (
                    <div key={d.day} className="flex-1 flex flex-col justify-end items-center gap-0.5 min-w-[6px]"
                      title={`${d.day}: заведено ${d.created}, выиграно ${d.won}, проиграно ${d.lost}`}>
                      <div className="w-full bg-emerald-500 rounded-sm"
                        style={{ height: `${(d.won / max) * 70}px` }} />
                      <div className="w-full bg-blue-400 rounded-sm"
                        style={{ height: `${(d.created / max) * 70}px` }} />
                      <div className="w-full bg-red-300 rounded-sm"
                        style={{ height: `${(d.lost / max) * 70}px` }} />
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex gap-4 mt-3 text-[11.5px] text-gray-500">
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400 mr-1.5" />заведено</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1.5" />выиграно</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-red-300 mr-1.5" />проиграно</span>
            </div>
          </div>
        </Card>

        <Card title="По регионам" sub={`выигрыши и потери за период, портфель — на сейчас · ${data.period?.from} — ${data.period?.to}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2">Регион</th>
                  <th className="text-right font-semibold px-4 py-2">В работе</th>
                  <th className="text-right font-semibold px-4 py-2">Пайплайн</th>
                  <th className="text-right font-semibold px-4 py-2">Выиграно</th>
                  <th className="text-right font-semibold px-4 py-2">Проиграно</th>
                  <th className="text-right font-semibold px-4 py-2">Подписано</th>
                </tr>
              </thead>
              <tbody>
                {(data.byRegion || []).map((r: any) => (
                  <tr key={r.market} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-900">{REGION_NAMES[r.market] || r.market}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.open}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">{money(r.pipeline, 'UZS')}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{r.won}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-600">{r.lost}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.won_amount, 'UZS')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Портрет покупателя"
        sub={`кто покупает, а кто нет — по закрытым сделкам периода · ${data.market ? `регион ${REGION_NAMES[data.market] || data.market}` : 'все регионы'}`}>
        <div className="grid md:grid-cols-2 gap-0 md:divide-x divide-gray-100">
          {(['orders', 'delivery'] as const).map(dim => {
            const rows = (data.icp || []).filter((r: any) => r.dim === dim)
            const known = rows.filter((r: any) => !/^не указано$/i.test(r.value))
            const unknown = rows.find((r: any) => /^не указано$/i.test(r.value))
            return (
              <div key={dim} className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-gray-500 bg-gray-50/80">
                      <th className="text-left font-semibold px-4 py-2">{dim === 'orders' ? 'Заказов в день' : 'Доставка'}</th>
                      <th className="text-right font-semibold px-4 py-2">Закрыто</th>
                      <th className="text-right font-semibold px-4 py-2">Куплено</th>
                      <th className="text-left font-semibold px-4 py-2 w-[38%]">Доля побед</th>
                    </tr>
                  </thead>
                  <tbody>
                    {known.map((r: any) => {
                      const rate = r.total ? Math.round((r.won / r.total) * 100) : 0
                      return (
                        <tr key={r.value} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-900">{r.value}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.won}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${rate}%` }} /></div>
                              <span className="text-[11px] text-gray-500 tabular-nums w-8">{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {unknown && (
                      <tr className="border-t border-gray-100 text-gray-400">
                        <td className="px-4 py-2">не указано</td>
                        <td className="px-4 py-2 text-right tabular-nums">{unknown.total}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{unknown.won}</td>
                        <td className="px-4 py-2 text-[11px]">{unknown.total ? Math.round((unknown.won / unknown.total) * 100) : 0}% · заполняйте квалификацию</td>
                      </tr>
                    )}
                    {rows.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-4 text-gray-400">Закрытых сделок за период нет</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Команда" sub="сделки, заведённые в периоде, и портфель на сейчас · одна таблица вместо трёх">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Сотрудник</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Сделок за период</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Выиграно</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Доля побед</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Подписано</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Квалифицировано</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Открыто сейчас</th>
                <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Без шага</th>
              </tr>
            </thead>
            <tbody>
              {(data.team || []).map((t: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-4 py-2 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.deals}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.won}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(t.won, t.won + t.lost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(t.won_amount, '')}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(t.qualified, t.deals)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.open_now ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {t.open_no_step > 0
                      ? <span className="text-red-600 font-semibold">{t.open_no_step}</span>
                      : (t.open_no_step ?? 0)}
                  </td>
                </tr>
              ))}
              {(data.team || []).length === 0 && (
                <tr><td colSpan={8} className="px-4 py-4 text-gray-400">Сделок за период нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
      </>}
    </PageShell>
  )
}

export default SalesReportsPage
