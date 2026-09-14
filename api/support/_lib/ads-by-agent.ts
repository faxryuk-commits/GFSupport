import { readMetaConfig } from './meta-config.js'

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

/** Траты кампаний за период — одним запросом на пачку идентификаторов. */
async function campaignSpend(
  token: string, ids: string[], since: string, until: string,
): Promise<Record<string, { name: string; spend: number; metaLeads: number }>> {
  const out: Record<string, { name: string; spend: number; metaLeads: number }> = {}
  const range = JSON.stringify({ since, until })
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const url = `https://graph.facebook.com/v21.0/?ids=${chunk.join(',')}` +
      `&fields=name,insights.time_range(${encodeURIComponent(range)}){spend,actions}` +
      `&access_token=${encodeURIComponent(token)}`
    const res = await fetch(url).then(r => r.json()).catch(() => null)
    if (!res || res.error) continue
    for (const id of chunk) {
      const c = res[id]
      if (!c) continue
      const ins = c.insights?.data?.[0]
      const leads = Number((ins?.actions || []).find((a: any) => a.action_type === 'lead')?.value || 0)
      out[id] = { name: c.name || id, spend: Number(ins?.spend || 0), metaLeads: leads }
    }
  }
  return out
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
  const camps = token && cids.length
    ? await campaignSpend(token, cids, fromTs.slice(0, 10), toTs.slice(0, 10))
    : {}

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
  const totals: { cost: number; leads: number; n: Partial<Record<Fate, number>>; c: Partial<Record<Fate, number>> } =
    { cost: 0, leads: rows.length, n: {}, c: {} }
  for (const a of agents) {
    totals.cost += a.cost
    for (const f of FATES) {
      if (a.n[f]) totals.n[f] = (totals.n[f] || 0) + a.n[f]!
      if (a.c[f]) totals.c[f] = (totals.c[f] || 0) + a.c[f]!
    }
  }

  const campaigns = Object.entries(camps)
    .map(([id, c]) => ({ id, name: c.name, spend: c.spend, metaLeads: c.metaLeads, crmLeads: crmByCamp[id] || 0 }))
    .sort((x, y) => y.spend - x.spend)

  // Сколько отказов без причины: мера доверия к колонке «не отработано»
  const junkNoReason = rows.filter(r => r.status === 'junk' && !r.reason).length
  const junk = rows.filter(r => r.status === 'junk').length

  return {
    configured: Boolean(token),
    agents, totals, campaigns,
    quality: { junk, junkNoReason },
  }
}
