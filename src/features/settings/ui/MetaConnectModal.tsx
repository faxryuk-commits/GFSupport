import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'

/**
 * Подключение Instagram и Facebook из настроек.
 *
 * Раньше доступы Meta лежали в переменных окружения Vercel: подключить канал
 * мог только разработчик и только через выкладку. А права на страницу есть
 * у совсем других людей — здесь всё делает тот, у кого они есть.
 *
 * Три шага на одном экране: ключи приложения → согласие Meta → выбор страницы.
 * Ниже — лид-формы с раскладкой по регионам.
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

function Copyable({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false)
  return (
    <div>
      <div className="text-[11.5px] text-gray-500 mb-1">{label}</div>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600) }}
        title="Нажмите, чтобы скопировать"
        className="w-full text-left font-mono text-[12px] bg-gray-50 border border-gray-200 rounded-lg
                   px-3 py-2 hover:border-blue-300 break-all">
        {value}
        <span className={`ml-2 text-[11px] ${done ? 'text-emerald-600' : 'text-gray-400'}`}>
          {done ? 'скопировано' : 'копировать'}
        </span>
      </button>
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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<State>('/integrations/meta', false)
      .then(d => {
        setSt(d)
        setAppId(d.appId || '')
        setVerifyToken(d.verifyToken || '')
      })
      .catch(e => setError(e?.message || 'Не удалось получить состояние'))
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  // Согласие открывается в отдельной вкладке — возвращаемся сюда и обновляем
  // состояние, когда человек снова смотрит на эту страницу
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
    setAppSecret('')
    setNote('Ключи сохранены')
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

  const connected = Boolean(st?.pageId)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Instagram и Facebook" size="lg">
      <div className="space-y-5 text-[13.5px]">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
        )}
        {note && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[12.5px] text-blue-800">{note}</div>
        )}

        {/* ── Шаг 1 ─────────────────────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold text-gray-900 mb-1">1. Ключи приложения Meta</h3>
          <p className="text-[12.5px] text-gray-500 mb-3">
            Берутся в консоли разработчика: Настройки приложения → Основные.
            Секрет хранится в системе и наружу не отдаётся.
          </p>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input value={appId} onChange={e => setAppId(e.target.value)}
              placeholder="ID приложения"
              className="text-[13px] px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
            <input value={appSecret} onChange={e => setAppSecret(e.target.value)} type="password"
              placeholder={st?.appSecret ? `Секрет сохранён (${st.appSecret})` : 'Секрет приложения'}
              className="text-[13px] px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
            <input value={verifyToken} onChange={e => setVerifyToken(e.target.value)}
              placeholder="Маркер подтверждения — придумайте любой"
              className="sm:col-span-2 text-[13px] px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
          </div>
          <button onClick={saveCreds} disabled={busy === 'creds' || !appId.trim()}
            className="mt-2.5 text-[12.5px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy === 'creds' ? '…' : 'Сохранить ключи'}
          </button>
        </section>

        {/* ── Два адреса для консоли Meta ────────────────────────────────────── */}
        {st && (
          <section className="grid sm:grid-cols-2 gap-2.5">
            <Copyable label="Адрес вебхука — в раздел Webhooks" value={st.webhookUrl} />
            <Copyable label="Адрес возврата — во «Вход через Facebook»" value={st.redirectUri} />
          </section>
        )}

        {/* ── Шаг 2 ─────────────────────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold text-gray-900 mb-1">2. Согласие Meta</h3>
          <p className="text-[12.5px] text-gray-500 mb-3">
            Проходит человек с правами администратора страницы — это может быть не вы.
            Он входит своим аккаунтом Facebook и разрешает доступ.
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={startAuth} disabled={busy === 'auth' || !st?.appId}
              className="text-[12.5px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {st?.authorized ? 'Пройти заново' : 'Пройти согласие'}
            </button>
            {st?.authorized && (
              <span className="text-[12px] text-emerald-700">Доступ выдан ✓</span>
            )}
          </div>
        </section>

        {/* ── Шаг 3 ─────────────────────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold text-gray-900 mb-1">3. Страница</h3>
          {connected ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-[12.5px] text-emerald-900">
              <b>{st?.pageName}</b>
              {st?.igUsername && <> · Instagram @{st.igUsername}</>}
              <div className="text-[11.5px] opacity-80 mt-0.5">
                Подключил {st?.connectedByName || '—'}
                {st?.connectedAt ? `, ${new Date(st.connectedAt).toLocaleDateString('ru-RU')}` : ''}
              </div>
            </div>
          ) : (
            <>
              <p className="text-[12.5px] text-gray-500 mb-2.5">
                Выберите страницу, с которой идёт реклама. Вебхуки подпишутся сами.
              </p>
              <button onClick={loadPages} disabled={busy === 'pages' || !st?.authorized}
                className="text-[12.5px] px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-300 disabled:opacity-50">
                {busy === 'pages' ? '…' : 'Показать страницы'}
              </button>
              {pages.length > 0 && (
                <div className="mt-2.5 border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {pages.map(p => (
                    <button key={p.id} onClick={() => selectPage(p.id)} disabled={busy === 'select'}
                      className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-blue-50 disabled:opacity-50">
                      {p.name} <span className="text-gray-400 font-mono text-[11px]">{p.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Формы и регионы ────────────────────────────────────────────────── */}
        {connected && (
          <section>
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="font-semibold text-gray-900">Лид-формы и регионы</h3>
              <button onClick={syncForms} disabled={busy === 'forms'}
                className="text-[12px] px-2.5 py-1 rounded-lg border border-gray-200 hover:border-blue-300 disabled:opacity-50">
                {busy === 'forms' ? '…' : 'Обновить список'}
              </button>
            </div>
            <p className="text-[12.5px] text-gray-500 mb-3">
              Регион берётся сначала отсюда, затем из названия формы, и только потом
              определяется по телефону и городу заявки.
            </p>
            {!st?.forms?.length ? (
              <div className="text-[12.5px] text-gray-400 py-2">
                Формы не загружены. Нажмите «Обновить список».
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {st.forms.map(f => (
                  <div key={f.form_id} className="px-3 py-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-gray-900 truncate">{f.name || f.form_id}</div>
                      <div className="text-[11px] text-gray-400">
                        {f.leads_count ? `${f.leads_count} заявок` : 'заявок нет'}
                        {!f.market_id && f.suggested_market && (
                          <> · подсказка: {regionName(f.suggested_market)}</>
                        )}
                        {!f.market_id && !f.suggested_market && (
                          <span className="text-amber-600"> · регион не назначен</span>
                        )}
                      </div>
                    </div>
                    <select value={f.market_id || ''} disabled={busy === 'form'}
                      onChange={e => setFormMarket(f.form_id, e.target.value)}
                      className="text-[12px] px-2 py-1 border border-gray-200 rounded-lg bg-white">
                      <option value="">
                        {f.suggested_market ? `по подсказке — ${regionName(f.suggested_market)}` : 'по заявке'}
                      </option>
                      {REGIONS.map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {connected && (
          <div className="pt-1">
            <button onClick={disconnect} disabled={busy === 'off'}
              className="text-[12px] text-gray-400 hover:text-red-600">
              Отключить интеграцию
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
