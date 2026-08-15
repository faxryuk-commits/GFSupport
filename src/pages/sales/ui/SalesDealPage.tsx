import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/services/api.service'
import { formatDateTimeShort } from '@/shared/lib/time'
import { useSalesRefs, optionsFor } from './refs'
import { InlineField, Skeleton } from './kit'
import { QuoteBuilder } from './QuoteBuilder'

/**
 * Карточка сделки — рабочий экран во время звонка.
 *
 * Главное здесь не форма, а критерии выхода: этап не двигается, пока не
 * заполнены поля, и система прямо говорит, каких именно не хватает. Правка
 * полей — тут же, в строке критерия, чтобы не уходить в отдельную форму.
 */

interface Stage {
  description?: string | null
  id: string
  key: string
  label: string
  kind: string
  owner_role: string
  sla_hours: number | null
  probability: number
  required_fields: string[]
}

interface DealData {
  channelId?: string | null
  messages?: Array<{
    id: string; sender_name: string | null; is_from_client: boolean
    text_content: string | null; content_type: string | null; created_at: string
  }>
  deal: any
  account: any
  stages: Stage[]
  currentStage: Stage | null
  nextStage: Stage | null
  missing: Array<{ field: string; label: string }>
  tasks: any[]
  documents: any[]
  events: any[]
  contacts: any[]
  reasons: Array<{ id: string; code: string; label: string; reactivate_days: number | null }>
  labels: Record<string, string>
}

/** Денежные поля показываем разрядами: «7 370 000», а не «7370000». */
const MONEY_FIELDS = new Set(['monthly_amount', 'onetime_amount', 'budget_stated'])

/**
 * Поля, где значений может быть несколько: ресторан работает сразу с Yandex
 * Eats и Uzum Tezkor, а в сделку берут два-три модуля. Хранится строкой через
 * запятую — так же, как приходило из Amo.
 */
const MULTI_FIELDS = new Set(['aggregators', 'products', 'pain'])

const QUAL_FIELDS = [
  ['city', 'Город'], ['segment', 'Тип заведения'], ['points', 'Точек'],
  ['orders_per_day', 'Заказов в день'], ['pos', 'POS-система'],
  ['aggregators', 'Агрегаторы'], ['delivery_type', 'Тип доставки'],
  ['dm_name', 'ЛПР'], ['dm_role', 'Роль ЛПР'], ['pain', 'Боль клиента'],
] as const

const COMMERCIAL_FIELDS = [
  ['budget_stated', 'Бюджет со слов'], ['tariff', 'Тариф'],
  ['monthly_amount', 'Подписка в месяц'], ['onetime_amount', 'Единоразово'],
  ['term_months', 'Срок, мес'], ['discount_pct', 'Скидка, %'], ['currency', 'Валюта'],
  ['valid_till', 'КП действует до'], ['expected_close_at', 'Ожидаемое закрытие'],
] as const

