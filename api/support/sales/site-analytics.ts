import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { parseSiteDigest } from '../lib/site-digest.js'

export const config = { runtime: 'edge' }

/**
 * Сводка по сайту delever.io: верх воронки рядом с самой воронкой.
 *
 * POST — приём от бота. Принимает либо готовый JSON, либо текст той самой
 * сводки, что бот шлёт в Telegram: просить его научиться второму формату
 * значит менять два проекта вместо одного.
 *   Authorization: Bearer <CRON_SECRET>   (или админ модуля)
 *   { "text": "📊 Аналитика delever.io — 12.08.2026 …" }
 *   { "day": "2026-08-12", "views": 102, … }
 *
 * GET ?days=30 — история для отчёта.
 *
 * День — ключ: повторная присылка за ту же дату обновляет строку, а не плодит
 * дубли. Бот может слать хоть каждый час.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const auth = req.headers.get('authorization') || ''
  const byCron = Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`
  const ctx = await extractAgentContext(req)

  if (req.method === 'POST') {
    if (!byCron && !ctx.isOrgAdmin && !ctx.isGlobalAdmin) {
      return json({ error: 'unauthorized' }, 401)
    }
    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'body is required' }, 400)

    const d = typeof body.text === 'string' ? parseSiteDigest(body.text) : body
    const day = d.day || body.day
    if (!day) return json({ error: 'не удалось определить дату сводки' }, 400)

    await sql`
      INSERT INTO sales_site_analytics (
        org_id, day, views, uniques, sessions, median_seconds, leads,
        new_visitors, returning_visitors, devices, os, langs, top_pages,
        interests, sources, countries, engagement, hot_visitors, ab_tests, raw
      ) VALUES (
        ${orgId}, ${day}, ${d.views ?? null}, ${d.uniques ?? null}, ${d.sessions ?? null},
        ${d.median_seconds ?? null}, ${d.leads ?? null},
        ${d.new_visitors ?? null}, ${d.returning_visitors ?? null},
        ${JSON.stringify(d.devices || {})}::jsonb, ${JSON.stringify(d.os || {})}::jsonb,
        ${JSON.stringify(d.langs || {})}::jsonb, ${JSON.stringify(d.top_pages || [])}::jsonb,
        ${JSON.stringify(d.interests || [])}::jsonb, ${JSON.stringify(d.sources || [])}::jsonb,
        ${JSON.stringify(d.countries || [])}::jsonb, ${JSON.stringify(d.engagement || [])}::jsonb,
        ${JSON.stringify(d.hot_visitors || [])}::jsonb, ${JSON.stringify(d.ab_tests || [])}::jsonb,
        ${typeof body.text === 'string' ? body.text.slice(0, 8000) : null}
      )
      ON CONFLICT (org_id, day) DO UPDATE SET
        views = EXCLUDED.views, uniques = EXCLUDED.uniques, sessions = EXCLUDED.sessions,
        median_seconds = EXCLUDED.median_seconds, leads = EXCLUDED.leads,
        new_visitors = EXCLUDED.new_visitors, returning_visitors = EXCLUDED.returning_visitors,
        devices = EXCLUDED.devices, os = EXCLUDED.os, langs = EXCLUDED.langs,
        top_pages = EXCLUDED.top_pages, interests = EXCLUDED.interests,
        sources = EXCLUDED.sources, countries = EXCLUDED.countries,
        engagement = EXCLUDED.engagement, hot_visitors = EXCLUDED.hot_visitors,
        ab_tests = EXCLUDED.ab_tests, raw = EXCLUDED.raw
    `
    return json({ ok: true, day, parsed: typeof body.text === 'string' })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const days = Math.min(180, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)))
  const rows = await sql`
    SELECT * FROM sales_site_analytics
    WHERE org_id = ${orgId} AND day > CURRENT_DATE - ${days}::int
    ORDER BY day DESC
  ` as any[]

  // Итог за период считаем здесь: на экране нужен и он, и разбивка по дням
  const sum = (key: string) => rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
  const totals = {
    views: sum('views'),
    uniques: sum('uniques'),
    sessions: sum('sessions'),
    leads: sum('leads'),
    days: rows.length,
    // Медиану по медианам не считают — берём среднее по дням, честно называя
    avgMedianSeconds: rows.length
      ? Math.round(rows.reduce((a, r) => a + Number(r.median_seconds || 0), 0) / rows.length)
      : 0,
  }

  return json({ days: rows, totals, latest: rows[0] || null })
}
