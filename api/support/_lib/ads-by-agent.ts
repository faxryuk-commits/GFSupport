import { readMetaConfig } from './meta-config.js'
import { ensureChannelCostsSchema, channelSpend } from './channel-costs.js'

/**
 * Отчёт «Реклама по сотрудникам»: чьи лиды с Meta и что стало с деньгами.
 *
 * Бюджет кампании за период делится поровну между её лидами, дошедшими до
 * CRM, — так сумма по людям сходится с тратами кабинета, а лид получает
 * цену без догадок о том, какой именно показ его привёл.
 *
 * Лид приписывается тому, кто его взял (assigned_agent_id), иначе владельцу
 * сделки из него; никому — отдельная строка «Никто не взял»: это тоже
 * судьба денег, и самая дорогая.
 *
 * Судьба лида — один из шести исходов, от лучшего к худшему:
 *   paid         — по сделке пришли деньги;
 *   advanced     — сделка прошла квалификацию, встречу, КП или договор;
 *   working      — в работе, звонки есть;
 *   junk_worked  — в отказе, но с причиной или звонками: отработали, потеряли;
 *   junk_target  — «не наш клиент» / «тест»: брак таргета, не сейлза;
 *   wasted       — закрыт или брошен без единого звонка и без причины.
 *
 * Звонки видны только через АТС и мессенджеры системы; кто звонит с личного
 * телефона — выглядит как «не отработал». Это оговорено в самом отчёте.
 */

export type Fate = 'paid' | 'advanced' | 'working' | 'junk_worked' | 'junk_target' | 'wasted'
export const FATES: Fate[] = ['paid', 'advanced', 'working', 'junk_worked', 'junk_target', 'wasted']

/** Причины, которые говорят о таргете, а не о работе сейлза. */
const TARGET_REASONS = new Set(['Не наш клиент', 'Тест'])

interface LeadRow {
  id: string
  cid: string
  market_id: string | null
  status: string
  reason: string | null
  agent_id: string | null
  agent: string | null
  deal_id: string | null
  paid: boolean
  paid_amount: number
  advanced: boolean
  calls: number
  cost?: number
  fate?: Fate
}

export interface AgentLine {
  agent: string
  agentId: string | null
  markets: string[]
  leads: number
  cost: number
  calls: number
  paidAmount: number
  n: Partial<Record<Fate, number>>
  c: Partial<Record<Fate, number>>
}

function fateOf(r: LeadRow): Fate {
  if (r.paid) return 'paid'
  if (r.advanced) return 'advanced'
  if (r.status === 'junk') {
    if (r.reason && TARGET_REASONS.has(r.reason)) return 'junk_target'
    if (r.reason || r.calls > 0) return 'junk_worked'
    return 'wasted'
  }
  return r.calls > 0 ? 'working' : 'wasted'
}

export interface CampInfo {
  id: string
  name: string
  /** ACTIVE / PAUSED / … как отдаёт Meta; null — кампания не найдена. */
  status: string | null
  /** Дневной бюджет, $: у CBO — свой, у ABO — сумма активных групп. */
  dailyBudget: number
  activeAdsets: number
  spend: number
  metaLeads: number
}

function leadsOf(ins: any): number {
  return Number((ins?.actions || []).find((a: any) => a.action_type === 'lead')?.value || 0)
}

/**
 * Кампании кабинета за период — с бюджетами и тратами. Кабинет не хранится
 * в настройках: его номер спрашиваем у любой известной кампании, поэтому
 * отчёт переживёт и смену кабинета, и второй кабинет рядом.
 */
