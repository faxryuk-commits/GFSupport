import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'

/**
 * Подключение личного Telegram сейлза.
 *
 * Клиенту пишет живой человек, а не «уведомление компании», — и лимиты
 * Telegram не копятся на одном номере отдела. Взамен сотруднику даётся
 * прямое обещание: система забирает только переписку с клиентами из базы,
 * личные чаты не читаются. Обещание держит код (webhook/telegram-user),
 * а здесь оно написано словами, до подключения, а не после.
 */

type Status = {
  connected: boolean
  phone?: string
  username?: string | null
  used?: number
  limit?: number
  pausedUntil?: string | null
  lastError?: string | null
  bridgeError?: string
}

export function TelegramConnect() {
  const [st, setSt] = useState<Status | null>(null)
  const [step, setStep] = useState<'idle' | 'code' | 'password'>('idle')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    apiGet<Status>('/sales/telegram?action=status', false).then(setSt).catch(() => setSt({ connected: false }))
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<any>) => {
    if (busy) return
    setBusy(true); setErr('')
    try { return await fn() } catch (e: any) { setErr(e?.message || 'не получилось'); return null } finally { setBusy(false) }
  }

  const start = () => run(async () => {
    await apiPost('/sales/telegram', { action: 'login', phone })
    setStep('code')
  })

  const confirm = () => run(async () => {
    const r = await apiPost<any>('/sales/telegram', { action: 'code', code })
    if (r?.needPassword) { setStep('password'); return }
    setStep('idle'); setCode(''); load()
  })

  const confirmPass = () => run(async () => {
    await apiPost('/sales/telegram', { action: 'password', password })
    setStep('idle'); setPassword(''); setCode(''); load()
  })

  const logout = () => run(async () => {
    if (!confirm2()) return
    await apiPost('/sales/telegram', { action: 'logout' })
    load()
  })
  const confirm2 = () => window.confirm('Отключить Telegram? Сессия удалится, переписка с клиентами в карточках останется.')

  const inp = 'text-[13px] border border-gray-200 rounded-lg px-3 py-2 w-full'

  if (!st) return null

  return (
    <div className="bg-white border border-[#e8edf3] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-900">Мой Telegram</span>
          <span className="text-[11px] text-slate-400">писать клиентам от своего имени</span>
        </div>
        {st.connected
          ? <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">подключён</span>
          : <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">не подключён</span>}
      </div>

      {st.connected ? (
        <div className="divide-y divide-gray-50">
          <div className="px-4 py-2.5 flex items-center justify-between text-[12.5px]">
            <span className="text-slate-500">Аккаунт</span>
            <span className="text-slate-800">
              {st.username ? <b>@{st.username}</b> : 'без имени пользователя'}
              <span className="text-slate-400 tabular-nums ml-2">{st.phone}</span>
            </span>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between text-[12.5px]">
            <span className="text-slate-500">Первых сообщений за сутки</span>
            <b className="tabular-nums">{st.used ?? 0} / {st.limit ?? 0}</b>
          </div>
          {st.pausedUntil && (
            <div className="px-4 py-2.5 text-[12.5px] text-amber-700 bg-amber-50">
              Telegram ограничил отправку до {new Date(st.pausedUntil).toLocaleString('ru-RU')}.
              Пункт «Написать в Telegram» пока ведёт во внешнюю ссылку — работа не встаёт.
            </div>
          )}
          <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <button onClick={logout} disabled={busy}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-red-400 hover:text-red-600">
              Отключить
            </button>
            <span className="text-[11px] text-slate-400">переписка с клиентами в карточках останется</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-2.5">
          {st.bridgeError && (
            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Мост сейчас недоступен: {st.bridgeError}
            </div>
          )}
          {step === 'idle' && (
            <>
              <div className="text-[12.5px] text-slate-600">
                Введите свой номер в Telegram — придёт код в чат «Telegram».
              </div>
              <div className="flex gap-2 flex-wrap">
                <input className={`${inp} flex-1 min-w-[180px]`} value={phone} placeholder="+998 90 123 45 67"
                  onChange={e => setPhone(e.target.value)} />
                <button onClick={start} disabled={busy || phone.replace(/\D/g, '').length < 9}
                  className="text-[12.5px] px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50">
                  {busy ? '…' : 'Получить код'}
                </button>
              </div>
            </>
          )}
          {step === 'code' && (
            <>
              <div className="text-[12.5px] text-slate-600">Код пришёл в Telegram на {phone}</div>
              <div className="flex gap-2 flex-wrap">
                <input className={`${inp} flex-1 min-w-[140px] tracking-[.3em] text-center`} value={code}
                  placeholder="12345" onChange={e => setCode(e.target.value)} />
                <button onClick={confirm} disabled={busy || code.length < 4}
                  className="text-[12.5px] px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50">
                  {busy ? '…' : 'Подтвердить'}
                </button>
                <button onClick={() => { setStep('idle'); setCode('') }}
                  className="text-[12.5px] px-3 py-2 rounded-lg border border-gray-300 text-gray-600">Назад</button>
              </div>
            </>
          )}
          {step === 'password' && (
            <>
              <div className="text-[12.5px] text-slate-600">
                У аккаунта включён облачный пароль. Он нужен только для входа и нигде не сохраняется.
              </div>
              <div className="flex gap-2 flex-wrap">
                <input className={`${inp} flex-1 min-w-[160px]`} type="password" value={password}
                  placeholder="Облачный пароль" onChange={e => setPassword(e.target.value)} />
                <button onClick={confirmPass} disabled={busy || !password}
                  className="text-[12.5px] px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50">
                  {busy ? '…' : 'Войти'}
                </button>
              </div>
            </>
          )}
          {err && <div className="text-[12px] text-red-600">{err}</div>}

          <div className="border-t border-gray-100 pt-2.5 space-y-1.5">
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-emerald-600 font-bold">✓</span>
              <span className="text-slate-600">В систему попадает переписка только с номерами из базы клиентов — она видна в карточке сделки.</span>
            </div>
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-red-500 font-bold">✗</span>
              <span className="text-slate-600">Личные чаты, группы и каналы не читаются и не сохраняются.</span>
            </div>
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-slate-400 font-bold">⏻</span>
              <span className="text-slate-600">Отключить можно в один клик; лимит первых сообщений бережёт аккаунт от блокировки.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
