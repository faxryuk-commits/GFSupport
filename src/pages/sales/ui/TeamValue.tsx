import { useEffect, useRef, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis, Seg, moneyList } from './kit'
import { REGION_NAMES } from './region'

/**
 * Команда: ценность сотрудников — результат и как он получен.
 *
 * Пять осей в две группы: результат (выиграно, деньги) — за что платим;
 * действия, чистота карточек и ритм — почему результат такой и каким будет
 * дальше. Сводного балла нет: одну цифру команда научится растить за неделю,
 * и это будут заметки. Полоска под числом — относительно лучшего в команде,
 * чтобы профиль читался без чтения цифр. Сигналы — правила, не мнение.
 *
 * Правила счёта и честные дыры (АТС только в Ташкенте) — в карточке внизу:
 * руководитель читает её один раз, а к нулям Баку возвращается с пониманием.
 */

interface Signal { tone: 'good' | 'warn' | 'bad' | 'info'; text: string }
interface Person {
  agentId: string; name: string; role: string | null; market: string | null; since: string | null
  result: { won: number; lost: number; closed: number; conv: number | null; created: number; advanced: number; open: number
            wonAmounts: Record<string, number>; wonUzs: number }
  touch: { calls: number; answered: number; talkSec: number; msgs: number; meetings: number; total: number; visible: boolean }
  crm: { moves: number; tasks: number; notes: number; total: number }
  clean: { open: number; withStep: number; qualified: number; late: number; lateAmt: number; lost: number; lostReasoned: number; stale14: number
           checks: Array<{ key: string; label: string; pass: number; of: number; ratio: number | null }>; score: number | null }
  rhythm: { activeDays: number; workDays: number; weekendDays: number; longestGap: number; lastActive: string | null; days: Record<string, number> }
  signals: Signal[]
}
interface Data {
  period: { from: string; to: string; workDays: number; crmSince: string }
  workDays: string[]
  totals: { people: number; byMarket: Record<string, number>; won: number; wonAmounts: Record<string, number>
            touches: number; cleanAvg: number | null; rhythmAvg: number }
  people: Person[]
}

type Sort = 'result' | 'actions' | 'clean' | 'rhythm'

