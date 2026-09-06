import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from './kit'

/**
 * Назначение встречи из карточки сделки или лида.
 *
 * Свободное время считается по календарю того, кто будет проводить встречу:
 * у каждого своё расписание, и занятость одного не должна закрывать время
 * остальным. Смена исполнителя перезапрашивает слоты — иначе показали бы
 * чужую занятость как свою.
 */

interface Slot { startAt: string; hhmm: string; free: boolean; busyCount?: number }
interface SlotsData { date: string; slots: Slot[]; slotMinutes: number; reason?: string; googleReady?: boolean }

interface Props {
  dealId?: string | null
  leadId?: string | null
  /** Кого зовём: подставляем контакт сделки, чтобы не искать почту руками. */
  guestName?: string | null
  guestEmail?: string | null
  /** Команда для выбора исполнителя. Пусто — встречу берёт тот, кто назначает. */
  team?: Array<{ id: string; name: string }>
  defaultAssigneeId?: string | null
  defaultAssigneeName?: string | null
  onClose: () => void
  onDone?: () => void
}

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const TZ = 5

function tk(d: Date) {
  const t = new Date(d.getTime() + TZ * 3600_000)
  return { m: t.getUTCMonth(), day: t.getUTCDate(), dow: t.getUTCDay(), y: t.getUTCFullYear() }
}
const isoDay = (d: Date) => {
  const p = tk(d)
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const KINDS = ['Демо продукта', 'Первичная встреча', 'Повторная встреча', 'Техническая', 'Онбординг']

export function BookMeetingModal({
  dealId, leadId, guestName, guestEmail, team = [],
  defaultAssigneeId, defaultAssigneeName, onClose, onDone,
}: Props) {
  // Две недели вперёд: дальше клиент всё равно не помнит, а список
  // превращается в ленту
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 86400_000)),
    [],
  )
  const [dayIdx, setDayIdx] = useState(0)
  const [data, setData] = useState<SlotsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [kind, setKind] = useState(KINDS[0])
  const [duration, setDuration] = useState<number | null>(null)
  const [assignee, setAssignee] = useState(defaultAssigneeId || '')
  const [email, setEmail] = useState(guestEmail || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadSlots = useCallback(async (d: Date, who: string) => {
    setLoading(true)
    setError('')
    setSlot(null)
    try {
      const q = who ? `&assignee=${encodeURIComponent(who)}` : ''
      const r = await apiGet<SlotsData>(`/sales/meetings?action=slots&date=${isoDay(d)}${q}`, false)
      setData(r)
      if (duration === null) setDuration(r.slotMinutes)
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить свободное время')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [duration])

  // Перезапрашиваем и при смене дня, и при смене исполнителя: расписание
  // персональное, у другого менеджера свободно другое время
  useEffect(() => { loadSlots(days[dayIdx], assignee) }, [dayIdx, days, assignee, loadSlots])

  const submit = async () => {
    if (!slot) { setError('Выберите время'); return }
    setBusy(true)
    setError('')
    try {
      await apiPost('/sales/meetings?action=create', {
        dealId: dealId || undefined,
        leadId: leadId || undefined,
        startAt: slot.startAt,
        durationMin: duration || undefined,
        title: kind,
        assigneeAgentId: assignee || undefined,
        guestName: guestName || undefined,
        guestEmail: email || undefined,
      })
      onDone?.()
      onClose()
    } catch (e: any) {
      const msg = String(e?.message || '')
      // Занять время мог сам менеджер из другого места — расписание живое
      setError(msg.includes('slot_taken') || msg.includes('409')
        ? 'Это время только что заняли — выберите другое'
        : msg || 'Не удалось назначить встречу')
      loadSlots(days[dayIdx], assignee)
    } finally {
      setBusy(false)
    }
  }

  const chosen = days[dayIdx]
  const assigneeName = assignee
    ? (team.find(t => t.id === assignee)?.name || defaultAssigneeName || '')
    : (defaultAssigneeName || 'вы')

  return (
    <Modal
      title="Назначить встречу"
      sub={`${DOW[tk(chosen).dow]}, ${tk(chosen).day} ${MON[tk(chosen).m]} · Ташкент`}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <span className="text-[11.5px] text-gray-400 flex-1 leading-snug">
            Создаст событие в календаре{assigneeName ? ` ${assigneeName}` : ''} со ссылкой Meet
            и поставит задачу.
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
          >Отмена</button>
          <button
            onClick={submit}
            disabled={busy || !slot}
            className="px-3.5 py-1.5 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40"
          >{busy ? 'Назначаем…' : 'Назначить'}</button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
        )}

        {/* дни */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {days.map((d, i) => (
            <button
              key={isoDay(d)}
              onClick={() => setDayIdx(i)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                i === dayIdx
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
              }`}
            >
              {DOW[tk(d).dow]} {tk(d).day}
            </button>
          ))}
        </div>

        {/* время */}
        <div>
          <div className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-2">Время</div>
          {loading && <div className="py-6 text-center text-[12.5px] text-gray-400">Смотрим свободное время…</div>}
          {!loading && data && !data.slots.length && (
            <div className="py-6 text-center text-[12.5px] text-gray-400">
              {data.reason === 'выходной' ? 'В этот день не работаем' : 'Свободного времени нет'}
            </div>
          )}
          {!loading && data && data.slots.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
              {data.slots.map(s => (
                <button
                  key={s.startAt}
                  disabled={!s.free}
                  onClick={() => setSlot(s)}
                  title={s.busyCount ? `в это время у команды встреч: ${s.busyCount}` : undefined}
                  className={`py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${
                    slot?.startAt === s.startAt
                      ? 'bg-blue-500 text-white border-blue-500'
                      : s.free
                        ? 'bg-white text-gray-700 border-gray-200 hover:border-blue-400'
                        : 'bg-gray-50 text-gray-300 border-gray-100 line-through cursor-not-allowed'
                  }`}
                >{s.hhmm}</button>
              ))}
            </div>
          )}
        </div>

        {/* тип и длительность */}
        <div className="flex gap-2">
          <label className="flex-1">
            <div className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1">Тип</div>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-gray-700"
            >
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="w-[120px]">
            <div className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1">Длительность</div>
            <select
              value={duration ?? 60}
              onChange={e => setDuration(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-gray-700"
            >
              {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} мин</option>)}
            </select>
          </label>
        </div>

        {/* исполнитель */}
        {team.length > 0 && (
          <label className="block">
            <div className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1">Кто проводит</div>
            <select
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-gray-700"
            >
              <option value="">{defaultAssigneeName || 'Я'}</option>
              {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}

        {/* гость */}
        <label className="block">
          <div className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wide mb-1">
            Почта клиента {guestName ? `· ${guestName}` : ''}
          </div>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            type="email"
            placeholder="чтобы Google прислал приглашение"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12.5px] text-gray-700"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Без почты встреча создастся, но клиент не получит приглашение и ссылку.
          </p>
          {data && data.googleReady === false && (
            <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              У этого менеджера календарь не подключён — встреча появится в CRM,
              но без события в Google и без ссылки Meet.
            </p>
          )}
        </label>
      </div>
    </Modal>
  )
}
