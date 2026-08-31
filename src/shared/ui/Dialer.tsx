import { useEffect, useRef, useState } from 'react'
import { Phone, X } from 'lucide-react'
import { apiPost } from '@/shared/services/api.service'
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const parsed = parsePhone(num)
  const digits = num.replace(/\D/g, '')

  const call = async () => {
    if (digits.length < 7 || status === 'calling') return
    setStatus('calling'); setNote('')
    try {
      await apiPost('/sales/call', { to: num })
      setStatus('ok')
      setNote('АТС звонит вам — снимите трубку, дальше соединит')
      setTimeout(() => { setStatus('idle'); setNote('') }, 6000)
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
          <div className="mt-2 text-[10.5px] text-gray-400">
            АТС наберёт ваш номер, после ответа — соединит. Звонок запишется и через
            несколько минут появится касанием в карточке клиента.
          </div>
        </div>
      )}
    </>
  )
}