const ROLE_LABEL: Record<string, string> = { cco: 'CCO', kam: 'закрытие', sdr: 'SDR', sales: 'продажи', sales_lead: 'лид продаж', manager: 'менеджер', admin: 'админ', agent: 'продажи' }
const MARKET_SHORT: Record<string, string> = { uz: 'Ташкент', kz: 'Алматы', az: 'Баку', kg: 'Бишкек', ge: 'Тбилиси' }
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const fmtMln = (v: number) => v ? `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн` : '—'
const fmtDay = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1]}` }
const wdOf = (iso: string) => new Date(`${iso}T12:00:00+05:00`).getDay()
const isWeekend = (iso: string) => { const w = wdOf(iso); return w === 0 || w === 6 }
const lastDays = (to: string, n: number): string[] => {
  const out: string[] = []
  const d = new Date(`${to}T12:00:00+05:00`)
  for (let i = 0; i < n; i++) { out.unshift(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' })); d.setDate(d.getDate() - 1) }
  return out
}
const heatClass = (n: number) =>
  n <= 0 ? 'bg-gray-100' : n < 20 ? 'bg-blue-200' : n < 40 ? 'bg-blue-400' : n < 70 ? 'bg-blue-600' : 'bg-blue-800'

const SIG_TONE: Record<Signal['tone'], string> = {
  good: 'bg-emerald-50 text-emerald-800', warn: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-800', info: 'bg-gray-100 text-gray-600',
}

function Bar({ v, max, color }: { v: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0
  return <div className="h-1 w-24 bg-gray-100 rounded mt-1.5 overflow-hidden"><div className={`h-full rounded ${color}`} style={{ width: `${w}%` }} /></div>
}

function Dots({ checks }: { checks: Person['clean']['checks'] }) {
  return (
    <span className="inline-flex gap-[3px] ml-1.5 align-middle">
      {checks.map(c => {
        const cls = c.ratio === null ? 'bg-gray-100 outline outline-1 outline-dashed outline-gray-300 -outline-offset-1'
          : c.ratio >= 0.8 ? 'bg-emerald-500' : c.ratio >= 0.4 ? 'bg-amber-400' : 'bg-red-500'
        const title = c.ratio === null ? `${c.label}: нечего проверять` : `${c.label}: ${c.pass} из ${c.of}`
        return <i key={c.key} title={title} className={`inline-block w-2 h-2 rounded-full ${cls}`} />
      })}
    </span>
  )
}

export function TeamValue({ from, to, region }: { from: string; to: string; region: string | null }) {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('result')
  const reqRef = useRef(0)

  useEffect(() => {
    const my = ++reqRef.current
    apiGet<Data>(`/sales/reports?action=team_value&from=${from}&to=${to}&region=${region || 'all'}`, false)
      .then(r => { if (my === reqRef.current) { setD(r); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить команду'))
  }, [from, to, region])

  if (error) return <div className="text-[12.5px] text-red-600 py-3">{error}</div>
  if (!d) return <div className="text-[12.5px] text-gray-400 py-6 text-center">Считаю команду…</div>

  const people = [...d.people].sort((a, b) => {
    if (sort === 'actions') return (b.touch.total + b.crm.total) - (a.touch.total + a.crm.total)
    if (sort === 'clean') return (b.clean.score ?? -1) - (a.clean.score ?? -1)
    if (sort === 'rhythm') return (b.rhythm.workDays ? b.rhythm.activeDays / b.rhythm.workDays : 0) - (a.rhythm.workDays ? a.rhythm.activeDays / a.rhythm.workDays : 0)
    return b.result.won - a.result.won || b.result.wonUzs - a.result.wonUzs || b.result.advanced - a.result.advanced
  })
  const max = {
    won: Math.max(1, ...people.map(p => p.result.won)),
    uzs: Math.max(1, ...people.map(p => p.result.wonUzs)),
    touch: Math.max(1, ...people.map(p => p.touch.total)),
    crm: Math.max(1, ...people.map(p => p.crm.total)),
  }
  const strip = lastDays(d.period.to, 12)
  const heat = lastDays(d.period.to, 14)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' })
  const markets = Object.entries(d.totals.byMarket).map(([k, n]) => `${MARKET_SHORT[k] || REGION_NAMES[k] || k} ${n}`).join(' · ')

  return (
    <div className="space-y-4">
      <Kpis items={[
        ['Сейлзов в работе', String(d.totals.people), markets || '—'],
        ['Выиграно', String(d.totals.won), `закрыто за период · ${moneyList(d.totals.wonAmounts, 'без сумм')}`],
        ['Касаний клиентов', String(d.totals.touches), 'разговоры, сообщения, встречи · факты, не заметки'],
        ['Чистота карточек', d.totals.cleanAvg === null ? '—' : `${d.totals.cleanAvg}%`, 'открытых сделок с шагом, квалификацией и суммой'],
        ['Ритм', `${d.totals.rhythmAvg}%`, `рабочих дней с действиями · ${d.period.workDays} дн в периоде`],
      ]} />

      <Card title="Ценность сотрудников"
        sub="результат — за что платим; действия, чистота и ритм — почему он такой · полоска — относительно лучшего в команде"
        right={<div className="flex items-center gap-2"><span className="text-[11px] text-gray-400">сортировать:</span>
          <Seg size="sm" value={sort} onChange={setSort}
            items={[{ key: 'result', label: 'Результат' }, { key: 'actions', label: 'Действия' }, { key: 'clean', label: 'Чистота' }, { key: 'rhythm', label: 'Ритм' }]} /></div>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] text-gray-600 font-semibold">
                <th />
                <th colSpan={2} className="text-left px-3 pt-2.5">Результат<i className="block h-0.5 rounded bg-emerald-500 mt-1" /></th>
                <th colSpan={2} className="text-left px-3 pt-2.5">Действия<i className="block h-0.5 rounded bg-blue-500 mt-1" /></th>
                <th className="text-left px-3 pt-2.5">Чистота<i className="block h-0.5 rounded bg-violet-500 mt-1" /></th>
                <th className="text-left px-3 pt-2.5">Ритм<i className="block h-0.5 rounded bg-amber-500 mt-1" /></th>
                <th />
              </tr>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left font-semibold px-4 py-2">Сотрудник</th>
                <th className="text-left font-semibold px-3 py-2">Выиграно</th>
                <th className="text-left font-semibold px-3 py-2">Подписано</th>
                <th className="text-left font-semibold px-3 py-2">С клиентом</th>
                <th className="text-left font-semibold px-3 py-2">В CRM</th>
                <th className="text-left font-semibold px-3 py-2">Карточки</th>
                <th className="text-left font-semibold px-3 py-2">Дней из {d.period.workDays}</th>
                <th className="text-left font-semibold px-3 py-2">Сигналы</th>
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const c = p.clean, r = p.rhythm
                const roleLabel = [p.role && ROLE_LABEL[p.role], p.market && (MARKET_SHORT[p.market] || REGION_NAMES[p.market]), p.since && `с ${fmtDay(p.since)}`].filter(Boolean).join(' · ')
                return (
                  <tr key={p.agentId} className="border-b border-gray-100 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-gray-900">{p.name}</div>
                      <div className="text-[11px] text-gray-500">{roleLabel}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{p.result.won}
                        {p.result.closed > 0 && <span className="text-[11px] text-gray-500 font-normal ml-1">из {p.result.closed} · {p.result.conv}%</span>}</div>
                      <div className="text-[11px] text-gray-500">{p.result.advanced > 0 ? `до демо и дальше: ${p.result.advanced}` : `${p.result.open} в работе`}</div>
                      <Bar v={p.result.won} max={max.won} color="bg-emerald-500" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{moneyList(p.result.wonAmounts, '—')}</div>
                      <div className="text-[11px] text-gray-500">{Object.keys(p.result.wonAmounts).some(k => k !== 'UZS') && p.result.wonUzs ? `≈ ${fmtMln(p.result.wonUzs)} UZS по курсу` : p.result.wonUzs ? 'в месяц' : 'сумм в выигранных нет'}</div>
                      <Bar v={p.result.wonUzs} max={max.uzs} color="bg-emerald-500" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{p.touch.total}</div>
                      <div className="text-[11px] text-gray-500 whitespace-nowrap">
                        {p.touch.visible
                          ? `${p.touch.answered} разгов.${p.touch.talkSec >= 60 ? ` (${Math.round(p.touch.talkSec / 60)} мин)` : ''} · ${p.touch.msgs} сообщ.${p.touch.meetings ? ` · ${p.touch.meetings} встреч` : ''}`
                          : `АТС и мессенджеры CRM здесь нет${p.touch.meetings ? ` · ${p.touch.meetings} встреч` : ''}`}
                      </div>
                      <Bar v={p.touch.total} max={max.touch} color="bg-blue-500" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{p.crm.total}</div>
                      <div className="text-[11px] text-gray-500 whitespace-nowrap">{p.crm.moves} переходов · {p.crm.tasks} задач · {p.crm.notes} записей</div>
                      <Bar v={p.crm.total} max={max.crm} color="bg-blue-500" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{c.score === null ? '—' : `${c.score}%`}<Dots checks={c.checks} /></div>
                      <div className="text-[11px] text-gray-500 whitespace-nowrap">
                        {c.open > 0 ? `${c.withStep} из ${c.open} с шагом · ${c.qualified} квалифицировано` : 'открытых сделок нет'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold tabular-nums">{r.activeDays}{r.workDays !== d.period.workDays && <span className="text-[11px] text-gray-500 font-normal"> из {r.workDays}</span>}
                        <span className="inline-grid ml-1.5 align-middle gap-[2px]" style={{ gridTemplateColumns: `repeat(${strip.length}, 9px)` }}>
                          {strip.map(day => {
                            const n = r.days[day] || 0
                            const we = isWeekend(day)
                            return <i key={day} title={`${WD[wdOf(day)]} ${fmtDay(day)}: ${n}`}
                              className={`block w-[9px] h-[9px] rounded-[2px] ${n > 0 ? heatClass(n) : we ? 'bg-gray-50 outline outline-1 outline-gray-200 -outline-offset-1' : 'bg-gray-100'}`} />
                          })}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 whitespace-nowrap">
                        {r.activeDays === 0 ? 'без действий' : r.activeDays === r.workDays ? 'каждый рабочий день' : r.longestGap >= 2 ? `перерыв ${r.longestGap} дн подряд` : 'с пропусками'}
                        {r.weekendDays > 0 && ` · +${r.weekendDays} вых.`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {p.signals.map((s, i) => <span key={i} className={`text-[11px] rounded-md px-1.5 py-px whitespace-nowrap ${SIG_TONE[s.tone]}`}>{s.text}</span>)}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {people.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-[12.5px] text-gray-400">За период у команды нет ни сделок, ни действий</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Ритм по дням" sub={`действия с клиентами и в CRM · выходные серым · до ${fmtDay(d.period.crmSince)} команда работала в Amo, там данных нет`}
        right={<span className="text-[10px] text-gray-400 border border-gray-200 rounded-md px-2 py-0.5">{fmtDay(heat[0])} — {fmtDay(heat[heat.length - 1])}</span>}>
        <div className="px-4 py-3 overflow-x-auto">
          <table className="text-[12px]">
            <thead>
              <tr>
                <th />
                {heat.map(day => <th key={day} className={`font-medium text-[10px] px-1 pb-1 text-center ${isWeekend(day) ? 'text-gray-300' : 'text-gray-400'}`}>{WD[wdOf(day)]} {Number(day.slice(8))}</th>)}
                <th className="text-left text-[10px] font-medium text-gray-400 pl-3">итого</th>
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const total = heat.reduce((s, day) => s + (p.rhythm.days[day] || 0), 0)
                return (
                  <tr key={p.agentId}>
                    <td className="pr-3 py-[3px] whitespace-nowrap text-gray-700">{p.name}</td>
                    {heat.map(day => {
                      const n = p.rhythm.days[day] || 0
                      const we = isWeekend(day)
                      return (
                        <td key={day} className="px-[3px] py-[3px]">
                          <div title={`${WD[wdOf(day)]} ${fmtDay(day)}: ${n}`}
                            className={`w-[26px] h-5 rounded flex items-center justify-center text-[9.5px] ${n > 0 ? `${heatClass(n)} ${n < 20 ? 'text-blue-900' : 'text-white'}` : we ? 'bg-gray-50 outline outline-1 outline-gray-200 -outline-offset-1' : 'bg-gray-100'}`}>
                            {n > 0 ? n : ''}
                          </div>
                        </td>
                      )
                    })}
                    <td className="pl-3 py-[3px] whitespace-nowrap text-gray-500 tabular-nums">{total} · {p.rhythm.activeDays} из {p.rhythm.workDays}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3.5 mt-2.5 text-[11px] text-gray-500">
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-100 mr-1 align-[-1px]" />0</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 mr-1 align-[-1px]" />1–19</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400 mr-1 align-[-1px]" />20–39</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-600 mr-1 align-[-1px]" />40–69</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-800 mr-1 align-[-1px]" />70+</span>
            {heat[heat.length - 1] === today && <span className="ml-1">· сегодня день ещё идёт</span>}
          </div>
        </div>
      </Card>

      <Card title="Как считаем — и чего не видим" sub="цифры, которые нельзя накрутить, и честные дыры">
        <div className="px-4 py-3 grid md:grid-cols-2 gap-x-7 gap-y-2 text-[12.5px]">
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Результат</b>Выиграно и конверсия из закрытых за период (выиграно ÷ выиграно + проиграно). Для SDR отдельно: сколько заведённых дошло до демо и дальше. <span className="text-gray-500">Подписка — по валютам; в сумы по курсу только для сортировки.</span></div>
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Действия с клиентом</b>Разговоры от 30 секунд по данным АТС, исходящие сообщения из CRM, проведённые встречи. <span className="text-gray-500">Недозвоны и заметки сюда не входят — их можно наделать.</span></div>
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Действия в CRM</b>Переходы по этапам и закрытые задачи. Записи — отдельно и без веса: это самоотчёт.</div>
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Чистота карточек</b>Пять проверок по открытым сделкам: есть следующий шаг · заполнена квалификация (POS, боль, заказы, доставка) · на КП и дальше указана сумма · проигрыш с причиной, не «Другое» · не стоит 14+ дней. Процент — среднее по применимым проверкам.</div>
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Ритм</b>Рабочих дней с хотя бы одним действием. Новичку считаем с его первого дня. Выходные — плюсом, но не минусом.</div>
          <div className="py-1.5 border-b border-gray-100"><b className="block font-semibold">Сравнивать внутри региона и роли</b>SDR теряет 80 на 2 выигрыша — это его работа, а не провал. Закрытие судим по выигрышам, SDR — по разговорам и переданным дальше.</div>
          <div className="md:col-span-2 mt-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900"><b className="font-semibold">Чего не видим сегодня.</b> АТС и мессенджеры подключены только в Ташкенте: у Алматы и Баку «с клиентом» всегда 0, их ценность видна по переходам, чистоте и результату. Встречи — по закрытым задачам-встречам, не по календарю. До {fmtDay(d.period.crmSince)} команда работала в Amo — действий за те дни нет.</div>
        </div>
      </Card>
    </div>
  )
}