async function accountCampaigns(
  token: string, knownIds: string[], since: string, until: string,
): Promise<Record<string, CampInfo>> {
  const out: Record<string, CampInfo> = {}
  const range = encodeURIComponent(JSON.stringify({ since, until }))
  const G = 'https://graph.facebook.com/v21.0'
  const tk = `access_token=${encodeURIComponent(token)}`

  const accounts = new Set<string>()
  for (let i = 0; i < knownIds.length; i += 50) {
    const chunk = knownIds.slice(i, i + 50)
    const res = await fetch(`${G}/?ids=${chunk.join(',')}&fields=account_id&${tk}`)
      .then(r => r.json()).catch(() => null)
    if (!res || res.error) continue
    for (const id of chunk) if (res[id]?.account_id) accounts.add(String(res[id].account_id))
  }

  for (const acc of accounts) {
    let url: string | null = `${G}/act_${acc}/campaigns?limit=100` +
      `&fields=name,effective_status,daily_budget,adsets.limit(50){daily_budget,effective_status},` +
      `insights.time_range(${range}){spend,actions}&${tk}`
    // Постранично: кампаний в кабинете за год набирается больше сотни
    for (let guard = 0; url && guard < 10; guard++) {
      const res: any = await fetch(url).then(r => r.json()).catch(() => null)
      if (!res || res.error) break
      for (const c of res.data || []) {
        const ins = c.insights?.data?.[0]
        const adsets = (c.adsets?.data || []) as any[]
        const active = adsets.filter(a => a.effective_status === 'ACTIVE')
        const daily = c.daily_budget
          ? Number(c.daily_budget) / 100
          : active.reduce((s, a) => s + Number(a.daily_budget || 0) / 100, 0)
        out[c.id] = {
          id: c.id, name: c.name, status: c.effective_status || null,
          dailyBudget: daily, activeAdsets: active.length,
          spend: Number(ins?.spend || 0), metaLeads: leadsOf(ins),
        }
      }
      url = res.paging?.next || null
    }
  }

  // Кампании, до которых кабинетом не дотянулись (чужой кабинет, нет прав), —
  // поштучно: без трат отчёт по сотрудникам теряет смысл
  const missing = knownIds.filter(id => !out[id])
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    const res = await fetch(`${G}/?ids=${chunk.join(',')}&fields=name,effective_status,insights.time_range(${range}){spend,actions}&${tk}`)
      .then(r => r.json()).catch(() => null)
    if (!res || res.error) continue
    for (const id of chunk) {
      const c = res[id]
      if (!c) continue
      const ins = c.insights?.data?.[0]
      out[id] = { id, name: c.name || id, status: c.effective_status || null, dailyBudget: 0,
                  activeAdsets: 0, spend: Number(ins?.spend || 0), metaLeads: leadsOf(ins) }
    }
  }
  return out
}

/** Человеческие имена каналов там, где справочник источников молчит. */
const CHANNEL_LABELS: Record<string, string> = {
  meta: 'Meta лид-форма', google: 'Google Ads', yandex: 'Яндекс Директ',
  site: 'Сайт delever.io', instagram_direct: 'Instagram Direct', telegram_bot: 'Telegram-бот',
  call: 'Входящий звонок', messenger: 'Facebook Messenger', outbound: 'Исходящий холодный',
  manual: 'Заведён вручную', import: 'Импорт базы', amo_manual: 'Amo · завёл менеджер',
  unknown: 'Источник не определён',
}
/** Платные каналы — всегда в таблице, даже без лидов: расход был, показать нечего. */
const PAID_CHANNELS = ['meta', 'google', 'yandex']

export interface ChannelLine {
  key: string
  label: string
  paid: boolean
  leads: number
  deals: number
  advanced: number
  won: number
  paidN: number
  paidAmount: number
  /** Расход за период, $; null — канал платный, но расход неизвестен. */
  spend: number | null
  spendSource: 'meta' | 'metrika' | null
}

/**
 * Все каналы привлечения за период: лиды → в работу → продвинуто → выиграно
 * → деньги, и расход там, где он известен. Лид с сайта с меткой Google или
 * Яндекса считается лидом той сети, а не сайта — иначе платный трафик
 * неотличим от органики.
 */
