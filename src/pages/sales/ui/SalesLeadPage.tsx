import { useCallback, useEffect, useState } from 'react'
import { CallPhone } from '@/shared/ui'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { apiGet, apiPatch, apiPost } from '@/shared/services/api.service'
import { formatDateTimeShort, formatDateTimeWithTz, formatDayLabel, formatTimeHM } from '@/shared/lib/time'
import { parsePhone } from '@/shared/lib/phone'
import { Card, Chip, InlineField, OwnerPicker, Skeleton, leadStatus, slaTone, slaText, Fold, MoreMenu } from './kit'
import { CallInsight } from './CallInsight'
import { ContactsCard } from './ContactsCard'
import { TasksCard } from './TasksCard'
import { DealFeed } from './DealFeed'
import { BookMeetingModal } from './BookMeetingModal'
import { useSalesRefs, optionsFor, getSalesRefs } from './refs'

/** Что выясняем о заведении на первом звонке — те же поля, что у сделки. */
/**
 * ЛПР здесь не спрашиваем. Во-первых, кто обратился — уже видно в блоке
 * «Кто обратился» прямо ниже: имя, телефон, компания. Во-вторых, на обращении
 * про лицо, принимающее решение, знать ещё неоткуда — с человеком не говорили.
 * ЛПР появляется в сделке, и там он выбирается из контактов клиента.
 */
const QUAL_FIELDS = [
  ['city', 'Город'], ['segment', 'Тип заведения'], ['points', 'Точек'],
  ['orders_per_day', 'Заказов в день'], ['pos', 'POS-система'],
  ['aggregators', 'Агрегаторы'], ['delivery_type', 'Тип доставки'],
  ['pain', 'Боль клиента'],
] as const

/** Поля, где значений может быть несколько сразу. */
const MULTI_QUAL = new Set<string>(['aggregators', 'pain', 'delivery_type'])

/**
 * Без этих полей обращение не станет сделкой: их требует этап «Квалифицирован».
 * Пустые помечаем сразу, а не после неудачного перетаскивания — иначе человек
 * узнаёт о них, только упёршись.
 */
const GATING = new Set<string>(['points', 'orders_per_day', 'pos', 'pain'])

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
  team?: Array<{ id: string; name: string }>
  fields: Array<{ label: string; value: string }>
  touchpoints: Array<{ kind: string; channel: string | null; title: string | null
    detail: string | null; url: string | null; identity: string | null; happened_at: string }>
  assistant: Array<{ action: string; channel: string | null; step: number
    message: string | null; reply: string | null; status: string; error: string | null; created_at: string }>
  deals: Array<{ id: string; title: string; stage: string | null; monthly_amount: string | null
    currency: string; won_at: string | null; lost_at: string | null; created_at: string }>
  messages: Array<{ id: string; sender_name: string | null; is_from_client: boolean
    text_content: string | null; content_type: string | null; created_at: string }>
  /** Открытые этапы воронки рынка — для перевода в сделку сразу на нужный. */
  stages?: Array<{ id: string; key: string; label: string }>
}

const KIND_LABEL: Record<string, string> = {
  form: 'заявка с формы', message: 'написал в мессенджер', comment: 'комментарий',
  call: 'звонок', email: 'письмо', manual: 'заведён вручную', other: 'канал не определён',
}

const ASSISTANT_ACTION: Record<string, string> = {
  draft: 'подготовил сообщение', sent: 'отправил сообщение',
  reply: 'получен ответ', stop: 'прогрев остановлен', skip: 'шаг пропущен',
  // Имена действий из журнала — словами, а не кодами: «nurture_draft»
  // в карточке читал только разработчик
  nurture_draft: 'Черновик прогрева — не отправлен', nurture_sent: 'Прогрев отправлен',
  nurture_failed: 'Прогрев не ушёл', nurture_done: 'Прогрев завершён',
  handover: 'Передано человеку', qualify_sent: 'Квалификатор написал клиенту',
  qualify_reply: 'Клиент ответил квалификатору', draft_failed: 'Черновик не собрался',
}

/**
 * Импорт базы кладёт данные с Google Карт одной строкой в текст обращения:
 * «Рейтинг Google: 4.7 (43 отзывов) · Google Maps: <url> place id=<id> · адрес · сайт».
 * Читать это как текст клиента нельзя — это справка, и ей место в своём блоке.
 */
