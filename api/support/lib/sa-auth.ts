import { getSQL } from './db.js'

export interface SuperAdminContext {
  saId: string | null
  email: string | null
  name: string | null
  role: string | null
}

export async function extractSuperAdminContext(req: Request): Promise<SuperAdminContext> {
  const fallback: SuperAdminContext = { saId: null, email: null, name: null, role: null }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fallback

  const token = authHeader.replace('Bearer ', '').trim()
  if (!token.startsWith('sa_')) return fallback

  try {
    const sql = getSQL()
    const [row] = await sql`
      SELECT id, email, name, role FROM support_super_admins
      WHERE id = ${token} AND is_active = true LIMIT 1
    `
    if (!row) return fallback

    return {
      saId: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
    }
  } catch {
    return fallback
  }
}
