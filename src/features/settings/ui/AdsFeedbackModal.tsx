import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'
import { formatDateTime } from '@/shared/lib'

/**
 * Окно обратной петли Google Ads / Яндекс Директ.
 *
 * Смысл для того, кто открыл: реклама сейчас платит за форму, а должна —
 * за клиента. Здесь два подключения, у каждого свой путь:
 *   Google — забирает CSV с нашего адреса сам, нужно вставить адрес в его
 *            расписание загрузок и завести три действия-конверсии с теми же
 *            названиями;
 *   Яндекс — мы шлём в Метрику, нужен номер счётчика и OAuth-токен.
 * Токен наружу не показывается: после сохранения видно только «есть».
 */

interface Stats { [status: string]: number }
interface State {
  google: {
    url: string | null; key: string | null; conversionNames: string[]; lastFetchedAt: string | null; stats: Stats
    analytics: { connected: boolean; email: string | null; property: string; connectedAt: string | null }
  }
  yandex: { counter: string | null; hasToken: boolean; readyAt: string | null; goals: { id: string; name: string }[]; stats: Stats }
  enabledAt: string | null
  heartbeatAt: string | null
}

const STATUS_RU: Record<string, string> = {
  pending: 'в очереди', published: 'Google забрал', sent: 'ушло в Метрику',
  baseline: 'до включения', no_match: 'без click id', error: 'ошибка',
}

function ago(iso: string | null): string {
  if (!iso) return 'ещё не было'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return formatDateTime(iso)
}

