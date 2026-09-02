import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PhoneIncoming, PhoneOutgoing, Play } from 'lucide-react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { parsePhone } from '@/shared/lib/phone'
import { Card, Kpis, PageShell, Empty } from './kit'
import { CallInsight } from './CallInsight'

/**
 * Дашборд звонков: сколько звонили, дозвонились ли, когда и кто говорил.
 *
 * Телефония до сих пор жила россыпью: касания на карточках, недавние в
 * звонилке, записи в кабинете АТС. Здесь одна картина: динамика по дням,
 * загрузка по часам (когда клиенты реально звонят), разрез по сотрудникам
 * и лента звонков с лидами, сделками и прослушиванием записи на месте.
 */

interface Stats {
  totals: {
    total: number; inbound: number; outbound: number; answered: number
    missedIn: number; failedOut: number; talkSec: number; avgTalkSec: number
  }
  byDay: Array<{ day: string; answered: number; missed: number }>
  byHour: Array<{ h: number; answered: number; missed: number }>
  byAgent: Array<{
    name: string; total: number; answered: number; talkSec: number
    inbound?: number; outbound?: number; days?: Record<string, number>
  }>
  calls: Array<{
    uuid: string | null; at: string; direction: 'in' | 'out'; answered: boolean
    talkSec: number; number: string; who: string
    leadId: string | null; leadName: string | null
    dealId: string | null; dealTitle: string | null
  }>
}

