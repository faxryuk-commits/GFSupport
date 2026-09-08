import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CallPhone } from '@/shared/ui'
import { Link } from 'react-router-dom'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/services/api.service'
import { formatDateTimeShort, toDateInput, fromDateInput } from '@/shared/lib/time'
import { useSalesRefs, optionsFor } from './refs'
import { InlineField, OwnerPicker, Skeleton, Fold, MoreMenu, Chip, fmtDateTime } from './kit'
import { QuoteBuilder } from './QuoteBuilder'
import { EditQuoteModal } from './EditQuoteModal'
import { BookMeetingModal } from './BookMeetingModal'
import { DealFeed } from './DealFeed'
import { TeamThread } from './TeamThread'
import { PaymentsCard } from './PaymentsCard'
import { SpecCard } from './SpecCard'
import { ContactsCard } from './ContactsCard'
import { sendMessage } from '@/shared/api/messages'
import { useAuth } from '@/shared/hooks/useAuth'

/** Роли, которым сервер разрешает решать по скидке выше порога. */
const DISCOUNT_APPROVERS = ['admin', 'org_admin', 'cco', 'sales_lead']

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
  owner?: { id: string; name: string } | null
  team?: Array<{ id: string; name: string }>
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
const MULTI_FIELDS = new Set(['aggregators', 'products', 'pain', 'delivery_type'])

/**
 * Поля с датой. Вводятся календарём, а не строкой: «дата демо», набранная
 * руками, превращается в «завтра в 3» — по такой записи не построить ни
 * напоминание, ни отчёт, и критерий выхода этапа проверить тоже нечем.
 */
const DATE_FIELDS: Record<string, 'date' | 'datetime'> = {
  meeting_at: 'datetime', next_step_at: 'datetime', paid_at: 'datetime',
  valid_till: 'date', start_date: 'date', expected_close_at: 'date',
}

const QUAL_FIELDS = [
  ['city', 'Город'], ['segment', 'Тип заведения'], ['points', 'Точек'],
  ['orders_per_day', 'Заказов в день'], ['pos', 'POS-система'],
  ['aggregators', 'Агрегаторы'], ['delivery_type', 'Тип доставки'],
  ['pain', 'Боль клиента'], ['budget_stated', 'Бюджет со слов'],
] as const

/**
 * То, что решается на КП. Всё остальное отсюда убрано:
 * — «Подписка в месяц» подставляется из прайса при выборе тарифа
 *   (остаётся правимой: индивидуальная цена возможна);
 * — «Валюта» выводится из рынка и показана подписью, а не полем;
 * — «Бюджет со слов» — факт квалификации, а не наше обещание, и переехал туда;
 * — реквизиты, дата старта и первый платёж нужны после подписания
 *   и лежат в свёрнутом блоке ниже.
 */
const COMMERCIAL_FIELDS = [
  ['tariff', 'Тариф'], ['monthly_amount', 'Подписка в месяц'],
  ['term_months', 'Срок, мес'], ['discount_pct', 'Скидка, %'],
  ['onetime_amount', 'Единоразово'], ['valid_till', 'КП действует до'],
  ['start_date', 'Дата старта'],
] as const

/** Нужное после подписания — не мешает на этапе переговоров. */
// Блок «После подписания» убран целиком:
// — реквизиты живут в карточке юрлица клиента, где их десять полей, а не одно;
//   генерация договора и так берёт их оттуда, если в сделке пусто;
// — «депозит или первый платёж» дублировал «Поступления»: деньги отмечают там,
//   и теперь оплата сама проставляет факт на сделке;
// — «дата старта» переехала в коммерческие условия, где ей и место.
// «Ожидаемое закрытие» убрано: единственным его читателем был SELECT для
// списка сделок, которого больше нет. Форекаст по нему никто не строил,
// напоминаний по нему не было — поле просили заполнять впустую.

/** Поля да/нет — рендерятся одним кликом, а не текстовым вводом. */
const BOOL_FIELDS = new Set(['dm_confirmed'])

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
 * Быстрый срок: «завтра», «через неделю» — без ковыряния в календаре.
 * Девять утра именно по рабочей зоне: раньше час собирался руками через
 * setUTCHours, и «завтра» оказывалось на два часа позже обеда.
 */
