import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'

/**
 * Подключение Instagram и Facebook.
 *
 * Экран собран как шаги с состоянием, а не как одна длинная форма: раскрыт
 * только тот шаг, который делают сейчас, пройденные свёрнуты в строчку.
 * Первая версия показывала всё сразу, и в ней терялось главное — адрес
 * возврата нужно внести в консоль Meta ДО согласия, иначе Facebook отвечает
 * «URL заблокирован». Теперь этот шаг стоит перед кнопкой и не пропускается.
 */

type Form = {
  form_id: string; name: string | null; market_id: string | null
  suggested_market: string | null; status: string | null
  leads_count: number; last_lead_at: string | null
}

type State = {
  appId: string | null; appSecret: string | null; verifyToken: string | null
  pageId: string | null; pageName: string | null; pageToken: string | null
  igUsername: string | null; connectedByName: string | null; connectedAt: string | null
  source: 'db' | 'env' | 'none'; authorized: boolean
  webhookUrl: string; redirectUri: string; forms: Form[]
}

const REGIONS: Array<[string, string]> = [
  ['uz', 'Узбекистан'], ['kz', 'Казахстан'], ['kg', 'Кыргызстан'],
  ['az', 'Азербайджан'], ['ge', 'Грузия'], ['cy', 'Кипр'], ['ae', 'ОАЭ'],
]
const regionName = (c: string | null) => REGIONS.find(r => r[0] === c)?.[1] || null

/** Значение, которое нужно перенести в чужую консоль: копируется нажатием. */
function Copyable({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="mt-3">
      <div className="text-[12px] font-medium text-slate-600 mb-1">{label}</div>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600) }}
        className="w-full flex items-center gap-2 text-left font-mono text-[12.5px] bg-white border border-slate-200
                   rounded-lg px-3 py-2.5 hover:border-blue-400 transition-colors group">
        <span className="flex-1 break-all text-slate-700">{value}</span>
        <span className={`flex-none text-[11px] font-sans px-2 py-1 rounded-md ${
          done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700'}`}>
          {done ? 'скопировано' : 'копировать'}
        </span>
      </button>
      {hint && <div className="text-[12px] text-slate-500 mt-1.5">{hint}</div>}
    </div>
  )
}