async function channelsOverview(
  sql: any, orgId: string, opts: { fromTs: string; toTs: string; market: string },
  metaSpend: number,
): Promise<ChannelLine[]> {
  const { fromTs, toTs, market } = opts
  const rows = (await sql`
    SELECT
      CASE
        WHEN l.click_source = 'gclid' OR lower(l.utm_source) IN ('google', 'gclid') THEN 'google'
        WHEN l.click_source = 'yclid' OR lower(l.utm_source) IN ('yandex', 'yclid')
          OR (l.click_source IS NULL AND l.click_id ~ '^[0-9]{12,}$') THEN 'yandex'
        WHEN l.meta_campaign_id IS NOT NULL OR s.key = 'meta_leadform' THEN 'meta'
        ELSE COALESCE(s.key, 'unknown')
      END AS key,
      MAX(s.label) AS label,
      COUNT(*)::int AS leads,
      COUNT(d.id)::int AS deals,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sales_deal_events e JOIN sales_stages s2 ON s2.id = e.new_stage_id
        WHERE e.deal_id = d.id
          AND s2.key IN ('qualified', 'meeting', 'demo', 'kp', 'contract', 'won')))::int AS advanced,
      COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::int AS won,
      COUNT(*) FILTER (WHERE d.paid_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM sales_payments p WHERE p.deal_id = d.id))::int AS paid_n,
      COALESCE(SUM((SELECT SUM(p.amount) FROM sales_payments p WHERE p.deal_id = d.id)), 0)::float AS paid_amount
    FROM sales_leads l
    LEFT JOIN sales_sources s ON s.id = l.source_id
    LEFT JOIN sales_deals d ON d.source_lead_id = l.id
    WHERE l.org_id = ${orgId}
      AND l.created_at >= ${fromTs}::timestamptz AND l.created_at <= ${toTs}::timestamptz
      AND (${market} = '' OR l.market_id = ${market})
    GROUP BY 1
  `) as any[]

  await ensureChannelCostsSchema(sql)
  const costs = await channelSpend(sql, orgId, fromTs.slice(0, 10), toTs.slice(0, 10))

  const byKey = new Map<string, ChannelLine>()
  for (const r of rows) {
    byKey.set(r.key, {
      key: r.key, label: CHANNEL_LABELS[r.key] || r.label || r.key, paid: PAID_CHANNELS.includes(r.key),
      leads: r.leads, deals: r.deals, advanced: r.advanced, won: r.won,
      paidN: r.paid_n, paidAmount: r.paid_amount, spend: null, spendSource: null,
    })
  }
  for (const key of PAID_CHANNELS) {
    if (!byKey.has(key)) byKey.set(key, {
      key, label: CHANNEL_LABELS[key], paid: true, leads: 0, deals: 0, advanced: 0, won: 0,
      paidN: 0, paidAmount: 0, spend: null, spendSource: null,
    })
  }
  const meta = byKey.get('meta')!
  meta.spend = metaSpend; meta.spendSource = 'meta'
  for (const key of ['yandex', 'google']) {
    const c = costs[key]
    const line = byKey.get(key)!
    if (c) { line.spend = c.spend; line.spendSource = 'metrika' }
  }
  return [...byKey.values()].sort((a, b) =>
    (b.paid ? 1 : 0) - (a.paid ? 1 : 0) || (b.spend || 0) - (a.spend || 0) || b.leads - a.leads)
}

