import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiPatch } from '@/shared/services/api.service'
import { Chip, PageShell, Skeleton, money, moneyList, fmtDateTime, slaTone, slaText,
         useAutoRefresh, Drawer, FilterBar , workMorningIn } from './kit'
import { RegionBadge, useRegion } from './region'
import { parsePhone } from '@/shared/lib/phone'
import { SalesDealPage } from './SalesDealPage'
import { SalesLeadPage } from './SalesLeadPage'

/**
 * Единая воронка: обращения и сделки на одном экране.
 *
 * Слева очередь реакции, справа процесс продажи, между ними — граница
 * квалификации. Разрезать этот путь на два раздела было нашим техническим
 * удобством: сейлз ведёт клиента от первого сообщения до денег и не должен
 * переключать экраны посреди дороги.
 *
 * Обращение и сделка остаются разными сущностями: у первого норматив в
 * 15 минут и решение «наш ли клиент», у второй — этапы, критерии и деньги.
 * Поэтому и карточки разные, и правила перетаскивания разные.
 */

interface Lead {
  id: string; name: string; contact_name: string | null; phone: string | null
  city: string | null; status: string; icp_score: number | null
  sla_due_at: string | null; first_touch_at: string | null; created_at: string
  text: string | null; lead_kind: string | null; source: string | null
  agent_name: string | null; nurture_step: number | null; nurture_next_at: string | null
}

interface Deal {
  id: string; title: string; account: string | null; monthly_amount: string | null
  currency: string; city: string | null; pos: string | null; points: number | null
  orders_per_day: string | null; tariff: string | null; next_step: string | null
  next_step_at: string | null; stage_since: string; stalled_at: string | null
  updated_at: string | null; owner_name: string | null; phone: string | null
  doc_opens: number | null; stage_key: string
  won_at?: string | null; lost_at?: string | null; lost_reason?: string | null
}

interface FunnelData {
  leadColumns: Array<{ key: string; label: string; hint: string; total: number }>
  leads: Lead[]
  stages: Array<{ key: string; label: string; description: string | null; sla_hours: string | null; total: number; amounts: Record<string, string> }>
  deals: Deal[]
  closed: Array<{ key: string; label: string; kind: string; total: number; last30: number; amounts30: Record<string, string> }>
  totals: { open_deals?: number; pipeline_amounts?: Record<string, string>; no_next_step?: number }
  owners: Array<{ id: string; name: string }>
}

const KIND_LABEL: Record<string, string> = {
  form: 'форма', message: 'мессенджер', comment: 'комментарий',
  call: 'звонок', email: 'письмо', manual: 'вручную', other: 'канал неизвестен',
}

function days(iso: string | null): number {
  if (!iso) return 0
  const ts = iso.includes('Z') || iso.includes('+') ? iso : `${iso}Z`
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
}