/** Шаг: свёрнут когда пройден, раскрыт когда очередь, приглушён когда рано. */
function Step({ n, title, state, children }: {
  n: number; title: string; state: 'done' | 'now' | 'locked'; children?: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border ${
      state === 'now' ? 'border-blue-200 bg-blue-50/40'
        : state === 'done' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/50'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`flex-none w-6 h-6 rounded-lg grid place-items-center text-[12px] font-bold ${
          state === 'done' ? 'bg-emerald-500 text-white'
            : state === 'now' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
          {state === 'done' ? '✓' : n}
        </span>
        <span className={`text-[14px] font-semibold ${state === 'locked' ? 'text-slate-400' : 'text-slate-800'}`}>
          {title}
        </span>
      </div>
      {state !== 'locked' && children && <div className="px-4 pb-4 pl-[52px]">{children}</div>}
    </div>
  )
}

export function MetaConnectModal({ isOpen, onClose, onChanged }: {
  isOpen: boolean; onClose: () => void; onChanged?: () => void
}) {
  const [st, setSt] = useState<State | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [urlAdded, setUrlAdded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<State>('/integrations/meta', false)
      .then(d => { setSt(d); setAppId(d.appId || ''); setVerifyToken(d.verifyToken || '') })
      .catch(e => setError(e?.message || 'Не удалось получить состояние'))
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  // Согласие открывается отдельной вкладкой: возвращаемся — обновляем состояние
  useEffect(() => {
    if (!isOpen) return
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isOpen, load])

  const act = async (name: string, fn: () => Promise<any>) => {
    setBusy(name); setError(null); setNote(null)
    try { await fn(); load(); onChanged?.() }
    catch (e: any) { setError(e?.message || 'Не получилось') }
    finally { setBusy(null) }
  }

  const saveCreds = () => act('creds', async () => {
    await apiPost('/integrations/meta?action=credentials', { appId, appSecret, verifyToken })
    setAppSecret(''); setNote('Ключи сохранены')
  })

  const startAuth = () => act('auth', async () => {
    const r = await apiGet<{ url: string }>('/integrations/meta?action=auth-url', false)
    window.open(r.url, '_blank', 'noopener')
    setNote('Согласие открылось в новой вкладке. Вернитесь сюда, когда закончите.')
  })

  const loadPages = () => act('pages', async () => {
    const r = await apiGet<{ pages: Array<{ id: string; name: string }> }>('/integrations/meta?action=pages', false)
    setPages(r.pages || [])
    if (!r.pages?.length) setNote('Страниц не нашлось — у этого аккаунта нет прав администратора страницы')
  })

  const selectPage = (pageId: string) => act('select', async () => {
    const r = await apiPost<{ pageName: string; igUsername: string | null; subscribed: boolean; subscribeError: string | null }>(
      '/integrations/meta?action=select-page', { pageId })
    setPages([])
    setNote(r.subscribed
      ? `Страница «${r.pageName}» подключена, вебхуки подписаны${r.igUsername ? `, Instagram @${r.igUsername}` : ''}`
      : `Страница подключена, но подписать вебхуки не вышло: ${r.subscribeError || 'неизвестно'}`)
  })

  const syncForms = () => act('forms', async () => {
    const r = await apiPost<{ found: number }>('/integrations/meta?action=sync-forms', {})
    setNote(`Найдено форм: ${r.found}`)
  })

  const setFormMarket = (formId: string, market: string) =>
    act('form', () => apiPost('/integrations/meta?action=form-market', { formId, market: market || null }))

  const disconnect = () => {
    if (!confirm('Отключить Instagram и Facebook? Заявки с рекламы перестанут приходить.')) return
    act('off', () => apiPost('/integrations/meta?action=disconnect', {}))
  }

  const hasKeys = Boolean(st?.appId && st?.appSecret)
  const connected = Boolean(st?.pageId)
  const stepState = (done: boolean, ready: boolean) => done ? 'done' : ready ? 'now' : 'locked'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Instagram и Facebook" size="lg">
      <div className="space-y-3">
        {connected && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-3">
            <span className="text-[18px] leading-none mt-0.5">✅</span>
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="font-semibold text-emerald-900">
                Подключено · {st?.pageName}
                {st?.igUsername && <span className="font-normal"> · Instagram @{st.igUsername}</span>}
              </div>
              <div className="text-[12px] text-emerald-800/80 mt-0.5">
                {st?.connectedByName || '—'}
                {st?.connectedAt ? `, ${new Date(st.connectedAt).toLocaleDateString('ru-RU')}` : ''}
                {' · заявки, директ и Messenger идут к нам'}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-700">{error}</div>
        )}
        {note && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3.5 py-2.5 text-[12.5px] text-blue-800">{note}</div>
        )}

        {/* ── 1 ─────────────────────────────────────────────────────────────── */}
        <Step n={1} title="Ключи приложения Meta" state={stepState(hasKeys, true)}>
          <p className="text-[12.5px] text-slate-600 mb-3">
            Консоль разработчика → Настройки приложения → Основные. Секрет хранится
            в системе и наружу не отдаётся.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={appId} onChange={e => setAppId(e.target.value)} placeholder="ID приложения"
              className="text-[13px] px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" />
            <input value={appSecret} onChange={e => setAppSecret(e.target.value)} type="password"
              placeholder={st?.appSecret ? `Секрет сохранён (${st.appSecret})` : 'Секрет приложения'}
              className="text-[13px] px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" />
            <input value={verifyToken} onChange={e => setVerifyToken(e.target.value)}
              placeholder="Маркер подтверждения — придумайте любой"
              className="sm:col-span-2 text-[13px] px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" />
          </div>
          <button onClick={saveCreds} disabled={busy === 'creds' || !appId.trim()}
            className="mt-2.5 text-[12.5px] px-3.5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy === 'creds' ? 'Сохраняем…' : hasKeys ? 'Обновить ключи' : 'Сохранить ключи'}
          </button>
        </Step>

        {/* ── 2 ─────────────────────────────────────────────────────────────── */}
        <Step n={2} title="Внести два адреса в консоль Meta" state={stepState(urlAdded || connected, hasKeys)}>
          {/* Именно здесь спотыкаются: без адреса возврата Facebook отвечает
              «URL заблокирован», и по тексту ошибки непонятно, куда идти */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12.5px] text-amber-900">
            <b>Сделайте это до согласия.</b> Если пропустить, Facebook ответит
            «URL заблокирован» — он не пускает на адрес, которого нет в списке разрешённых.
          </div>

          <Copyable
            label="Адрес возврата → «Вход через Facebook» → Настройки → Допустимые URI перенаправления OAuth"
            value={st?.redirectUri || ''}
            hint="Если продукта «Вход через Facebook» в приложении нет — добавьте его, вариант «Веб»." />

          <Copyable
            label="Адрес вебхука → Webhooks → объект «Страница» → Подписаться"
            value={st?.webhookUrl || ''}
            hint={`Там же спросят маркер подтверждения — тот, что вы задали на шаге 1${st?.verifyToken ? `: ${st.verifyToken}` : ''}. После подписки включите поле leadgen.`} />

          {!connected && (
            <label className="flex items-center gap-2 mt-3.5 text-[12.5px] text-slate-700 cursor-pointer">
              <input type="checkbox" checked={urlAdded} onChange={e => setUrlAdded(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300" />
              Оба адреса внесены — можно идти дальше
            </label>
          )}
        </Step>

        {/* ── 3 ─────────────────────────────────────────────────────────────── */}
        <Step n={3} title="Согласие Meta" state={stepState(Boolean(st?.authorized), hasKeys && (urlAdded || connected))}>
          <p className="text-[12.5px] text-slate-600 mb-3">
            Проходит человек с правами администратора страницы — это может быть не вы.
            Он входит своим аккаунтом Facebook и разрешает доступ.
          </p>
          <div className="flex gap-2.5 items-center flex-wrap">
            <button onClick={startAuth} disabled={busy === 'auth' || !st?.appId}
              className="text-[12.5px] px-3.5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy === 'auth' ? 'Открываем…' : st?.authorized ? 'Пройти заново' : 'Пройти согласие'}
            </button>
            {st?.authorized && <span className="text-[12.5px] text-emerald-700">Доступ выдан</span>}
          </div>
        </Step>

        {/* ── 4 ─────────────────────────────────────────────────────────────── */}
        <Step n={4} title="Выбрать страницу" state={stepState(connected, Boolean(st?.authorized))}>
          <p className="text-[12.5px] text-slate-600 mb-3">
            Та, с которой идёт реклама. Вебхуки подпишутся сами — вручную ничего не нужно.
          </p>
          <button onClick={loadPages} disabled={busy === 'pages'}
            className="text-[12.5px] px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:border-blue-400 disabled:opacity-50">
            {busy === 'pages' ? 'Ищем…' : 'Показать страницы'}
          </button>
          {pages.length > 0 && (
            <div className="mt-2.5 border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white overflow-hidden">
              {pages.map(p => (
                <button key={p.id} onClick={() => selectPage(p.id)} disabled={busy === 'select'}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] hover:bg-blue-50 disabled:opacity-50">
                  {p.name} <span className="text-slate-400 font-mono text-[11px]">{p.id}</span>
                </button>
              ))}
            </div>
          )}
        </Step>

        {/* ── Формы ─────────────────────────────────────────────────────────── */}
        {connected && (
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div>
                <div className="text-[14px] font-semibold text-slate-800">Лид-формы и регионы</div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  Ваш выбор главнее подсказки из названия, подсказка — главнее города в заявке
                </div>
              </div>
              <button onClick={syncForms} disabled={busy === 'forms'}
                className="flex-none text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 disabled:opacity-50">
                {busy === 'forms' ? '…' : 'Обновить'}
              </button>
            </div>
            {!st?.forms?.length ? (
              <div className="px-4 py-4 text-[12.5px] text-slate-400">
                Формы не загружены — нажмите «Обновить».
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {st.forms.map(f => (
                  <div key={f.form_id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-slate-800 truncate">{f.name || f.form_id}</div>
                      <div className="text-[11.5px] text-slate-400">
                        {f.leads_count ? `${f.leads_count} заявок` : 'заявок нет'}
                        {!f.market_id && f.suggested_market && <> · подсказка: {regionName(f.suggested_market)}</>}
                        {!f.market_id && !f.suggested_market && (
                          <span className="text-amber-600"> · регион не назначен</span>
                        )}
                      </div>
                    </div>
                    <select value={f.market_id || ''} disabled={busy === 'form'}
                      onChange={e => setFormMarket(f.form_id, e.target.value)}
                      className="flex-none text-[12px] px-2 py-1.5 border border-slate-200 rounded-lg bg-white">
                      <option value="">
                        {f.suggested_market ? `подсказка — ${regionName(f.suggested_market)}` : 'по заявке'}
                      </option>
                      {REGIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {connected && (
          <div className="pt-1">
            <button onClick={disconnect} disabled={busy === 'off'}
              className="text-[12px] text-slate-400 hover:text-red-600">
              Отключить интеграцию
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
