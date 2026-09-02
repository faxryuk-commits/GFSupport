import { useCallback, useEffect, useState } from 'react'
import { CallPhone } from '@/shared/ui'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { apiGet, apiPatch, apiPost } from '@/shared/services/api.service'
import { formatDateTimeShort, formatDateTimeWithTz, formatDayLabel, formatTimeHM } from '@/shared/lib/time'
import { parsePhone } from '@/shared/lib/phone'
import { Card, Chip, InlineField, Skeleton, leadStatus, slaTone, slaText } from './kit'
import { TasksCard } from './TasksCard'
import { useSalesRefs, optionsFor, getSalesRefs } from './refs'

/** Что выясняем о заведении на первом звонке — те же поля, что у сделки. */
const QUAL_FIELDS = [
  ['city', 'Город'], ['segment', 'Тип заведения'], ['points', 'Точек'],
  ['orders_per_day', 'Заказов в день'], ['pos', 'POS-система'],
  ['aggregators', 'Агрегаторы'], ['delivery_type', 'Тип доставки'],
  ['dm_name', 'ЛПР'], ['dm_role', 'Роль ЛПР'], ['pain', 'Боль клиента'],
] as const

/** Поля, где значений может быть несколько сразу. */
const MULTI_QUAL = new Set<string>(['aggregators', 'pain', 'delivery_type'])

/**
 * Карточка обращения: кто написал, откуда и что именно сказал.
 *
 * В списке видна строка с именем и обрезанным текстом, и на вопрос «что это
 * за заявка» приходилось идти в Amo или в чат. Здесь собрано то, что известно
 * на момент первого касания: заполненные человеком поля, переписка целиком,
 * работа ассистента и во что обращение вылилось.
 *
 * Открывается и панелью с доски, и отдельным адресом — ссылку на обращение
 * нужно уметь послать коллеге.
 */

interface LeadData {
  lead: any
  fields: Array<{ label: string; value: string }>
  touchpoints: Array<{ kind: string; channel: string | null; title: string | null
    detail: string | null; url: string | null; identity: string | null; happened_at: string }>
  assistant: Array<{ action: string; channel: string | null; step: number
    message: string | null; reply: string | null; status: string; error: string | null; created_at: string }>
  deals: Array<{ id: string; title: string; stage: string | null; monthly_amount: string | null
    currency: string; won_at: string | null; lost_at: string | null; created_at: string }>
  messages: Array<{ id: string; sender_name: string | null; is_from_client: boolean
    text_content: string | null; content_type: string | null; created_at: string }>
}

const KIND_LABEL: Record<string, string> = {
  form: 'заявка с формы', message: 'написал в мессенджер', comment: 'комментарий',
  call: 'звонок', email: 'письмо', manual: 'заведён вручную', other: 'канал не определён',
}

const ASSISTANT_ACTION: Record<string, string> = {
  draft: 'подготовил сообщение', sent: 'отправил сообщение',
  reply: 'получен ответ', stop: 'прогрев остановлен', skip: 'шаг пропущен',
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-3 py-1.5 px-4 border-b border-dashed border-gray-100 last:border-0">
    <span className="text-[12px] text-gray-500 w-40 flex-none">{label}</span>
    <span className="text-[12.5px] text-gray-900 break-words min-w-0">{children}</span>
  </div>
)

/**
 * Название, которое правится по клику.
 *
 * Бренд переименовывают часто: в заявке приходит «bread way», а компания
 * называется «Bread Way Bakery». Раньше это чинили только на странице
 * аккаунта — до неё надо было сначала догадаться дойти по ссылке.
 */
const Rename = ({ value, onSave, children }: {
  value: string
  onSave: (v: string) => Promise<void> | void
  children: React.ReactNode
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = async () => {
    const v = draft.trim()
    setEditing(false)
    if (v && v !== value) await onSave(v)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="border border-blue-400 rounded-md px-2 py-0.5 text-[13px] min-w-0 w-56"
      />
    )
  }

  return (
    <span className="inline-flex items-baseline gap-1.5 group/rn">
      {children}
      <button
        onClick={() => { setDraft(value); setEditing(true) }}
        title="Переименовать"
        className="flex-none text-[11px] text-gray-300 group-hover/rn:text-blue-600"
      >
        ✎
      </button>
    </span>
  )
}