function parseMapsInfo(text: string | null | undefined): {
  rating: string | null; reviews: string | null; mapsUrl: string | null
  placeId: string | null; address: string | null; website: string | null
} | null {
  const s = String(text || '')
  if (!/Рейтинг Google/i.test(s) && !/Google Maps:/i.test(s)) return null
  const parts = s.split(' · ').map(x => x.trim())
  const rm = s.match(/Рейтинг Google:\s*([\d.,]+)\s*\((\d+)/i)
  const um = s.match(/Google Maps:\s*(https?:\/\/\S+)/i)
  const pm = s.match(/place id=(\S+)/i)
  const site = parts.find(x => /^https?:\/\//i.test(x) && !/google\./i.test(x)) || null
  const address = parts.find(x => !/^Рейтинг Google/i.test(x) && !/^Google Maps:/i.test(x) && !/^https?:\/\//i.test(x)) || null
  return { rating: rm?.[1] || null, reviews: rm?.[2] || null, mapsUrl: um?.[1] || null,
    placeId: pm?.[1] || null, address, website: site }
}

const Row = ({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) => (
  <div className="flex items-center gap-2 h-8 px-4 border-b border-gray-100 last:border-0 text-[12.5px]" title={title}>
    <span className="text-[12px] text-gray-500 w-[116px] flex-none truncate" title={label}>{label}</span>
    <span className="text-gray-900 font-medium min-w-0 text-right ml-auto truncate">{children}</span>
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

const Block = ({ title, sub, count, children }: { title: string; sub?: string; count?: React.ReactNode; children: React.ReactNode }) => (
  <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <header className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2" title={sub}>
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {count !== undefined && (
        <span className="text-[10.5px] font-medium text-gray-500 bg-white border border-gray-200 rounded-md px-1.5 py-px tabular-nums">{count}</span>
      )}
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
  // Встречу можно назначить прямо с обращения: назначенное демо и есть то,
  // из-за чего лид становится сделкой, — заставлять сначала конвертировать
  // значит ставить процесс впереди работы
  const [meetingOpen, setMeetingOpen] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    apiGet<LeadData>(`/sales/lead?id=${id}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(/404/.test(String(e?.message || ''))
        ? 'Этого обращения больше нет — его удалили или объединили с другим. Клиента ищите в воронке или в «Аккаунтах».'
        : e?.message || 'Не удалось открыть обращение'))
  }, [id])

  useEffect(() => { load() }, [load])

  const refs = useSalesRefs()

  /**
   * Перевод в сделку на выбранный этап. Раньше с карточки был только путь
   * через «Беру» на первый этап, а дальше — перетаскивание по доске; когда
   * разговор уже прошёл демо, это три лишних хода. Отказ движка (422) —
   * не поломка: показываем, чего не хватает, и остаёмся в карточке.
   */
  const convertTo = async (toStage: string) => {
    if (!toStage) return
    setBusy(true); setError('')
    try {
      const res: any = await apiPost('/sales/funnel?action=convert', { leadId: id, toStage })
      if (res?.dealId) navigate(`/sales/deals/${res.dealId}`)
      else load()
    } catch (e: any) {
      setError(e?.message || 'Переход заблокирован')
    } finally { setBusy(false) }
  }

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
      navigate('/sales/funnel')
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

  if (error && !data) return (
    <div className="p-6 space-y-3">
      <div className="text-[13px] text-gray-900">{error}</div>
      <Link to="/sales/funnel" className="inline-block text-[12.5px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-blue-400">
        В воронку
      </Link>
    </div>
  )
  if (!data) return <Skeleton rows={5} kpis={false} />

  const l = data.lead
  const phone = parsePhone(l.phone, l.market_id)
  const open = ['new', 'assigned', 'attempting', 'nurture'].includes(l.status)

  // День разговора подписываем один раз: сплошная лента одинаковых дат
  // читается хуже, чем разговор с разделителями
  let lastDay = ''

  return (
    <div className="p-4 space-y-3">
      <header className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 space-y-3">
        {/* Одна строка сути: имя, компания, статус, откуда, ответственный,
            когда пришло. Раньше — четыре строки и метки вразнобой */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight leading-tight">
            <Rename value={l.name} onSave={v => act('update', { fields: { name: v } })}>
              {l.contact_name || l.name}
            </Rename>
          </h1>
          {l.contact_name && l.name !== l.contact_name && (
            <span className="text-[12.5px] text-gray-500">{l.name}</span>
          )}
          <Chip tone={leadStatus(l.status).tone}>{leadStatus(l.status).label}</Chip>
          <Chip tone="violet">
            {[KIND_LABEL[l.lead_kind || ''] || 'обращение', l.source].filter(Boolean).join(' · ')}
          </Chip>
          {l.raw?._test && <Chip tone="amber">тестовая</Chip>}
          {l.sla_due_at && !l.first_touch_at && open && (
            <Chip tone={slaTone(l.sla_due_at)}>{slaText(l.sla_due_at)}</Chip>
          )}
          <span className="flex items-center gap-1.5 text-[11.5px] text-gray-400 ml-auto whitespace-nowrap">
            <OwnerPicker
              owner={l.agent_name ? { name: l.agent_name } : null}
              team={data.team || []}
              onPick={agentId => act('reassign', { agentId })}
              busy={busy}
            />
            <span>·</span>
            <span className="tabular-nums">пришло {formatDateTimeShort(l.created_at)}</span>
          </span>
        </div>
        {/* Один ряд действий в том же порядке, что у сделки: главное · встреча ·
            этап · позвонить · ⋯ (отказ, удаление) */}
        <div className="flex items-center gap-2 flex-wrap">
          {open && (
            <>
              <button disabled={busy} onClick={() => act('assign')}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:brightness-110 disabled:opacity-50">
                Беру в работу
              </button>
              <button disabled={busy} onClick={() => setMeetingOpen(true)}
                className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50">
                Назначить встречу
              </button>
              {(data.stages?.length || 0) > 0 && (
                <select disabled={busy} value="" onChange={e => convertTo(e.target.value)}
                  title="Перевести в сделку сразу на выбранный этап"
                  className="text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 bg-white
                             hover:border-blue-400 disabled:opacity-50">
                  <option value="">В сделку на этап…</option>
                  {data.stages!.map(s => <option key={s.id} value={s.key}>{s.label}</option>)}
                </select>
              )}
              {l.status !== 'nurture' && l.assistant_can_write && (
                <button disabled={busy} onClick={() => act('nurture')}
                  title="Ассистент напишет клиенту сам: 4 сообщения за 10 дней. Ответ клиента вернёт обращение вам"
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-violet-400 disabled:opacity-50">
                  → Ассистенту
                </button>
              )}
              {l.status === 'nurture' && (
                <button disabled={busy} onClick={() => act('dial')}
                  title="Забрать у ассистента и дозваниваться самому"
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-gray-500 disabled:opacity-50">
                  Вернуть себе
                </button>
              )}
            </>
          )}
          {l.phone && (
            <span className="text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-emerald-400">
              <CallPhone phone={l.phone} market={l.market_id} leadId={l.id} size="sm" channels />
            </span>
          )}
          <span className="flex-1" />
          <MoreMenu items={[
            open && { label: 'В отказ…', onClick: askReason, danger: true },
            { label: 'Удалить насовсем', title: 'Для тестовых и ошибочных обращений; администраторы и руководители', onClick: remove, danger: true },
          ]} />
        </div>
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

      {meetingOpen && (
        <BookMeetingModal
          leadId={id}
          guestName={l.contact_name || l.name}
          guestEmail={null}
          defaultAssigneeName={l.assigned_agent_name || null}
          onClose={() => setMeetingOpen(false)}
          onDone={load}
        />
      )}

      {/* Две колонки, как в карточке сделки: слева — кто это и что о нём
          известно, справа — общение и работа: задачи, ветка команды,
          переписка, касания. Раньше всё шло одним столбцом, и до переписки
          нужно было проскроллить три экрана */}
      <div className="grid lg:grid-cols-[1.15fr_0.95fr] gap-4 items-start">
        <div className="space-y-3 min-w-0">
        {/* Квалификация нашими руками. Эти поля менеджер заполнял в Amo, а мы
            читали их из сырых данных заявки — без Amo они бы осиротели */}
        <Card dense title="Квалификация"
          count={`${QUAL_FIELDS.filter(([f]) => { const v = qual(f); return v !== null && v !== undefined && v !== '' }).length} из ${QUAL_FIELDS.length} · для сделки нужны ${[...GATING].length}`}
          hint="Заполняется на звонке, правится по клику. Поля с точкой нужны, чтобы обращение стало сделкой">
          <div className="grid sm:grid-cols-2">
            {QUAL_FIELDS.map(([f, label]) => {
              const v = qual(f)
              const need = GATING.has(f) && (v === null || v === undefined || v === '')
              return (
                <div key={f} className={need ? 'bg-amber-50/60 border-l-2 border-amber-400' : ''}
                     title={need ? 'Без этого поля обращение не станет сделкой' : undefined}>
                  <InlineField label={need ? `${label} •` : label} value={v}
                    onSave={x => saveQual(f, x)}
                    options={optionsFor(refs, f, l.market_id)}
                    multiple={MULTI_QUAL.has(f)} />
                </div>
              )
            })}
          </div>
        </Card>

        {/* «Кто» и «откуда» — один блок в две колонки: это одна страница
            паспорта, а не два раздела */}
        <Block title="Кто и откуда">
          <div className="grid sm:grid-cols-2">
            {l.contact_name && <Row label="Контакт">{l.contact_name}</Row>}
            <Row label="Телефон" title={phone.valid && phone.operator ? phone.operator : undefined}>
              {l.phone
                ? <CallPhone phone={l.phone} market={l.market_id} leadId={l.id} size="sm" channels />
                : <span className="text-gray-400">не оставил</span>}
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
            <Row label="Источник">{l.source || 'не определён'}</Row>
            {l.campaign && <Row label="Кампания">{l.campaign}</Row>}
            {l.icp_score !== null && l.icp_score !== undefined && (
              // Причины оценки — по наведению: голая цифра «0» читается как
              // «не посчитали», а список причин в строку не помещается
              <Row label="Оценка"
                title={Array.isArray(l.icp_reasons) && l.icp_reasons.length
                  ? l.icp_reasons.map((r: any) => `${r.label}${r.points ? ` (${r.points > 0 ? '+' : ''}${r.points})` : ''}`).join(' · ')
                  : undefined}>
                <span className={l.icp_score >= 50 ? 'text-emerald-700 font-semibold'
                  : l.icp_score >= 20 ? 'text-amber-700' : 'text-gray-900'}>
                  {l.icp_score}
                </span>
                {Array.isArray(l.icp_reasons) && l.icp_reasons.length > 0 && (
                  <span className="text-[11px] text-gray-400 font-normal"> · {l.icp_reasons.length} причин ⓘ</span>
                )}
              </Row>
            )}
            {l.external_id && <Row label="Идентификатор">{l.external_id}</Row>}
          </div>
        </Block>

        {/* Дополнительные номера и люди живут у клиента: у обращения одно
            поле телефона, а у ресторана — управляющий, бухгалтер, второй номер */}
        {(() => {
          const m = parseMapsInfo(l.text)
          if (!m) return null
          return (
            <Block title="На карте" count={m.rating ? `${m.rating} · ${m.reviews || 0} отз.` : undefined}
              sub="Данные Google Карт из импорта базы">
              <div className="grid sm:grid-cols-2">
                {m.rating && <Row label="Рейтинг">{m.rating}<span className="text-gray-400 font-normal"> · {m.reviews} отзывов</span></Row>}
                {m.address && <Row label="Адрес" title={m.address}>{m.address}</Row>}
                {m.website && (
                  <Row label="Сайт"><a href={m.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{m.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></Row>
                )}
                {m.mapsUrl && (
                  <Row label="Google Maps"><a href={m.mapsUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">открыть на карте</a></Row>
                )}
              </div>
            </Block>
          )
        })()}

        {l.account_id && <ContactsCard accountId={l.account_id} market={l.market_id} />}

        {/* Редкое — свёрнуто в строки с содержимым: текст заявки, ответы
            формы и сделки не нужны при каждом открытии, а места занимали */}
        {((l.text && !parseMapsInfo(l.text)) || data.fields.length > 0 || data.deals.length > 0) && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {l.text && !parseMapsInfo(l.text) && (
              <Fold title="Что написал" sub={`«${String(l.text).replace(/\s+/g, ' ').slice(0, 90)}${l.text.length > 90 ? '…' : ''}»`}>
                {/* Ответы лид-формы приходят машинным видом — с подчёркиваниями
                    вместо пробелов. Правим только при показе */}
                <p className="px-4 py-2.5 text-[12.5px] text-gray-800 whitespace-pre-wrap">
                  {String(l.text || '').split('\n').map(humanValue).join('\n')}
                </p>
              </Fold>
            )}
            {data.fields.length > 0 && (
              <Fold title="Что заполнил" sub={`${data.fields.length} полей формы и карточки`}>
                <div className="grid sm:grid-cols-2">{data.fields.map(f => (
                  <Row key={f.label} label={humanLabel(f.label)}>{humanValue(f.value)}</Row>
                ))}</div>
              </Fold>
            )}
            {data.deals.length > 0 && (
              <Fold title="Во что вылилось" defaultOpen sub={`${data.deals.length} ${data.deals.length === 1 ? 'сделка' : 'сделки'}`}>
                {data.deals.map(d => (
                  <Link key={d.id} to={`/sales/deals/${d.id}`}
                    className="flex justify-between gap-3 px-3 h-7 items-center border-b border-gray-100 last:border-0 hover:bg-gray-50 text-[12px]">
                    <span className="text-blue-600 truncate">{d.title}</span>
                    <span className="text-[11.5px] text-gray-500 whitespace-nowrap">
                      {d.won_at ? 'выиграна' : d.lost_at ? 'проиграна' : d.stage || 'в работе'}
                      {d.monthly_amount ? ` · ${Number(d.monthly_amount).toLocaleString('ru-RU')} ${d.currency}` : ''}
                    </span>
                  </Link>
                ))}
              </Fold>
            )}
          </div>
        )}
        </div>
        <div className="space-y-3 min-w-0">
        <TasksCard leadId={id} accountId={l.account_id || undefined} />

        {/* Единая лента, как в сделке: касания, переписка и разговор команды
            одним потоком. Отдельной ветки «Команда» больше нет — внутренние
            сообщения идут здесь же с жёлтой меткой */}
        <DealFeed
          leadId={id}
          accountId={l.account_id || undefined}
          phone={l.phone}
          messages={data.messages}
          channelId={l.channel_id || undefined}
          team={data.team || []}
          onChanged={load}
        />

        {data.messages.length > 0 && (
          <Block title="Переписка" count={data.messages.length} sub="Сообщения в канале клиента">
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
          <Block title="Работа ассистента" count={data.assistant.length} sub="Что и когда ассистент написал вместо человека">
            <div>
              {data.assistant.map((a, i) => (
                <div key={i} className="px-4 py-2 border-b border-gray-100 last:border-0">
                  <div className="flex justify-between gap-2 text-[12px]">
                    <span className="text-gray-800 font-medium">
                      {ASSISTANT_ACTION[a.action] || a.action}
                      {a.step ? <span className="text-gray-400 font-normal"> · шаг {a.step} из 4</span> : null}
                      {a.channel ? <span className="text-gray-400 font-normal"> · {a.channel}</span> : null}
                    </span>
                    <span className="text-[11px] text-gray-400 tabular-nums flex-none">
                      {formatDateTimeShort(a.created_at)}
                    </span>
                  </div>
                  {a.message && <div className="text-[12px] text-gray-600 mt-0.5">«{a.message}»</div>}
                  {a.reply && <div className="text-[12px] text-emerald-700 mt-0.5">ответ: «{a.reply}»</div>}
                  {/* Причина — предупреждение, а не авария: черновик готов, отправит человек */}
                  {a.error && (
                    <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 mt-1">
                      {a.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Block>
        )}

        {/* Звонки уже в ленте — с записью, разбором и плеером. Второй раз
            показывать тот же журнал под другим именем незачем: здесь остаются
            только касания, которых в ленте нет (визиты на сайт, формы) */}
        {data.touchpoints.filter(t => t.kind !== 'call').length > 0 && (
          <Block title="Другие касания" count={data.touchpoints.filter(t => t.kind !== 'call').length}
            sub="Визиты на сайт, формы и прочее, чего нет в ленте">
            <div>
              {data.touchpoints.filter(t => t.kind !== 'call').map((t, i) => (
                <div key={i} className="flex gap-3 px-4 py-2 border-b border-gray-100 last:border-0">
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
                      <div className="mt-0.5 flex items-center gap-3 flex-wrap">
                        {rec?.id === t.identity ? (
                          <audio controls autoPlay src={rec.url} className="w-full h-8" />
                        ) : (
                          <button onClick={() => listenRec(t.identity!)} disabled={recBusy === t.identity}
                            className="text-[11.5px] text-emerald-700 hover:underline disabled:opacity-40">
                            {recBusy === t.identity ? 'загружаю…' : '▶ запись'}
                          </button>
                        )}
                        <CallInsight uuid={t.identity} />
                      </div>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        )}

        </div>
      </div>
    </div>
  )
}

export default SalesLeadPage