function StatsLine({ stats }: { stats: Stats }) {
  const parts = Object.entries(stats).filter(([, n]) => n > 0)
  if (!parts.length) return <span className="text-[12px] text-slate-400">За 30 дней событий не было</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {parts.map(([k, n]) => (
        <span key={k} className={`text-[12px] ${k === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
          {STATUS_RU[k] || k}: <b>{n}</b>
        </span>
      ))}
    </div>
  )
}

export function AdsFeedbackModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [st, setSt] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [counter, setCounter] = useState('')
  const [token, setToken] = useState('')

  const load = useCallback(() => {
    apiGet<State>('/integrations/ads-feedback', false)
      .then(s => { setSt(s); setCounter(s.yandex.counter || '105636261') })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }, [])
  useEffect(() => { if (isOpen) { setError(null); setNote(null); load() } }, [isOpen, load])

  const run = async (key: string, body: Record<string, unknown>, okNote: string) => {
    setBusy(key); setError(null); setNote(null)
    try {
      await apiPost('/integrations/ads-feedback', body)
      setNote(okNote)
      setToken('')
      load()
    } catch (e: any) {
      setError(e?.message || 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  const [copiedKey, setCopiedKey] = useState(false)
  const copy = async (text: string | null, flag: (v: boolean) => void) => {
    if (!text) return
    try { await navigator.clipboard.writeText(text); flag(true); setTimeout(() => flag(false), 1500) } catch { /* буфер недоступен */ }
  }

  const connectGa = async () => {
    setBusy('ga'); setError(null)
    try {
      const r = await apiPost<{ url: string }>('/integrations/ads-feedback', { action: 'ga_auth', property: st?.google.analytics.property })
      window.location.href = r.url
    } catch (e: any) {
      setError(e?.message || 'Не получилось открыть согласие Google')
      setBusy(null)
    }
  }

  const hbMin = st?.heartbeatAt ? Math.floor((Date.now() - new Date(st.heartbeatAt).getTime()) / 60000) : null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Обратная петля рекламы: Google и Яндекс" size="lg">
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-700">{error}</div>}
        {note && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-[12.5px] text-emerald-800">{note}</div>}

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-[12.5px] text-slate-600 leading-relaxed">
          Реклама учится на том, что мы ей сообщаем. Сейчас обе системы платят за заполненную форму.
          Петля отдаёт им факты из CRM — <b>квалифицирован</b>, <b>встреча</b>, <b>оплата</b> — по click id,
          с которым пришла заявка. Через 2–3 недели накопленных фактов цель кампании переключается
          на «квалифицирован», и цена считается уже за него.
        </div>

        {/* ── Google Ads ────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div>
              <div className="text-[14.5px] font-semibold text-slate-800">Google Ads</div>
              <div className="text-[12px] text-slate-500 mt-0.5">Google сам забирает файл конверсий по расписанию с нашего адреса</div>
            </div>
            <button onClick={() => run('gkey', { action: 'google_key' }, st?.google.url ? 'Ключ перевыпущен — обновите адрес в Google Ads' : 'Адрес готов — вставьте его в Google Ads')}
              disabled={busy === 'gkey'}
              className="flex-none text-[12.5px] px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 disabled:opacity-50">
              {busy === 'gkey' ? '…' : st?.google.url ? 'Перевыпустить ключ' : 'Включить'}
            </button>
          </div>
          <div className="px-4 py-3 space-y-2.5">
            {st?.google.url ? (
              <>
                <div className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[12px] text-slate-500">
                  <span>Адрес</span>
                  <code className="min-w-0 truncate text-[11.5px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-slate-700">{st.google.url}</code>
                  <button onClick={() => copy(st.google.url, setCopied)} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400">
                    {copied ? 'Скопировано' : 'Копировать'}
                  </button>
                  <span>Имя</span>
                  <code className="text-[11.5px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-slate-700">gfsupport</code>
                  <span />
                  <span>Пароль</span>
                  <code className="min-w-0 truncate text-[11.5px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-slate-700">{st.google.key}</code>
                  <button onClick={() => copy(st.google.key, setCopiedKey)} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400">
                    {copiedKey ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
                <ol className="text-[12px] text-slate-600 list-decimal pl-4 space-y-0.5">
                  <li>Инструменты → Менеджер данных → Подключить продукт → «HTTPS» → адрес, имя и пароль отсюда; раз в сутки.</li>
                  <li>Три действия-конверсии «Импорт → офлайн» с названиями:
                    {' '}{st.google.conversionNames.map(n => <code key={n} className="mx-0.5 bg-slate-100 rounded px-1">{n}</code>)}</li>
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatsLine stats={st.google.stats} />
                  <span className="text-[11.5px] text-slate-400">Google забирал: {ago(st.google.lastFetchedAt)}</span>
                </div>
                {/* Расход Google Ads — из GA4, связанного с кабинетом: API Ads не нужен */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12.5px] text-slate-700">
                      <b>Расход в отчёте по каналам</b> — из Google Analytics (ресурс {st.google.analytics.property})
                      {st.google.analytics.connected
                        ? <span className="text-emerald-700"> · подключено{st.google.analytics.email ? `, ${st.google.analytics.email}` : ''}</span>
                        : <span className="text-amber-700"> · не подключено</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {st.google.analytics.connected && (
                        <button onClick={() => run('gasync', { action: 'ga_sync' }, 'Расход Google за 30 дней забран')}
                          disabled={busy === 'gasync'}
                          className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 disabled:opacity-50">
                          {busy === 'gasync' ? 'Забираем…' : 'Забрать сейчас'}
                        </button>
                      )}
                      <button onClick={connectGa} disabled={busy === 'ga'}
                        className={`text-[12px] px-2.5 py-1.5 rounded-lg disabled:opacity-50 ${st.google.analytics.connected
                          ? 'border border-slate-200 hover:border-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                        {busy === 'ga' ? 'Открываем…' : st.google.analytics.connected ? 'Переподключить' : 'Подключить Analytics'}
                      </button>
                      {st.google.analytics.connected && (
                        <button onClick={() => run('gaoff', { action: 'ga_off' }, 'Analytics отключён')}
                          className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-red-400 text-slate-600">
                          Отключить
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11.5px] text-slate-500">
                    Согласие даёт владелец аккаунта, у которого есть доступ к GA4 и кабинету Ads. Расход подтягивается ночью, как у Яндекса.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-slate-500">Пока выключено. «Включить» выдаст адрес с ключом — его нужно вставить в расписание загрузок Google Ads.</p>
            )}
          </div>
        </section>

        {/* ── Яндекс ────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-[14.5px] font-semibold text-slate-800">Яндекс Директ</div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Мы шлём офлайн-конверсии в Метрику по yclid, Директ видит их как цели счётчика
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2.5">
              <label className="text-[12px] text-slate-600">
                Счётчик Метрики
                <input value={counter} onChange={e => setCounter(e.target.value)} inputMode="numeric"
                  className="mt-1 w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-blue-400 outline-none" />
              </label>
              <label className="text-[12px] text-slate-600">
                OAuth-токен Яндекса {st?.yandex.hasToken && <span className="text-emerald-700">· сохранён</span>}
                <input value={token} onChange={e => setToken(e.target.value)} type="password" autoComplete="off"
                  placeholder={st?.yandex.hasToken ? 'оставьте пустым, чтобы не менять' : 'y0_AgAAAA…'}
                  className="mt-1 w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-blue-400 outline-none" />
              </label>
            </div>
            <p className="text-[11.5px] text-slate-500 leading-relaxed">
              Токен: <a href="https://oauth.yandex.ru/client/new" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">oauth.yandex.ru</a> →
              создать приложение с правом <code className="bg-slate-100 rounded px-1">metrika:write</code>, платформа «Веб-сервисы»,
              Redirect URI <code className="bg-slate-100 rounded px-1">https://oauth.yandex.ru/verification_code</code>; затем открыть
              <code className="bg-slate-100 rounded px-1">https://oauth.yandex.ru/authorize?response_type=token&client_id=…</code> и вставить токен сюда.
              При сохранении система сама включит учёт офлайн-конверсий и заведёт цели
              {' '}{st?.yandex.goals.map(g => <code key={g.id} className="mx-0.5 bg-slate-100 rounded px-1">{g.id}</code>)}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => run('ym', { action: 'yandex', counter, token }, 'Метрика готова: порог включён, цели заведены')}
                disabled={busy === 'ym' || !counter}
                className="text-[12.5px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {busy === 'ym' ? 'Проверяем…' : st?.yandex.readyAt ? 'Сохранить и проверить' : 'Подключить'}
              </button>
              {st?.yandex.hasToken && (
                <button onClick={() => run('ymoff', { action: 'yandex_off' }, 'Яндекс отключён, токен стёрт')}
                  disabled={busy === 'ymoff'}
                  className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-red-400 text-slate-600 disabled:opacity-50">
                  Отключить
                </button>
              )}
              {st?.yandex.readyAt && (
                <span className="text-[11.5px] text-slate-400">Метрика подготовлена {formatDateTime(st.yandex.readyAt)}</span>
              )}
            </div>
            {st && <StatsLine stats={st.yandex.stats} />}
          </div>
        </section>

        <div className="flex items-center justify-between text-[11.5px] text-slate-400 px-1">
          <span>Часовой прогон: {hbMin === null ? 'ещё не ходил' : hbMin < 130 ? `ходит, последний ${ago(st?.heartbeatAt || null)}` : `молчит ${Math.floor(hbMin / 60)} ч`}</span>
          <span>расписание: каждый час в :25</span>
        </div>
      </div>
    </Modal>
  )
}