const Block = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <header className="px-4 py-2.5 border-b border-gray-100">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </header>
    {children}
  </section>
)


/**
 * Названия полей приходят из формы Meta как есть: «какая_кассовая_система_у_вас»
 * с подчёркиваниями вместо пробелов. Читать это тяжело, а поправить в самой
 * форме нельзя — она принадлежит рекламному кабинету.
 */
function humanLabel(raw: string): string {
  const t = String(raw || '').replace(/_/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : raw
}

/**
 * Время в ответах формы приходит в UTC со смещением «+0000», и по нему
 * невозможно понять, в какой зоне оно записано. Переводим в рабочую и
 * подписываем зону явно, остальные значения оставляем как есть.
 */
const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([.\d]*)?(Z|[+-]\d{2}:?\d{2})?$/

function humanValue(raw: string): string {
  const v = String(raw ?? '').trim()
  if (ISO_TS.test(v)) {
    const out = formatDateTimeWithTz(v)
    if (out !== '—') return out
  }
  return v.replace(/_/g, ' ')
}

export function SalesLeadPage({ leadId }: { leadId?: string }) {
  const params = useParams()
  const id = leadId || params.id
  const [data, setData] = useState<LeadData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  // Запись разговора по uuid звонка: ссылка подписанная и короткоживущая,
  // берётся на каждое прослушивание
  const [rec, setRec] = useState<{ id: string; url: string } | null>(null)
  const [recBusy, setRecBusy] = useState<string | null>(null)
  const [reasons, setReasons] = useState<Array<{ id: string; label: string }>>([])

  const load = useCallback(() => {
    if (!id) return
    apiGet<LeadData>(`/sales/lead?id=${id}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось открыть обращение'))
  }, [id])

  useEffect(() => { load() }, [load])

  const refs = useSalesRefs()

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true)
    try {
      await apiPost(`/sales/leads?action=${action}`, { leadId: id, ...extra })
      setAsking(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Действие не выполнено')
    } finally { setBusy(false) }
  }

  // Удаление насовсем: для тестовых обращений, которые не должны попадать
  // даже в отчёт по отказам. API пускает только админа и не даёт удалить
  // лида, из которого выросла сделка
  const navigate = useNavigate()
  const remove = async () => {
    if (!window.confirm('Удалить обращение насовсем? История звонков и сообщений по нему отвяжется.')) return
    setBusy(true)
    try {
      await apiPost('/sales/leads?action=delete', { leadId: id })
      navigate('/sales/leads')
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить')
      setBusy(false)
    }
  }

  const listenRec = async (uuid: string) => {
    if (recBusy) return
    setRecBusy(uuid)
    try {
      const r = await apiPost<{ url: string }>('/sales/call?action=record', { uuid })
      if (r?.url) setRec({ id: uuid, url: r.url })
    } catch (e: any) {
      setError(e?.message || 'АТС не отдала запись')
    } finally { setRecBusy(null) }
  }

  // Бренд живёт в аккаунте, а не в обращении: переименование должно доехать
  // до компании, иначе в списках останется старое написание
  const renameAccount = async (v: string) => {
    const accountId = (data?.lead as any)?.account_id
    if (!accountId) return
    try {
      await apiPatch('/sales/accounts', { id: accountId, fields: { name: v } })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось переименовать') }
  }

  /**
   * Значение поля квалификации: сначала то, что заполнили мы, потом — то, что
   * приехало в заявке. Пустая строка в нашем слое означает «здесь пусто»
   * и намеренно перебивает старое значение из Amo.
   */
  const qual = (field: string): string => {
    const l: any = data?.lead
    const own = l?.qual?.[field]
    if (own !== undefined && own !== null) return String(own)
    if (field === 'city' && l?.city) return String(l.city)
    const fromRaw = l?.raw?.[field]
    return fromRaw === undefined || fromRaw === null ? '' : String(fromRaw)
  }

  const saveQual = async (field: string, value: string) => {
    try {
      await apiPost('/sales/leads?action=qual', { leadId: id, fields: { [field]: value } })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить')
    }
  }

  /**
   * Отказ спрашивает причину. Самый частый исход воронки уходил в тишину:
   * две с половиной тысячи отказов и ни одной причины — то есть на вопрос
   * «почему мы их теряем» ответить было нечем.
   */
  const askReason = async () => {
    setAsking(true)
    if (reasons.length) return
    try {
      const d = await getSalesRefs()
      setReasons(d.reasons || [])
    } catch { /* без справочника отказ всё равно можно оформить */ }
  }

  if (error && !data) return <div className="p-6 text-[13px] text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={5} kpis={false} />

  const l = data.lead
  const phone = parsePhone(l.phone, l.market_id)
  const open = ['new', 'assigned', 'attempting', 'nurture'].includes(l.status)

  // День разговора подписываем один раз: сплошная лента одинаковых дат
  // читается хуже, чем разговор с разделителями
  let lastDay = ''

  return (
    <div className="p-4 space-y-3">
      <header className="space-y-1.5">
        <div className="text-[11px] text-gray-400">
          <Link to="/sales/leads" className="hover:text-blue-600">Обращения</Link>
          {' / '}{l.name}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">
            <Rename value={l.name} onSave={v => act('update', { fields: { name: v } })}>
              {l.contact_name || l.name}
            </Rename>
          </h1>
          {l.contact_name && l.name !== l.contact_name && (
            <span className="text-[13px] text-gray-500">{l.name}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <Chip tone="violet">{KIND_LABEL[l.lead_kind || ''] || 'обращение'}</Chip>
          {/* Заявка из инструмента проверки Meta: настоящих данных в ней нет,
              и звонить по ней некому */}
          {l.raw?._test && <Chip tone="amber">тестовая</Chip>}
          <Chip tone={leadStatus(l.status).tone}>{leadStatus(l.status).label}</Chip>
          {l.sla_due_at && !l.first_touch_at && open && (
            <Chip tone={slaTone(l.sla_due_at)}>{slaText(l.sla_due_at)}</Chip>
          )}
          <span className="text-[11.5px] text-gray-400 tabular-nums">
            пришло {formatDateTimeShort(l.created_at)}
          </span>
        </div>
        {open && (
          <div className="flex gap-2 pt-1">
            <button disabled={busy} onClick={() => act('assign')}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:brightness-110 disabled:opacity-50">
              Беру в работу
            </button>
            {l.status !== 'nurture' && (
              <button disabled={busy} onClick={() => act('nurture')}
                className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-violet-400">
                На прогрев
              </button>
            )}
            <button disabled={busy} onClick={askReason}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 hover:border-red-400 hover:text-red-600">
              В отказ
            </button>
          </div>
        )}
        {asking && (
          <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2">
            <div className="text-[12.5px] text-gray-900">Почему не наш клиент?</div>
            <div className="flex flex-wrap gap-1.5">
              {reasons.map(r => (
                <button key={r.id} disabled={busy}
                  onClick={() => act('archive', { reasonId: r.id })}
                  className="text-[11.5px] px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700
                             hover:border-red-400 hover:text-red-600 disabled:opacity-50">
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-0.5 items-center">
              <button disabled={busy} onClick={() => act('archive')}
                className="text-[11.5px] text-gray-400 hover:text-gray-700">
                причина неизвестна
              </button>
              <button onClick={() => setAsking(false)}
                className="text-[11.5px] text-gray-400 hover:text-gray-700">отмена</button>
              <span className="flex-1" />
              <button disabled={busy} onClick={remove}
                title="Насовсем — для тестовых обращений; доступно администратору"
                className="text-[11.5px] text-red-400 hover:text-red-600">
                удалить насовсем
              </button>
            </div>
          </div>
        )}
        {error && <div className="text-[12px] text-red-600">{error}</div>}
      </header>

      {/* Следующий шаг по лиду ставится здесь же: раньше его записывали в Amo,
          потому что в карточке для этого не было ничего */}
      <TasksCard leadId={id} accountId={l.account_id || undefined} />

      {/* Квалификация нашими руками. Эти поля менеджер заполнял в Amo, а мы
          читали их из сырых данных заявки — без Amo они бы осиротели */}
      <Card title="Квалификация" sub="заполняется на звонке, правится по клику">
        <div className="grid sm:grid-cols-2">
          {QUAL_FIELDS.map(([f, label]) => (
            <InlineField key={f} label={label} value={qual(f)}
              onSave={v => saveQual(f, v)}
              options={optionsFor(refs, f, l.market_id)}
              multiple={MULTI_QUAL.has(f)} />
          ))}
        </div>
      </Card>

      <Block title="Кто обратился">
        <div>
          {l.contact_name && <Row label="Контакт">{l.contact_name}</Row>}
          <Row label="Телефон">
            {l.phone
              ? <CallPhone phone={l.phone} market={l.market_id} leadId={l.id} />
              : <span className="text-gray-400">не оставил</span>}
            {phone.valid && phone.operator && (
              <span className="text-gray-400 text-[11.5px]"> · {phone.operator}</span>
            )}
          </Row>
          {l.city && <Row label="Город">{l.city}</Row>}
          <Row label="Компания">
            {l.account_id
              ? <Rename value={l.account_name || ''} onSave={renameAccount}>
                  <Link to={`/sales/accounts/${l.account_id}`} className="text-blue-600 hover:underline">
                    {l.account_name}
                  </Link>
                </Rename>
              : <span className="text-gray-400">аккаунт не заведён</span>}
          </Row>
          {(l.instagram || l.telegram || l.website) && (
            <Row label="Профили">
              {[l.instagram, l.telegram, l.website].filter(Boolean).join(' · ')}
            </Row>
          )}
        </div>
      </Block>

      <Block title="Откуда пришло" sub="канал, кампания и метки перехода">
        <div>
          <Row label="Источник">{l.source || 'не определён'}</Row>
          {l.campaign && <Row label="Кампания">{l.campaign}</Row>}
          {l.agent_name && <Row label="Ответственный">{l.agent_name}</Row>}
          {l.icp_score !== null && l.icp_score !== undefined && (
            <Row label="Оценка соответствия">
              <span className={l.icp_score >= 50 ? 'text-emerald-700 font-semibold'
                : l.icp_score >= 20 ? 'text-amber-700' : 'text-gray-900'}>
                {l.icp_score}
              </span>
              {/* Голая цифра «0» читается как «не посчитали». Причины показывают,
                  что оценка сделана и на чём основана */}
              {Array.isArray(l.icp_reasons) && l.icp_reasons.length > 0 && (
                <span className="block text-[11.5px] text-gray-500 mt-0.5">
                  {l.icp_reasons.map((r: any) =>
                    `${r.label}${r.points ? ` (${r.points > 0 ? '+' : ''}${r.points})` : ''}`).join(' · ')}
                </span>
              )}
            </Row>
          )}
          {l.external_id && <Row label="Идентификатор">{l.external_id}</Row>}
        </div>
      </Block>

      {l.text && (
        <Block title="Что написал">
          {/* Ответы лид-формы приходят машинным видом — с подчёркиваниями
              вместо пробелов. Правим только при показе: в самой форме
              названия полей не наши, а рекламного кабинета */}
          <p className="px-4 py-3 text-[12.5px] text-gray-800 whitespace-pre-wrap">
            {String(l.text || '').split('\n').map(humanValue).join('\n')}
          </p>
        </Block>
      )}

      {data.fields.length > 0 && (
        <Block title="Что заполнил" sub="поля формы и карточки как есть">
          <div>{data.fields.map(f => (
            <Row key={f.label} label={humanLabel(f.label)}>{humanValue(f.value)}</Row>
          ))}</div>
        </Block>
      )}

      {data.messages.length > 0 && (
        <Block title="Переписка" sub={`${data.messages.length} сообщений в канале`}>
          <div className="max-h-96 overflow-y-auto p-3 space-y-1.5">
            {data.messages.map(m => {
              const day = formatDayLabel(m.created_at)
              const divider = day !== lastDay ? (lastDay = day) : null
              return (
                <div key={m.id}>
                  {divider && (
                    <div className="text-center text-[10.5px] text-gray-400 py-1">{divider}</div>
                  )}
                  <div className={`flex ${m.is_from_client ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-1.5 ${
                      m.is_from_client ? 'bg-gray-100 text-gray-900' : 'bg-blue-50 text-blue-900'}`}>
                      <div className="text-[10px] opacity-70">
                        {m.sender_name || (m.is_from_client ? 'Клиент' : 'Команда')} · {formatTimeHM(m.created_at)}
                      </div>
                      <div className="text-[12.5px] whitespace-pre-wrap break-words">
                        {m.text_content || `[${m.content_type || 'вложение'}]`}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Block>
      )}

      {data.assistant.length > 0 && (
        <Block title="Работа ассистента" sub="что и когда он написал вместо человека">
          <div>
            {data.assistant.map((a, i) => (
              <div key={i} className="px-4 py-2 border-b border-dashed border-gray-100 last:border-0">
                <div className="flex justify-between gap-2 text-[11.5px]">
                  <span className="text-gray-700">
                    {ASSISTANT_ACTION[a.action] || a.action}
                    {a.step ? ` · шаг ${a.step}` : ''}
                    {a.channel ? ` · ${a.channel}` : ''}
                  </span>
                  <span className="text-gray-400 tabular-nums flex-none">
                    {formatDateTimeShort(a.created_at)}
                  </span>
                </div>
                {a.message && <div className="text-[12px] text-gray-600 mt-0.5">«{a.message}»</div>}
                {a.reply && <div className="text-[12px] text-emerald-700 mt-0.5">ответ: «{a.reply}»</div>}
                {a.error && <div className="text-[12px] text-red-600 mt-0.5">{a.error}</div>}
              </div>
            ))}
          </div>
        </Block>
      )}

      {data.touchpoints.length > 0 && (
        <Block title="История касаний">
          <div>
            {data.touchpoints.map((t, i) => (
              <div key={i} className="flex gap-3 px-4 py-2 border-b border-dashed border-gray-100 last:border-0">
                <span className="text-[11.5px] text-gray-400 w-28 flex-none tabular-nums">
                  {formatDateTimeShort(t.happened_at)}
                </span>
                <span className="text-[12.5px] text-gray-800 min-w-0 flex-1">
                  {t.title || t.kind}
                  {t.channel && <span className="text-gray-400"> · {t.channel}</span>}
                  {t.detail && <div className="text-[11.5px] text-gray-500">{t.detail}</div>}
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer"
                       className="text-[11.5px] text-blue-600 hover:underline break-all">{t.url}</a>
                  )}
                  {t.kind === 'call' && t.identity && /^[0-9a-f-]{32,40}$/i.test(t.identity) && (
                    rec?.id === t.identity ? (
                      <audio controls autoPlay src={rec.url} className="mt-1.5 w-full h-8" />
                    ) : (
                      <button onClick={() => listenRec(t.identity!)} disabled={recBusy === t.identity}
                        className="mt-0.5 block text-[11.5px] text-emerald-700 hover:underline disabled:opacity-40">
                        {recBusy === t.identity ? 'загружаю…' : '▶ запись'}
                      </button>
                    )
                  )}
                </span>
              </div>
            ))}
          </div>
        </Block>
      )}

      {data.deals.length > 0 && (
        <Block title="Во что вылилось">
          <div>
            {data.deals.map(d => (
              <Link key={d.id} to={`/sales/deals/${d.id}`}
                className="flex justify-between gap-3 px-4 py-2 border-b border-dashed border-gray-100 last:border-0 hover:bg-gray-50">
                <span className="text-[12.5px] text-blue-600">{d.title}</span>
                <span className="text-[11.5px] text-gray-500">
                  {d.won_at ? 'выиграна' : d.lost_at ? 'проиграна' : d.stage || 'в работе'}
                  {d.monthly_amount ? ` · ${Number(d.monthly_amount).toLocaleString('ru-RU')} ${d.currency}` : ''}
                </span>
              </Link>
            ))}
          </div>
        </Block>
      )}
    </div>
  )
}

export default SalesLeadPage
