import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/shared/services/api.service'
import { Card, Chip, Empty, Kpis, fmtDate, money, InlineField, Skeleton } from './kit'
import { useSalesRefs, optionsFor } from './refs'

/**
 * Карточка аккаунта — сквозной объект: лиды, сделки, документы, проект
 * внедрения и обращения в поддержку одного клиента в одном месте.
 *
 * Ради этого экрана модуль и живёт внутри GFSupport: в отдельной CRM половина
 * блоков была бы недоступна, а связь с перепиской и подключением пришлось бы
 * восстанавливать интеграцией.
 */

const LIFECYCLE: Record<string, [string, string]> = {
  lead: ['лид', 'gray'],
  prospect: ['в работе', 'blue'],
  customer: ['клиент', 'green'],
  churned: ['ушёл', 'red'],
}

export function SalesAccountPage({ accountId }: { accountId?: string } = {}) {
  const { id: routeId } = useParams<{ id: string }>()
  const id = accountId || routeId
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [merchant, setMerchant] = useState('')
  const refs = useSalesRefs()

  const load = useCallback(() => {
    if (!id) return
    apiGet<any>(`/sales/accounts?id=${id}`, false)
      .then(d => { setData(d); setMerchant(d.account?.merchant_id || ''); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить аккаунт'))
  }, [id])

  useEffect(() => { load() }, [load])

  const patch = async (field: string, value: string) => {
    if (!id) return
    try {
      await apiPatch('/sales/accounts', { id, fields: { [field]: value } })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось сохранить') }
  }

  /**
   * Склейка дублей: два написания одного бренда — обычное дело, когда лиды
   * приходят из разных каналов. Всё переезжает на выбранный аккаунт.
   */
  const merge = async () => {
    if (!id) return
    const term = prompt('Название аккаунта, в который склеить (часть названия):')
    if (!term) return
    try {
      const found = await apiGet<any>(`/sales/accounts?q=${encodeURIComponent(term)}&limit=10`, false)
      const options = (found.accounts || []).filter((x: any) => x.id !== id)
      if (!options.length) { setError('Аккаунт не найден'); return }
      const list = options.map((x: any, i: number) => `${i + 1}. ${x.name}${x.city ? ` · ${x.city}` : ''}`).join('\n')
      const pick = prompt(`В какой склеить «${data.account.name}»?\n\n${list}\n\nНомер:`)
      const target = options[Number(pick) - 1]
      if (!target) return
      if (!confirm(`Все сделки, лиды, контакты и документы «${data.account.name}» переедут в «${target.name}», а этот аккаунт уйдёт в архив. Продолжить?`)) return
      const res: any = await apiPost('/sales/accounts?action=merge', { from: id, into: target.id })
      alert(`Склеено: сделок ${res.moved.deals}, лидов ${res.moved.leads}, контактов ${res.moved.contacts}`)
      window.location.href = `/sales/accounts/${target.id}`
    } catch (e: any) {
      setError(e?.message || 'Не удалось склеить')
    }
  }

  const removeForever = async () => {
    if (!id) return
    if (!confirm(`Удалить «${data.account.name}» насовсем? Это нельзя отменить. Аккаунты со сделками удалить нельзя — их нужно склеивать.`)) return
    try {
      await apiDelete(`/sales/accounts?id=${id}&hard=1`)
      window.location.href = '/sales/accounts'
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить')
    }
  }

  const archive = async () => {
    if (!id) return
    if (!confirm(`Убрать «${data.account.name}» в архив? Аккаунт исчезнет из списков, сделки и чаты останутся.`)) return
    try {
      await apiDelete(`/sales/accounts?id=${id}`)
      window.location.href = '/sales/accounts'
    } catch (e: any) { setError(e?.message || 'Не удалось убрать в архив') }
  }

  const saveMerchant = async () => {
    if (!id) return
    try {
      await apiPatch('/sales/accounts', { id, fields: { merchant_id: merchant } })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось сохранить') }
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={5} />

  const a = data.account
  const isPartner = a.account_type === 'partner'
  const [lcLabel, lcTone] = LIFECYCLE[a.lifecycle] || ['—', 'gray']
  const wonAmount = (data.deals || [])
    .filter((d: any) => d.won_at)
    .reduce((s: number, d: any) => s + Number(d.monthly_amount || 0), 0)

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11.5px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
            <Link to={isPartner ? '/sales/partners' : '/sales/accounts'} className="hover:text-blue-600">
              {isPartner ? 'Партнёры' : 'Аккаунты'}
            </Link>
            <span>/</span>
            <span className="text-gray-500">{a.name}</span>
            {a.channel_id && (
              <>
                <span>·</span>
                <Link to={`/chats/${a.channel_id}`} className="text-blue-600 hover:underline">чат клиента</Link>
              </>
            )}
            {a.onboarding_brand_id && (
              <>
                <span>·</span>
                <Link to="/onboarding" className="text-blue-600 hover:underline">проект внедрения</Link>
              </>
            )}
          </div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            {a.name}
            <Chip tone={isPartner ? 'violet' : lcTone}>{isPartner ? 'партнёр' : lcLabel}</Chip>
          </h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {[a.city, a.inn ? `ИНН ${a.inn}` : null, a.owner_name ? `ведёт ${a.owner_name}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={merge} title="Перенести всё в другой аккаунт: дубли по написанию названия"
            className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            Склеить с другим
          </button>
          <button onClick={archive} title="Убрать из списков, сохранив сделки и чаты"
            className="text-[12.5px] px-3 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
            В архив
          </button>
          <button onClick={removeForever} title="Удалить насовсем — только для пустых карточек"
            className="text-[12.5px] px-3 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
            Удалить
          </button>
        </div>
      </div>

      <Kpis items={[
        ['Статус', a.first_order_at ? 'Работает' : a.onboarding_brand_id ? 'Внедрение' : 'В продаже',
          a.first_order_at ? `первый заказ ${fmtDate(a.first_order_at)}` : 'первого заказа ещё нет'],
        ['Сделок', String((data.deals || []).length),
          `${(data.deals || []).filter((d: any) => d.won_at).length} выиграно`],
        ['Подписано', money(wonAmount, 'UZS'), 'в месяц по выигранным'],
        ['Обращений', String((data.tickets || []).length), 'в поддержку'],
        [isPartner ? 'Привёл клиентов' : 'Привёл партнёр',
          isPartner ? String((data.referred || []).length) : (a.referrer_name || '—'),
          isPartner ? (a.program_name || 'программа не задана') : 'источник аккаунта'],
      ]} />

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Сделки" sub="включая допродажи на этот же аккаунт">
            {(data.deals || []).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Сделок нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.deals.map((d: any) => (
                  <Link key={d.id} to={`/sales/deals/${d.id}`}
                    className="px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-gray-50">
                    <div className="flex-1 min-w-[160px]">
                      <div className="text-[12.5px] font-medium text-gray-900">{d.title}</div>
                      <div className="text-[11px] text-gray-400">
                        {[d.stage, d.owner_name, fmtDate(d.created_at)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {d.deal_type === 'expansion' && <Chip tone="violet">допродажа</Chip>}
                    <Chip tone={d.won_at ? 'green' : d.lost_at ? 'red' : 'blue'}>
                      {d.won_at ? `выиграна ${fmtDate(d.won_at)}` : d.lost_at ? 'проиграна' : d.stage}
                    </Chip>
                    <div className="text-[12.5px] tabular-nums text-gray-900 w-32 text-right">
                      {money(d.monthly_amount, d.currency)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {isPartner && (
            <Card title="Приведённые клиенты" sub="по ним считается вознаграждение партнёра">
              {(data.referred || []).length === 0 ? (
                <div className="px-4 py-4 text-[12.5px] text-gray-400">Пока никого не привёл</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.referred.map((r: any) => (
                    <Link key={r.id} to={`/sales/accounts/${r.id}`}
                      className="px-4 py-2.5 flex justify-between items-center hover:bg-gray-50">
                      <span className="text-[12.5px] text-gray-900">{r.name}</span>
                      <span className="text-[11px] text-gray-400">
                        {LIFECYCLE[r.lifecycle]?.[0] || r.lifecycle} · {fmtDate(r.created_at)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title="Обращения в поддержку" sub="тот же чат, что вёл сейлз до продажи"
            right={a.channel_id
              ? <Link to={`/chats/${a.channel_id}`} className="text-[12px] text-blue-600 hover:underline">Открыть чат</Link>
              : <span className="text-[11px] text-gray-400">чат не привязан</span>}>
            {(data.tickets || []).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">
                {a.channel_id ? 'Обращений нет' : 'Привяжите канал, чтобы видеть историю поддержки'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.tickets.map((t: any) => (
                  <div key={t.id} className="px-4 py-2.5 flex justify-between items-center gap-3">
                    <span className="text-[12.5px] text-gray-900 flex-1">{t.title || 'Обращение'}</span>
                    <Chip tone={t.resolved_at ? 'green' : 'amber'}>{t.resolved_at ? 'решено' : t.status}</Chip>
                    <span className="text-[11px] text-gray-400">{fmtDate(t.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Документы" sub="КП, договоры и оферты по аккаунту">
            {(data.documents || []).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Документов нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.documents.map((doc: any) => (
                  <div key={doc.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                    <span className="text-[12.5px] text-gray-900 flex-1">
                      {doc.number ? `№${doc.number}` : 'без номера'} · {doc.kind}
                    </span>
                    {doc.opened_count > 0 && <Chip tone="blue">открыто {doc.opened_count}×</Chip>}
                    <span className="text-[12px] tabular-nums text-gray-600">{money(doc.total, doc.currency)}</span>
                    {doc.share_token && (
                      <a href={`/d/${doc.share_token}`} target="_blank" rel="noreferrer"
                        className="text-[12px] text-blue-600 hover:underline">открыть</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Профиль клиента" sub="значения из справочника: одно написание на всю базу">
            <div>
              <InlineField label="Название" value={a.name} onSave={v => patch('name', v)} />
              <InlineField label="Страна" value={a.country} onSave={v => patch('country', v)}
                options={optionsFor(refs, 'country')} />
              {/* Города берём по стране аккаунта, а не общим списком: в карточке
                  узбекского клиента незачем предлагать Лимассол */}
              <InlineField label="Город" value={a.city} onSave={v => patch('city', v)}
                options={optionsFor(refs, 'city', a.market_id)} />
              <InlineField label="Тип заведения" value={a.segment} onSave={v => patch('segment', v)}
                options={optionsFor(refs, 'segment')} />
              {isPartner && (
                <>
                  <InlineField label="Тип партнёра" value={a.partner_kind}
                    onSave={v => patch('partner_kind', v)} options={optionsFor(refs, 'partner_kind')} />
                  {/* Программа — ссылка на справочник, поэтому выбор, а не текст:
                      от неё считается вознаграждение партнёра */}
                  <div className="flex items-center gap-2 py-2 px-4 border-b border-dashed border-gray-100">
                    <span className="text-[12.5px] text-gray-500 flex-1">Программа</span>
                    <select
                      value={a.partner_program_id || ''}
                      onChange={e => patch('partner_program_id', e.target.value)}
                      className="border border-gray-300 rounded-md px-2 py-1 text-[12.5px] max-w-[190px]"
                    >
                      <option value="">не задана</option>
                      {(data.programs || []).map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.rate_pct ? ` · ${p.rate_pct}%` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <InlineField label="ИНН" value={a.inn} onSave={v => patch('inn', v)} />
            </div>
          </Card>

          <Card title="Связи" sub="внешние идентификаторы аккаунта">
            <div className="divide-y divide-gray-100">
              <div className="px-4 py-2.5 flex justify-between items-center gap-2">
                <span className="text-[12.5px] text-gray-500">merchant_id в админке</span>
                <div className="flex gap-1.5 items-center">
                  <input value={merchant} onChange={e => setMerchant(e.target.value)}
                    placeholder="не задан"
                    className="w-24 border border-gray-300 rounded-md px-2 py-1 text-[12px] text-right" />
                  {merchant !== (a.merchant_id || '') && (
                    <button onClick={saveMerchant} className="text-[11.5px] text-blue-600">сохранить</button>
                  )}
                </div>
              </div>
              {[['Чат клиента', a.channel_id ? 'привязан' : 'нет'],
                ['Проект внедрения', a.onboarding_brand_id ? 'привязан' : 'нет'],
                ['Территория', a.market_id || '—'],
                ['Запуск', fmtDate(a.launched_at)],
                ['Первый заказ', fmtDate(a.first_order_at)]].map(([k, v]) => (
                <div key={k} className="px-4 py-2.5 flex justify-between text-[12.5px]">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-900">{v}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 text-[11px] text-gray-400 border-t border-gray-100">
              Начисления и счета живут в админке Delever и Didox — здесь только ссылка.
            </div>
          </Card>

          <Card title="Контакты" sub="по телефону идёт склейка обращений">
            {(data.contacts || []).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Контактов нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.contacts.map((c: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex justify-between gap-3">
                    <div>
                      <div className="text-[12.5px] text-gray-900">{c.name || 'Без имени'}</div>
                      <div className="text-[11px] text-gray-400">{c.role || (c.is_primary ? 'основной' : '')}</div>
                    </div>
                    <div className="text-[12px] text-gray-600">{c.phone || c.telegram || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Обращения" sub="история лидов этого клиента">
            {(data.leads || []).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Лидов нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.leads.map((l: any) => (
                  <div key={l.id} className="px-4 py-2.5 flex justify-between items-center gap-2">
                    <div>
                      <div className="text-[12.5px] text-gray-900">{l.source || 'источник не указан'}</div>
                      <div className="text-[11px] text-gray-400">{fmtDate(l.created_at)}</div>
                    </div>
                    <Chip tone={(l.icp_score ?? 0) >= 50 ? 'green' : 'gray'}>ICP {l.icp_score ?? 0}</Chip>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </div>
  )
}

export default SalesAccountPage