const fmtDur = (sec: number): string => {
  if (!sec) return '0 мин'
  if (sec < 60) return `${sec} сек`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} мин`
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
}

const fmtAt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })

/** Столбики: отвеченные растут снизу зелёным, неотвеченные — сверху красным. */
function Bars({ items, labelEvery = 1, labels }: {
  items: Array<{ answered: number; missed: number; key: string }>
  labelEvery?: number
  labels?: (key: string, i: number) => string
}) {
  const max = Math.max(1, ...items.map(i => i.answered + i.missed))
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex items-end gap-[3px] h-28">
        {items.map((it, i) => {
          const total = it.answered + it.missed
          return (
            <div key={it.key} className="flex-1 min-w-0 flex flex-col justify-end h-full group relative"
              title={`${labels ? labels(it.key, i) : it.key}: ${it.answered} отвечено, ${it.missed} без ответа`}>
              {total > 0 ? (
                <>
                  {it.missed > 0 && (
                    <div className="bg-red-300 rounded-t-[3px]"
                      style={{ height: `${(it.missed / max) * 100}%`, minHeight: 3 }} />
                  )}
                  {it.answered > 0 && (
                    <div className={`bg-emerald-500 ${it.missed ? '' : 'rounded-t-[3px]'}`}
                      style={{ height: `${(it.answered / max) * 100}%`, minHeight: 3 }} />
                  )}
                </>
              ) : (
                <div className="bg-gray-100 rounded-t-[3px]" style={{ height: 2 }} />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-[3px] mt-1">
        {items.map((it, i) => (
          <div key={it.key} className="flex-1 min-w-0 text-center text-[9.5px] text-gray-400 tabular-nums truncate">
            {i % labelEvery === 0 ? (labels ? labels(it.key, i) : it.key) : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

const fmtSince = (sec: number): string => {
  if (sec < 60) return `${sec} сек`
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** Линия прямо сейчас: кто звонит и с кем идёт разговор, по событиям АТС. */
function LiveLines() {
  const [lines, setLines] = useState<Array<{
    direction: 'in' | 'out'; state: 'ringing' | 'talking'; number: string
    ext: string | null; sinceSec: number; leadId: string | null; leadName: string | null
  }>>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stop = false
    const load = () => {
      apiGet<any>('/sales/call?action=now', false)
        .then(d => { if (!stop) { setLines(d?.lines || []); setTick(0) } })
        .catch(() => {})
    }
    load()
    const poll = setInterval(load, 10000)
    // Секундомер тикает локально между опросами — разговор «живёт» на глазах
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => { stop = true; clearInterval(poll); clearInterval(t) }
  }, [])

  if (!lines.length) return null
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
        Сейчас на линии
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {lines.map((l, i) => {
          const p = parsePhone(l.number)
          return (
            <div key={`${l.number}_${i}`} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-none ${
                l.state === 'talking' ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
              <span className="text-[12.5px] text-gray-800 tabular-nums">
                {l.direction === 'in' ? '↓' : '↑'} {p.valid ? p.pretty : l.number}
              </span>
              {l.leadId && (
                <Link to={`/sales/leads/${l.leadId}`}
                  className="text-[11.5px] text-blue-600 hover:underline max-w-[180px] truncate">
                  {l.leadName || 'лид'}
                </Link>
              )}
              {l.ext && <span className="text-[11px] text-gray-400">внутр. {l.ext}</span>}
              <span className={`text-[11.5px] tabular-nums ${
                l.state === 'talking' ? 'text-emerald-700' : 'text-amber-600'}`}>
                {l.state === 'talking' ? `разговор · ${fmtSince(l.sinceSec + tick)}` : 'звонит…'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function SalesCallsPage() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<{ uuid: string; url: string } | null>(null)
  const [recBusy, setRecBusy] = useState<string | null>(null)
  const [recErr, setRecErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const load = useCallback((d: number) => {
    setLoading(true)
    apiGet<Stats>(`/sales/call?action=stats&days=${d}`, false)
      .then(s => setData(s))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(days) }, [days, load])

  // Ссылка на запись подписанная и живёт недолго — берётся на каждое прослушивание
  const listen = async (uuid: string) => {
    if (recBusy) return
    setRecBusy(uuid); setRecErr(null)
    try {
      const r = await apiPost<any>('/sales/call?action=record', { uuid })
      if (r?.url) setPlaying({ uuid, url: r.url })
      else setRecErr('Запись не нашлась')
    } catch (e: any) {
      setRecErr(e?.message || 'АТС не отдала запись')
    } finally { setRecBusy(null) }
  }

  const createLead = async (number: string) => {
    if (creating) return
    setCreating(true)
    try {
      const r = await apiPost<any>('/sales/call?action=lead', { number })
      if (r?.leadId) navigate(`/sales/leads/${r.leadId}`)
    } catch { /* номер кривой — карточку из него не собрать */ }
    finally { setCreating(false) }
  }

  const t = data?.totals
  const answeredRate = t && t.total ? Math.round((t.answered / t.total) * 100) : 0

  const header = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-[17px] font-bold text-gray-900">Звонки</h1>
        <div className="text-[11.5px] text-gray-400">
          телефония продаж: динамика, команда, записи разговоров
        </div>
      </div>
      <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
        {[[1, 'Сегодня'], [7, 'Неделя'], [30, 'Месяц']].map(([d, label]) => (
          <button key={d} onClick={() => setDays(Number(d))}
            className={`px-3 py-1.5 text-[12px] rounded-md ${
              days === d ? 'bg-blue-600 text-white font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  if (loading && !data) {
    return (
      <PageShell header={header}>
        <div className="text-sm text-gray-400 py-10 text-center">Считаю звонки…</div>
      </PageShell>
    )
  }

  return (
    <PageShell header={header}>
      <LiveLines />
      <Kpis items={[
        ['Всего звонков', String(t?.total ?? 0),
          `↓ ${t?.inbound ?? 0} входящих · ↑ ${t?.outbound ?? 0} исходящих`
          + (days > 1 && t?.total ? ` · в среднем ${(t.total / days).toFixed(1).replace('.0', '')} в день` : '')],
        ['Дозвон', `${answeredRate}%`, `${t?.answered ?? 0} разговоров состоялось`],
        ['Пропущено входящих', String(t?.missedIn ?? 0), 'клиент звонил — не ответили'],
        ['Недозвоны исходящие', String(t?.failedOut ?? 0), 'звонили — не дозвонились'],
        ['Время разговоров', fmtDur(t?.talkSec ?? 0), `в среднем ${fmtDur(t?.avgTalkSec ?? 0)} на разговор`],
      ]} />

      <div className="grid lg:grid-cols-2 gap-4">
        {days > 1 && (
          <Card title="Динамика по дням" sub="зелёное — разговоры, красное — без ответа">
            <Bars
              items={(data?.byDay || []).map(d => ({ ...d, key: d.day }))}
              labelEvery={days > 10 ? 5 : 1}
              labels={k => new Date(k + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
            />
          </Card>
        )}
        <Card title="По часам" sub="когда на самом деле звонят — время ташкентское">
          <Bars
            items={(data?.byHour || []).map(h => ({ ...h, key: String(h.h) }))}
            labelEvery={3}
            labels={k => `${k}:00`}
          />
        </Card>
        {days === 1 && (
          <Card title="Дневные действия команды" sub="входящие, исходящие и дозвон по каждому — сегодня">
            <AgentTable rows={data?.byAgent || []} dayAxis={[]} periodDays={1} />
          </Card>
        )}
      </div>

      {days > 1 && (
        <Card title="Дневные действия команды"
          sub="входящие, исходящие, дозвон и среднее в день — по добавочным и мобильным из профилей">
          <AgentTable rows={data?.byAgent || []}
            dayAxis={(data?.byDay || []).map(d => d.day)} periodDays={days} />
        </Card>
      )}

      <Card title="Лента звонков" sub="последние звонки периода — с карточками и записями"
        right={recErr ? <span className="text-[11.5px] text-red-600">{recErr}</span> : undefined}>
        {!(data?.calls || []).length ? (
          <Empty title="Звонков за период нет" hint="они появятся здесь через несколько минут после разговора" />
        ) : (
          <div className="divide-y divide-gray-50">
            {(data?.calls || []).map((c, i) => {
              const p = parsePhone(c.number)
              return (
                <div key={c.uuid || i} className="px-4 py-2.5">
                  {/* wrap обязателен: раскрытая панель разбора занимает всю
                      ширину и без переноса сжимала номер в столбик */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`flex-none w-7 h-7 rounded-full flex items-center justify-center ${
                      c.answered ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {c.direction === 'in'
                        ? <PhoneIncoming className="w-3.5 h-3.5" />
                        : <PhoneOutgoing className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-gray-800 tabular-nums">
                          {p.valid ? p.pretty : c.number || 'номер скрыт'}
                        </span>
                        <span className={`text-[11.5px] ${c.answered ? 'text-emerald-600' : 'text-red-500'}`}>
                          {c.answered
                            ? `${c.talkSec} сек`
                            : c.direction === 'in' ? 'пропущен' : 'недозвон'}
                        </span>
                        {c.who && <span className="text-[11.5px] text-gray-400">· {c.who}</span>}
                      </div>
                      <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap">
                        <span>{fmtAt(c.at)}</span>
                        {c.leadId && (
                          <Link to={`/sales/leads/${c.leadId}`} className="text-blue-600 hover:underline truncate max-w-[220px]">
                            {c.leadName || 'лид'}
                          </Link>
                        )}
                        {c.dealId && (
                          <Link to={`/sales/deals/${c.dealId}`} className="text-violet-600 hover:underline truncate max-w-[220px]">
                            {c.dealTitle || 'сделка'}
                          </Link>
                        )}
                        {!c.leadId && c.number.replace(/\D/g, '').length >= 7 && (
                          <button onClick={() => createLead(c.number)} disabled={creating}
                            className="text-emerald-700 hover:underline disabled:opacity-40">
                            + создать лида
                          </button>
                        )}
                      </div>
                    </div>
                    {c.uuid && (
                      <button onClick={() => listen(c.uuid!)} disabled={recBusy === c.uuid}
                        title="Прослушать запись"
                        className="flex-none flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200
                                   text-[11.5px] text-gray-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40">
                        <Play className="w-3 h-3" />
                        {recBusy === c.uuid ? '…' : 'запись'}
                      </button>
                    )}
                    {c.answered && c.uuid && <CallInsight uuid={c.uuid} />}
                  </div>
                  {playing?.uuid === c.uuid && (
                    <audio controls autoPlay src={playing.url} className="mt-2 w-full h-9" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </PageShell>
  )
}

/**
 * Дневные действия команды: каждому сотруднику — входящие, исходящие, дозвон,
 * среднее в день и мини-график активности по дням периода. Отвечает на вопрос
 * РОПа «кто сколько реально работает руками» без выгрузок из АТС.
 */
function AgentTable({ rows, dayAxis, periodDays }: {
  rows: Array<{
    name: string; total: number; answered: number; talkSec: number
    inbound?: number; outbound?: number; days?: Record<string, number>
  }>
  dayAxis: string[]
  periodDays: number
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-5 text-[12px] text-gray-400">
        Пока некого показать: сотрудники распознаются по добавочному или телефону
        из профиля — заполните их в Настройках → Телефония.
      </div>
    )
  }
  const maxDaily = Math.max(1, ...rows.flatMap(r => Object.values(r.days || {})))
  const avg = (r: { total: number }) =>
    periodDays > 1 ? (r.total / periodDays).toFixed(1).replace('.0', '') : String(r.total)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
            <th className="text-left font-medium px-4 py-2">Сотрудник</th>
            {periodDays > 1 && <th className="text-left font-medium px-2 py-2">По дням</th>}
            <th className="text-right font-medium px-2 py-2">↓ Вх</th>
            <th className="text-right font-medium px-2 py-2">↑ Исх</th>
            <th className="text-right font-medium px-2 py-2">Всего</th>
            <th className="text-right font-medium px-2 py-2">Дозвон</th>
            <th className="text-right font-medium px-2 py-2">Ср/день</th>
            <th className="text-right font-medium px-4 py-2">Разговоры</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.name} className="hover:bg-gray-50/60">
              <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{r.name}</td>
              {periodDays > 1 && (
                <td className="px-2 py-2">
                  <div className="flex items-end gap-[2px] h-6">
                    {dayAxis.map(day => {
                      const n = r.days?.[day] || 0
                      return (
                        <div key={day} title={`${day}: ${n}`}
                          className={`w-[5px] rounded-sm ${n ? 'bg-blue-400' : 'bg-gray-100'}`}
                          style={{ height: n ? `${Math.max(15, (n / maxDaily) * 100)}%` : '3px' }} />
                      )
                    })}
                  </div>
                </td>
              )}
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.inbound ?? '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.outbound ?? '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900">{r.total}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                <span className="text-emerald-700">{r.answered}</span>
                <span className="text-gray-400"> · {r.total ? Math.round((r.answered / r.total) * 100) : 0}%</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{avg(r)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{fmtDur(r.talkSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