function money(v: any, currency = 'UZS') {
  if (v === null || v === undefined || v === '') return '—'
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`
}

/**
 * Даты показываем со временем и в одной рабочей зоне: «сегодня» и «сегодня в
 * 9:40» — разная информация, когда норматив этапа считается в часах.
 */
const fmtDate = (v: string | null) => formatDateTimeShort(v)

/**
 * Значение для календарного поля: наивная строка из базы хранит UTC, а input
 * ждёт локальное время без зоны. Показываем рабочую зону — ту же, что и везде.
 */
function toLocalInput(v: string | null): string {
  if (!v) return ''
  const ts = v.includes('Z') || v.includes('+') ? v : v + 'Z'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const tashkent = new Date(d.getTime() + 5 * 3600000)
  return tashkent.toISOString().slice(0, 16)
}

/** Быстрый срок: «завтра», «через неделю» — без ковыряния в календаре. */
function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86400000 + 5 * 3600000)
  d.setUTCHours(9, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

const Card = ({ title, sub, right, children }: any) => (
  <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <header className="px-4 py-3 border-b border-gray-100 flex justify-between items-center gap-3 flex-wrap">
      <div>
        <h3 className="text-[13.5px] font-semibold text-gray-900">{title}</h3>
        {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {right}
    </header>
    {children}
  </section>
)

export function SalesDealPage({ dealId }: { dealId?: string } = {}) {
  // id приходит либо из адреса, либо снаружи — когда карточку показывают
  // боковой панелью прямо над списком
  const { id: routeId } = useParams<{ id: string }>()
  const id = dealId || routeId
  const [data, setData] = useState<DealData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const refs = useSalesRefs()

  const load = useCallback(() => {
    if (!id) return
    apiGet<DealData>(`/sales/deal?id=${id}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить сделку'))
  }, [id])

  useEffect(() => { load() }, [load])

  const removeForever = async () => {
    if (!id) return
    if (!confirm('Удалить сделку насовсем? Это нельзя отменить. Закрытые сделки удалить нельзя — они в отчётах.')) return
    try {
      await apiDelete(`/sales/deals?id=${id}&hard=1`)
      window.location.href = '/sales/deals'
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить')
    }
  }

  const archive = async () => {
    if (!id) return
    if (!confirm('Убрать сделку в архив? Она исчезнет из списков и отчётов по воронке, но останется в истории аккаунта.')) return
    try {
      await apiDelete(`/sales/deals?id=${id}`)
      window.location.href = '/sales/deals'
    } catch (e: any) {
      setError(e?.message || 'Не удалось убрать в архив')
    }
  }

  const patch = async (field: string, value: string) => {
    if (!id) return
    try {
      await apiPatch('/sales/deal', { id, fields: { [field]: value } })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить')
    }
  }

  const advance = async () => {
    if (!id || !data?.nextStage) return
    setBusy(true); setBlocked(null)
    try {
      await apiPost('/sales/stage', { dealId: id, toStage: data.nextStage.key })
      load()
    } catch (e: any) {
      // 422 от движка — это не ошибка системы, а несоблюдённое условие
      setBlocked(e?.message || 'Переход заблокирован: не заполнены критерии выхода')
    } finally {
      setBusy(false)
    }
  }

  const lose = async (code: string) => {
    if (!id) return
    setBusy(true)
    try {
      await apiPost('/sales/stage', { dealId: id, toStage: 'lost', lostReasonCode: code })
      setLostOpen(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось закрыть сделку')
    } finally {
      setBusy(false)
    }
  }

  const publishDoc = async (docId: string) => {
    setBusy(true)
    try {
      const res = await apiPost<{ url: string }>('/sales/documents?action=publish', { id: docId })
      if (res?.url) await navigator.clipboard?.writeText(res.url).catch(() => {})
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось опубликовать')
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) {
    return <div className="p-6 text-sm text-gray-900">{error}</div>
  }
  if (!data) return <Skeleton rows={6} kpis={false} />

  const d = data.deal
  // Списки берём защищённо: карточка открывается панелью поверх доски, и один
  // неожиданный ответ сервера не должен уносить весь экран в ошибку
  const stages = data.stages || []
  const missing = data.missing || []
  const documents = data.documents || []
  const tasks = data.tasks || []
  const contacts = data.contacts || []
  const events = data.events || []
  const reasons = data.reasons || []
  const openStages = stages.filter(s => s.kind === 'open')
  const curIdx = openStages.findIndex(s => s.id === d.stage_id)
  const closed = Boolean(d.won_at || d.lost_at)

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11.5px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
            <Link to="/sales/deals" className="hover:text-blue-600">Сделки</Link>
            <span>/</span>
            <span className="text-gray-500">{data.account?.name || d.title}</span>
            {/* Переходы в соседние разделы: чат клиента и проект внедрения —
                тот же аккаунт, просто в другом модуле системы */}
            {data.account?.channel_id && (
              <>
                <span>·</span>
                <Link to={`/chats/${data.account.channel_id}`} className="text-blue-600 hover:underline">
                  чат клиента
                </Link>
              </>
            )}
            {data.account?.onboarding_brand_id && (
              <>
                <span>·</span>
                <Link to="/onboarding" className="text-blue-600 hover:underline">проект внедрения</Link>
              </>
            )}
          </div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            {data.account?.name || d.title}
            <button
              title="Переименовать сделку"
              onClick={() => {
                const next = prompt('Название сделки', d.title || '')
                if (next && next.trim() && next !== d.title) patch('title', next.trim())
              }}
              className="text-[12px] font-normal text-gray-400 hover:text-blue-600"
            >
              переименовать
            </button>
          </h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {[data.currentStage?.label, d.city, d.pos, d.points ? `${d.points} точек` : null]
              .filter(Boolean).join(' · ')}
          </p>
          {/* Возраст сделки — первое, что спрашивают на разборе: когда завели,
              когда трогали в последний раз и сколько висит на этапе */}
          <p className="text-[11.5px] text-gray-400 mt-1">
            {[
              `создана ${fmtDate(d.created_at)}`,
              d.updated_at ? `изменена ${fmtDate(d.updated_at)}` : null,
              d.stage_since ? `на этапе ${Math.floor((Date.now() - new Date(
                d.stage_since.includes('Z') ? d.stage_since : d.stage_since + 'Z').getTime()) / 86400000)} дн` : null,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-right mr-2">
            <div className="text-[17px] font-semibold text-gray-900 tabular-nums">
              {money(d.monthly_amount, d.currency)}
            </div>
            <div className="text-[11px] text-gray-400">в месяц</div>
          </div>
          {!closed && (
            <>
              <button onClick={() => setLostOpen(true)}
                className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-red-400 hover:text-red-600">
                Закрыть LOST
              </button>
              <button onClick={advance} disabled={busy}
                className="text-[12.5px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50">
                {busy ? '…' : `Двинуть этап → ${data.nextStage?.label || ''}`}
              </button>
            </>
          )}
          <button onClick={archive} title="Убрать из списков, сохранив в истории аккаунта"
            className="text-[12.5px] px-3 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
            В архив
          </button>
          <button onClick={removeForever} title="Удалить насовсем — только открытую сделку"
            className="text-[12.5px] px-3 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
            Удалить
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex gap-1 flex-wrap">
          {openStages.map((s, i) => (
            <div key={s.id}
              title={s.description || undefined}
              className={`flex-1 min-w-[72px] rounded-lg px-2 py-1.5 border cursor-help ${
                i < curIdx ? 'bg-emerald-50 border-emerald-200' :
                i === curIdx ? 'bg-blue-600 border-blue-600' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-[9px] font-bold ${i === curIdx ? 'text-white/70' : 'text-gray-400'}`}>
                {String(i).padStart(2, '0')}
              </div>
              <div className={`text-[11px] leading-tight ${
                i === curIdx ? 'text-white font-medium' : i < curIdx ? 'text-emerald-700' : 'text-gray-500'}`}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <div className="space-y-4">
          {closed ? (
            <div className={`rounded-xl border p-4 text-[13px] ${
              d.won_at ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                       : 'bg-red-50 border-red-200 text-red-800'}`}>
              {d.won_at
                ? 'Сделка выиграна. Проект внедрения создан — дальше работа в «Подключениях».'
                : `Сделка закрыта${d.reactivate_at ? `, вернётся в очередь ${fmtDate(d.reactivate_at)}` : ''}.`}
            </div>
          ) : (
            <Card
              title={`Критерии выхода → ${data.nextStage?.label || ''}`}
              sub={data.nextStage ? `владелец: ${data.nextStage.owner_role.toUpperCase()} · вероятность ${data.nextStage.probability}%` : ''}
              right={
                <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-md ${
                  missing.length ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {(data.nextStage?.required_fields?.length || 0) - missing.length} из {data.nextStage?.required_fields?.length || 0}
                </span>
              }
            >
              <div>
                {(data.nextStage?.required_fields || []).map(f => {
                  const miss = missing.find(m => m.field === f)
                  return (
                    <InlineField
                      key={f}
                      label={miss?.label || data.labels?.[f] || f}
                      value={d[f]}
                      money={MONEY_FIELDS.has(f)}
                      options={optionsFor(refs, f, d.market_id)}
                      onSave={v => patch(f, v)}
                    />
                  )
                })}
                {!data.nextStage?.required_fields?.length && (
                  <div className="px-4 py-3 text-[12.5px] text-gray-400">Для этого перехода полей не требуется</div>
                )}
              </div>
              {blocked && (
                <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">
                  {blocked}
                </div>
              )}
            </Card>
          )}

          <Card title="Квалификация" sub="заполняется на звонке, правится по клику">
            <div className="grid sm:grid-cols-2">
              {QUAL_FIELDS.map(([f, label]) => (
                <InlineField key={f} label={label} value={d[f]} onSave={v => patch(f, v)}
                  options={optionsFor(refs, f, d.market_id)}
                  multiple={MULTI_FIELDS.has(f)} />
              ))}
            </div>
          </Card>

          <Card title="Коммерческие условия" sub="то, что мы пообещали клиенту">
            <div className="grid sm:grid-cols-2">
              {COMMERCIAL_FIELDS.map(([f, label]) => (
                <InlineField key={f} label={label} value={d[f]} money={MONEY_FIELDS.has(f)}
                  onSave={v => patch(f, v)} options={optionsFor(refs, f, d.market_id)} />
              ))}
            </div>
            {Number(d.discount_pct || 0) > 15 && (
              <div className="m-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800">
                Скидка {d.discount_pct}% выше порога — переход дальше требует подтверждения фаундера.
              </div>
            )}
          </Card>

          <Card
            title="Документы"
            sub="ссылка вместо файла: видно, кто открыл и сколько читал"
            right={
              <button onClick={() => setBuilderOpen(true)}
                className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                Собрать КП
              </button>
            }
          >
            {documents.length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Документов пока нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {documents.map(doc => (
                  <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <div className="text-[12.5px] font-medium text-gray-900">
                        {doc.number ? `№${doc.number} · ` : ''}{doc.title}
                        {doc.version > 1 && <span className="text-gray-400"> · ред. {doc.version}</span>}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {money(doc.total, doc.currency)}
                        {doc.valid_till ? ` · до ${fmtDate(doc.valid_till)}` : ''}
                      </div>
                    </div>
                    {doc.opened_count > 0 && (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                        открыто {doc.opened_count}× · {Math.round((doc.read_seconds || 0) / 60)} мин
                      </span>
                    )}
                    {doc.share_token ? (
                      <a href={`/d/${doc.share_token}`} target="_blank" rel="noreferrer"
                        className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                        Открыть
                      </a>
                    ) : (
                      <button onClick={() => publishDoc(doc.id)} disabled={busy}
                        className="text-[12px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50">
                        Опубликовать и скопировать ссылку
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Следующий шаг" sub="без него сделка через 48 ч помечается брошенной">
            <div className="p-4">
              <div className={`rounded-lg px-3 py-2 text-[12.5px] ${
                d.next_step ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'}`}>
                {d.next_step || 'Не назначен'}
                {d.next_step_at && <span className="block text-[11px] opacity-80 mt-0.5">{fmtDate(d.next_step_at)}</span>}
              </div>
            </div>
            {/* Действие — из списка типовых: свободная строка означала, что
                «позвонить», «созвон» и «набрать» — три разных шага, и отчёт по
                ним не собрать. Дата — календарём, а не строкой формата */}
            <InlineField label="Что делаем" value={d.next_step} onSave={v => patch('next_step', v)}
              options={optionsFor(refs, 'next_step')} />
            <div className="flex items-center gap-2 py-2 px-4 border-b border-dashed border-gray-100">
              <span className="text-[12.5px] text-gray-500 flex-1">Когда</span>
              <input
                type="datetime-local"
                value={toLocalInput(d.next_step_at)}
                onChange={e => patch('next_step_at', e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-[12.5px]"
              />
            </div>
            <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-dashed border-gray-100">
              {[['Сегодня', 0], ['Завтра', 1], ['Через 3 дня', 3], ['Через неделю', 7]].map(([label, days]) => (
                <button key={String(label)}
                  onClick={() => patch('next_step_at', inDays(Number(days)))}
                  className="text-[11.5px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600">
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Задачи и каденция" sub="создаются автоматически при смене этапа">
            {tasks.filter(t => !t.done_at).length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Активных задач нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {tasks.filter(t => !t.done_at).map(t => (
                  <div key={t.id} className="px-4 py-2.5">
                    <div className="text-[12.5px] text-gray-900">{t.title}</div>
                    <div className="text-[11px] text-gray-400">
                      {fmtDate(t.due_at)} · {t.kind === 'cadence' ? 'каденция' : 'задача'}
                      {t.channel ? ` · ${t.channel}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Переписка рядом со сделкой: иначе диалог читают в одном месте,
              а работают в другом, и контекст теряется по дороге */}
          <Card
            title="Переписка"
            sub={data.channelId
              ? 'последние сообщения из чата клиента'
              : 'чат не привязан — привяжите канал в карточке аккаунта'}
            right={data.channelId ? (
              <Link to={`/chats/${data.channelId}`} className="text-[12px] text-blue-600 hover:underline">
                Открыть чат
              </Link>
            ) : null}
          >
            {!(data.messages || []).length ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">
                {data.channelId
                  ? 'Сообщений пока нет'
                  : 'Сообщения появятся, когда аккаунт свяжут с каналом: чат из Telegram, WhatsApp или Instagram.'}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                {(data.messages || []).map((m: any) => (
                  <div key={m.id} className="px-4 py-2">
                    <div className="flex justify-between gap-2">
                      <span className={`text-[11px] font-semibold ${
                        m.is_from_client ? 'text-blue-700' : 'text-gray-500'}`}>
                        {m.is_from_client ? (m.sender_name || 'Клиент') : (m.sender_name || 'Мы')}
                      </span>
                      <span className="text-[10.5px] text-gray-400">{fmtDate(m.created_at)}</span>
                    </div>
                    <div className="text-[12px] text-gray-800 mt-0.5">
                      {m.text_content || `[${m.content_type || 'вложение'}]`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Контакты" sub="по телефону идёт склейка обращений">
            {contacts.length === 0 ? (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Контактов нет</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {contacts.map((c, i) => (
                  <div key={i} className="px-4 py-2.5 flex justify-between gap-3">
                    <div>
                      <div className="text-[12.5px] text-gray-900">{c.name || 'Без имени'}</div>
                      <div className="text-[11px] text-gray-400">{c.role || (c.is_primary ? 'основной' : '')}</div>
                    </div>
                    <div className="text-[12px] text-gray-600 tabular-nums">{c.phone || c.telegram || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="История этапов" sub="каждое движение — событие">
            <div className="divide-y divide-gray-100">
              {events.slice(0, 8).map((e, i) => (
                <div key={i} className="px-4 py-2.5">
                  <div className="text-[12.5px] text-gray-900">
                    {e.from_stage ? `${e.from_stage} → ` : ''}{e.to_stage}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {fmtDate(e.changed_at)} · {e.changed_by || '—'}
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="px-4 py-4 text-[12.5px] text-gray-400">История пуста</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {lostOpen && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={() => setLostOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-[14px] font-semibold text-gray-900">Причина отказа</h3>
              <p className="text-[11.5px] text-gray-400 mt-0.5">
                Без причины закрыть нельзя: от неё зависит, когда сделка вернётся в работу
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {reasons.map(r => (
                <button key={r.id} onClick={() => lose(r.code)} disabled={busy}
                  className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 disabled:opacity-50">
                  <div className="text-[13px] text-gray-900">{r.label}</div>
                  <div className="text-[11px] text-gray-400">
                    {r.reactivate_days ? `вернётся через ${r.reactivate_days} дней` : 'не возвращаемся'}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-4 py-3 bg-gray-50 flex justify-end">
              <button onClick={() => setLostOpen(false)} className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {builderOpen && (
        <QuoteBuilder
          deal={d}
          onClose={() => setBuilderOpen(false)}
          onDone={() => { setBuilderOpen(false); load() }}
        />
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </div>
  )
}

export default SalesDealPage
