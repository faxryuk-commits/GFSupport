import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Ссылка на клиентский статус-портал бренда.
 *
 * POST { brandId } → { url } — токен создаётся один раз и живёт всегда:
 * ссылка в группе клиента не должна протухать. Отправка ссылки — рукой
 * сотрудника из карточки бренда.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const { brandId } = await req.json()
  if (!brandId) return json({ error: 'brandId is required' }, 400)

  const [brand] = await sql`
    SELECT id, name, portal_token FROM onboarding_brands
    WHERE id = ${brandId} AND org_id = ${orgId} LIMIT 1
  ` as any[]
  if (!brand) return json({ error: 'brand not found' }, 404)

  let token = brand.portal_token
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 28)
    await sql`UPDATE onboarding_brands SET portal_token = ${token}
      WHERE id = ${brandId} AND org_id = ${orgId} AND portal_token IS NULL`
    const [fresh] = await sql`SELECT portal_token FROM onboarding_brands WHERE id = ${brandId}` as any[]
    token = fresh?.portal_token || token
  }

  const origin = new URL(req.url).origin
  return json({ url: `${origin}/r/${token}`, brand: brand.name })
}
