import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders, ensureOnce } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { salesId } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Telegram Ads: реестр кампаний и отчёт по ним.
 *
 * У Telegram нет ни пикселя, ни API конверсий — платформа показывает только
 * просмотры и клики. Атрибуция строится на нашей стороне: каждое объявление
 * получает метку, объявление ведёт на бота ссылкой t.me/<бот>?start=ad_<код>,
 * приёмник sales/inbox по метке заводит лида с источником telegram_ads
 * и кодом кампании. Дальше обычный конвейер CRM: квалификация, сделка,
 * оплата — и стоимость квалифицированного лида по каждому объявлению,
 * которой в кабинете Telegram не покажут никогда.
 *
 * Расходы платформа наружу не отдаёт — их заносят руками из кабинета
 * (реселлера), журналом: дата + сумма. Этого достаточно для CPL/CPQL.
 *
 * GET  ?action=report            — кампании со счётчиками и расходами
 * POST { action: 'create', name, code? }        — новая кампания
 * POST { action: 'spend', code, amount, spentOn?, note? } — записать расход
 * POST { action: 'archive', code }              — скрыть кампанию из отчёта
 * POST { action: 'bot', username }              — юзернейм бота для ссылок
 */

async function ensureTgAdsSchema(sql: any): Promise<void> {
  await ensureOnce('tg-ads', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_tg_campaigns (
        id VARCHAR(50) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        code VARCHAR(60) NOT NULL,
        name VARCHAR(200) NOT NULL,
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tg_campaigns_code ON sales_tg_campaigns(org_id, code)`
    await sql`
      CREATE TABLE IF NOT EXISTS sales_tg_spend (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        code VARCHAR(60) NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
        spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
        note VARCHAR(300),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tg_spend_code ON sales_tg_spend(org_id, code)`
  })
}

/** Код из названия: «Плов-гид сентябрь» → plov_gid_sentyabr (короткий, латиницей). */
function slugify(name: string): string {
  const map: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
    н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',
    ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  }
  const slug = name.toLowerCase()
    .split('').map(ch => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return slug || `c${Date.now().toString(36)}`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureTgAdsSchema(sql)

  if (req.method === 'GET') {
    // Один поход в базу: кампании + лиды по меткам + сделки из них + расходы.
    // Квалифицирован = на сделке заполнены точки и тип доставки (те же факты,
    // что шлёт петля Meta); оплачен = paid_at или платёж
    const [campaigns, stats, spend, botRow] = await sql.transaction([
      sql`
        SELECT code, name, created_at, archived_at IS NOT NULL AS archived
        FROM sales_tg_campaigns WHERE org_id = ${orgId}
        ORDER BY created_at DESC
      `,
      sql`
        SELECT l.campaign AS code,
               COUNT(*)::int AS leads,
               COUNT(*) FILTER (WHERE d.points IS NOT NULL AND d.delivery_type IS NOT NULL)::int AS qualified,
               COUNT(*) FILTER (WHERE d.paid_at IS NOT NULL
                 OR EXISTS (SELECT 1 FROM sales_payments p WHERE p.deal_id = d.id))::int AS paid,
               MAX(l.created_at) AS last_lead_at
        FROM sales_leads l
        LEFT JOIN sales_deals d ON d.source_lead_id = l.id
        JOIN sales_sources s ON s.id = l.source_id
        WHERE l.org_id = ${orgId} AND s.key = 'telegram_ads' AND l.campaign IS NOT NULL
        GROUP BY l.campaign
      `,
      sql`
        SELECT code, SUM(amount)::numeric(12,2) AS total, MAX(currency) AS currency
        FROM sales_tg_spend WHERE org_id = ${orgId} GROUP BY code
      `,
      sql`
        SELECT value FROM support_settings
        WHERE org_id = ${orgId} AND key = 'tg_ads_bot_username' LIMIT 1
      `,
    ]) as any[]

    const statBy: Record<string, any> = {}
    for (const r of stats) statBy[r.code] = r
    const spendBy: Record<string, any> = {}
    for (const r of spend) spendBy[r.code] = r

    return json({
      botUsername: botRow?.[0]?.value || null,
      campaigns: campaigns.map((c: any) => ({
        code: c.code,
        name: c.name,
        archived: c.archived,
        createdAt: c.created_at,
        leads: statBy[c.code]?.leads || 0,
        qualified: statBy[c.code]?.qualified || 0,
        paid: statBy[c.code]?.paid || 0,
        lastLeadAt: statBy[c.code]?.last_lead_at || null,
        spend: Number(spendBy[c.code]?.total || 0),
        currency: spendBy[c.code]?.currency || 'EUR',
      })),
      // Метки, по которым пришли лиды, но кампании в реестре нет —
      // видны отдельно, а не теряются молча
      unknown: stats.filter((r: any) => !campaigns.some((c: any) => c.code === r.code))
        .map((r: any) => ({ code: r.code, leads: r.leads })),
    })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!ctx.isLead) return json({ error: 'Управлять кампаниями может руководитель' }, 403)
  const body = await req.json().catch(() => null)
  const action = String(body?.action || '')

  if (action === 'create') {
    const name = String(body?.name || '').trim().slice(0, 200)
    if (!name) return json({ error: 'Нужно название кампании' }, 400)
    const code = String(body?.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || slugify(name)
    const [dup] = await sql`
      SELECT 1 FROM sales_tg_campaigns WHERE org_id = ${orgId} AND code = ${code} LIMIT 1
    ` as any[]
    if (dup) return json({ error: `Код «${code}» уже занят` }, 409)
    await sql`
      INSERT INTO sales_tg_campaigns (id, org_id, code, name)
      VALUES (${salesId('tgc')}, ${orgId}, ${code}, ${name})
    `
    return json({ ok: true, code })
  }

  if (action === 'spend') {
    const code = String(body?.code || '').trim()
    const amount = Number(body?.amount)
    if (!code || !isFinite(amount) || amount <= 0) return json({ error: 'Нужны код кампании и сумма' }, 400)
    await sql`
      INSERT INTO sales_tg_spend (org_id, code, amount, currency, spent_on, note)
      VALUES (${orgId}, ${code}, ${amount}, ${String(body?.currency || 'EUR').slice(0, 10)},
              ${body?.spentOn || new Date().toISOString().slice(0, 10)},
              ${body?.note ? String(body.note).slice(0, 300) : null})
    `
    return json({ ok: true })
  }

  if (action === 'archive') {
    const code = String(body?.code || '').trim()
    await sql`
      UPDATE sales_tg_campaigns SET archived_at = NOW()
      WHERE org_id = ${orgId} AND code = ${code}
    `
    return json({ ok: true })
  }

  if (action === 'bot') {
    const username = String(body?.username || '').trim().replace(/^@/, '').slice(0, 60)
    await sql`
      INSERT INTO support_settings (key, value, org_id, updated_at)
      VALUES ('tg_ads_bot_username', ${username}, ${orgId}, NOW())
      ON CONFLICT (key, org_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
