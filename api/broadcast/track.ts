import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export default async function handler(req: Request) {
  const sql = getSQL()
  const url = new URL(req.url)
  
  // Параметры трекинга
  const broadcastId = url.searchParams.get('b') // ID рассылки
  const linkId = url.searchParams.get('l') // ID ссылки
  const targetUrl = url.searchParams.get('url') // Целевой URL
  
  if (!targetUrl) {
    return new Response('Missing target URL', { status: 400 })
  }
  
  try {
    // Создаём таблицу кликов если нет
    await sql`
      CREATE TABLE IF NOT EXISTS support_broadcast_clicks (
        id SERIAL PRIMARY KEY,
        broadcast_id VARCHAR(50),
        link_id VARCHAR(50),
        target_url TEXT,
        user_agent TEXT,
        ip_hash VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {})
    
    // Записываем клик
    const userAgent = req.headers.get('user-agent') || ''
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    // Хэшируем IP для приватности
    const ipHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
      .then(hash => Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16))
      .catch(() => 'unknown')
    
    await sql`
      INSERT INTO support_broadcast_clicks (broadcast_id, link_id, target_url, user_agent, ip_hash)
      VALUES (${broadcastId}, ${linkId}, ${targetUrl}, ${userAgent.slice(0, 500)}, ${ipHash})
    `
    
    // Обновляем счётчик кликов в рассылке
    if (broadcastId) {
      await sql`
        UPDATE support_broadcasts 
        SET clicks_count = COALESCE(clicks_count, 0) + 1
        WHERE id = ${broadcastId}
      `.catch(() => {})
    }
    
  } catch (e) {
    console.error('[Track Click Error]', e)
  }
  
  // Редирект на целевой URL
  return Response.redirect(decodeURIComponent(targetUrl), 302)
}
