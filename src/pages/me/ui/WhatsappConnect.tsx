import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { formatDateTimeShort } from '@/shared/lib/time'

/**
 * Подключение личного WhatsApp сейлза.
 *
 * Поддержка работает через GreenAPI с одного рабочего номера — этот экран
 * её не касается. Здесь у каждого продавца свой номер: он сканирует QR
 * своим телефоном и пишет клиентам от себя, а переписка ложится в карточку.
 */

/**
 * Состояние сессии одним словом — его считает мост.
 * `reconnecting` появился отдельно от `off` намеренно: обычный обрыв связи
 * выглядел как «меня выкинуло», хотя сервис уже возвращается сам.
 */
type SessionState = 'online' | 'reconnecting' | 'qr' | 'need_qr' | 'off'

type Status = {
  connected: boolean
  state?: SessionState
  qr?: string | null
  phone?: string | null
  connectedAt?: string | null
  lastError?: string | null
  used?: number
  limit?: number
  bridgeError?: string
}

const CHIP: Record<SessionState, { text: string; cls: string; dot?: boolean }> = {
  online: { text: 'на связи', cls: 'bg-emerald-50 text-emerald-700' },
  reconnecting: { text: 'переподключается', cls: 'bg-amber-50 text-amber-700', dot: true },
  qr: { text: 'сканирование', cls: 'bg-blue-50 text-blue-700' },
  need_qr: { text: 'нужен QR', cls: 'bg-blue-50 text-blue-700' },
  off: { text: 'не подключён', cls: 'bg-gray-100 text-gray-500' },
}

export function WhatsappConnect() {
  const [st, setSt] = useState<Status | null>(null)
  const [pairing, setPairing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    apiGet<Status>('/sales/whatsapp?action=status', false).then(setSt).catch(() => setSt({ connected: false }))
  }, [])
  useEffect(() => { load() }, [load])

  // Пока показан QR — переспрашиваем состояние: скан происходит на телефоне,
  // и экран должен сам заметить, что подключение прошло
  useEffect(() => {
    if (!pairing) return
    const t = setInterval(() => {
      apiGet<Status>('/sales/whatsapp?action=status', false).then(s => {
        setSt(s)
        if (s.connected) { setPairing(false); setErr('') }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [pairing])

  // Пока сервис переподключается — переспрашиваем реже, но переспрашиваем:
  // человеку не за чем обновлять страницу, чтобы увидеть, что всё вернулось
  const reconnecting = st?.state === 'reconnecting'
  useEffect(() => {
    if (!reconnecting) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [reconnecting, load])

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const r = await apiPost<Status>('/sales/whatsapp', { action: 'login' })
      setSt(s => ({ ...(s || { connected: false }), ...r }))
      setPairing(!r.connected)
    } catch (e: any) { setErr(e?.message || 'не получилось') } finally { setBusy(false) }
  }

  const logout = async () => {
    if (!window.confirm('Отключить WhatsApp? Переписка с клиентами в карточках останется.')) return
    setBusy(true)
    try { await apiPost('/sales/whatsapp', { action: 'logout' }); setPairing(false); load() }
    catch (e: any) { setErr(e?.message || 'не получилось') } finally { setBusy(false) }
  }

  if (!st) return null

  // Мост отдаёт состояние словом; старый ответ без него читаем по-прежнему
  const state: SessionState = st.state || (st.connected ? 'online' : st.qr ? 'qr' : 'off')
  const chip = CHIP[state] || CHIP.off

  return (
    <div className="bg-white border border-[#e8edf3] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-900">Мой WhatsApp</span>
          <span className="text-[11px] text-slate-400">писать клиентам со своего номера</span>
        </div>
        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 ${chip.cls}`}>
          {chip.dot && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
          {chip.text}
        </span>
      </div>

      {state === 'reconnecting' ? (
        <div className="px-4 py-3 space-y-2.5">
          <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
            Связь с WhatsApp пропала — сервис возвращается сам. Обычно занимает меньше минуты,
            сканировать код заново не нужно.
          </div>
          <div className="text-[12.5px] text-slate-600">
            Номер <b className="tabular-nums text-slate-800">{st.phone || '—'}</b>
            {st.connectedAt && <> · последний раз на связи {formatDateTimeShort(st.connectedAt)}</>}
          </div>
        </div>
      ) : st.connected ? (
        <div className="divide-y divide-gray-50">
          <div className="px-4 py-2.5 flex items-center justify-between text-[12.5px]">
            <span className="text-slate-500">Номер</span>
            <b className="tabular-nums">{st.phone || '—'}</b>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between text-[12.5px]">
            <span className="text-slate-500">Первых сообщений за сутки</span>
            <b className="tabular-nums">{st.used ?? 0} / {st.limit ?? 0}</b>
          </div>
          <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <button onClick={logout} disabled={busy}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-red-400 hover:text-red-600">
              Отключить
            </button>
            <span className="text-[11px] text-slate-400">переписка с клиентами останется в карточках</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-3">
          {st.bridgeError && (
            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Сервис сейчас недоступен: {st.bridgeError}
            </div>
          )}

          {state === 'need_qr' && !st.qr && (
            <div className="text-[12px] text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 leading-relaxed">
              Устройство отвязали в WhatsApp на телефоне. Подключение придётся пройти заново —
              это займёт полминуты.
            </div>
          )}

          {st.qr ? (
            <div className="flex gap-4 items-start flex-wrap">
              <img src={st.qr} alt="QR-код WhatsApp" className="w-[180px] h-[180px] rounded-lg border border-gray-200" />
              <div className="text-[12.5px] text-slate-600 space-y-1 max-w-[280px]">
                <div className="font-medium text-slate-800">Отсканируйте телефоном</div>
                <div>WhatsApp → Настройки → <b>Связанные устройства</b> → «Привязка устройства».</div>
                <div className="text-slate-400 text-[11.5px]">
                  Код живёт около минуты. Если не успели — нажмите «Обновить код».
                </div>
                <button onClick={start} disabled={busy}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 mt-1">
                  Обновить код
                </button>
              </div>
            </div>
          ) : (
            <>
              {state !== 'need_qr' && (
                <div className="text-[12.5px] text-slate-600">
                  Свой номер — чтобы клиенту писал живой человек, а не общий номер компании.
                  Поддержка при этом работает как раньше, отдельно.
                </div>
              )}
              <button onClick={start} disabled={busy}
                className="text-[12.5px] px-4 py-2 rounded-lg bg-blue-500 text-white font-medium disabled:opacity-50">
                {busy ? 'Готовим код…' : 'Показать QR-код'}
              </button>
            </>
          )}
          {err && <div className="text-[12px] text-red-600">{err}</div>}

          <div className="border-t border-gray-100 pt-2.5 space-y-1.5">
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-emerald-600 font-bold">✓</span>
              <span className="text-slate-600">В карточку попадает переписка только с номерами из базы клиентов.</span>
            </div>
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-red-500 font-bold">✗</span>
              <span className="text-slate-600">Личные чаты и группы не читаются и не сохраняются.</span>
            </div>
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-slate-400 font-bold">⏻</span>
              <span className="text-slate-600">Лимит первых сообщений в сутки бережёт номер от блокировки.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
