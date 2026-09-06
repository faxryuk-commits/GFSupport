import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { useAuth } from '@/shared/hooks/useAuth'


/**
 * Встречи рядом с работой, а не на отдельной странице.
 *
 * Полоска в шапке показывает нагрузку недели, попап под ней разворачивает
 * подробности. Боковое окно уводило внимание к краю экрана и перекрывало
 * доску — календарь смотрят мельком, между делом, и он должен раскрываться
 * там же, где на него посмотрели. Отдельная страница здесь была лишней: воронка — рабочая
 * поверхность, и уходить с неё ради расписания значит терять контекст.
 *
 * Календарь общий на команду: занятое время занято для всех, а чужую встречу
 * можно взять на себя одним действием.
 */

interface Meeting {
  id: string
  startAt: string
  title: string
  status: string
  doneAt: string | null
  assigneeAgentId: string | null
  assigneeName: string | null
  accountName: string | null
  dealId: string | null
  leadId: string | null
  meetUrl: string | null
}
interface Data { meetings: Meeting[]; slotMinutes: number; workDays: number[]; googleConnected: boolean }
interface Slot { startAt: string; hhmm: string; free: boolean }

const TZ = 5
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function tk(d: Date) {
  const t = new Date(d.getTime() + TZ * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), dow: t.getUTCDay(), h: t.getUTCHours(), min: t.getUTCMinutes() }
}
const isoDay = (d: Date) => {
  const p = tk(d)
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
const hhmm = (d: Date) => {
  const p = tk(d)
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`
}
function weekStart(base: Date): Date {
  const p = tk(base)
  // Воскресенье не входит в рабочую неделю Пн–Сб: показываем наступающую,
  // а не только что закончившуюся — иначе в выходной панель полна прошлого
  const shift = p.dow === 0 ? -1 : p.dow - 1
  return new Date(Date.UTC(p.y, p.m, p.day - shift) - TZ * 3600_000)
}

/** Цвет закреплён за человеком, а не за позицией в списке: иначе доска
 *  перекрашивается каждый раз, когда кто-то выпал из выборки. */
const PALETTE = ['#3b82f6', '#7c3aed', '#059669', '#d97706', '#0891b2', '#db2777', '#65a30d']
function colorOf(id: string | null): string {
  if (!id) return '#94a3b8'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const initials = (n: string | null) =>
  (n || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()

export function MeetingsPanel({ compact = false }: { compact?: boolean } = {}) {
  const { agent } = useAuth()
  const [weekAnchor, setWeekAnchor] = useState(() => new Date())
  const [data, setData] = useState<Data | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  // В неделе Пн–Сб шесть дней: воскресный индекс 6 выходил за границы массива
  // и ронял страницу на обращении к days[6]
  const [dayIdx, setDayIdx] = useState(() => {
    const dow = tk(new Date()).dow
    return dow === 0 ? 0 : Math.min(5, dow - 1)
  })
  const [sel, setSel] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setMoving(null) }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setMoving(null) }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // перенос
  const [moving, setMoving] = useState<string | null>(null)
  const [moveDay, setMoveDay] = useState(0)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [moveSlot, setMoveSlot] = useState<Slot | null>(null)

  const start = useMemo(() => weekStart(weekAnchor), [weekAnchor])
  const days = useMemo(
    () => Array.from({ length: 6 }, (_, i) => new Date(start.getTime() + i * 86400_000)),
    [start],
  )

  const load = useCallback(async () => {
    try {
      // Кэш включён намеренно: панель живёт и на воронке, и в очереди дня,
      // а данные недели не меняются ежесекундно
      const r = await apiGet<Data>(
        `/sales/meetings?from=${isoDay(days[0])}&to=${isoDay(days[5])}`,
      )
      setData(r)
    } catch { setData(null) }
  }, [days])

  useEffect(() => { load() }, [load])

  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>()
    for (const x of data?.meetings || []) {
      if (x.status === 'cancelled') continue
      const k = isoDay(new Date(x.startAt))
      m.set(k, [...(m.get(k) || []), x])
    }
    return m
  }, [data])

  const openOn = (i: number) => { setDayIdx(i); setMode('day'); setOpen(true) }

  const loadSlots = useCallback(async (d: Date) => {
    setSlots(null)
    setMoveSlot(null)
    try {
      const r = await apiGet<{ slots: Slot[] }>(`/sales/meetings?action=slots&date=${isoDay(d)}`, false)
      setSlots(r.slots)
    } catch { setSlots([]) }
  }, [])

  const startMove = (m: Meeting) => {
    setMoving(m.id)
    setMoveDay(0)
    loadSlots(days[0])
  }

  const act = async (path: string, body: unknown) => {
    setBusy(true)
    setError('')
    try {
      await apiPost(`/sales/meetings?action=${path}`, body)
      setMoving(null)
      // Свой же кэш обходим: после действия нужен свежий ответ
      const fresh = await apiGet<Data>(
        `/sales/meetings?from=${isoDay(days[0])}&to=${isoDay(days[5])}`, false,
      )
      setData(fresh)
    } catch (e: any) {
      const msg = String(e?.message || '')
      setError(msg.includes('slot_taken') || msg.includes('409')
        ? 'Это время только что заняли — выберите другое'
        : msg || 'Не получилось')
    } finally { setBusy(false) }
  }

  const activeDay = days[Math.min(Math.max(dayIdx, 0), days.length - 1)]
  const dayList = (byDay.get(isoDay(activeDay)) || [])
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
  const weekList = (data?.meetings || [])
    .filter(m => m.status !== 'cancelled')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
  const list = mode === 'day' ? dayList : weekList

  const total = data?.meetings.filter(m => m.status !== 'cancelled').length || 0
  const todayKey = isoDay(new Date())

  const todayCount = (byDay.get(todayKey) || []).length
  const todayIdx = Math.max(0, days.findIndex(d => isoDay(d) === todayKey))

  return (
    <div ref={box} className="relative">
      {/* Компактно: одна кнопка с числом на сегодня. Шесть дней с точками
          в шапке отвечали на вопрос, который задают раз в день, а место
          занимали всегда; неделя целиком — в раскрытом окне */}
      {compact ? (
        <button
          onClick={() => (open ? setOpen(false) : openOn(todayIdx))}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border whitespace-nowrap ${
            open ? 'border-gray-900 bg-gray-900 text-white'
              : todayCount ? 'border-blue-300 text-blue-700 bg-blue-50 hover:border-blue-500'
                : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}
        >
          📅 Встречи · сегодня {todayCount}{total > todayCount ? ` · неделя ${total}` : ''}
        </button>
      ) : (
      <div className="flex items-stretch border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="flex items-center gap-1.5 px-2.5 border-r border-gray-200 bg-gray-50/70 text-[11px] font-bold text-gray-500 whitespace-nowrap">
          📅 Встречи
        </div>
        {days.map((d, i) => {
          const k = isoDay(d)
          const items = byDay.get(k) || []
          const isToday = k === todayKey
          const off = data?.workDays.length ? !data.workDays.includes(tk(d).dow) : false
          return (
            <button
              key={k}
              onClick={() => openOn(i)}
              title={items.length ? `${items.length} встреч` : 'встреч нет'}
              className={`w-[38px] py-1 text-center border-r border-gray-100 last:border-r-0 transition-colors ${
                isToday ? 'bg-blue-50' : off ? 'bg-gray-50/70' : 'hover:bg-gray-50'
              }`}
            >
              <div className={`text-[9px] font-extrabold uppercase tracking-wide ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>
                {DOW[tk(d).dow]}
              </div>
              <div className={`text-[12px] font-extrabold leading-tight ${
                isToday ? 'text-blue-600' : off ? 'text-gray-400' : 'text-gray-900'
              }`}>{tk(d).day}</div>
              <div className="flex gap-[2px] justify-center mt-[3px] h-[5px]">
                {items.slice(0, 4).map(m => (
                  <i key={m.id} className="w-[4px] h-[4px] rounded-full"
                     style={{ background: colorOf(m.assigneeAgentId) }} />
                ))}
              </div>
            </button>
          )
        })}
        <button
          onClick={() => { setMode('week'); setOpen(true) }}
          className="flex items-center px-2.5 border-l border-gray-200 bg-gray-50/70 text-[11px] font-bold text-blue-600 whitespace-nowrap hover:bg-blue-50"
        >развернуть →</button>
      </div>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-[min(560px,calc(100vw-3rem))]
                        max-h-[70vh] overflow-hidden flex flex-col
                        bg-white border border-gray-200 rounded-xl shadow-xl">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-none">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {(['day', 'week'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-2.5 py-1 text-[11px] font-bold border-r border-gray-200 last:border-r-0 ${
                  mode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-500'
                }`}>{m === 'day' ? 'День' : 'Неделя'}</button>
            ))}
          </div>
          {mode === 'day' && (
            <div className="flex gap-1 overflow-x-auto">
              {days.map((d, i) => (
                <button key={isoDay(d)} onClick={() => setDayIdx(i)}
                  className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-bold border ${
                    i === dayIdx ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
                  }`}>{DOW[tk(d).dow]} {tk(d).day}</button>
              ))}
            </div>
          )}
          <div className="flex-1" />
          <button onClick={() => setWeekAnchor(new Date(start.getTime() - 7 * 86400_000))}
            className="px-2 py-1 text-[11px] font-bold border border-gray-200 rounded-md text-gray-500">←</button>
          <button onClick={() => setWeekAnchor(new Date(start.getTime() + 7 * 86400_000))}
            className="px-2 py-1 text-[11px] font-bold border border-gray-200 rounded-md text-gray-500">→</button>
        </div>

        <div className="px-4 py-3 space-y-2 overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">{error}</div>
          )}
          {data && !data.googleConnected && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800">
              Google-календарь не подключён — встречи живут только в CRM, без ссылок Meet.
            </div>
          )}

          {!list.length && (
            <p className="py-8 text-center text-[12.5px] text-gray-400">
              {mode === 'day' ? 'В этот день встреч нет' : 'На этой неделе встреч нет'}
            </p>
          )}

          {list.map(m => {
            const s = new Date(m.startAt)
            const mine = agent?.id && m.assigneeAgentId === agent.id
            const isSel = sel === m.id
            return (
              <div key={m.id}
                   className={`border rounded-xl overflow-hidden ${isSel ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
                <button onClick={() => setSel(isSel ? null : m.id)} className="w-full flex gap-2.5 px-3 py-2 text-left">
                  <div className="text-[12.5px] font-extrabold whitespace-nowrap pt-0.5">
                    {hhmm(s)}
                    {mode === 'week' && (
                      <span className="block text-[9.5px] font-bold text-gray-400">
                        {DOW[tk(s).dow]} {tk(s).day} {MON[tk(s).m]}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-extrabold truncate">{m.accountName || m.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-[17px] h-[17px] rounded-full grid place-items-center text-[8.5px] font-extrabold text-white"
                            style={{ background: colorOf(m.assigneeAgentId) }}>
                        {initials(m.assigneeName)}
                      </span>
                      <span className="text-[10.5px] font-bold text-gray-500 truncate">
                        {m.assigneeName || 'без исполнителя'}{mine ? ' · вы' : ''}
                      </span>
                      {m.doneAt && <span className="text-[9px] font-extrabold text-emerald-600">прошла</span>}
                    </div>
                  </div>
                </button>

                {isSel && (
                  <>
                    <div className="flex gap-1.5 flex-wrap px-3 py-2 border-t border-gray-100 bg-gray-50/60">
                      {!mine && !m.doneAt && (
                        <button disabled={busy} onClick={() => act('reassign', { id: m.id, assigneeAgentId: agent?.id })}
                          className="px-2.5 py-1 text-[11px] font-extrabold rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                          Провести вместо коллеги
                        </button>
                      )}
                      {!m.doneAt && (
                        <button onClick={() => (moving === m.id ? setMoving(null) : startMove(m))}
                          className="px-2.5 py-1 text-[11px] font-extrabold rounded-md border border-gray-200 bg-white text-gray-600">
                          Перенести
                        </button>
                      )}
                      {m.meetUrl && (
                        <a href={m.meetUrl} target="_blank" rel="noopener noreferrer"
                           className="px-2.5 py-1 text-[11px] font-extrabold rounded-md border border-gray-200 bg-white text-gray-600">
                          Открыть Meet
                        </a>
                      )}
                      {(m.dealId || m.leadId) && (
                        <Link to={m.dealId ? `/sales/deals/${m.dealId}` : `/sales/leads/${m.leadId}`}
                              className="px-2.5 py-1 text-[11px] font-extrabold rounded-md border border-gray-200 bg-white text-gray-600">
                          {m.dealId ? 'В сделку' : 'К лиду'}
                        </Link>
                      )}
                      {!m.doneAt && (
                        <button disabled={busy} onClick={() => act('cancel', { id: m.id })}
                          className="px-2.5 py-1 text-[11px] font-extrabold rounded-md border border-red-200 bg-white text-red-600 disabled:opacity-50">
                          Отменить
                        </button>
                      )}
                    </div>

                    {moving === m.id && (
                      <div className="px-3 py-2.5 border-t border-gray-100 bg-blue-50/60">
                        <div className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wide mb-1.5">
                          Перенести на
                        </div>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {days.map((d, i) => (
                            <button key={isoDay(d)}
                              onClick={() => { setMoveDay(i); loadSlots(d) }}
                              className={`px-2 py-0.5 rounded-md text-[10.5px] font-extrabold border ${
                                i === moveDay ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-blue-200'
                              }`}>{DOW[tk(d).dow]} {tk(d).day}</button>
                          ))}
                        </div>
                        {!slots && <div className="text-[11.5px] text-gray-400 py-2">Смотрим свободное время…</div>}
                        {slots && !slots.length && <div className="text-[11.5px] text-gray-400 py-2">Свободного времени нет</div>}
                        {slots && slots.length > 0 && (
                          <div className="grid grid-cols-6 gap-1.5">
                            {slots.map(s => (
                              <button key={s.startAt} disabled={!s.free} onClick={() => setMoveSlot(s)}
                                className={`py-1 rounded-md text-[10.5px] font-extrabold border ${
                                  moveSlot?.startAt === s.startAt
                                    ? 'bg-blue-500 text-white border-blue-500'
                                    : s.free
                                      ? 'bg-white text-gray-600 border-blue-200'
                                      : 'bg-gray-100 text-gray-300 border-gray-200 line-through cursor-not-allowed'
                                }`}>{s.hhmm}</button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2.5">
                          <span className="text-[10.5px] text-gray-500 font-semibold flex-1">
                            Сдвинет событие в Google — клиенту уйдёт обновление приглашения.
                          </span>
                          <button
                            disabled={!moveSlot || busy}
                            onClick={() => act('reschedule', { id: m.id, startAt: moveSlot?.startAt })}
                            className="px-2.5 py-1 text-[11px] font-extrabold rounded-md bg-blue-500 text-white disabled:opacity-40">
                            {moveSlot ? `Перенести на ${moveSlot.hhmm}` : 'Выберите время'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {mode === 'week' && total > 0 && (
            <p className="text-[11px] text-gray-400 text-center pt-1">Всего за неделю: {total}</p>
          )}
        </div>
        </div>
      )}
    </div>
  )
}
