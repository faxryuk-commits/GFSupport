import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId, normPhone } from '../lib/sales-schema.js'

export const config = { runtime: 'edge' }

/**
 * Путь клиента: все касания в одной ленте.
 *
 * GET ?account=<id> — лента по аккаунту. Собирается из того, что уже есть в
 * системе (обращения, переписка, документы, движение по этапам), плюс из
 * касаний, присланных снаружи: заходы на сайт, диалоги с ботом, подписки.
 *
 * POST — приём внешнего касания. Склейка идёт по телефону: он единственный
 * общий у сайта, бота и заявки. Пришло касание с телефоном, который мы знаем, —
 * оно встаёт в ленту нужного клиента, нет — лежит неопознанным, пока телефон
 * не появится.
 *   Authorization: Bearer <CRON_SECRET>
 *   { "kind": "site_visit", "phone": "+998…", "title": "/pricing", "at": "…" }
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
    if (!byCron && !ctx.agentId) return json({ error: 'unauthorized' }, 401)
    const body = await req.json().catch(() => null)
    if (!body?.kind) return json({ error: 'kind is required' }, 400)

    // Кого касались: по телефону, по внешнему идентификатору канала или явно
    let accountId: string | null = body.accountId || null
    const phoneNorm = normPhone(body.phone || null)
    if (!accountId && phoneNorm) {
      const [byPhone] = await sql`
        SELECT account_id FROM sales_contacts
        WHERE org_id = ${orgId} AND phone_norm = ${phoneNorm} AND account_id IS NOT NULL
        LIMIT 1
      `
      accountId = byPhone?.account_id || null
    }
    if (!accountId && body.channelKey) {
      const [byChannel] = await sql`
        SELECT id FROM sales_accounts
        WHERE org_id = ${orgId} AND channel_id = ${String(body.channelKey)} LIMIT 1
      `
      accountId = byChannel?.id || null
    }

    await sql`
      INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, deal_id, kind, channel,
                                     title, detail, url, identity, meta, happened_at)
      VALUES (${salesId('stp')}, ${orgId}, ${accountId}, ${body.leadId || null}, ${body.dealId || null},
              ${String(body.kind).slice(0, 40)}, ${body.channel || null},
              ${(body.title || '').slice(0, 300) || null}, ${body.detail || null},
              ${body.url || null}, ${phoneNorm || body.identity || null},
              ${JSON.stringify(body.meta || {})}::jsonb,
              ${body.at || new Date().toISOString()})
    `
    return json({ ok: true, matched: Boolean(accountId) })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const accountId = url.searchParams.get('account')
  if (!accountId) return json({ error: 'account is required' }, 400)

  const [account] = await sql`
    SELECT id, name, channel_id FROM sales_accounts WHERE id = ${accountId} AND org_id = ${orgId}
  `
  if (!account) return json({ error: 'not found' }, 404)

  // Лента собирается из того, что уже записано в разных местах системы:
  // отдельная таблица касаний хранит только внешние события
  const [leads, events, docs, external, messages] = await Promise.all([
    sql`
      SELECT l.id, l.name, l.created_at, l.first_touch_at, l.campaign, l.utm_source, l.utm_campaign,
             l.landing_url, s.label AS source
      FROM sales_leads l LEFT JOIN sales_sources s ON s.id = l.source_id
      WHERE l.account_id = ${accountId} AND l.org_id = ${orgId}
      ORDER BY l.created_at
    `,
    sql`
      SELECT e.changed_at, e.changed_by, so.label AS from_stage, sn.label AS to_stage, d.title AS deal
      FROM sales_deal_events e
      JOIN sales_deals d ON d.id = e.deal_id
      LEFT JOIN sales_stages so ON so.id = e.old_stage_id
      LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
      WHERE d.account_id = ${accountId} AND e.org_id = ${orgId}
      ORDER BY e.changed_at
    `,
    sql`
      SELECT id, kind, number, status, total, currency, created_at, opened_count, first_opened_at
      FROM sales_documents WHERE account_id = ${accountId} AND org_id = ${orgId}
      ORDER BY created_at
    `,
    sql`
      SELECT kind, channel, title, detail, url, happened_at, meta
      FROM sales_touchpoints WHERE account_id = ${accountId} AND org_id = ${orgId}
      ORDER BY happened_at
    `,
    // Переписка живёт в поддержке: берём границы, а не всю ленту сообщений
    account.channel_id
      ? sql`
          SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at, COUNT(*)::int AS total
          FROM support_messages WHERE channel_id = ${account.channel_id}
        `
      : Promise.resolve([] as any[]),
  ])

  const timeline: any[] = []
  for (const l of leads as any[]) {
    timeline.push({
      at: l.created_at,
      kind: 'lead',
      title: `Обращение: ${l.source || 'источник не указан'}`,
      detail: [l.campaign, l.utm_source && `utm: ${l.utm_source}`, l.utm_campaign, l.landing_url]
        .filter(Boolean).join(' · ') || null,
    })
    if (l.first_touch_at) {
      timeline.push({ at: l.first_touch_at, kind: 'touch', title: 'Первое касание сейлза' })
    }
  }
  for (const e of events as any[]) {
    timeline.push({
      at: e.changed_at,
      kind: 'stage',
      title: `${e.deal}: ${e.from_stage ? `${e.from_stage} → ` : ''}${e.to_stage || '—'}`,
      detail: e.changed_by,
    })
  }
  for (const d of docs as any[]) {
    timeline.push({
      at: d.created_at,
      kind: 'doc',
      title: `${d.kind === 'offer' ? 'Оферта' : 'КП'} ${d.number || ''}`.trim(),
      detail: d.total ? `${Number(d.total).toLocaleString('ru-RU')} ${d.currency}` : null,
    })
    if (d.first_opened_at) {
      timeline.push({
        at: d.first_opened_at,
        kind: 'doc_open',
        title: `Клиент открыл документ ${d.number || ''}`.trim(),
        detail: d.opened_count > 1 ? `всего ${d.opened_count} открытий` : null,
      })
    }
  }
  for (const t of external as any[]) {
    timeline.push({
      at: t.happened_at, kind: t.kind, title: t.title || t.kind, detail: t.detail, url: t.url,
    })
  }
  const chat = (messages as any[])[0]
  if (chat?.total) {
    timeline.push({
      at: chat.first_at, kind: 'chat',
      title: 'Начало переписки в поддержке',
      detail: `${chat.total} сообщений, последнее ${new Date(chat.last_at).toISOString().slice(0, 10)}`,
    })
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return json({ account, timeline, counts: { leads: (leads as any[]).length, external: (external as any[]).length } })
}
