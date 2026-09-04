import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis } from './kit'

/**
 * Активность сотрудников за день: чем человек занимался с утра до вечера.
 *
 * Руководителю нужен не итог месяца, а рабочий день: сколько набрал, с кем
 * поговорил, что сдвинул по этапам, каких лидов забрал, что записал. Сверху
 * сводка по каждому, снизу — лента событий с «до → после», как в журнале Amo.
 */

interface Person {
  name: string; role: string | null
  callsIn: number; callsOut: number; answered: number; talkSec: number
  moves: number; won: number; lost: number
  notes: number; leads: number; tasks: number; deals: number; total: number
}
interface Ev {
  at: string; who: string | null; obj: string; about: string | null
  event: string | null; before: string | null; after: string | null; link: string | null
}
interface Data {
  period: { from: string; to: string }
  people: Person[]
  totals: { people: number; calls: number; answered: number; talkSec: number; moves: number; won: number; actions: number }
  events: Ev[]
}

const fmtDur = (sec: number): string => {
  if (!sec) return '—'
  if (sec < 60) return `${sec} сек`
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}`
}
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short' })

/** Ярлык объекта: по нему в ленте видно, о чём вообще запись. */
const OBJ: Record<string, { label: string; cls: string }> = {
  deal: { label: 'сделка', cls: 'text-violet-700 bg-violet-50' },
  call: { label: 'звонок', cls: 'text-emerald-700 bg-emerald-50' },
  task: { label: 'задача', cls: 'text-blue-700 bg-blue-50' },
}

/** Дата в формате YYYY-MM-DD по рабочей зоне, а не по зоне браузера. */
function tashkentDay(shiftDays = 0): string {
  const t = new Date(Date.now() + shiftDays * 86400000 + 5 * 3600000)
  return t.toISOString().slice(0, 10)
}

export function SalesActivity({ region }: { region: string | null }) {
  const [day, setDay] = useState(() => tashkentDay())
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const my = ++reqRef.current
    setD(null)
    apiGet<Data>(`/sales/reports?action=activity&from=${day}&to=${day}&region=${region || 'all'}`, false)
      .then(r => { if (my === reqRef.current) { setD(r); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить активность'))
  }, [day, region])

  const isToday = day === tashkentDay()
  const events = d?.events.filter(e => !who || e.who === who) || []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => setDay(tashkentDay())}
            className={`text-[12.5px] px-3 py-1.5 ${isToday ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
            Сегодня
          </button>
          <button onClick={() => setDay(tashkentDay(-1))}
            className={`text-[12.5px] px-3 py-1.5 border-l border-gray-300 ${
              day === tashkentDay(-1) ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
            Вчера
          </button>
        </div>
        <input type="date" value={day} max={tashkentDay()}
          onChange={e => setDay(e.target.value)}
          className="text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-700" />
        {who && (
          <button onClick={() => setWho(null)}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            {who} · показать всех ✕
          </button>
        )}
      </div>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
      {!d && !error && <div className="text-[12.5px] text-gray-400 py-6 text-center">Собираю день…</div>}

      {d && (
        <>
          <Kpis items={[
            ['Работали', String(d.totals.people), 'сотрудников с активностью'],
            ['Действий', String(d.totals.actions), 'звонки, этапы, задачи, заметки'],
            ['Звонков', String(d.totals.calls), `${d.totals.answered} разговоров состоялось`],
            ['На линии', fmtDur(d.totals.talkSec), 'суммарно за день'],
            ['Движений по воронке', String(d.totals.moves), `${d.totals.won} выигрышей`],
          ]} />

          <Card title="Кто что сделал" sub="клик по строке — отфильтровать ленту по сотруднику">
            {!d.people.length ? (
              <div className="px-4 py-6 text-[12.5px] text-gray-400">
                За этот день активности не записано.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="text-left font-semibold px-4 py-2">Сотрудник</th>
                      <th className="text-right font-semibold px-3 py-2">↓ Вх</th>
                      <th className="text-right font-semibold px-3 py-2">↑ Исх</th>
                      <th className="text-right font-semibold px-3 py-2">Разговоры</th>
                      <th className="text-right font-semibold px-3 py-2">На линии</th>
                      <th className="text-right font-semibold px-3 py-2">Этапы</th>
                      <th className="text-right font-semibold px-3 py-2">Выиграл</th>
                      <th className="text-right font-semibold px-3 py-2">Лиды</th>
                      <th className="text-right font-semibold px-3 py-2">Задачи</th>
                      <th className="text-right font-semibold px-3 py-2">Заметки</th>
                      <th className="text-right font-semibold px-4 py-2">Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map(p => (
                      <tr key={p.name}
                        onClick={() => setWho(who === p.name ? null : p.name)}
                        className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${
                          who === p.name ? 'bg-blue-50/60' : ''}`}>
                        <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.callsIn || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.callsOut || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">{p.answered || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtDur(p.talkSec)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.moves || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">{p.won || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.leads || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.tasks || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.notes || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{p.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title={who ? `Лента дня — ${who}` : 'Лента дня'}
            sub="каждое действие по времени · «до → после» там, где значение менялось"
            right={<span className="text-[11.5px] text-gray-400">{fmtDay(day + 'T12:00:00')} · {events.length} событий</span>}
          >
            {!events.length ? (
              <div className="px-4 py-6 text-[12.5px] text-gray-400">Событий за этот день нет.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {events.map((e, i) => {
                  const o = OBJ[e.obj] || { label: e.obj, cls: 'text-gray-600 bg-gray-100' }
                  const href = e.obj === 'deal' && e.link ? `/sales/deals/${e.link}`
                    : e.obj === 'call' && e.link ? `/sales/leads/${e.link}` : null
                  return (
                    <div key={i} className="px-4 py-2 flex items-baseline gap-3 flex-wrap hover:bg-gray-50">
                      <span className="text-[11.5px] text-gray-400 tabular-nums w-11 flex-none">{fmtTime(e.at)}</span>
                      <span className="text-[12.5px] font-medium text-gray-800 w-28 flex-none truncate">
                        {e.who || '—'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide flex-none ${o.cls}`}>
                        {o.label}
                      </span>
                      {href ? (
                        <Link to={href} className="text-[12.5px] text-blue-600 hover:underline truncate max-w-[200px]">
                          {e.about || '—'}
                        </Link>
                      ) : (
                        <span className="text-[12.5px] text-gray-700 truncate max-w-[200px]">{e.about || '—'}</span>
                      )}
                      <span className="text-[12px] text-gray-500">{e.event}</span>
                      {(e.before || e.after) && (
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {e.before && (
                            <span className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500">
                              {e.before}
                            </span>
                          )}
                          {e.before && e.after && <span className="text-gray-300">→</span>}
                          {e.after && (
                            <span className="text-[11px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-700">
                              {e.after}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
