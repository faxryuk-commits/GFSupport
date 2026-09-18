import { ensureOnce } from './db.js'

/**
 * Поток продаж: от канала до выигрыша.
 *
 * Когорта — обращения, созданные в периоде. У каждого одна судьба:
 *   без сделки → «отказ» (junk) или «ждёт разбора» (wait);
 *   со сделкой → выиграна (won), проиграна на ступени k (lost[k]) или стоит
 *   на ступени k (open[k]), k = 1..4: Квалифицирован, Демо, КП, Договор.
 *
 * Сделка без обращения (из Amo или заведённая сразу сделкой) — тоже член
 * когорты, со своим каналом: иначе год Amo-истории выпадает из потока.
 *
 * Сделка обращения — та, что из него родилась (source_lead_id). Повторное
 * обращение клиента к сделке не рождает новой (см. sales-intake), а лид
 * помечается converted — тогда его судьба = судьба живой сделки того же
 * клиента; иначе 138 таких обращений за квартал считались бы «ждут».
 *
 * Ступень сделки — самая дальняя, куда она доходила (по событиям этапов),
 * или текущая, если событий нет. Этапы разных воронок сводятся к четырём
 * ступеням: research → 1, discovery → 2, proposal → 3, pilot → 4.
 * Выигранная считается прошедшей все ступени — так в реке лента доходит
 * до «Выиграно», а конверсия «до ступени и дальше» читается как обычно.
 *
 * Один запрос отдаёт когорту по строкам, всё остальное — сложение в коде:
 * четыре агрегирующих запроса с коррелированными подзапросами шли 5,6 с,
 * этот — 0,4 с на 1 500 обращений.
 */

export interface FlowChannel {
  key: string
  /** id источника — для ссылки в воронку, где фильтр по источнику идёт по id. */
  id: string | null
  label: string
  junk: number
  wait: number
  won: number
  lost: number[]
  open: number[]
  wonAmounts: Record<string, number>
  wonMedianDays: number | null
}

export interface FlowOpts {
  fromTs: string
  toTs: string
  market: string
  /** '' — все, 'none' — ничьи, иначе id сотрудника. */
  owner: string
  /** Ключи источников, которые не считать. */
  exclude: string[]
}

async function ensureIndexes(sql: any): Promise<void> {
  await ensureOnce('sales-flow-idx', async () => {
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_deals_source_lead ON sales_deals(source_lead_id) WHERE source_lead_id IS NOT NULL`
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_leads_org_created ON sales_leads(org_id, created_at)`
  })
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2)
}