export async function adsByAgent(
  sql: any, orgId: string, opts: { fromTs: string; toTs: string; market: string },
) {
  const { fromTs, toTs, market } = opts
  const rows = (await sql`
    SELECT l.id, l.meta_campaign_id AS cid, l.market_id, l.status, r.label AS reason,
           COALESCE(l.assigned_agent_id, d.owner_agent_id) AS agent_id,
           COALESCE(a1.name, a2.name) AS agent,
           d.id AS deal_id,
           (d.paid_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM sales_payments p WHERE p.deal_id = d.id)) AS paid,
           COALESCE((SELECT SUM(p.amount) FROM sales_payments p WHERE p.deal_id = d.id), 0)::float AS paid_amount,
           EXISTS (SELECT 1 FROM sales_deal_events e
                   JOIN sales_stages s2 ON s2.id = e.new_stage_id
                   WHERE e.deal_id = d.id
                     AND s2.key IN ('qualified', 'meeting', 'demo', 'kp', 'contract', 'won')) AS advanced,
           (SELECT COUNT(*) FROM sales_touchpoints tp
             WHERE tp.kind = 'call'
               AND (tp.lead_id = l.id OR (d.id IS NOT NULL AND tp.deal_id = d.id)))::int AS calls
    FROM sales_leads l
    LEFT JOIN sales_deals d ON d.source_lead_id = l.id
    LEFT JOIN sales_lost_reasons r ON r.id = l.lost_reason_id
    LEFT JOIN support_agents a1 ON a1.id = l.assigned_agent_id
    LEFT JOIN support_agents a2 ON a2.id = d.owner_agent_id
    WHERE l.org_id = ${orgId} AND l.meta_campaign_id IS NOT NULL
      AND l.created_at >= ${fromTs}::timestamptz AND l.created_at <= ${toTs}::timestamptz
      AND (${market} = '' OR l.market_id = ${market})
  `) as LeadRow[]

  const cfg = await readMetaConfig(orgId)
  const token = cfg.userToken || cfg.capiToken || null
  const cids = [...new Set(rows.map(r => r.cid))]
  const since = fromTs.slice(0, 10), until = toTs.slice(0, 10)
  const camps = token && cids.length ? await accountCampaigns(token, cids, since, until) : {}

  const crmByCamp: Record<string, number> = {}
  for (const r of rows) crmByCamp[r.cid] = (crmByCamp[r.cid] || 0) + 1
  for (const r of rows) {
    const c = camps[r.cid]
    r.cost = c ? c.spend / crmByCamp[r.cid] : 0
    r.fate = fateOf(r)
  }

  const byAgent = new Map<string, AgentLine>()
  for (const r of rows) {
    const key = r.agent_id || ''
    let a = byAgent.get(key)
    if (!a) {
      a = { agent: r.agent || 'Никто не взял', agentId: r.agent_id, markets: [],
            leads: 0, cost: 0, calls: 0, paidAmount: 0, n: {}, c: {} }
      byAgent.set(key, a)
    }
    if (r.market_id && !a.markets.includes(r.market_id)) a.markets.push(r.market_id)
    a.leads++; a.cost += r.cost!; a.calls += r.calls; a.paidAmount += r.paid_amount
    a.n[r.fate!] = (a.n[r.fate!] || 0) + 1
    a.c[r.fate!] = (a.c[r.fate!] || 0) + r.cost!
  }
  const agents = [...byAgent.values()].sort((x, y) => y.cost - x.cost)

  // Кампании: живые (крутятся сейчас) и те, что тратили в периоде, — с той же
  // раскладкой судеб. Кампания без лидов в CRM — тоже строка: деньги ушли,
  // а показывать нечего, и это самое важное, что о ней можно сказать
  const byCamp = new Map<string, any>()
  for (const c of Object.values(camps)) {
    if (c.spend <= 0 && c.status !== 'ACTIVE') continue
    byCamp.set(c.id, { ...c, crmLeads: crmByCamp[c.id] || 0, markets: [] as string[], n: {}, c: {} })
  }
  for (const r of rows) {
    const c = byCamp.get(r.cid)
    if (!c) continue
    if (r.market_id && !c.markets.includes(r.market_id)) c.markets.push(r.market_id)
    c.n[r.fate!] = (c.n[r.fate!] || 0) + 1
    c.c[r.fate!] = (c.c[r.fate!] || 0) + r.cost!
  }
  // Фильтр по стране: у кампании страна — это страна её лидов
  // «Живая» — не статус в Meta, а факт: кампания активна И есть чему крутиться.
  // Кампания со всеми группами на паузе в кабинете числится ACTIVE, а денег
  // не тратит — показывать её зелёной значит врать
  for (const c of byCamp.values()) c.live = c.status === 'ACTIVE' && (c.activeAdsets > 0 || c.dailyBudget > 0)
  const campaigns = [...byCamp.values()]
    .filter(c => !market || c.markets.includes(market))
    .sort((x, y) => (y.live ? 1 : 0) - (x.live ? 1 : 0) || y.spend - x.spend)

  const totals: { cost: number; spend: number; leads: number; n: Partial<Record<Fate, number>>; c: Partial<Record<Fate, number>> } =
    { cost: 0, spend: 0, leads: rows.length, n: {}, c: {} }
  for (const a of agents) {
    totals.cost += a.cost
    for (const f of FATES) {
      if (a.n[f]) totals.n[f] = (totals.n[f] || 0) + a.n[f]!
      if (a.c[f]) totals.c[f] = (totals.c[f] || 0) + a.c[f]!
    }
  }
  // Потрачено всего — по кампаниям, включая те, что лидов в CRM не дали
  totals.spend = campaigns.reduce((s, c) => s + c.spend, 0)
  const dailyBudget = campaigns.filter(c => c.live).reduce((s, c) => s + c.dailyBudget, 0)

  // Сколько отказов без причины: мера доверия к колонке «не отработано»
  const junkNoReason = rows.filter(r => r.status === 'junk' && !r.reason).length
  const junk = rows.filter(r => r.status === 'junk').length

  const channels = await channelsOverview(sql, orgId, opts, totals.spend)

  return {
    configured: Boolean(token),
    agents, totals, campaigns, dailyBudget, channels,
    quality: { junk, junkNoReason },
  }
}
