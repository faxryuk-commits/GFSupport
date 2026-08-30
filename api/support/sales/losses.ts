import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { resolveRegion } from '../lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Потери одной корзиной.
 *
 * Клиент отваливается в двух местах: обращение уходит в отказ до
 * квалификации, сделка проигрывается после. Событие бизнеса при этом одно —
 * «не купили», — и считать его двумя отдельными кучами значит никогда не
 * увидеть, где на самом деле течёт. Поэтому корзина одна, а теги объясняют,
 * что именно произошло:
 *
 *   что   — обращение или сделка
 *   где   — шаг, на котором оборвалось: не дозвонились, после демо, на КП
 *   почему — причина из справочника
 *
 * Историю тегом «где» задним числом не наделить: у обращений он нигде не
 * хранился, у сделок восстановился только там, где сохранился переход в
 * журнале. Такие записи честно помечены как «не указано».
 *
 * GET ?from=&to=&region=&owner=  → { items, byStage, byReason, byKind, total }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const market = await resolveRegion(sql, orgId, url) || ''
  const owner = url.searchParams.get('owner') || ''
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200')))

  // Границы дня считаем по рабочему часовому поясу: «за вчера» не должно
  // означать разное в зависимости от того, где сидит смотрящий
  const fromTs = from ? `${from}T00:00:00+05:00` : ''
  const toTs = to ? `${to}T23:59:59+05:00` : ''

  const [rows, byStage, byReason] = await sql.transaction([
    sql`
      SELECT * FROM (
        SELECT 'lead' AS kind, l.id, l.name AS title, l.market_id,
               COALESCE(l.lost_stage, 'unknown') AS stage,
               r.label AS reason, l.lost_comment AS comment,
               l.archived_at AS at, NULL::numeric AS amount, NULL AS currency,
               ag.name AS owner_name
        FROM sales_leads l
        LEFT JOIN sales_lost_reasons r ON r.id = l.lost_reason_id
        LEFT JOIN support_agents ag ON ag.id = l.assigned_agent_id
        WHERE l.org_id = ${orgId} AND l.status = 'junk'
          AND (${market} = '' OR l.market_id = ${market})
          AND (${owner} = '' OR l.assigned_agent_id = ${owner})
          AND (${fromTs} = '' OR l.archived_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR l.archived_at <= ${toTs}::timestamptz)
        UNION ALL
        SELECT 'deal' AS kind, d.id, COALESCE(a.name, d.title) AS title, d.market_id,
               COALESCE(d.lost_stage, 'unknown') AS stage,
               r.label AS reason, d.lost_comment AS comment,
               d.lost_at AS at, d.monthly_amount AS amount, d.currency,
               ag.name AS owner_name
        FROM sales_deals d
        JOIN sales_stages s ON s.id = d.stage_id AND s.kind = 'lost'
        LEFT JOIN sales_accounts a ON a.id = d.account_id
        LEFT JOIN sales_lost_reasons r ON r.id = d.lost_reason_id
        LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND (${owner} = '' OR d.owner_agent_id = ${owner})
          AND (${fromTs} = '' OR d.lost_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR d.lost_at <= ${toTs}::timestamptz)
      ) t
      ORDER BY at DESC NULLS LAST
      LIMIT ${limit}
    `,
    sql`
      SELECT kind, stage, COUNT(*)::int AS total FROM (
        SELECT 'lead' AS kind, COALESCE(lost_stage, 'unknown') AS stage
        FROM sales_leads
        WHERE org_id = ${orgId} AND status = 'junk'
          AND (${market} = '' OR market_id = ${market})
          AND (${owner} = '' OR assigned_agent_id = ${owner})
          AND (${fromTs} = '' OR archived_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR archived_at <= ${toTs}::timestamptz)
        UNION ALL
        SELECT 'deal' AS kind, COALESCE(d.lost_stage, 'unknown') AS stage
        FROM sales_deals d
        JOIN sales_stages s ON s.id = d.stage_id AND s.kind = 'lost'
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND (${owner} = '' OR d.owner_agent_id = ${owner})
          AND (${fromTs} = '' OR d.lost_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR d.lost_at <= ${toTs}::timestamptz)
      ) t GROUP BY kind, stage ORDER BY total DESC
    `,
    sql`
      SELECT reason, COUNT(*)::int AS total FROM (
        SELECT COALESCE(r.label, 'причина не указана') AS reason
        FROM sales_leads l
        LEFT JOIN sales_lost_reasons r ON r.id = l.lost_reason_id
        WHERE l.org_id = ${orgId} AND l.status = 'junk'
          AND (${market} = '' OR l.market_id = ${market})
          AND (${owner} = '' OR l.assigned_agent_id = ${owner})
          AND (${fromTs} = '' OR l.archived_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR l.archived_at <= ${toTs}::timestamptz)
        UNION ALL
        SELECT COALESCE(r.label, 'причина не указана') AS reason
        FROM sales_deals d
        JOIN sales_stages s ON s.id = d.stage_id AND s.kind = 'lost'
        LEFT JOIN sales_lost_reasons r ON r.id = d.lost_reason_id
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND (${owner} = '' OR d.owner_agent_id = ${owner})
          AND (${fromTs} = '' OR d.lost_at >= ${fromTs}::timestamptz)
          AND (${toTs} = '' OR d.lost_at <= ${toTs}::timestamptz)
      ) t GROUP BY reason ORDER BY total DESC
    `,
  ]) as any[]

  const stages = byStage as any[]
  const total = stages.reduce((sum, r) => sum + r.total, 0)

  return json({
    items: rows,
    byStage: stages,
    byReason,
    byKind: {
      lead: stages.filter(r => r.kind === 'lead').reduce((s, r) => s + r.total, 0),
      deal: stages.filter(r => r.kind === 'deal').reduce((s, r) => s + r.total, 0),
    },
    total,
    labels: STAGE_LABEL,
  })
}

/**
 * Подписи шагов потери. Ключи у обращений и у сделок свои, но человеку
 * нужен один список: он смотрит, где течёт, а не в какой таблице лежит.
 */
const STAGE_LABEL: Record<string, string> = {
  new: 'до первого касания',
  assigned: 'назначено, но не тронуто',
  attempting: 'на дозвоне',
  nurture: 'на прогреве',
  qualified: 'после квалификации',
  meeting: 'демо назначено',
  demo: 'после демо',
  kp: 'на КП',
  contract: 'на договоре',
  unknown: 'не указано',
}