function inDays(days: number): string {
  const day = toDateInput(new Date(Date.now() + days * 86400000).toISOString(), true).slice(0, 10)
  return fromDateInput(`${day}T09:00`, true)
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
  // Перевод между воронками — подтверждение внутри карточки, а не window.confirm:
  // системный диалог браузер может глушить (и тогда клик молча ничего не делает),
  // а результат перевода — сделка исчезает с текущей доски — нужно объяснить словами
  const [switchAsk, setSwitchAsk] = useState<'enterprise' | 'sales' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<string | null>(null)

  const removeDoc = async (doc: any) => {
    const warn = doc.share_token
      ? 'Удалить КП? Опубликованная ссылка у клиента перестанет открываться.'
      : 'Удалить черновик КП?'
    if (!confirm(warn)) return
    try {
      await apiDelete(`/sales/documents?id=${doc.id}`)
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось удалить') }
  }
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const refs = useSalesRefs()
  const { agent } = useAuth()
  // Проверка ролей есть и на сервере — здесь она только прячет кнопку,
  // чтобы продавец не жал то, что ему всё равно не разрешат
  const canApproveDiscount = DISCOUNT_APPROVERS.includes(String(agent?.role || ''))

  const load = useCallback(() => {
    if (!id) return
    apiGet<DealData>(`/sales/deal?id=${id}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить сделку'))
  }, [id])

  const [meetingOpen, setMeetingOpen] = useState(false)

  useEffect(() => { load() }, [load])

  const removeForever = async () => {
    if (!id) return
    if (!confirm('Удалить сделку насовсем? Это нельзя отменить. Закрытые сделки удалить нельзя — они в отчётах.')) return
    try {
      await apiDelete(`/sales/deals?id=${id}&hard=1`)
      window.location.href = '/sales/funnel'
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить')
    }
  }

  const archive = async () => {
    if (!id) return
    if (!confirm('Убрать сделку в архив? Она исчезнет из списков и отчётов по воронке, но останется в истории аккаунта.')) return
    try {
      await apiDelete(`/sales/deals?id=${id}`)
      window.location.href = '/sales/funnel'
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

  // Новая итерация продажи тому же клиенту: сделка заводится на тот же
  // account_id (дубль клиента не плодится), с квалификацией из прошлой
  // сделки — суммы и КП начинаются с чистого листа
  const repeatSale = async () => {
    if (!data) return
    const d0 = data.deal
    if (!confirm('Создать новую сделку для повторной продажи этому клиенту? Текущая останется закрытой, история сохранится.')) return
    setBusy(true)
    try {
      const res: any = await apiPost('/sales/deals', {
        title: data.account?.name || d0.title,
        accountId: d0.account_id,
        market: d0.market_id || undefined,
        city: d0.city || undefined,
        pos: d0.pos || undefined,
        points: d0.points || undefined,
        ordersPerDay: d0.orders_per_day || undefined,
        tariff: d0.tariff || undefined,
        dealType: 'repeat',
      })
      if (res?.id) window.location.href = `/sales/deals/${res.id}`
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать повторную сделку')
    } finally { setBusy(false) }
  }

  const changeOwner = async (agentId: string) => {
    setBusy(true)
    try {
      await apiPost('/sales/deal?action=owner', { id, agentId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось передать сделку')
    } finally { setBusy(false) }
  }

  /**
   * Перевод на любой этап, не только на следующий. Ход назад тоже отсюда:
   * договорённость сорвалась — сделка возвращается на «КП», а не тащится
   * по доске через три колонки. Критерии выхода проверяет движок; его отказ
   * показываем как список того, что заполнить.
   */
  const moveTo = async (toStage: string) => {
    if (!id || !toStage) return
    setBusy(true); setBlocked(null)
    try {
      await apiPost('/sales/stage', { dealId: id, toStage })
      load()
    } catch (e: any) {
      // 422 от движка — это не ошибка системы, а несоблюдённое условие
      setBlocked(e?.message || 'Переход заблокирован: не заполнены критерии выхода')
    } finally {
      setBusy(false)
    }
  }
  const advance = () => { if (data?.nextStage) moveTo(data.nextStage.key) }

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

  /**
   * Решение по скидке выше порога. Пока его нет, движок этапов не пускает
   * сделку дальше — раньше снять эту блокировку было нечем вообще.
   */
  const decideDiscount = async (ok: boolean) => {
    if (!id) return
    setBusy(true)
    try {
      await apiPost(`/sales/deal?action=${ok ? 'approve-discount' : 'reject-discount'}`, { id })
      setBlocked(null)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось изменить решение по скидке')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ответ клиенту из карточки. Уходит тем же путём, что и из раздела чатов:
   * канал сам решает, WhatsApp это, Telegram или директ. Имя автора берётся
   * из localStorage внутри sendMessage — иначе в чате появится «Support».
   */
  const sendToClient = async () => {
    const text = draft.trim()
    if (!text || !data?.channelId) return
    setSending(true); setError(null)
    try {
      await sendMessage(data.channelId, text)
      setDraft(''); setSent(true)
      setTimeout(() => setSent(false), 2500)
      load()
    } catch (e: any) {
      setError(e?.message || 'Сообщение не ушло — откройте чат и проверьте канал')
    } finally {
      setSending(false)
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
    <div className="p-4 space-y-3">
      {/* Шапка в одну строку сути и один ряд действий. Раньше — четыре
          строки текста слева, «— в месяц» и семь кнопок одинакового веса
          справа; главное, редкое и опасное стояли вперемешку */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight leading-tight truncate max-w-[40%]"
            title={data.account?.name || d.title}>
            {data.account?.name || d.title}
          </h1>
          <button
            title="Переименовать"
            onClick={async () => {
              // Заголовок показывает имя клиента (account.name), а не title
              // сделки — правим именно то, что человек видит, иначе «не работает»
              const shown = data.account?.name || d.title || ''
              const next = prompt(data.account ? 'Название клиента' : 'Название сделки', shown)
              if (!next || !next.trim() || next.trim() === shown) return
              try {
                if (data.account?.id) {
                  await apiPatch('/sales/accounts', { id: data.account.id, fields: { name: next.trim() } })
                }
                await apiPatch('/sales/deal', { id, fields: { title: next.trim() } })
                load()
              } catch (e: any) { setError(e?.message || 'Не удалось переименовать') }
            }}
            className="text-[11px] text-gray-400 hover:text-blue-600"
          >✎</button>
          {data.currentStage?.label && <Chip tone="blue">{data.currentStage.label}</Chip>}
          {[d.points ? `${d.points} точ.` : null, d.city, d.pos].filter(Boolean).length > 0 && (
            <Chip tone="gray">{[d.points ? `${d.points} точ.` : null, d.city, d.pos].filter(Boolean).join(' · ')}</Chip>
          )}
          {d.monthly_amount ? <Chip tone="green">{money(d.monthly_amount, d.currency)} / мес</Chip> : null}
          {d.stage_since && (() => {
            const n = Math.floor((Date.now() - new Date(
              d.stage_since.includes('Z') ? d.stage_since : d.stage_since + 'Z').getTime()) / 86400000)
            return <Chip tone={n > 14 ? 'red' : n > 3 ? 'amber' : 'gray'}>{n} дн на этапе</Chip>
          })()}
          <span className="flex items-center gap-1.5 text-[11.5px] text-gray-400 ml-auto whitespace-nowrap">
            <OwnerPicker owner={data.owner || null} team={data.team || []}
              onPick={agentId => changeOwner(agentId)} busy={busy} />
            <span>·</span>
            <span title={`создана ${fmtDate(d.created_at)}`}>изменена {fmtDate(d.updated_at || d.created_at)}</span>
            {data.account?.channel_id && (
              <><span>·</span><Link to={`/chats/${data.account.channel_id}`} className="text-blue-600 hover:underline">чат</Link></>
            )}
            {data.account?.onboarding_brand_id && (
              <><span>·</span><Link to="/onboarding" className="text-blue-600 hover:underline">внедрение</Link></>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!closed && data.nextStage && (
            <button onClick={advance} disabled={busy}
              className="text-[12px] px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:brightness-110 disabled:opacity-50">
              {busy ? '…' : `→ ${data.nextStage.label}`}
            </button>
          )}
          <button onClick={() => setMeetingOpen(true)}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-700">
            Назначить встречу
          </button>
          {!closed && (
            <select value={d.stage_id || ''} disabled={busy}
              onChange={e => {
                // Закрытие — тоже этап: выигрыш уходит в движок сразу,
                // проигрыш сначала спрашивает причину, без неё он не пишется
                if (e.target.value === '__won') { moveTo('won'); return }
                if (e.target.value === '__lost') { setLostOpen(true); return }
                const s = openStages.find(x => x.id === e.target.value); if (s) moveTo(s.key)
              }}
              title="Перевести на любой этап"
              className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-700
                         hover:border-blue-400 disabled:opacity-50">
              {openStages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              <option disabled>──────</option>
              <option value="__won">✓ Выиграна</option>
              <option value="__lost">✕ Проиграна…</option>
            </select>
          )}
          {contacts[0]?.phone && (
            <span className="text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-emerald-400">
              <CallPhone phone={contacts[0].phone} market={d.market_id} size="sm" />
            </span>
          )}
          <span className="flex-1" />
          <MoreMenu items={[
            {
              label: String(data?.deal?.pipeline || '').startsWith('enterprise') ? '→ Обычная воронка' : '→ Enterprise-воронка',
              title: 'Enterprise ведётся отдельной воронкой: свои этапы и нормативы',
              onClick: () => setSwitchAsk(String(data?.deal?.pipeline || '').startsWith('enterprise') ? 'sales' : 'enterprise'),
            },
            !closed && { label: 'Закрыть как проигранную…', onClick: () => setLostOpen(true), danger: true },
            { label: 'В архив', title: 'Убрать из списков, сохранив в истории аккаунта', onClick: archive },
            { label: 'Удалить насовсем', title: 'Только открытую сделку', onClick: removeForever, danger: true },
          ]} />
        </div>
        {switchAsk && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-900 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-[240px]">
              {switchAsk === 'enterprise'
                ? 'Перевести в Enterprise-воронку? Сделка встанет на этап «Разведка», нормативы этапов станут недельными. На доске она появится под переключателем «Enterprise».'
                : 'Вернуть в обычную воронку? Сделка встанет на «Квалифицирован». На доске она появится под переключателем «Продажи».'}
            </span>
            <button disabled={busy}
              onClick={async () => {
                setBusy(true); setError(null)
                try {
                  const r: any = await apiPost('/sales/deals?action=set-type', { id, type: switchAsk })
                  setSwitchAsk(null)
                  setNotice(switchAsk === 'enterprise'
                    ? `Переведена в Enterprise-воронку, этап «${r?.stage || 'Разведка'}». На доске — переключатель «Enterprise».`
                    : `Возвращена в обычную воронку, этап «${r?.stage || 'Квалифицирован'}». На доске — переключатель «Продажи».`)
                  load()
                } catch (e: any) { setError(e?.message || 'Не удалось перевести') }
                finally { setBusy(false) }
              }}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
              {busy ? '…' : 'Перевести'}
            </button>
            <button onClick={() => setSwitchAsk(null)} className="text-[12px] text-violet-700 hover:underline">Отмена</button>
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 flex items-center gap-3">
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-emerald-700 font-semibold">Понятно</button>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-700 font-semibold">Понятно</button>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-1.5">
        <div className="flex gap-1 flex-wrap">
          {openStages.map((s, i) => (
            <button key={s.id} type="button"
              disabled={busy || closed || i === curIdx}
              onClick={() => moveTo(s.key)}
              title={s.description ? `${s.description}\n\nНажмите, чтобы перевести` : 'Нажмите, чтобы перевести'}
              className={`flex-1 min-w-[72px] rounded-md px-2.5 py-1.5 border text-left transition-colors flex items-center gap-1.5 ${
                i < curIdx ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400' :
                i === curIdx ? 'bg-blue-600 border-blue-600 cursor-default shadow-sm' : 'bg-white border-gray-200 hover:border-blue-400'}
                disabled:opacity-100`}>
              <span className={`text-[10px] font-bold w-4 flex-none ${
                i === curIdx ? 'text-white/70' : i < curIdx ? 'text-emerald-600' : 'text-gray-400'}`}>
                {i < curIdx ? '✓' : String(i + 1).padStart(2, '0')}
              </span>
              <span className={`text-[11.5px] leading-tight truncate ${
                i === curIdx ? 'text-white font-semibold' : i < curIdx ? 'text-emerald-800' : 'text-gray-600'}`}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Скидка выше порога: пока решения нет, движок этапов не пускает сделку
          дальше. Показываем всем, но решают только руководители */}
      {d.approval_state === 'pending' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-[13px] text-amber-900 flex-1 min-w-[240px]">
            <b>Скидка {d.discount_pct}% ждёт решения.</b>{' '}
            {canApproveDiscount
              ? 'Сделка не двинется по этапам, пока вы не подтвердите условия.'
              : 'Сделка не двинется по этапам — попросите руководителя подтвердить.'}
          </div>
          {canApproveDiscount && (
            <div className="flex gap-2">
              <button onClick={() => decideDiscount(true)} disabled={busy}
                className="text-[12.5px] px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                Подтвердить скидку
              </button>
              <button onClick={() => decideDiscount(false)} disabled={busy}
                className="text-[12.5px] px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                Отклонить
              </button>
            </div>
          )}
        </div>
      )}
      {d.approval_state === 'rejected' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          <b>Скидка {d.discount_pct}% отклонена.</b> Измените коммерческие условия — после правки
          скидки решение запросится заново.
        </div>
      )}
      {d.approval_state === 'approved' && Number(d.discount_pct || 0) > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[12.5px] text-emerald-800">
          Скидка {d.discount_pct}% подтверждена руководителем.
        </div>
      )}

      {/* Правая колонка почти равна левой: там лента, встречи и ветка
          команды — то, ради чего карточку открывают, а не справочные поля */}
      <div className="grid lg:grid-cols-[1.15fr_0.95fr] gap-3 items-start">
        {/* min-w-0 обязателен: без него колонка сетки не ужимается под
            содержимое с nowrap и выталкивает правую за край окна */}
        <div className="space-y-3 min-w-0">
          {closed ? (
            <div className={`rounded-xl border p-4 text-[13px] flex items-center justify-between gap-3 flex-wrap ${
              d.won_at ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                       : 'bg-red-50 border-red-200 text-red-800'}`}>
              <span>
                {d.won_at
                  ? 'Сделка выиграна. Проект внедрения создан — дальше работа в «Подключениях».'
                  : `Сделка закрыта${d.reactivate_at ? `, вернётся в очередь ${fmtDate(d.reactivate_at)}` : ''}.`}
              </span>
              {/* Повторная продажа — НОВАЯ сделка на том же клиенте: история
                  старой не трогается, отчёты не портятся. Возврат этой же
                  сделки в работу — отдельный жест, кнопкой «Двинуть этап» */}
              <button onClick={repeatSale} disabled={busy}
                className="text-[12.5px] px-3 py-1.5 rounded-lg bg-white border border-current
                           font-medium hover:brightness-95 disabled:opacity-50 flex-none">
                🔁 Повторная продажа
              </button>
            </div>
          ) : (
            <>
              {/* Критерии — одной строкой и только когда есть что сказать:
                  пустая коробка «полей не требуется» занимала место зря */}
              {(data.nextStage?.required_fields?.length || 0) > 0 && (
                <div className={`rounded-xl border px-3 py-2 text-[12px] flex items-center gap-2 flex-wrap ${
                  missing.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                  <span className="font-semibold whitespace-nowrap">
                    → {data.nextStage?.label}: {missing.length ? 'не хватает' : 'всё заполнено'}
                  </span>
                  {missing.map(m => m.field === 'legal_name' && data.account?.id ? (
                    // Реквизиты заполняются в карточке клиента — ведём туда,
                    // а не оставляем искать поле, которого в сделке нет
                    <Link key={m.field} to={`/sales/accounts/${data.account.id}`}
                      title="Реквизиты юрлица заполняются в карточке клиента; договор соберётся из них"
                      className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-amber-300 text-amber-900 hover:border-blue-400 hover:text-blue-700">
                      Реквизиты → карточка клиента
                    </Link>
                  ) : (
                    <span key={m.field} className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-amber-200 text-amber-900">
                      {m.label || data.labels?.[m.field] || m.field}
                    </span>
                  ))}
                  <span className="ml-auto text-[11px] opacity-70 tabular-nums">
                    {(data.nextStage?.required_fields?.length || 0) - missing.length} из {data.nextStage?.required_fields?.length || 0}
                  </span>
                </div>
              )}
              {blocked && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">
                  {blocked}
                  {/* Блокер про состав — приводим человека прямо к блоку */}
                  {/Состав(а)? подключения/i.test(blocked) && (
                    <button
                      onClick={() => document.getElementById('spec-block')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                      className="block mt-1.5 text-[12px] font-semibold text-red-700 underline underline-offset-2">
                      Перейти к составу подключения ↓
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <Card dense title="Квалификация"
            count={`${QUAL_FIELDS.filter(([f]) => d[f] !== null && d[f] !== undefined && d[f] !== '').length} из ${QUAL_FIELDS.length}`}
            hint="Заполняется на звонке, правится по клику"
            right={
              // ЛПР — это контакт клиента, а не три отдельных поля: имя, роль
              // и телефон уже хранятся у контакта
              <span className="flex items-center gap-1.5 text-[11.5px] text-gray-500">
                <span>ЛПР</span>
                {contacts.length === 0 ? (
                  <span className="text-gray-400">добавьте контакт ниже</span>
                ) : (
                  <select
                    value={d.dm_contact_id || ''}
                    onChange={e => patch('dm_contact_id', e.target.value)}
                    className="border border-gray-200 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-gray-800 max-w-[220px]"
                  >
                    <option value="">не выбран</option>
                    {contacts.filter((c: any) => c.id).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {[c.name, c.role].filter(Boolean).join(' · ') || c.phone}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            }>
            <div className="grid sm:grid-cols-2">
              {QUAL_FIELDS.map(([f, label]) => (
                <InlineField key={f} label={label} value={d[f]} onSave={v => patch(f, v)}
                  options={optionsFor(refs, f, d.market_id)} when={DATE_FIELDS[f]}
                  multiple={MULTI_FIELDS.has(f)} bool={BOOL_FIELDS.has(f)} />
              ))}
            </div>
          </Card>

          {/* Контакты клиента: второй номер, бухгалтер, почта. Блок был
              импортирован, но не выведен — «добавьте контакт ниже» вело в пустоту */}
          {data.account?.id && <ContactsCard accountId={data.account.id} market={d.market_id} />}

          <Card dense title="Коммерческие условия"
            count={`${COMMERCIAL_FIELDS.filter(([f]) => d[f] !== null && d[f] !== undefined && d[f] !== '').length} из ${COMMERCIAL_FIELDS.length} · ${d.currency || 'UZS'}`}
            hint="То, что мы пообещали клиенту"
            right={
              <button onClick={() => setBuilderOpen(true)}
                className="text-[11.5px] px-2.5 py-1 border border-gray-300 rounded-md hover:border-blue-500 hover:text-blue-600">
                Собрать КП
              </button>
            }>
            <div className="grid sm:grid-cols-2">
              {COMMERCIAL_FIELDS.map(([f, label]) => (
                <InlineField key={f} label={label} value={d[f]} money={MONEY_FIELDS.has(f)}
                  onSave={v => patch(f, v)} when={DATE_FIELDS[f]}
                  options={optionsFor(refs, f, d.market_id)} />
              ))}
            </div>
            {Number(d.discount_pct || 0) > 15 && (
              <div className="m-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800">
                Скидка {d.discount_pct}% выше порога — переход дальше требует подтверждения фаундера.
              </div>
            )}
          </Card>



          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <Fold title="Документы" defaultOpen={documents.length > 0}
            sub={documents.length ? `${documents.length} · ссылка вместо файла: видно, кто открыл и сколько читал` : 'пока нет'}>
            {documents.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-gray-400">Документов пока нет — «Собрать КП» в условиях выше</div>
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
                      <a href={`/d/${doc.share_token}?staff=1`} target="_blank" rel="noreferrer"
                        title="Свой просмотр в статистику не попадёт"
                        className="text-[12px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                        Открыть
                      </a>
                    ) : (
                      <button onClick={() => publishDoc(doc.id)} disabled={busy}
                        className="text-[12px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:brightness-110 disabled:opacity-50">
                        Опубликовать и скопировать ссылку
                      </button>
                    )}
                    <button onClick={() => setEditingDoc(doc.id)}
                      title="Изменить строки, цены и срок действия"
                      className="text-[12px] px-2.5 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600">
                      Изменить
                    </button>
                    <button onClick={() => removeDoc(doc)}
                      title={doc.share_token ? 'Удалить: ссылка у клиента перестанет открываться' : 'Удалить черновик'}
                      className="text-[12px] px-2.5 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:border-red-300 hover:text-red-600">
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Fold>
          </div>

          {/* Редкое — ниже основного: ТЗ нужно к моменту КП, поступления —
              после подписания. Оба сами по себе свёрнуты */}
          {id && <div id="spec-block"><SpecCard dealId={id} /></div>}
          {id && <PaymentsCard dealId={id} canManage={(data.team || []).length > 0} />}
        </div>

        <div className="space-y-3 min-w-0">
          <Card dense title="Следующий шаг" hint="Без него сделка через 48 ч помечается брошенной">
            {/* Панель состояния — первое, что видно справа: есть шаг или нет.
                Одной строкой в заголовке это терялось */}
            <div className={`mx-4 mt-3 mb-1 rounded-lg px-3 py-2 text-[13px] font-semibold ${
              d.next_step ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'}`}>
              {d.next_step || 'Шаг не назначен'}
              {d.next_step_at && <span className="ml-2 text-[11.5px] font-normal opacity-80">{fmtDateTime(d.next_step_at)}</span>}
            </div>
            {/* Действие — из списка типовых: свободная строка означала, что
                «позвонить», «созвон» и «набрать» — три разных шага, и отчёт по
                ним не собрать. Дата — календарём, а не строкой формата */}
            <InlineField label="Что делаем" value={d.next_step} onSave={v => patch('next_step', v)}
              options={optionsFor(refs, 'next_step')} />
            <div className="flex items-center gap-2 h-8 px-4 border-b border-gray-100">
              <span className="text-[12px] text-gray-500 w-[116px] flex-none">Когда</span>
              <span className="flex-1" />
              {/* Показывали в рабочей зоне, а сохраняли выбранное как есть —
                  время уезжало вперёд на пять часов при каждой правке */}
              <input
                type="datetime-local"
                value={toDateInput(d.next_step_at, true)}
                onChange={e => patch('next_step_at', fromDateInput(e.target.value, true))}
                className="border border-gray-300 rounded-md px-1.5 py-0.5 text-[11.5px]"
              />
            </div>
            <div className="px-4 py-2 flex flex-wrap gap-1.5">
              {[['Сегодня', 0], ['Завтра', 1], ['Через 3 дня', 3], ['Через неделю', 7]].map(([label, days]) => (
                <button key={String(label)}
                  onClick={() => patch('next_step_at', inDays(Number(days)))}
                  className="text-[11.5px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600">
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* Встреча — одной строкой: есть дата — видно когда, нет — кнопка.
              Кнопка-сирота в правой колонке была третьим местом для одного действия */}
          <Card dense title="Встречи">
            <div className="flex items-center gap-2 h-9 px-4 text-[12.5px]">
              {d.meeting_at ? (
                <span className="text-blue-700 font-medium">📅 {fmtDateTime(d.meeting_at)}</span>
              ) : (
                <span className="text-gray-400">не назначена</span>
              )}
              <span className="flex-1" />
              <button onClick={() => setMeetingOpen(true)} className="text-[11.5px] text-blue-600 hover:underline">
                {d.meeting_at ? 'ещё одну' : 'Назначить'}
              </button>
            </div>
          </Card>


          {meetingOpen && (
            <BookMeetingModal
              dealId={id}
              guestName={contacts[0]?.name || null}
              guestEmail={contacts[0]?.email || null}
              team={data.team || []}
              defaultAssigneeId={data.owner?.id || null}
              defaultAssigneeName={data.owner?.name || null}
              onClose={() => setMeetingOpen(false)}
              onDone={load}
            />
          )}

          {/* ТЗ собирается по ходу продажи: на финише сейлз хочет закрыть
              сделку, а не заполнять анкету, и форма превращается в «уточним» */}


          {/* Единая лента вместо четырёх блоков: задачи, касания, переписка
              и движения по этапам — один поток. Порядок событий и есть
              история сделки, и читаться она должна сверху вниз */}
          <DealFeed
            dealId={id}
            accountId={data.account?.id}
            messages={data.messages}
            tasks={tasks}
            events={events}
            channelId={data.channelId}
            onChanged={load}
          />

          {/* Разговор о клиенте между своими — при карточке, а не в Telegram.
              Свёрнут, пока не нужен: пустая ветка занимала полэкрана */}
          {/* Без overflow-hidden: подсказка @имя раскрывается вверх и резалась рамкой */}
          <div className="bg-white border border-gray-200 rounded-xl">
            <Fold title="Команда" sub="внутреннее — клиент не видит · @имя зовёт коллегу">
              <TeamThread dealId={id} accountId={data.account?.id} team={data.team || []} embedded />
            </Fold>
          </div>

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

      {editingDoc && (
        <EditQuoteModal docId={editingDoc} onClose={() => setEditingDoc(null)} onSaved={() => load()} />
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
