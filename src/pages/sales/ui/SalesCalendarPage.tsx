import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { PageShell, Empty, Skeleton, Modal } from './kit'

/**
 * Полотно встреч команды.
 *
 * Календарь один на всех намеренно. Встречу назначает CRM на конкретного
 * менеджера, но видят её все: если человек не успевает, коллега подхватывает
 * встречу за один клик — а для этого чужое расписание должно лежать рядом
 * с собственным, а не за фильтром «только мои».
 */

interface Meeting {
  id: string
  startAt: string
  title: string
  status: string
  doneAt: string | null
  doneResult: string | null
  assigneeAgentId: string | null
  assigneeName: string | null
  accountName: string | null
  dealId: string | null
  leadId: string | null
  dealStage: string | null
  meetUrl: string | null
}

interface Data {
  from: string
  to: string
  slotMinutes: number
  workDays: number[]
  workFrom: number
  workTo: number
  googleConnected: boolean
  meetings: Meeting[]
}

const TZ = 5 // Ташкент, UTC+5 без перехода на летнее время
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Ташкентские «стенные» части времени. */
function tk(d: Date) {
  const t = new Date(d.getTime() + TZ * 3600_000)
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(),
    dow: t.getUTCDay(), h: t.getUTCHours(), min: t.getUTCMinutes(),
  }
}
const iso = (d: Date) => {
  const p = tk(d)
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
const hhmm = (d: Date) => {
  const p = tk(d)
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`
}

/** Понедельник недели, в которую попадает дата (по ташкентскому времени). */
function weekStart(base: Date): Date {
  const p = tk(base)
  const shift = (p.dow + 6) % 7
  return new Date(Date.UTC(p.y, p.m, p.day - shift) - TZ * 3600_000)
}

/**
 * Цвет менеджера. Держим детерминированным от id: список людей меняется,
 * а цвет за человеком должен оставаться — иначе календарь «перекрашивается»
 * каждый раз, когда кто-то ушёл в отпуск.
 */
const PALETTE = ['#3b82f6', '#7c3aed', '#059669', '#d97706', '#0891b2', '#db2777', '#65a30d']
function colorOf(id: string | null): string {
  if (!id) return '#94a3b8'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const initials = (name: string | null) =>
  (name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()

export function SalesCalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date())
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)

  const start = useMemo(() => weekStart(anchor), [anchor])
  const days = useMemo(
    () => Array.from({ length: 6 }, (_, i) => new Date(start.getTime() + i * 86400_000)),
    [start],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const from = iso(days[0])
      const to = iso(days[days.length - 1])
      const r = await apiGet<Data>(`/sales/meetings?from=${from}&to=${to}`, false)
      setData(r)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить встречи')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiGet<{ id: string; name: string }>('/me', false).then(setMe).catch(() => setMe(null))
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of data?.meetings || []) {
      const k = iso(new Date(m.startAt))
      const arr = map.get(k) || []
      arr.push(m)
      map.set(k, arr)
    }
    return map
  }, [data])

  const people = useMemo(() => {
    const map = new Map<string, { name: string; n: number }>()
    for (const m of data?.meetings || []) {
      if (!m.assigneeAgentId) continue
      const cur = map.get(m.assigneeAgentId) || { name: m.assigneeName || '—', n: 0 }
      cur.n++
      map.set(m.assigneeAgentId, cur)
    }
    return [...map.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [data])

  const takeOver = async (m: Meeting) => {
    if (!me?.id) return
    setBusy(true)
    try {
      await apiPost('/sales/meetings?action=reassign', { id: m.id, assigneeAgentId: me.id })
      setPicked(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось перевести встречу на себя')
    } finally { setBusy(false) }
  }

  const cancel = async (m: Meeting) => {
    setBusy(true)
    try {
      await apiPost('/sales/meetings?action=cancel', { id: m.id })
      setPicked(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось отменить встречу')
    } finally { setBusy(false) }
  }

  const from = data?.workFrom ?? 10
  const to = data?.workTo ?? 19
  const SLOT_PX = 34
  const hours = Array.from({ length: to - from }, (_, i) => from + i)
  const todayKey = iso(new Date())

  const header = (
    <div className="flex items-center gap-3 flex-wrap">
      <div>
        <h1 className="text-[15px] font-bold text-gray-900 leading-tight">
          Встречи · {tk(days[0]).day} {MON[tk(days[0]).m]} — {tk(days[5]).day} {MON[tk(days[5]).m]}
        </h1>
        <div className="text-[11.5px] text-gray-400 font-medium mt-0.5">
          {data ? `${data.meetings.length} встреч · календарь общий` : 'загружаем…'}
          {data && !data.googleConnected && ' · Google не подключён'}
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex gap-1.5">
        <button
          onClick={() => setAnchor(new Date(start.getTime() - 7 * 86400_000))}
          className="px-2.5 py-1.5 text-[12px] font-semibold border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600"
        >←</button>
        <button
          onClick={() => setAnchor(new Date())}
          className="px-3 py-1.5 text-[12px] font-semibold border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600"
        >Сегодня</button>
        <button
          onClick={() => setAnchor(new Date(start.getTime() + 7 * 86400_000))}
          className="px-2.5 py-1.5 text-[12px] font-semibold border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600"
        >→</button>
      </div>
    </div>
  )

  return (
    <PageShell header={header} fill>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-700 flex-none">
          {error}
        </div>
      )}

      {people.length > 0 && (
        <div className="flex gap-1.5 items-center flex-wrap flex-none">
          <span className="text-[11px] font-bold text-gray-400 mr-0.5">Кто проводит:</span>
          {people.map(([id, p]) => (
            <span key={id} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-full pl-1 pr-2.5 py-0.5 bg-white">
              <span
                className="w-[18px] h-[18px] rounded-full grid place-items-center text-[9px] font-bold text-white"
                style={{ background: colorOf(id) }}
              >{initials(p.name)}</span>
              <span className="text-[11.5px] font-semibold text-gray-700">{p.name} · {p.n}</span>
            </span>
          ))}
        </div>
      )}

      {loading && !data && <Skeleton />}

      {data && !data.meetings.length && !loading && (
        <Empty
          title="На этой неделе встреч нет"
          hint="Встреча назначается из карточки сделки или лида — оттуда она попадёт сюда и в общий календарь."
        />
      )}

      {data && (
        <div className="flex-1 min-h-0 bg-white border border-gray-200 rounded-xl overflow-auto">
          <div className="grid" style={{ gridTemplateColumns: `52px repeat(6, minmax(132px, 1fr))` }}>
            {/* шапка */}
            <div className="sticky top-0 z-20 bg-gray-50/95 border-b border-gray-200 border-r border-gray-100" />
            {days.map(d => {
              const k = iso(d)
              const isToday = k === todayKey
              const off = data.workDays.length && !data.workDays.includes(tk(d).dow)
              return (
                <div
                  key={k}
                  className={`sticky top-0 z-20 border-b border-gray-200 border-r border-gray-100 px-2 py-2 text-center ${
                    off ? 'bg-gray-100/80' : 'bg-gray-50/95'
                  }`}
                >
                  <div className={`text-[10.5px] font-bold uppercase tracking-wide ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>
                    {DOW[tk(d).dow]}
                  </div>
                  <div className={`text-[15px] font-extrabold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                    {tk(d).day}
                  </div>
                </div>
              )
            })}

            {/* колонка часов */}
            <div className="border-r border-gray-200">
              {hours.map(h => (
                <div key={h} className="text-[10px] font-bold text-gray-400 text-right pr-1.5 -translate-y-1.5"
                     style={{ height: SLOT_PX }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* дни */}
            {days.map(d => {
              const k = iso(d)
              const off = data.workDays.length && !data.workDays.includes(tk(d).dow)
              const list = byDay.get(k) || []
              return (
                <div key={k} className={`relative border-r border-gray-100 ${off ? 'bg-gray-50/60' : ''}`}>
                  {hours.map(h => (
                    <div key={h} className="border-b border-gray-100" style={{ height: SLOT_PX }} />
                  ))}
                  {list.map(m => {
                    const s = new Date(m.startAt)
                    const p = tk(s)
                    const top = ((p.h - from) * 60 + p.min) / 60 * SLOT_PX
                    if (top < 0) return null
                    const height = Math.max(46, (data.slotMinutes / 60) * SLOT_PX)
                    const cancelled = m.status === 'cancelled'
                    const done = Boolean(m.doneAt)
                    const color = colorOf(m.assigneeAgentId)
                    return (
                      <button
                        key={m.id}
                        onClick={() => setPicked(m)}
                        title={`${m.accountName || m.title} · ${m.assigneeName || 'без исполнителя'}`}
                        className={`absolute left-[3px] right-[3px] rounded-lg border border-gray-200 bg-white px-1.5 py-1
                                    text-left overflow-hidden shadow-sm hover:shadow transition-shadow ${
                          cancelled ? 'opacity-45 line-through' : ''
                        }`}
                        style={{ top, height, borderLeft: `3px solid ${color}` }}
                      >
                        <div className="text-[10px] font-bold text-gray-400">{hhmm(s)}</div>
                        <div className="text-[11.5px] font-bold text-gray-900 truncate leading-tight">
                          {m.accountName || m.title}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span
                            className="w-[15px] h-[15px] rounded-full grid place-items-center text-[8px] font-bold text-white flex-none"
                            style={{ background: color }}
                          >{initials(m.assigneeName)}</span>
                          {done && <span className="text-[9px] font-bold text-emerald-600">прошла</span>}
                          {!m.assigneeAgentId && <span className="text-[9px] font-bold text-red-600">без исполнителя</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {picked && (
        <Modal
          title={picked.accountName || picked.title}
          sub={`${DOW[tk(new Date(picked.startAt)).dow]}, ${tk(new Date(picked.startAt)).day} ${MON[tk(new Date(picked.startAt)).m]} · ${hhmm(new Date(picked.startAt))}`}
          onClose={() => setPicked(null)}
          footer={
            <div className="flex gap-2 justify-end">
              {picked.status !== 'cancelled' && !picked.doneAt && (
                <button
                  onClick={() => cancel(picked)}
                  disabled={busy}
                  className="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >Отменить встречу</button>
              )}
              {me && picked.assigneeAgentId !== me.id && picked.status !== 'cancelled' && (
                <button
                  onClick={() => takeOver(picked)}
                  disabled={busy}
                  className="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                >Провести вместо коллеги</button>
              )}
            </div>
          }
        >
          <div className="space-y-2 text-[12.5px] text-gray-700">
            <div>
              <span className="text-gray-400">Проводит: </span>
              <b className="font-semibold">{picked.assigneeName || 'не назначен'}</b>
            </div>
            {picked.dealStage && (
              <div><span className="text-gray-400">Стадия сделки: </span>{picked.dealStage}</div>
            )}
            {picked.doneResult && (
              <div><span className="text-gray-400">Итог: </span>{picked.doneResult}</div>
            )}
            <div className="flex gap-3 pt-1">
              {picked.meetUrl && (
                <a href={picked.meetUrl} target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 font-semibold hover:underline">Открыть Meet</a>
              )}
              {picked.dealId && (
                <Link to={`/sales/deals/${picked.dealId}`} className="text-blue-600 font-semibold hover:underline">
                  Перейти в сделку
                </Link>
              )}
              {!picked.dealId && picked.leadId && (
                <Link to={`/sales/leads/${picked.leadId}`} className="text-blue-600 font-semibold hover:underline">
                  Перейти к лиду
                </Link>
              )}
            </div>
            {!picked.meetUrl && (
              <p className="text-[11.5px] text-gray-400 pt-1">
                Ссылки Meet нет — встреча создавалась, когда календарь был недоступен.
              </p>
            )}
          </div>
        </Modal>
      )}
    </PageShell>
  )
}

export default SalesCalendarPage