export async function salesFlow(sql: any, orgId: string, o: FlowOpts) {
  await ensureIndexes(sql)
  const excl = o.exclude.length ? o.exclude : ['']
  const rows = (await sql`
    WITH cohort AS (
      SELECT l.id, l.status, l.created_at, l.assigned_agent_id, l.account_id,
             COALESCE(s.key, 'unknown') AS skey, COALESCE(s.label, 'Источник не определён') AS slabel, s.id AS sid,
             COALESCE(d1.id, d2.id) AS deal_id,
             COALESCE(d1.won_at, d2.won_at) AS won_at,
             COALESCE(d1.lost_at, d2.lost_at) AS lost_at,
             COALESCE(d1.owner_agent_id, d2.owner_agent_id) AS owner_agent_id,
             COALESCE(d1.stage_id, d2.stage_id) AS stage_id,
             COALESCE(d1.lost_reason_id, d2.lost_reason_id) AS lost_reason_id,
             COALESCE(d1.monthly_amount, d2.monthly_amount) AS monthly_amount,
             COALESCE(d1.currency, d2.currency) AS currency
      FROM sales_leads l
      LEFT JOIN sales_sources s ON s.id = l.source_id
      -- Сделка из обращения; если её нет, а обращение «стало сделкой» —
      -- живая сделка того же клиента (повторное обращение приклеено к ней)
      -- Только нужные колонки: с d.* строки тянули jsonb спецификаций,
      -- и запрос на 5 мс в базе шёл секунду по проводу
      LEFT JOIN LATERAL (
        SELECT d.id, d.won_at, d.lost_at, d.owner_agent_id, d.stage_id, d.lost_reason_id, d.monthly_amount, d.currency
        FROM sales_deals d
        WHERE d.source_lead_id = l.id AND d.archived_at IS NULL
        ORDER BY d.created_at DESC LIMIT 1
      ) d1 ON true
      LEFT JOIN LATERAL (
        SELECT d.id, d.won_at, d.lost_at, d.owner_agent_id, d.stage_id, d.lost_reason_id, d.monthly_amount, d.currency
        FROM sales_deals d
        WHERE d1.id IS NULL AND l.status = 'converted' AND d.account_id = l.account_id AND d.archived_at IS NULL
        ORDER BY d.created_at DESC LIMIT 1
      ) d2 ON true
      WHERE l.org_id = ${orgId}
        AND l.created_at >= ${o.fromTs}::timestamptz AND l.created_at <= ${o.toTs}::timestamptz
        AND (${o.market} = '' OR l.market_id = ${o.market})
        AND COALESCE(s.key, 'unknown') <> ALL(${excl})
      UNION ALL
      -- Сделки без обращения: из Amo сделки приезжают уже сделками, и за год
      -- таких 671 против 593 обращений. Без них поток показывал 16 выигрышей
      -- там, где KPI считал 158, — и обе цифры были «правдой»
      SELECT d.id, 'converted', d.created_at, d.owner_agent_id, d.account_id,
             CASE WHEN d.external_id LIKE 'amo_%' THEN 'amo_deal' ELSE 'manual' END,
             CASE WHEN d.external_id LIKE 'amo_%' THEN 'Amo · сделка без обращения' ELSE 'Заведён вручную' END,
             CASE WHEN d.external_id LIKE 'amo_%' THEN NULL ELSE sm.id END,
             d.id, d.won_at, d.lost_at, d.owner_agent_id, d.stage_id, d.lost_reason_id, d.monthly_amount, d.currency
      FROM sales_deals d
      LEFT JOIN sales_sources sm ON sm.org_id = d.org_id AND sm.key = 'manual'
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
        AND d.source_lead_id IS NULL
        AND d.created_at >= ${o.fromTs}::timestamptz AND d.created_at <= ${o.toTs}::timestamptz
        AND (${o.market} = '' OR d.market_id = ${o.market})
        AND (CASE WHEN d.external_id LIKE 'amo_%' THEN 'amo_deal' ELSE 'manual' END) <> ALL(${excl})
    ),
    mx AS (
      SELECT e.deal_id,
             MAX(CASE st.key
               WHEN 'qualified' THEN 1 WHEN 'research' THEN 1
               WHEN 'meeting' THEN 2 WHEN 'demo' THEN 2 WHEN 'discovery' THEN 2
               WHEN 'kp' THEN 3 WHEN 'proposal' THEN 3
               WHEN 'contract' THEN 4 WHEN 'pilot' THEN 4 ELSE 0 END) AS m
      FROM sales_deal_events e JOIN sales_stages st ON st.id = e.new_stage_id
      WHERE e.deal_id IN (SELECT deal_id FROM cohort WHERE deal_id IS NOT NULL)
      GROUP BY 1
    )
    SELECT c.skey, c.slabel, c.sid, c.status,
           (c.deal_id IS NOT NULL) AS has_deal, c.deal_id,
           (c.won_at IS NOT NULL) AS won, (c.lost_at IS NOT NULL) AS lost,
           GREATEST(COALESCE(mx.m, 0), COALESCE(CASE st.key
               WHEN 'qualified' THEN 1 WHEN 'research' THEN 1
               WHEN 'meeting' THEN 2 WHEN 'demo' THEN 2 WHEN 'discovery' THEN 2
               WHEN 'kp' THEN 3 WHEN 'proposal' THEN 3
               WHEN 'contract' THEN 4 WHEN 'pilot' THEN 4 ELSE 0 END, 0), 1) AS mx,
           r.label AS reason,
           COALESCE(a.name, 'Ничей') AS owner_name,
           COALESCE(c.owner_agent_id, c.assigned_agent_id) AS owner_id,
           c.currency, c.monthly_amount::float AS amt,
           EXTRACT(EPOCH FROM (c.won_at - c.created_at)) / 86400 AS days
    FROM cohort c
    LEFT JOIN mx ON mx.deal_id = c.deal_id
    LEFT JOIN sales_stages st ON st.id = c.stage_id
    LEFT JOIN sales_lost_reasons r ON r.id = c.lost_reason_id
    LEFT JOIN support_agents a ON a.id = c.owner_agent_id
  `) as any[]

  // Фильтр по владельцу — здесь, а не в SQL: ничей/чужой считается по той
  // же паре «владелец сделки, иначе закреплённый за обращением»
  const filtered = o.owner
    ? rows.filter(r => o.owner === 'none' ? !r.owner_id : r.owner_id === o.owner)
    : rows

  const ch = new Map<string, FlowChannel & { days: number[] }>()
  const reasonsBy = new Map<string, number>()
  const repsBy = new Map<string, { name: string; agentId: string | null; deals: Set<string>; won: Set<string> }>()

  for (const r of filtered) {
    let c = ch.get(r.skey)
    if (!c) {
      c = { key: r.skey, id: r.sid || null, label: r.slabel, junk: 0, wait: 0, won: 0,
            lost: [0, 0, 0, 0, 0], open: [0, 0, 0, 0, 0], wonAmounts: {}, wonMedianDays: null, days: [] }
      ch.set(r.skey, c)
    }
    const k = Math.min(4, Math.max(1, Number(r.mx) || 1))
    if (!r.has_deal) {
      if (r.status === 'junk') c.junk++; else c.wait++
      continue
    }
    if (r.won) {
      c.won++
      if (r.currency && Number(r.amt) > 0) c.wonAmounts[r.currency] = (c.wonAmounts[r.currency] || 0) + Number(r.amt)
      if (r.days != null) c.days.push(Number(r.days))
    } else if (r.lost) {
      c.lost[k]++
      const key = `${k}|${r.reason || '(без причины)'}`
      reasonsBy.set(key, (reasonsBy.get(key) || 0) + 1)
    } else {
      c.open[k]++
    }
    // Сделки по владельцам — без дублей: у повторных обращений одна сделка
    const rk = r.owner_id || ''
    let rep = repsBy.get(rk)
    if (!rep) { rep = { name: r.owner_id ? r.owner_name : 'Ничей', agentId: r.owner_id || null, deals: new Set(), won: new Set() }; repsBy.set(rk, rep) }
    rep.deals.add(r.deal_id)
    if (r.won) rep.won.add(r.deal_id)
  }

  const channels: FlowChannel[] = [...ch.values()]
    .map(({ days, ...c }) => ({ ...c, wonMedianDays: median(days) }))
    .sort((a, b) => (b.junk + b.wait + b.won + b.lost.reduce((x, y) => x + y, 0) + b.open.reduce((x, y) => x + y, 0))
                  - (a.junk + a.wait + a.won + a.lost.reduce((x, y) => x + y, 0) + a.open.reduce((x, y) => x + y, 0)))

  const reasons = [...reasonsBy.entries()]
    .map(([key, n]) => { const [st, reason] = key.split('|'); return { stage: Number(st), reason, n } })
    .sort((a, b) => a.stage - b.stage || b.n - a.n)

  const reps = [...repsBy.values()]
    .map(r => ({ name: r.name, agentId: r.agentId, deals: r.deals.size, won: r.won.size }))
    .sort((a, b) => b.deals - a.deals)

  return { channels, reasons, reps }
}
