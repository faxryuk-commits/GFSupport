import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * Список «теневых» сотрудников — тех, кто отвечает в чатах от имени поддержки,
 * но НЕ зарегистрирован в support_agents. Их сообщения видны клиентам, но
 * НЕ учитываются в дашбордах и аналитике агентов.
 *
 *   GET /agents/unregistered[?days=30]
 *
 * Возвращает массив групп по telegram-юзеру с метриками:
 *   - sender_id, sender_name, sender_username
 *   - messages: сколько сообщений отправлено
 *   - channels: в скольких каналах отвечал
 *   - firstSeen, lastSeen
 *   - matched: похожие имена среди зарегистрированных агентов (чтобы понять,
 *     не дубль ли это)
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))

  try {
    // Группируем сообщения от не-клиентов по sender_id+sender_name,
    // оставляя только тех, кого нет в support_agents.
    const rows = await sql`
      WITH msg_senders AS (
        SELECT
          m.sender_id,
          MAX(m.sender_name)        AS sender_name,
          MAX(m.sender_username)    AS sender_username,
          COUNT(*)::int             AS messages,
          COUNT(DISTINCT m.channel_id)::int AS channels,
          MIN(m.created_at)         AS first_seen,
          MAX(m.created_at)         AS last_seen
        FROM support_messages m
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = false
          AND m.sender_role <> 'broadcast'
          AND m.created_at > NOW() - make_interval(days => ${days}::int)
          AND m.sender_id IS NOT NULL
        GROUP BY m.sender_id
      )
      SELECT s.*
      FROM msg_senders s
      LEFT JOIN support_agents a
        ON a.telegram_id::text = s.sender_id::text
       AND a.org_id = ${orgId}
      WHERE a.id IS NULL
      ORDER BY s.messages DESC
      LIMIT 50
    `

    // Для каждого «теневого» юзера ищем похожих агентов по имени.
    const result = await Promise.all((rows as any[]).map(async (r) => {
      const name = r.sender_name || ''
      let matched: any[] = []
      if (name.length >= 3) {
        try {
          matched = await sql`
            SELECT id, name, username, telegram_id
            FROM support_agents
            WHERE org_id = ${orgId}
              AND (
                LOWER(name) = LOWER(${name})
                OR (LENGTH(${name}) >= 4 AND name ILIKE ${`%${name}%`})
                OR (${r.sender_username || null}::text IS NOT NULL
                    AND LOWER(username) = LOWER(${r.sender_username || ''}))
              )
            LIMIT 5
          ` as any[]
        } catch {
          matched = []
        }
      }
      return {
        senderId: r.sender_id,
        senderName: r.sender_name,
        senderUsername: r.sender_username,
        messages: r.messages,
        channels: r.channels,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        possibleMatches: matched.map((a) => ({
          id: a.id,
          name: a.name,
          username: a.username,
          telegramId: a.telegram_id,
        })),
        canBindBy: 'telegram_id',
      }
    }))

    return json({
      success: true,
      orgId,
      windowDays: days,
      total: result.length,
      hint: result.length > 0
        ? 'Эти сотрудники отвечают клиентам, но не считаются в аналитике. ' +
          'Зарегистрируйте их через /agents/register или привяжите telegram_id ' +
          'к существующему агенту через /agents/bind.'
        : 'Все сотрудники, отвечающие клиентам, учтены в системе.',
      shadowSenders: result,
    })
  } catch (e: any) {
    console.error('[agents/unregistered] error:', e)
    return json({ success: false, error: e?.message || 'error' }, 500)
  }
}
