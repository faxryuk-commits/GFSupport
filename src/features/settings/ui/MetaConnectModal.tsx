import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'
import { useAuth } from '@/shared/hooks/useAuth'

/**
 * Подключение Instagram и Facebook.
 *
 * Экран разделён на два слоя намеренно, и это разные сущности с разной
 * судьбой. Настройка приложения — ключи и два адреса в консоли — делается
 * администратором один раз за всё время и свёрнута с глаз. Подключение
 * аккаунтов — обычная работа: страниц может быть несколько, они добавляются
 * и отключаются, у каждой свой Instagram и свой регион.
 *
 * Первая версия показывала все четыре шага всегда и подряд, и из неё
 * читалось, будто эти токены надо вводить каждый раз. Это неправда:
 * доступ живёт на уровне компании, а не человека, и смена подрядчика
 * ничего не ломает — если согласие проходил тот, кто в компании остаётся.
 */

type Form = {
  form_id: string; name: string | null; market_id: string | null
  suggested_market: string | null; status: string | null
  leads_count: number; last_lead_at: string | null
}

type Account = {
  id: string; pageId: string; pageName: string | null; igUsername: string | null
  marketId: string | null; subscribed: boolean; subscribeError: string | null
  connectedByName: string | null; connectedAt: string | null
}