export function SalesFunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const region = useRegion('funnel')

  // Что тащим: обращение или сделка — правила перехода у них разные
  // Сколько карточек показываем в колонке. Счётчик внизу был просто текстом:
  // «показано 15 из 142» — и посмотреть остальное было нельзя ничем
  const [perColumn, setPerColumn] = useState(15)
  const [drag, setDrag] = useState<{ kind: 'lead' | 'deal'; id: string; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const p = new URLSearchParams({ perColumn: String(perColumn), region: region || 'all' })
    if (owner) p.set('owner', owner)
    if (q) p.set('q', q)
    const my = ++reqRef.current
    apiGet<FunnelData>(`/sales/funnel?${p.toString()}`, false)
      .then(d => { if (my === reqRef.current) { setData(d); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить воронку'))
  }, [owner, q, region, perColumn])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useAutoRefresh(load, 30000)

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  /** Обращение внутри зоны входа: смена статуса, а не этапа. */
  const moveLead = async (leadId: string, to: string) => {
    setBusy(leadId)
    try {
      if (to === 'new') await apiPost('/sales/leads?action=restore', { leadId })
      else if (to === 'nurture') await apiPost('/sales/leads?action=nurture', { leadId })
      else if (to === 'attempting') await apiPost('/sales/leads?action=dial', { leadId })
      else await apiPost('/sales/leads?action=assign', { leadId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось перенести обращение')
    } finally { setBusy(null) }
  }

  /** Пересечение границы: обращение становится сделкой на выбранном этапе. */
  const convert = async (leadId: string, toStage: string) => {
    setBusy(leadId)
    try {
      const res: any = await apiPost('/sales/funnel?action=convert', { leadId, toStage })
      load()
      if (res?.dealId) setOpenDeal(res.dealId)
    } catch (e: any) {
      // 422 движка — не поломка, а несоблюдённое условие этапа
      setError(e?.message || 'Переход заблокирован')
    } finally { setBusy(null) }
  }

  const moveDeal = async (dealId: string, toStage: string) => {
    setBusy(dealId)
    try {
      await apiPost('/sales/stage', { dealId, toStage })
      load()
    } catch (e: any) {
      setError(e?.message || 'Переход заблокирован')
    } finally { setBusy(null) }
  }

  const planStep = async (dealId: string) => {
    setBusy(dealId)
    try {
      await apiPatch('/sales/deal', {
        id: dealId,
        fields: { next_step: 'Позвонить', next_step_at: workMorningIn(1) },
      })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось назначить шаг')
    } finally { setBusy(null) }
  }

  const drop = (target: string, zone: 'lead' | 'deal' | 'closed') => {
    if (!drag) return
    const { kind, id, from } = drag
    setDrag(null)
    setOver(null)
    if (from === target) return

    if (zone === 'lead') {
      if (kind === 'lead') moveLead(id, target)
      else setError('Сделку нельзя вернуть в обращения — закройте её отказом')
      return
    }
    if (zone === 'closed') {
      if (kind === 'deal') moveDeal(id, target)
      else setError('Сначала возьмите обращение в работу')
      return
    }
    if (kind === 'lead') convert(id, target)
    else moveDeal(id, target)
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={6} />

  const t = data.totals || {}
  const leadsIn = (status: string) => data.leads.filter(l => l.status === status)
  const dealsIn = (key: string) => data.deals.filter(d => d.stage_key === key)
  const zoneCls = (active: boolean, tone: 'lead' | 'deal') =>
    active
      ? tone === 'lead' ? 'border-violet-400 ring-2 ring-violet-100' : 'border-blue-500 ring-2 ring-blue-100'
      : 'border-gray-200'

  return (
    <PageShell fill header={
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-[18px] font-semibold text-gray-900 tracking-tight">Воронка</h1>
          <div className="flex items-center gap-3 text-[11.5px] text-gray-500 flex-wrap">
            <span>обращений <b className="text-gray-900">
              {data.leadColumns.reduce((s, c) => s + c.total, 0)}
            </b></span>
            <span>сделок <b className="text-gray-900">{t.open_deals ?? 0}</b></span>
            <span>на <b className="text-gray-900">{moneyList(t.pipeline_amounts, '—')}</b> в месяц</span>
            {t.no_next_step ? <span>без следующего шага <b className="text-amber-600">{t.no_next_step}</b></span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RegionBadge scope="funnel" />
        </div>
      </div>
    }>

      <div className="bg-white border border-gray-200 rounded-xl flex-none">
        <FilterBar
          active={[q && `поиск: ${q}`, owner && 'сейлз'].filter(Boolean) as string[]}
          right={<span className="text-[11.5px] text-gray-400 ml-auto">
            обновляется само · перетаскивание работает сквозь границу
          </span>}
        >
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Бренд, имя или телефон"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-56" />
          <select value={owner} onChange={e => setOwner(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px]">
            <option value="">Все сейлзы</option>
            {data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </FilterBar>
      </div>

      <div className="flex-1 min-h-0 flex gap-2.5 overflow-x-auto items-stretch pb-2">
        {/* ─── Зона входа: обращения ─────────────────────────────── */}
        <div className="flex gap-2.5 p-2 rounded-xl bg-violet-50/60 border border-dashed border-violet-200 flex-none">
          {data.leadColumns.map(col => (
            <section
              key={col.key}
              onDragOver={e => { e.preventDefault(); setOver(col.key) }}
              onDragLeave={() => setOver(o => (o === col.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(col.key, 'lead') }}
              className={`flex-none w-[212px] bg-white border rounded-lg flex flex-col
                          transition-colors ${zoneCls(over === col.key, 'lead')}`}
            >
              <header className="px-2.5 py-2 border-b border-gray-100">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">{col.label}</span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{col.total}</span>
                </div>
                <div className="text-[10.5px] text-gray-400">{col.hint}</div>
              </header>
              <div className="p-2 flex flex-col gap-2 overflow-y-auto">
                {leadsIn(col.key).map(l => {
                  const phone = parsePhone(l.phone)
                  return (
                    <article
                      key={l.id}
                      draggable
                      onDragStart={() => setDrag({ kind: 'lead', id: l.id, from: col.key })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      className={`bg-white border border-gray-200 border-l-[3px] border-l-violet-500 rounded-lg
                                  p-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-all
                                  ${drag?.id === l.id ? 'opacity-30' : ''}`}
                    >
                      {/* Имя — вход в карточку: «кто это и что просит» нельзя
                          понять по строке из двух слов */}
                      <button
                        onClick={() => setOpenLead(l.id)}
                        className="text-[12px] font-semibold text-gray-900 leading-tight text-left
                                   hover:text-violet-700"
                      >
                        {l.contact_name || l.name}
                      </button>
                      {l.contact_name && l.name !== l.contact_name && (
                        <div className="text-[10.5px] text-gray-500">{l.name}</div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Chip tone="violet">{KIND_LABEL[l.lead_kind || ''] || 'обращение'}</Chip>
                        {l.sla_due_at && !l.first_touch_at && col.key !== 'nurture' && (
                          <Chip tone={slaTone(l.sla_due_at)}>{slaText(l.sla_due_at)}</Chip>
                        )}
                        {col.key === 'nurture' && (
                          <Chip tone="gray">шаг {l.nurture_step ?? 0} из 4</Chip>
                        )}
                      </div>
                      {l.text && (
                        <div className="text-[11px] text-gray-600 mt-1 line-clamp-2">«{l.text}»</div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-1">
                        {[l.city, phone.valid ? phone.pretty : l.phone, l.source]
                          .filter(Boolean).join(' · ')}
                      </div>
                      {/* Когда обращение пришло — цифра, по которой сейлз решает,
                          звонить сейчас или это вчерашний хвост. «Просрочено на
                          19 ч» говорит о нормативе, но не о времени события */}
                      <div className="text-[10px] text-gray-400 tabular-nums">
                        {fmtDateTime(l.created_at)}
                      </div>
                      <div className="flex gap-1 mt-1.5">
                        <button
                          disabled={busy === l.id}
                          onClick={() => convert(l.id, 'qualified')}
                          className="text-[10px] px-2 py-1 rounded-md bg-violet-600 text-white
                                     hover:brightness-110 disabled:opacity-50"
                        >
                          Беру
                        </button>
                        {col.key !== 'nurture' && (
                          <button
                            disabled={busy === l.id}
                            onClick={() => moveLead(l.id, 'nurture')}
                            className="text-[10px] px-2 py-1 rounded-md border border-gray-200 text-gray-600
                                       hover:border-violet-400 hover:text-violet-700"
                          >
                            Прогрев
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
                {leadsIn(col.key).length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                    перетащите сюда
                  </div>
                )}
                {leadsIn(col.key).length < col.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {leadsIn(col.key).length} из {col.total}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>

        {/* ─── Граница: здесь обращение становится сделкой ────────── */}
        <div className="flex-none w-9 flex flex-col items-center justify-center gap-2 text-gray-400">
          <div className="flex-1 w-px border-l border-dashed border-gray-300" />
          <span className="text-[9.5px] tracking-wide [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
            здесь рождается сделка
          </span>
          <div className="flex-1 w-px border-l border-dashed border-gray-300" />
        </div>

        {/* ─── Зона работы: сделки ───────────────────────────────── */}
        <div className="flex gap-2.5 p-2 rounded-xl bg-blue-50/50 border border-dashed border-blue-200 flex-none">
          {data.stages.map(st => (
            <section
              key={st.key}
              onDragOver={e => { e.preventDefault(); setOver(st.key) }}
              onDragLeave={() => setOver(o => (o === st.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(st.key, 'deal') }}
              className={`flex-none w-[232px] bg-white border rounded-lg flex flex-col
                          transition-colors ${zoneCls(over === st.key, 'deal')}`}
            >
              <header className="px-2.5 py-2 border-b border-gray-100">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1">
                    {st.label}
                    {st.description && (
                      <span title={st.description}
                        className="w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400
                                   grid place-items-center text-[8px] font-bold cursor-help normal-case">?</span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{st.total}</span>
                </div>
                <div className="text-[10.5px] text-gray-400 tabular-nums">
                  {moneyList(st.amounts)}
                  {st.sla_hours ? ` · норматив ${Math.round(Number(st.sla_hours) / 24) || 1} дн` : ''}
                </div>
              </header>
              <div className="p-2 flex flex-col gap-2 overflow-y-auto">
                {dealsIn(st.key).map(d => {
                  const stuck = Boolean(d.stalled_at) || !d.next_step_at
                  return (
                    <article
                      key={d.id}
                      draggable
                      onDragStart={() => setDrag({ kind: 'deal', id: d.id, from: st.key })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      className={`bg-white border border-gray-200 border-l-[3px] rounded-lg p-2
                                  cursor-grab active:cursor-grabbing hover:shadow-md transition-all
                                  ${stuck ? 'border-l-red-500' : 'border-l-blue-500'}
                                  ${drag?.id === d.id ? 'opacity-30' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => setOpenDeal(d.id)}
                          className="text-[12px] font-semibold text-gray-900 hover:text-blue-600 text-left leading-tight">
                          {d.account || d.title}
                        </button>
                        <Chip tone={days(d.stage_since) > 14 ? 'red' : 'gray'}>{days(d.stage_since)} дн</Chip>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {[d.city, d.pos, d.points ? `${d.points} точ.` : null, d.orders_per_day]
                          .filter(Boolean).map(f => <Chip key={String(f)} tone="gray">{f}</Chip>)}
                        {d.doc_opens ? <Chip tone="green">КП открыто {d.doc_opens}×</Chip> : null}
                      </div>
                      <div className={`text-[11px] mt-1 tabular-nums ${
                        d.monthly_amount ? 'text-gray-700 font-medium' : 'text-amber-600'}`}>
                        {d.monthly_amount
                          ? `${money(d.monthly_amount, d.currency)}${d.tariff ? ` · ${d.tariff}` : ''}`
                          : 'сумма не указана'}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        {d.next_step
                          ? `${d.next_step}${d.next_step_at ? ` · ${fmtDateTime(d.next_step_at)}` : ''}`
                          : 'шаг не назначен'}
                        {d.owner_name ? ` · ${d.owner_name}` : ''}
                      </div>
                      {/* Карточки стоят по времени последнего движения, значит
                          это время должно быть видно — иначе порядок необъясним */}
                      <div className="text-[10px] text-gray-400 tabular-nums">
                        изменена {fmtDateTime(d.updated_at || d.stage_since)}
                      </div>
                      <div className="flex gap-1 mt-1.5">
                        {!d.next_step_at && (
                          <button disabled={busy === d.id} onClick={() => planStep(d.id)}
                            className="text-[10px] px-2 py-1 rounded-md bg-blue-600 text-white
                                       hover:brightness-110 disabled:opacity-50">
                            Шаг на завтра
                          </button>
                        )}
                        {d.phone && (
                          <a href={`tel:${d.phone}`}
                            className="text-[10px] px-2 py-1 rounded-md border border-gray-200 text-gray-600
                                       hover:border-blue-400 hover:text-blue-600">
                            Позвонить
                          </a>
                        )}
                      </div>
                    </article>
                  )
                })}
                {dealsIn(st.key).length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                    перетащите сюда
                  </div>
                )}
                {dealsIn(st.key).length < st.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {dealsIn(st.key).length} из {st.total}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>

        {/* ─── Закрытие ──────────────────────────────────────────── */}
        {/* Раньше здесь были узкие зоны со счётчиком: закрытое можно было
            только пополнить, но не посмотреть. Колонки такие же, как у
            этапов, — с карточками и «показать ещё» */}
        {data.closed.map(cl => {
          const won = cl.kind === 'won'
          const items = dealsIn(cl.key)
          return (
            <section
              key={cl.key}
              onDragOver={e => { e.preventDefault(); setOver(cl.key) }}
              onDragLeave={() => setOver(o => (o === cl.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(cl.key, 'closed') }}
              className={`flex-none w-[232px] rounded-lg border-2 flex flex-col transition-colors ${
                over === cl.key
                  ? won ? 'border-emerald-500 bg-emerald-50' : 'border-red-400 bg-red-50'
                  : won ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <header className={`px-2.5 py-2 border-b ${won ? 'border-emerald-100' : 'border-gray-200'}`}>
                <div className="flex justify-between items-baseline gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    won ? 'text-emerald-700' : 'text-red-600'}`}>{cl.label}</span>
                  <span className="text-[11.5px] text-gray-400 tabular-nums">{cl.total}</span>
                </div>
                <div className="text-[10.5px] text-gray-400 tabular-nums">
                  за 30 дней: {cl.last30}
                  {won && Object.keys(cl.amounts30 || {}).length ? ` · ${moneyList(cl.amounts30, '')}` : ''}
                </div>
              </header>
              <div className="p-2 flex flex-col gap-1.5 overflow-y-auto">
                {items.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setOpenDeal(d.id)}
                    className="w-full text-left bg-white border border-gray-200 rounded-lg px-2 py-1.5
                               hover:border-blue-400 transition-colors"
                  >
                    <div className="text-[12px] font-medium text-gray-900 truncate">
                      {d.account || d.title}
                    </div>
                    <div className="text-[10.5px] text-gray-400 tabular-nums truncate">
                      {won
                        ? [Number(d.monthly_amount) ? money(d.monthly_amount, d.currency) : null,
                           d.won_at ? fmtDateTime(d.won_at).split(',')[0] : null].filter(Boolean).join(' · ')
                          || 'сумма не указана'
                        : [d.lost_reason || 'причина не указана',
                           d.lost_at ? fmtDateTime(d.lost_at).split(',')[0] : null].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="text-[11px] text-gray-300 text-center py-3 border border-dashed
                                  border-gray-200 rounded-lg">
                    {won ? 'перетащите, чтобы закрыть' : 'перетащите — спросим причину'}
                  </div>
                )}
                {items.length > 0 && items.length < cl.total && (
                  <button
                    onClick={() => setPerColumn(p => Math.min(300, p + 50))}
                    className="w-full text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50
                               text-center py-2 rounded-lg border border-dashed border-blue-200 transition-colors">
                    Показать ещё · {items.length} из {cl.total}
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-red-600 text-white text-[12.5px]
                        px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 max-w-[560px]">
          {error}
          <button onClick={() => setError(null)} className="font-semibold flex-none">Понятно</button>
        </div>
      )}

      <Drawer
        open={!!openDeal}
        onClose={() => { setOpenDeal(null); load() }}
        title="Сделка"
        fullLink={openDeal ? `/sales/deals/${openDeal}` : undefined}
      >
        {openDeal && <SalesDealPage dealId={openDeal} />}
      </Drawer>

      <Drawer
        open={!!openLead}
        onClose={() => { setOpenLead(null); load() }}
        title="Обращение"
        fullLink={openLead ? `/sales/leads/${openLead}` : undefined}
      >
        {openLead && <SalesLeadPage leadId={openLead} />}
      </Drawer>
    </PageShell>
  )
}

export default SalesFunnelPage
