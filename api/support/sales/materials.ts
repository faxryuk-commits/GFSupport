import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { salesId } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Материалы к предложению: презентации, кейсы, видео.
 *
 * Отправлять их отдельными файлами — значит потерять всё, что даёт КП:
 * у документа есть публичная ссылка, счётчик открытий и время чтения, а у
 * вложения в директе нет ничего. Три файла подряд к тому же читаются как
 * спам, и половина не открывается с телефона.
 *
 * Поэтому материалы живут справочником и прикладываются к КП: клиент
 * получает одну ссылку, а менеджер видит, что именно смотрели. Открыл
 * предложение, но не открыл презентацию — это другой разговор при следующем
 * звонке, чем если не открыл ничего.
 *
 * GET    ?market=  → список
 * POST   { id?, title, url, kind, description?, markets?, defaultOn? }
 * DELETE ?id=
 */
const KINDS = ['presentation', 'case', 'video', 'doc', 'link']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const market = url.searchParams.get('market') || ''
    const rows = await sql`
      SELECT id, title, description, url, kind, markets, default_on, sort_order, opened_count
      FROM sales_materials
      WHERE org_id = ${orgId} AND is_active = true
        -- Материал без списка рынков годится всем: общая презентация продукта
        -- не должна пропадать из-за того, что кто-то не проставил регионы
        AND (${market} = '' OR markets IS NULL OR ${market} = ANY(markets))
      ORDER BY sort_order, title
    `
    return json({ materials: rows })
  }

  if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
    return json({ error: 'Менять материалы может только администратор' }, 403)
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    // Не удаляем: материал может быть приложен к отправленным предложениям,
    // и ссылка в них не должна умереть задним числом
    await sql`
      UPDATE sales_materials SET is_active = false
      WHERE id = ${id} AND org_id = ${orgId}
    `
    return json({ ok: true })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const body = await req.json().catch(() => null)
  const title = String(body?.title || '').trim()
  const link = String(body?.url || '').trim()
  if (!title || !link) return json({ error: 'Нужны название и ссылка' }, 400)
  const kind = KINDS.includes(String(body?.kind)) ? String(body.kind) : 'presentation'
  const markets: string[] | null = Array.isArray(body?.markets) && body.markets.length
    ? body.markets.map(String) : null

  if (body?.id) {
    await sql`
      UPDATE sales_materials
      SET title = ${title}, url = ${link}, kind = ${kind},
          description = ${body?.description ? String(body.description).slice(0, 500) : null},
          markets = ${markets}, default_on = ${Boolean(body?.defaultOn)},
          sort_order = ${Number(body?.sortOrder) || 0}
      WHERE id = ${String(body.id)} AND org_id = ${orgId}
    `
    return json({ ok: true, id: body.id })
  }

  const id = salesId('mat')
  await sql`
    INSERT INTO sales_materials (id, org_id, title, description, url, kind, markets,
                                 default_on, sort_order)
    VALUES (${id}, ${orgId}, ${title},
            ${body?.description ? String(body.description).slice(0, 500) : null},
            ${link}, ${kind}, ${markets}, ${Boolean(body?.defaultOn)},
            ${Number(body?.sortOrder) || 0})
  `
  return json({ ok: true, id })
}