type State = {
  accounts: Account[]
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
const ADMINS = ['admin', 'org_admin', 'cco']

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

export function MetaConnectModal({ isOpen, onClose, onChanged }: {
  isOpen: boolean; onClose: () => void; onChanged?: () => void
}) {
  const [st, setSt] = useState<State | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [setupOpen, setSetupOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { agent } = useAuth()
  const isAdmin = ADMINS.includes(String(agent?.role || ''))

  const load = useCallback(() => {
    apiGet<State>('/integrations/meta', false)
      .then(d => {
        setSt(d); setAppId(d.appId || ''); setVerifyToken(d.verifyToken || '')
        // Приложение ещё не настроено — техническая часть нужна сразу
        if (!d.appId || !d.appSecret) setSetupOpen(true)
      })
      .catch(e => setError(e?.message || 'Не удалось получить состояние'))
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

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
    setAppSecret(''); setNote('Ключи сохранены — больше их вводить не придётся')
  })

  const startAuth = (scopes?: 'base') => act('auth', async () => {
    const q = scopes ? '&scopes=base' : ''
    const r = await apiGet<{ url: string }>(`/integrations/meta?action=auth-url${q}`, false)
    window.open(r.url, '_blank', 'noopener')
    setNote('Окно Facebook открылось в новой вкладке. Разрешите доступ и вернитесь сюда.')
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
      ? `Готово: «${r.pageName}»${r.igUsername ? `, Instagram @${r.igUsername}` : ''}`
      : `Страница подключена, но подписать вебхуки не вышло: ${r.subscribeError || 'неизвестно'}`)
  })

  const syncForms = () => act('forms', async () => {
    const r = await apiPost<{ found: number }>('/integrations/meta?action=sync-forms', {})
    setNote(`Найдено форм: ${r.found}`)
  })

  const setFormMarket = (formId: string, market: string) =>
    act('form', () => apiPost('/integrations/meta?action=form-market', { formId, market: market || null }))

  const setAccountMarket = (accountId: string, market: string) =>
    act('acc', () => apiPost('/integrations/meta?action=account-market', { accountId, market: market || null }))

  const dropAccount = (a: Account) => {
    if (!confirm(`Отключить «${a.pageName || a.pageId}»? Заявки и сообщения с этой страницы перестанут приходить.`)) return
    act('acc', () => apiPost('/integrations/meta?action=disconnect', { accountId: a.id }))
  }

  const disconnect = () => {
    if (!confirm('Отключить Instagram и Facebook? Заявки с рекламы перестанут приходить.')) return
    act('off', () => apiPost('/integrations/meta?action=disconnect', {}))
  }

  const hasApp = Boolean(st?.appId && st?.appSecret)
  const accounts = st?.accounts || []
  const connected = accounts.length > 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Instagram и Facebook" size="lg">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-700">{error}</div>
        )}
        {note && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3.5 py-2.5 text-[12.5px] text-blue-800">{note}</div>
        )}

        {/* ── Подключённые аккаунты ──────────────────────────────────────────── */}
        {hasApp && (
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div>
                <div className="text-[14.5px] font-semibold text-slate-800">Аккаунты</div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  Страницы Facebook, с которых идут заявки и сообщения. Instagram приходит вместе со страницей
                </div>
              </div>
              <button onClick={() => startAuth()} disabled={busy === 'auth'}
                className="flex-none text-[12.5px] px-3 py-1.5 rounded-lg bg-blue-600 text-white
                           hover:bg-blue-700 disabled:opacity-50">
                {busy === 'auth' ? 'Открываем…' : '+ Аккаунт'}
              </button>
            </div>

            {accounts.length > 0 && (
              <div className="divide-y divide-slate-100">
                {accounts.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-start gap-3 group">
                    <span className="text-[16px] leading-none mt-0.5">{a.subscribed ? '✅' : '⚠️'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-slate-800 truncate">
                        {a.pageName || a.pageId}
                        {a.igUsername && <span className="font-normal text-slate-600"> · @{a.igUsername}</span>}
                      </div>
                      <div className="text-[11.5px] text-slate-400 mt-0.5">
                        {a.subscribed ? 'заявки и сообщения идут' : 'вебхуки не подписаны'}
                        {a.connectedByName ? ` · подключил ${a.connectedByName}` : ''}
                        {a.connectedAt ? `, ${new Date(a.connectedAt).toLocaleDateString('ru-RU')}` : ''}
                      </div>
                      {!a.subscribed && a.subscribeError && (
                        <div className="text-[11.5px] text-amber-700 mt-1">{a.subscribeError}</div>
                      )}
                    </div>
                    <select value={a.marketId || ''} disabled={busy === 'acc'}
                      onChange={e => setAccountMarket(a.id, e.target.value)}
                      title="Регион, к которому относится эта страница"
                      className="flex-none text-[12px] px-2 py-1.5 border border-slate-200 rounded-lg bg-white">
                      <option value="">регион не задан</option>
                      {REGIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                    <button onClick={() => dropAccount(a)} disabled={busy === 'acc'}
                      className="flex-none opacity-0 group-hover:opacity-100 text-[11.5px] text-slate-300 hover:text-red-600">
                      отключить
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Выбор страницы после согласия — тот же список для первого
                аккаунта и для каждого следующего */}
            {st?.authorized && (
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                <button onClick={loadPages} disabled={busy === 'pages'}
                  className="text-[12.5px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-blue-400 disabled:opacity-50">
                  {busy === 'pages' ? 'Ищем…' : accounts.length ? 'Добавить ещё страницу' : 'Показать доступные страницы'}
                </button>
                {pages.length > 0 && (
                  <div className="mt-2.5 border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white overflow-hidden">
                    {pages.map(p => {
                      const already = accounts.some(a => a.pageId === p.id)
                      return (
                        <button key={p.id} onClick={() => selectPage(p.id)} disabled={busy === 'select' || already}
                          className="w-full text-left px-3.5 py-2.5 text-[12.5px] hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent">
                          {p.name}
                          {already && <span className="text-slate-400"> · уже подключена</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {!accounts.length && (
              <div className="px-4 py-5 text-center">
                <p className="text-[13px] text-slate-600 max-w-[430px] mx-auto">
                  Ни одного аккаунта не подключено. Нажмите «+ Аккаунт» — откроется окно
                  Facebook, где нужно разрешить доступ, потом выберете страницу.
                </p>
                <div className="mt-2.5">
                  <button onClick={() => startAuth('base')} disabled={busy === 'auth'}
                    className="text-[12px] text-slate-500 hover:text-blue-600 underline decoration-dotted disabled:opacity-50">
                    Facebook пишет «Invalid Scopes» — подключить без заявок с рекламы
                  </button>
                </div>
                <div className="mt-3.5 rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12.5px] text-amber-900 text-left">
                  <b>Входите аккаунтом, который останется в компании</b> — владельца или
                  руководителя, а не подрядчика. Тогда смена таргетолога ничего не сломает:
                  доступ живёт у компании, а не у человека.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Формы и регионы ────────────────────────────────────────────────── */}
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

        {/* ── Техническая настройка: один раз за всё время, свёрнута ──────────── */}
        {isAdmin && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60">
            <button onClick={() => setSetupOpen(o => !o)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
              <span className="text-[13px]">🔧</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-slate-700">Настройка приложения Meta</div>
                <div className="text-[12px] text-slate-500">
                  {hasApp
                    ? 'Уже настроено — делается один раз за всё время'
                    : 'Нужно заполнить один раз, дальше не понадобится'}
                </div>
              </div>
              <span className="flex-none text-[12px] text-slate-400">{setupOpen ? 'скрыть' : 'открыть'}</span>
            </button>

            {setupOpen && (
              <div className="px-4 pb-4 border-t border-slate-200 pt-3.5">
                <p className="text-[12.5px] text-slate-600 mb-3">
                  Это техническая часть для администратора. Заполняется один раз и живёт
                  всегда — при смене сотрудников её трогать не нужно.
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
                  className="mt-2.5 text-[12.5px] px-3.5 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50">
                  {busy === 'creds' ? 'Сохраняем…' : 'Сохранить'}
                </button>

                <Copyable
                  label="Адрес возврата → «Вход через Facebook» → Настройки → Допустимые URI перенаправления"
                  value={st?.redirectUri || ''}
                  hint="Без него Facebook отвечает «URL заблокирован». Адрес закреплён — он не меняется от того, с какого домена открыта система." />

                <Copyable
                  label="Адрес вебхука → Webhooks → объект «Страница» → поле leadgen"
                  value={st?.webhookUrl || ''}
                  hint={`Маркер подтверждения там же${st?.verifyToken ? `: ${st.verifyToken}` : ''}.`} />

                {connected && (
                  <button onClick={disconnect} disabled={busy === 'off'}
                    className="mt-4 text-[12px] text-slate-400 hover:text-red-600">
                    Отключить интеграцию
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
