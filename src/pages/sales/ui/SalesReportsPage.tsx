import { useCallback, useEffect, useState, useRef } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Chip, Kpis, money, pct, PageShell, Skeleton } from './kit'
import { RegionBadge, useRegion, REGION_NAMES } from './region'
import { SalesPulse } from './SalesPulse'
import { SalesActivity } from './SalesActivity'

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
  const [tab, setTab] = useState<'sales' | 'activity' | 'site'>('sales')
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

  const funnel = (data.funnel || []).filter((f: any) => f.reached > 0)
  const top = funnel[0]?.reached || 0
  const totalWeighted = (data.money || []).reduce((s: number, m: any) => s + Number(m.weighted || 0), 0)
  const totalPipeline = (data.money || []).reduce((s: number, m: any) => s + Number(m.amount || 0), 0)
  const launch = data.launch || {}

  /**
   * Подпись под заголовком блока: за какой период он посчитан и по какому
   * региону. Раньше каждый блок молчал о своих границах, и цифры выглядели
   * несовместимыми — на деле часть была снимком «сейчас», часть за период.
   */
  const scope = (kind: 'period' | 'now') => {
    const region = data.market ? `регион ${REGION_NAMES[data.market] || data.market}` : 'все регионы'
    return kind === 'now'
      ? `на сейчас · ${region}`
      : `${data.period?.from} — ${data.period?.to} · ${region}`
  }

  /** «+12 к прошлому периоду» — иначе число висит без опоры. */
  function delta(now: number, before: any): string {
    const prev = Number(before || 0)
    if (!prev && !now) return 'за период'
    const diff = now - prev
    if (!prev) return `было 0, стало ${now}`
    const pct = Math.round((diff / prev) * 100)
    return `${diff >= 0 ? '+' : ''}${diff} к прошлому периоду (${pct >= 0 ? '+' : ''}${pct}%)`
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
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {([['sales', 'Продажи'], ['activity', 'Активность'], ['site', 'Сайт']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`text-[12.5px] px-3 py-1.5 ${tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
              {l}
            </button>
          ))}
        </div>
        <RegionBadge scope="reports" />
        <div className="flex gap-1 border border-gray-300 rounded-lg overflow-hidden">
          {[['30', 'Месяц'], ['90', 'Квартал'], ['365', 'Год']].map(([v, l]) => (
            <button key={v} onClick={() => { setPeriod(v); setCustomFrom(''); setCustomTo('') }}
              className={`text-[12.5px] px-3 py-1.5 ${period === v && !customFrom ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
              {l}
            </button>
          ))}
        </div>
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
      <SalesPulse from={fromStr} to={toStr} region={region} />

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

<Card title="Деньги в воронке" sub={`обещания, а не выручка · ${scope('now')}`}>
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

        <Card title="Источники" sub={`атрибуция приходит с лидом · ${scope('period')}`}>
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

        <Card title="Портрет покупателя" sub={`по POS-системе, все закрытые сделки · ${data.market ? `регион ${REGION_NAMES[data.market] || data.market}` : 'все регионы'}`}>
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
      </>}
    </PageShell>
  )
}

export default SalesReportsPage
