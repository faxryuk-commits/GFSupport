import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId, normPhone } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Контакты клиента: люди, с которыми мы говорим.
 *
 * Раньше контакт заводился ровно один — автоматически из телефона лида, и
 * добавить ЛПР, бухгалтера или почту было нечем. Поля роли и почты в базе
 * не заполнялись вообще ни одним кодом.
 *
 * GET    ?accountId=
 * POST   { accountId, name, role?, phone?, email?, telegram?, isPrimary? }
 * PATCH  { id, ... }
 * DELETE ?id=
 *
 * Телефон нормализуем при каждой записи: по последним девяти цифрам
 * склеиваются обращения из разных каналов, и контакт, заведённый руками,
 * должен участвовать в этой склейке наравне с пришедшим из заявки.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  /** Основной контакт у клиента один: назначая нового, снимаем признак с прежнего. */
  const clearPrimary = async (accountId: string, exceptId: string) => {
    await sql`
      UPDATE sales_contacts SET is_primary = false
      WHERE org_id = ${orgId} AND account_id = ${accountId} AND id <> ${exceptId}
    `
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    if (!body?.accountId) return json({ error: 'accountId is required' }, 400)
    const name = String(body?.name || '').trim()
    const phone = String(body?.phone || '').trim()
    if (!name && !phone) return json({ error: 'Нужно имя или телефон' }, 400)

    const [account] = await sql`
      SELECT id FROM sales_accounts WHERE id = ${body.accountId} AND org_id = ${orgId} LIMIT 1
    `
    if (!account) return json({ error: 'Клиент не найден' }, 404)

    // Первый контакт клиента становится основным сам: иначе у половины
    // карточек основного не будет вовсе
    const [{ n }] = await sql`
      SELECT COUNT(*)::int AS n FROM sales_contacts
      WHERE org_id = ${orgId} AND account_id = ${body.accountId}
    ` as any[]
    const isPrimary = body.isPrimary === true || n === 0

    const id = salesId('sac')
    await sql`
      INSERT INTO sales_contacts (id, org_id, account_id, name, role, phone, phone_norm,
                                  telegram, email, is_primary)
      VALUES (${id}, ${orgId}, ${body.accountId}, ${name || null}, ${body.role || null},
              ${phone || null}, ${normPhone(phone)}, ${body.telegram || null},
              ${body.email || null}, ${isPrimary})
    `
    if (isPrimary) await clearPrimary(body.accountId, id)
    return json({ ok: true, id })
  }

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => null)
    if (!body?.id) return json({ error: 'id is required' }, 400)
    const [c] = await sql`
      SELECT id, account_id FROM sales_contacts WHERE id = ${body.id} AND org_id = ${orgId} LIMIT 1
    `
    if (!c) return json({ error: 'not found' }, 404)

    // Поля правим по одному именованным запросом: динамическая сборка SQL
    // в шаблонных строках neon небезопасна и нечитаема
    if (body.name !== undefined) {
      await sql`UPDATE sales_contacts SET name = ${body.name || null} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.role !== undefined) {
      await sql`UPDATE sales_contacts SET role = ${body.role || null} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.email !== undefined) {
      await sql`UPDATE sales_contacts SET email = ${body.email || null} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.telegram !== undefined) {
      await sql`UPDATE sales_contacts SET telegram = ${body.telegram || null} WHERE id = ${body.id} AND org_id = ${orgId}`
    }
    if (body.phone !== undefined) {
      const phone = String(body.phone || '').trim()
      await sql`
        UPDATE sales_contacts SET phone = ${phone || null}, phone_norm = ${normPhone(phone)}
        WHERE id = ${body.id} AND org_id = ${orgId}
      `
    }
    if (body.isPrimary === true) {
      await sql`UPDATE sales_contacts SET is_primary = true WHERE id = ${body.id} AND org_id = ${orgId}`
      await clearPrimary(c.account_id, body.id)
    }
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    await sql`DELETE FROM sales_contacts WHERE id = ${id} AND org_id = ${orgId}`
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const accountId = url.searchParams.get('accountId')
  if (!accountId) return json({ contacts: [] })
  const contacts = await sql`
    SELECT id, name, role, phone, telegram, email, is_primary, created_at
    FROM sales_contacts WHERE org_id = ${orgId} AND account_id = ${accountId}
    ORDER BY is_primary DESC, created_at
  `
  return json({ contacts })
}
