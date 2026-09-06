import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'
import { formatDateTimeShort, WORK_TZ_LABEL } from '@/shared/lib/time'

/**
 * Подключение календарей команды.
 *
 * Экран разделён так же, как у Meta, и по той же причине: настройка
 * OAuth-клиента делается администратором один раз за всё время и свёрнута
 * с глаз, а подключение календаря — обычная работа каждого за себя.
 *
 * Календарь у каждого свой. Общий на всех не годился: на одном аккаунте
 * Google не может сказать, кто именно занят, и мы видели только конфликты,
 * созданные нами же — отпуск или встреча вне CRM оставались невидимыми.
 * Подключить чужой ящик нельзя: согласие проходит сам человек.
 */

type State = {
  appConfigured: boolean
  clientId: string | null
  clientSecret: string | null
  redirectUri: string
  connected: boolean
  alive: boolean
  calendarEmail: string | null
  connectedAt: string | null
  team: Array<{ agentId: string; name: string | null; email: string | null; connectedAt: string | null }>
  workDays: number[]
  workFrom: number
  workTo: number
  slotMinutes: number
  publicBooking: boolean
}

const DAYS: Array<[number, string]> = [
  [1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс'],
]

export function GoogleCalendarModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [st, setSt] = useState<State | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [showApp, setShowApp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await apiGet<State>('/integrations/google-calendar', false)
      setSt(r)
      setClientId(r.clientId || '')
      // Ключи приложения показываем свёрнутыми, пока их нет: иначе первое
      // открытие встречает стеной полей, к которым человек не готов
      setShowApp(!r.appConfigured)
    } catch (e: any) {
      setError(e?.message || 'Не удалось прочитать состояние интеграции')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  const saveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Нужны и Client ID, и Client Secret')
      return
    }
    setBusy('creds'); setError(''); setNote('')
    try {
      await apiPost('/integrations/google-calendar?action=credentials', {
        clientId: clientId.trim(), clientSecret: clientSecret.trim(),
      })
      setClientSecret('')
      setNote('Ключи сохранены. Теперь подключите календарь.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить ключи')
    } finally { setBusy('') }
  }

  const connect = async () => {
    setBusy('connect'); setError('')
    try {
      const r = await apiGet<{ url: string }>('/integrations/google-calendar?action=auth-url', false)
      window.location.href = r.url
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить ссылку согласия')
      setBusy('')
    }
  }

  const disconnect = async () => {
    setBusy('disconnect'); setError(''); setNote('')
    try {
      await apiPost('/integrations/google-calendar?action=disconnect', {})
      setNote('Календарь отключён. Ключи приложения сохранены.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось отключить')
    } finally { setBusy('') }
  }

  const saveSettings = async (patch: Partial<State>) => {
    if (!st) return
    const next = { ...st, ...patch }
    setSt(next)
    setBusy('settings'); setError('')
    try {
      await apiPost('/integrations/google-calendar?action=settings', {
        workDays: next.workDays, workFrom: next.workFrom, workTo: next.workTo,
        slotMinutes: next.slotMinutes, publicBooking: next.publicBooking,
      })
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить расписание')
      await load()
    } finally { setBusy('') }
  }

  const toggleDay = (d: number) => {
    if (!st) return
    const has = st.workDays.includes(d)
    const days = has ? st.workDays.filter(x => x !== d) : [...st.workDays, d].sort()
    if (!days.length) return // ноль рабочих дней означал бы календарь, в который нельзя записаться
    saveSettings({ workDays: days })
  }

  const copyRedirect = async () => {
    if (!st) return
    try {
      await navigator.clipboard.writeText(st.redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* буфер может быть недоступен — адрес виден и так */ }
  }

  const statusChip = !st ? null
    : st.connected && st.alive
      ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">подключён</span>
      : st.connected
        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">доступ отозван</span>
        : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">не подключён</span>

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Google Календарь" size="lg">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-700">{error}</div>
        )}
        {note && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3.5 py-2.5 text-[12.5px] text-blue-700">{note}</div>
        )}

        {loading && !st && (
          <div className="py-10 text-center text-[13px] text-slate-400">Читаем состояние…</div>
        )}

        {st && (
          <>
            {/* Мой календарь */}
            <div className="rounded-xl border border-[#e8edf3] p-4">
              <div className="flex items-center gap-2.5 mb-2">
                <h3 className="text-[14px] font-semibold text-slate-800">Мой календарь</h3>
                {statusChip}
              </div>

              {st.connected ? (
                <>
                  <div className="text-[12.5px] text-slate-600">
                    <span className="text-slate-400">Аккаунт: </span>
                    <b className="font-semibold">{st.calendarEmail || '—'}</b>
                    {st.connectedAt ? (
                      <span className="text-slate-400"> · с {formatDateTimeShort(st.connectedAt)}</span>
                    ) : null}
                  </div>
                  {!st.alive && (
                    <div className="mt-2.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                      Google больше не отдаёт доступ по сохранённому токену — вероятно, его отозвали
                      в аккаунте. Ваши встречи не будут попадать в календарь: подключитесь заново.
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={connect} disabled={busy === 'connect'}
                      className="px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-[#e8edf3] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      Переподключить
                    </button>
                    <button onClick={disconnect} disabled={busy === 'disconnect'}
                      className="px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Отключить
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] text-slate-500 leading-relaxed">
                    Ваши встречи из CRM будут появляться в вашем календаре со ссылкой Google&nbsp;Meet,
                    а занятое время — учитываться при выборе слота. Включая то, что вы завели вне CRM.
                  </p>
                  <button onClick={connect} disabled={!st.appConfigured || busy === 'connect'}
                    className="mt-3 px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40">
                    {busy === 'connect' ? 'Открываем Google…' : 'Подключить мой календарь'}
                  </button>
                  {!st.appConfigured && (
                    <p className="mt-2 text-[11.5px] text-slate-400">Сначала задайте ключи приложения — ниже.</p>
                  )}
                </>
              )}
            </div>

            {/* Команда */}
            <div className="rounded-xl border border-[#e8edf3] p-4">
              <h3 className="text-[14px] font-semibold text-slate-800 mb-1">Календари команды</h3>
              <p className="text-[11.5px] text-slate-400 mb-3">
                Подключает каждый сам — за другого это сделать нельзя, согласие даёт сам человек.
              </p>
              {st.team.length ? (
                <div className="space-y-1.5">
                  {st.team.map(m => (
                    <div key={m.agentId} className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-none" />
                      <b className="font-semibold text-slate-700">{m.name || m.agentId}</b>
                      <span className="text-slate-400 truncate">{m.email || ''}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-slate-400">Пока никто не подключил календарь.</p>
              )}
              <p className="mt-3 text-[11.5px] text-slate-400 leading-relaxed">
                У кого календарь не подключён, встреча всё равно создастся в CRM — но без события
                в Google и без ссылки Meet.
              </p>
            </div>

            {/* Расписание — общее на организацию, а не на человека */}
            <div className="rounded-xl border border-[#e8edf3] p-4">
                <h3 className="text-[14px] font-semibold text-slate-800 mb-1">Когда назначаем встречи</h3>
                <p className="text-[11.5px] text-slate-400 mb-3">{WORK_TZ_LABEL}</p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {DAYS.map(([d, label]) => (
                    <button
                      key={d}
                      onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                        st.workDays.includes(d)
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-500 border-[#e8edf3] hover:border-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-[12px] text-slate-500">
                    <span className="block mb-1">С</span>
                    <select
                      value={st.workFrom}
                      onChange={e => saveSettings({ workFrom: Number(e.target.value) })}
                      className="border border-[#e8edf3] rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700"
                    >
                      {Array.from({ length: 16 }, (_, i) => i + 6).map(h => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[12px] text-slate-500">
                    <span className="block mb-1">До</span>
                    <select
                      value={st.workTo}
                      onChange={e => saveSettings({ workTo: Number(e.target.value) })}
                      className="border border-[#e8edf3] rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700"
                    >
                      {Array.from({ length: 17 }, (_, i) => i + 8).map(h => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[12px] text-slate-500">
                    <span className="block mb-1">Длительность</span>
                    <select
                      value={st.slotMinutes}
                      onChange={e => saveSettings({ slotMinutes: Number(e.target.value) })}
                      className="border border-[#e8edf3] rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700"
                    >
                      {[15, 30, 45, 60, 90].map(m => <option key={m} value={m}>{m} мин</option>)}
                    </select>
                  </label>
                </div>

                <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={st.publicBooking}
                    onChange={e => saveSettings({ publicBooking: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span className="text-[12.5px] text-slate-600">
                    <b className="font-semibold text-slate-800">Публичная бронь с сайта</b>
                    <span className="block text-slate-400 text-[11.5px] mt-0.5">
                      Клиент выбирает свободное время сам, встреча и лид заводятся автоматически.
                    </span>
                  </span>
                </label>
            </div>

            {/* Ключи приложения — разовая настройка */}
            <div className="rounded-xl border border-[#e8edf3]">
              <button
                onClick={() => setShowApp(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-[13px] font-semibold text-slate-700">
                  Приложение Google
                  <span className="ml-2 text-[11.5px] font-normal text-slate-400">
                    {st.appConfigured ? 'ключи заданы' : 'не настроено'}
                  </span>
                </span>
                <span className="text-slate-400 text-[12px]">{showApp ? 'свернуть' : 'настроить'}</span>
              </button>

              {showApp && (
                <div className="px-4 pb-4 space-y-3 border-t border-[#f1f5f9] pt-3">
                  <p className="text-[12px] text-slate-500 leading-relaxed">
                    Разовая настройка. В Google Cloud Console включите Calendar API, создайте
                    OAuth-клиент типа «Веб-приложение» и добавьте в него адрес возврата ниже —
                    он должен совпасть побуквенно.
                  </p>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Разрешённый URI перенаправления
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 min-w-0 truncate bg-slate-50 border border-[#e8edf3] rounded-lg px-3 py-2 text-[11.5px] text-slate-700">
                        {st.redirectUri}
                      </code>
                      <button
                        onClick={copyRedirect}
                        className="px-3 py-2 text-[12px] font-medium rounded-lg border border-[#e8edf3] text-slate-600 hover:bg-slate-50 flex-shrink-0"
                      >
                        {copied ? 'скопирован' : 'копировать'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Client ID</div>
                    <input
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      placeholder="…apps.googleusercontent.com"
                      className="w-full border border-[#e8edf3] rounded-lg px-3 py-2 text-[12.5px] text-slate-700"
                    />
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Client Secret</div>
                    <input
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      type="password"
                      placeholder={st.clientSecret || 'GOCSPX-…'}
                      className="w-full border border-[#e8edf3] rounded-lg px-3 py-2 text-[12.5px] text-slate-700"
                    />
                    {st.clientSecret && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Сейчас сохранён {st.clientSecret}. Оставьте поле пустым, чтобы не менять.
                      </p>
                    )}
                  </div>

                  <button
                    onClick={saveCredentials}
                    disabled={busy === 'creds'}
                    className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
                  >
                    {busy === 'creds' ? 'Сохраняем…' : 'Сохранить ключи'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
