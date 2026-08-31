import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 50)
    // История подгружается на открытие: закрытая звонилка не тратит запросов
    apiGet<any>('/sales/call', false)
      .then(d => setRecent(d?.calls || []))
      .catch(() => {})
  }, [open])

  const parsed = parsePhone(num)
  const digits = num.replace(/\D/g, '')

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
      setNote('АТС звонит вам — снимите трубку, дальше соединит')
      if (r?.uuid) watchOutcome(r.uuid)
      else setTimeout(() => { setStatus('idle'); setNote('') }, 8000)
    } catch (e: any) {
      setStatus('error')
      setNote(e?.message || 'Телефония не настроена')
    }
  }

  return (
    <>
      {/* Трубка — поверх всего, но не поверх модалок (z ниже drawer'ов) */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Позвонить на любой номер"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-emerald-600 text-white
                   shadow-lg hover:bg-emerald-700 flex items-center justify-center transition-colors"
      >
        {open ? <X className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-80 bg-white border border-gray-200
                        rounded-2xl shadow-2xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-2">Позвонить</div>
          <input
            ref={inputRef}
            value={num}
            onChange={e => { setNum(e.target.value); if (status !== 'calling') { setStatus('idle'); setNote('') } }}
            onKeyDown={e => { if (e.key === 'Enter') call() }}
            placeholder="+998 90 123 45 67"
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
          <button
            onClick={call}
            disabled={digits.length < 7 || status === 'calling'}
            className="mt-2 w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium
                       hover:bg-emerald-700 disabled:opacity-40"
          >
            {status === 'calling' ? 'Соединяю…' : '📞 Позвонить'}
          </button>
          {note && (
            <div className={`mt-2 text-[12px] ${status === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
              {note}
            </div>
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
                    {r.leadId && (
                      <Link to={`/sales/leads/${r.leadId}`} onClick={() => setOpen(false)}
                        title={r.leadName || 'карточка лида'}
                        className="flex-none text-[10.5px] text-blue-600 hover:underline max-w-[90px] truncate">
                        {r.leadName || 'лид'}
                      </Link>
                    )}
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
