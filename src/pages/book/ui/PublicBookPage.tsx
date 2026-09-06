import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Публичная бронь встречи — страница для клиента с сайта.
 *
 * Смысл в том, чтобы горячий человек не ждал ответа до утра: форма
 * «мы перезвоним» теряет тех, кто готов говорить сейчас. Здесь он сам
 * выбирает время и сразу получает подтверждение.
 *
 * Открывается по токену из настроек интеграции, авторизация не нужна.
 * Наружу не показываем ни имён менеджеров, ни их занятости — только время,
 * которое можно взять.
 */

interface Slot { startAt: string; hhmm: string }

const TZ = 5
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function tk(d: Date) {
  const t = new Date(d.getTime() + TZ * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), dow: t.getUTCDay() }
}
const isoDay = (d: Date) => {
  const p = tk(d)
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function PublicBookPage() {
  const { token = '' } = useParams()
  // Две недели вперёд: дальше человек всё равно не планирует, а список
  // превращается в ленту
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 86400_000)),
    [],
  )
  // Открываемся на первом рабочем дне: в воскресенье клиент видел пустой
  // список и должен был сам догадаться переключить день
  const [dayIdx, setDayIdx] = useState(() => {
    const i = days.findIndex(d => tk(d).dow !== 0)
    return i < 0 ? 0 : i
  })
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', comment: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ startAt: string; meetUrl: string | null } | null>(null)

  const load = useCallback(async (d: Date) => {
    setSlots(null)
    setSlot(null)
    setError('')
    try {
      const r = await fetch(
        `/api/support/public/book?token=${encodeURIComponent(token)}&date=${isoDay(d)}`,
      )
      if (!r.ok) throw new Error('unavailable')
      const j = await r.json()
      setSlots(j.slots || [])
    } catch {
      setSlots([])
      setError('Не удалось загрузить свободное время. Обновите страницу.')
    }
  }, [token])

  useEffect(() => { load(days[dayIdx]) }, [dayIdx, days, load])

  const submit = async () => {
    if (!slot) return
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Заполните имя и телефон')
      return
    }
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/support/public/book?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startAt: slot.startAt,
          landingUrl: document.referrer || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j?.error || 'Не удалось забронировать')
        // Время могли занять, пока человек заполнял форму
        if (r.status === 409) { setSlot(null); load(days[dayIdx]) }
        return
      }
      setDone({ startAt: j.startAt, meetUrl: j.meetUrl || null })
    } catch {
      setError('Не удалось забронировать. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const chosen = days[dayIdx]
  const p = tk(chosen)

  if (done) {
    const d = new Date(done.startAt)
    const dp = tk(d)
    const t = new Date(d.getTime() + TZ * 3600_000)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-50 grid place-items-center mx-auto mb-5 text-3xl">✓</div>
          <h1 className="text-[22px] font-bold text-slate-900 mb-2">Встреча забронирована</h1>
          <p className="text-[15px] text-slate-600 mb-1">
            {DOW[dp.dow]}, {dp.day} {MON[dp.m]} в {String(t.getUTCHours()).padStart(2, '0')}:
            {String(t.getUTCMinutes()).padStart(2, '0')}
          </p>
          <p className="text-[13px] text-slate-400 mb-6">время ташкентское</p>
          {done.meetUrl ? (
            <a href={done.meetUrl} target="_blank" rel="noopener noreferrer"
               className="inline-block px-5 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600">
              Ссылка на встречу
            </a>
          ) : (
            <p className="text-[13.5px] text-slate-500">Менеджер свяжется с вами и пришлёт ссылку.</p>
          )}
          <p className="mt-6 text-[12.5px] text-slate-400">
            Если планы изменятся — позвоните нам, перенесём.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight">Выберите удобное время</h1>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Встреча онлайн, около часа. Покажем платформу и ответим на вопросы.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-[13px] text-red-700">
              {error}
            </div>
          )}

          {/* день */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {days.map((d, i) => (
              <button key={isoDay(d)} onClick={() => setDayIdx(i)}
                className={`shrink-0 px-3.5 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${
                  i === dayIdx
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                }`}>
                {DOW[tk(d).dow]} {tk(d).day}
              </button>
            ))}
          </div>

          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">
            {p.day} {MON[p.m]} · Ташкент
          </p>

          {!slots && <p className="py-8 text-center text-[13.5px] text-slate-400">Загружаем…</p>}
          {slots && !slots.length && (
            <p className="py-8 text-center text-[13.5px] text-slate-400">
              В этот день свободного времени нет — выберите другой.
            </p>
          )}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {slots.map(s => (
                <button key={s.startAt} onClick={() => setSlot(s)}
                  className={`py-2.5 rounded-xl text-[14px] font-bold border transition-colors ${
                    slot?.startAt === s.startAt
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                  }`}>{s.hhmm}</button>
              ))}
            </div>
          )}

          {slot && (
            <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ваше имя" autoComplete="name"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-[14px] text-slate-800
                           focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Телефон" type="tel" autoComplete="tel"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-[14px] text-slate-800
                           focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Email — пришлём приглашение" type="email" autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-[14px] text-slate-800
                           focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              <textarea value={form.comment} rows={2}
                onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                placeholder="О чём хотите поговорить (необязательно)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-[14px] text-slate-800 resize-none
                           focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              <button onClick={submit} disabled={busy}
                className="w-full py-3.5 rounded-xl bg-blue-500 text-white font-semibold text-[15px]
                           hover:bg-blue-600 disabled:opacity-50">
                {busy ? 'Бронируем…' : `Забронировать на ${slot.hhmm}`}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[12px] text-slate-400 mt-5">
          Нажимая «Забронировать», вы соглашаетесь на обработку контактных данных
          для связи по этой заявке.
        </p>
      </div>
    </div>
  )
}

export default PublicBookPage
