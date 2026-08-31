import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Phone, X } from 'lucide-react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { parsePhone } from '@/shared/lib/phone'

/**
 * Звонилка: набрать произвольный номер, не заходя ни в какую карточку.
 *
 * Кнопки на карточках закрывают звонки по базе, но половина работы сейлза —
 * номера со стороны: с визитки, из мессенджера, из таблицы партнёра. Плавающая
 * трубка в углу открывает поле набора; звонок идёт той же дорогой через АТС
 * (она набирает сотрудника, потом номер) и через пять минут ложится касанием —
 * а незнакомый входящий номер синк сам превратит в лида.
 */
export function Dialer() {
  const [open, setOpen] = useState(false)
  const [num, setNum] = useState('')
  const [status, setStatus] = useState<'idle' | 'calling' | 'ok' | 'error'>('idle')
  const [note, setNote] = useState('')
  const [recent, setRecent] = useState<Array<{
    number: string; title: string; at: string; leadId: string | null; leadName: string | null
  }>>([])
  // Чей номер набрали: известный лид → ссылка на карточку, незнакомый →
  // кнопка «создать лида». Звонок новому клиенту не должен повисать без карточки
  const [lead, setLead] = useState<{ id: string; name: string } | null>(null)
  const [noLead, setNoLead] = useState(false)
  const [creating, setCreating] = useState(false)
  // С какого номера уйдёт исходящий: личный добавочный сейлза или общий.
  // Видно до набора — понятно, какая трубка сейчас зазвонит
  const [ext, setExt] = useState('')
  // Личный номер или общий запасной: с общего говорит другой человек,
  // и это надо называть прямо, а не маскировать под «ваш» номер
  const [extPersonal, setExtPersonal] = useState(true)
  // Поиск по базе: имя или кусок номера превращаются в подсказки из лидов
  // и контактов — не нужно помнить, в каком списке живёт человек
  const [found, setFound] = useState<Array<{
    kind: string; id: string; name: string; phone: string; sub: string | null
  }>>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Живые входящие из вебхука АТС: звонок всплывает ещё до снятой трубки
  const [incoming, setIncoming] = useState<Array<{
    number: string; leadId: string | null; leadName: string | null; staff?: string | null
  }>>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 50)
    // История подгружается на открытие: закрытая звонилка не тратит запросов
    apiGet<any>('/sales/call', false)
      .then(d => {
        setRecent(d?.calls || [])
        setExt(String(d?.ext || ''))
        setExtPersonal(d?.extPersonal !== false)
      })
      .catch(() => {})
  }, [open])

  // Опрос живых событий АТС: раз в 12 секунд, всегда — входящий должен
  // всплыть, даже когда звонилка закрыта
  useEffect(() => {
    let stop = false
    const tick = () => {
      apiGet<any>('/sales/call?action=live', false)
        .then(d => { if (!stop) setIncoming(d?.calls || []) })
        .catch(() => {})
    }
    tick()
    const t = setInterval(tick, 12000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const search = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const clean = q.trim()
    const hasLetters = /[^\d\s+()-]/.test(clean)
    const digitsN = clean.replace(/\D/g, '').length
    if (clean.length < 2 || (!hasLetters && digitsN < 4) || (!hasLetters && digitsN >= 12)) {
      setFound([]); return
    }
    searchTimer.current = setTimeout(() => {
      apiGet<any>(`/sales/call?action=search&q=${encodeURIComponent(clean)}`, false)
        .then(d => setFound(d?.results || []))
        .catch(() => setFound([]))
    }, 300)
  }

  const parsed = parsePhone(num)
  const digits = num.replace(/\D/g, '')

  // Добавочный «101» и мобильный «+998…» читаются по-разному
  const extLabel = (e: string) => {
    if (/^\d{2,4}$/.test(e)) return `внутр. ${e}`
    const p = parsePhone(e)
    return p.valid ? p.pretty : e
  }

  // АТС принимает заявку мгновенно, а исход известен позже: занято, не
  // ответили, линия не в строю. Поэтому после «звонит вам» опрашиваем судьбу
  // вызова и показываем правду — вечное оптимистичное сообщение хуже ошибки
  const watchOutcome = (uuid: string) => {
    const delays = [12000, 25000, 45000]
    delays.forEach(d => setTimeout(async () => {
      try {
        const st = await apiPost<any>('/sales/call?action=status', { uuid })
        if (!st?.done) return
        setStatus(st.ok ? 'ok' : 'error')
        setNote(st.ok ? `✓ ${st.human}` : `Звонок не прошёл: ${st.human}`)
      } catch { /* исход неизвестен — молчим */ }
    }, d))
  }

  const call = async () => {
    if (digits.length < 7 || status === 'calling') return
    setStatus('calling'); setNote('')
    try {
      const r = await apiPost<any>('/sales/call', { to: num })
      setStatus('ok')
      const via = String(r?.ext || ext)
      if (via) setExt(via)
      setNote(`АТС звонит ${via ? `на ${extLabel(via)}` : 'вам'} — снимите трубку, дальше соединит`)
      setLead(r?.lead || null)
      setNoLead(!r?.lead)
      if (r?.uuid) watchOutcome(r.uuid)
      else setTimeout(() => { setStatus('idle'); setNote('') }, 8000)
    } catch (e: any) {
      setStatus('error')
      setNote(e?.message || 'Телефония не настроена')
    }
  }

  // Карточка по номеру: сервер найдёт существующего лида или создаст нового
  // (прошлые звонки этого номера прикрепятся сами) — и сразу в карточку,
  // пока разговор свежий в голове
  const createLead = async (number: string) => {
    if (creating) return
    setCreating(true)
    try {
      const r = await apiPost<any>('/sales/call?action=lead', { number })
      if (r?.leadId) {
        setOpen(false)
        navigate(`/sales/leads/${r.leadId}`)
      }
    } catch (e: any) {
      setStatus('error')
      setNote(e?.message || 'Не удалось создать лида')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Трубка — поверх всего, но не поверх модалок (z ниже drawer'ов) */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Позвонить на любой номер"
        className={`fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full text-white
                   shadow-lg flex items-center justify-center transition-colors ${
                   incoming.length ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-600 hover:bg-emerald-700'}`}
      >
        {open ? <X className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
      </button>

      {/* Входящий прямо сейчас: события вебхука АТС — карточка всплывает
          ещё до снятой трубки, чтобы сейлз видел, кто звонит */}
      {incoming.length > 0 && (
        <div className="fixed bottom-5 right-20 z-40 flex flex-col gap-1.5 items-end">
          {incoming.map((c, i) => {
            const p = parsePhone(c.number)
            return (
              <div key={`${c.number}_${i}`}
                className="flex items-center gap-2 bg-white border border-emerald-300 rounded-full
                           shadow-lg pl-3 pr-2 py-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-none" />
                <span className="text-[12px] text-gray-800 tabular-nums">
                  ↓ {p.valid ? p.pretty : c.number}
                </span>
                {c.leadId ? (
                  <Link to={`/sales/leads/${c.leadId}`}
                    className="text-[11.5px] text-blue-600 hover:underline max-w-[140px] truncate">
                    {c.leadName || 'лид'}
                  </Link>
                ) : c.staff ? (
                  <span className="text-[11px] text-gray-500">сотрудник {c.staff}</span>
                ) : (
                  <span className="text-[11px] text-gray-400">номер новый</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-80 bg-white border border-gray-200
                        rounded-2xl shadow-2xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-2">Позвонить</div>
          <input
            ref={inputRef}
            value={num}
            onChange={e => {
              setNum(e.target.value)
              setLead(null); setNoLead(false)
              search(e.target.value)
              if (status !== 'calling') { setStatus('idle'); setNote('') }
            }}
            onKeyDown={e => { if (e.key === 'Enter') call() }}
            placeholder="имя или номер"
            inputMode="tel"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-[15px] font-mono tabular-nums
                       focus:outline-none focus:border-emerald-500"
          />
          <div className="mt-1 min-h-[18px] text-[11.5px]">
            {digits.length >= 7 && parsed.valid && (
              <span className="text-gray-500">
                {parsed.pretty}{parsed.operator ? ` · ${parsed.operator}` : ''}{parsed.countryName ? ` · ${parsed.countryName}` : ''}
              </span>
            )}
            {digits.length >= 7 && !parsed.valid && (
              <span className="text-amber-600">{parsed.problem} — наберётся как есть</span>
            )}
          </div>
          {found.length > 0 && (
            <div className="mt-1 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-44 overflow-y-auto">
              {found.map((f, i) => (
                <div key={`${f.kind}_${f.id}_${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
                  <button
                    onClick={() => { setNum(f.phone); setFound([]); inputRef.current?.focus() }}
                    title="Подставить номер"
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-[12.5px] text-gray-800 truncate">
                      {f.name}
                      {f.sub && <span className="text-gray-400"> · {f.sub}</span>}
                    </div>
                    <div className="text-[10.5px] text-gray-400 tabular-nums">
                      {parsePhone(f.phone).valid ? parsePhone(f.phone).pretty : f.phone}
                    </div>
                  </button>
                  <Link
                    to={f.kind === 'lead' ? `/sales/leads/${f.id}` : `/sales/accounts/${f.id}`}
                    onClick={() => setOpen(false)}
                    className="flex-none text-[10.5px] text-blue-600 hover:underline"
                  >
                    {f.kind === 'lead' ? 'лид' : 'аккаунт'}
                  </Link>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={call}
            disabled={digits.length < 7 || status === 'calling'}
            className="mt-2 w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium
                       hover:bg-emerald-700 disabled:opacity-40"
          >
            {status === 'calling' ? 'Соединяю…' : '📞 Позвонить'}
          </button>
          {ext && (
            <div className={`mt-1 text-[10.5px] ${extPersonal ? 'text-gray-400' : 'text-amber-600'}`}>
              {extPersonal
                ? `Исходящий пойдёт с вашего номера: ${extLabel(ext)}`
                : `У вас не задан личный номер — звонок пойдёт через общий (${extLabel(ext)}), и говорить будет его владелец`}
            </div>
          )}
          {note && (
            <div className={`mt-2 text-[12px] ${status === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
              {note}
            </div>
          )}
          {lead && (
            <Link
              to={`/sales/leads/${lead.id}`}
              onClick={() => setOpen(false)}
              className="mt-1 block text-[12px] text-blue-600 hover:underline truncate"
            >
              Карточка: {lead.name}
            </Link>
          )}
          {noLead && !lead && (
            <button
              onClick={() => createLead(num)}
              disabled={creating}
              className="mt-2 w-full py-2 rounded-xl border border-emerald-300 text-emerald-700
                         text-[12.5px] font-medium hover:bg-emerald-50 disabled:opacity-40"
            >
              {creating ? 'Создаю карточку…' : '＋ Создать лида с этим номером'}
            </button>
          )}
          {recent.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2 max-h-56 overflow-y-auto">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Недавние
              </div>
              {recent.map((r, i) => {
                const p = parsePhone(r.number)
                const missed = /недозвон|не ответили/.test(r.title)
                const inbound = /Входящ/.test(r.title)
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 group">
                    <button
                      onClick={() => { setNum(r.number); inputRef.current?.focus() }}
                      title="Подставить номер"
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className={`text-[12.5px] tabular-nums ${missed ? 'text-red-600' : 'text-gray-800'}`}>
                        {inbound ? '↓' : '↑'} {p.valid ? p.pretty : r.number}
                      </div>
                      <div className="text-[10.5px] text-gray-400 truncate">
                        {r.title.split('·')[1]?.trim() || r.title}
                        {' · '}{new Date(r.at).toLocaleString('ru-RU', {
                          timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    </button>
                    {r.leadId ? (
                      <Link to={`/sales/leads/${r.leadId}`} onClick={() => setOpen(false)}
                        title={r.leadName || 'карточка лида'}
                        className="flex-none text-[10.5px] text-blue-600 hover:underline max-w-[90px] truncate">
                        {r.leadName || 'лид'}
                      </Link>
                    ) : r.number.replace(/\D/g, '').length >= 7 ? (
                      <button
                        onClick={() => createLead(r.number)}
                        disabled={creating}
                        title="Создать карточку лида по этому номеру"
                        className="flex-none text-[10.5px] text-emerald-700 hover:underline disabled:opacity-40"
                      >
                        + лид
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-2 text-[10.5px] text-gray-400">
            АТС наберёт ваш номер, после ответа — соединит. Микрофон браузера не
            используется: разговор идёт через ваш телефон или софтфон. Звонок
            запишется и появится в недавних и в карточке клиента.
          </div>
        </div>
      )}
    </>
  )
}
