import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * Восстановление «теневого» сотрудника — того, кто отвечает в чатах,
 * но не имеет записи в support_agents (например, был удалён, но у него
 * остался валидный токен в localStorage и он продолжает писать).
 *
 *   POST /agents/restore
 *     {
 *       senderId: "agent_1769850773003_yab4",  // что было в support_messages.sender_id
 *       senderName?: "O.Behruz",                // опц., возьмётся из последнего сообщения
 *       senderUsername?: "Behruz",              // опц.
 *       telegramId?: string,                    // опц., если есть числовой telegram_id
 *       role?: "agent" | "manager" | "lead"     // по умолчанию agent
 *     }
 *
 * Логика:
 * 1. Читаем последние сообщения с этим sender_id, чтобы взять name/username
 *    если они не переданы.
 * 2. Если запись support_agents с таким id уже есть — возвращаем её
 *    (идемпотентно). Если есть запись с этим telegram_id — тоже.
 * 3. Иначе — INSERT с ТЕМ ЖЕ id (если это agent_xxx-формат), чтобы
 *    исторические 2153 сообщения сразу подтянулись в JOIN дашборда.
 *
 * Возвращает созданного/найденного агента + сколько сообщений сразу
 * стало ему «принадлежать».
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  let body: any = {}
  try { body = await req.json() } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const senderId = String(body.senderId || '').trim()
  if (!senderId) return json({ error: 'senderId_required' }, 400)

  let name = body.senderName ? String(body.senderName).trim() : ''
  let username = body.senderUsername ? String(body.senderUsername).replace('@', '').trim() : ''
  const telegramId = body.telegramId ? String(body.telegramId).trim() : null
  const role = String(body.role || 'agent')

  try {
    // 1. Если name/username не переданы — забираем из последнего сообщения
    if (!name || !username) {
      const [last] = await sql`
        SELECT sender_name, sender_username
        FROM support_messages
        WHERE sender_id::text = ${senderId} AND org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 1
      `
      if (last) {
        name = name || (last as any).sender_name || senderId
        username = username || ((last as any).sender_username || '').replace('@', '')
      }
    }
    if (!name) name = senderId

    // 2. Идемпотентность — может агент уже существует
    const [existing] = await sql`
      SELECT id, org_id, name, username, telegram_id, role, created_at
      FROM support_agents
      WHERE id = ${senderId}
         OR (${telegramId}::text IS NOT NULL AND telegram_id::text = ${telegramId})
         OR (${username}::text <> '' AND LOWER(username) = LOWER(${username}) AND org_id = ${orgId})
      LIMIT 1
    `
    if (existing) {
      const [{ count }] = (await sql`
        SELECT COUNT(*)::int AS count
        FROM support_messages
        WHERE org_id = ${orgId}
          AND is_from_client = false
          AND (sender_id::text = ${(existing as any).id}
               OR ((existing.telegram_id IS NOT NULL) AND sender_id::text = ${(existing as any).telegram_id || ''}))
      `) as any[]
      return json({
        success: true,
        action: 'already_exists',
        agent: {
          id: (existing as any).id,
          orgId: (existing as any).org_id,
          name: (existing as any).name,
          username: (existing as any).username,
          telegramId: (existing as any).telegram_id,
          role: (existing as any).role,
        },
        messagesAttached: count,
      })
    }

    // 3. Создаём запись с тем же id, чтобы исторические сообщения подтянулись.
    // Используем senderId как id агента, если он в формате agent_xxx,
    // иначе генерируем новый id и привязываем telegram_id.
    const id = senderId.startsWith('agent_')
      ? senderId
      : `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    const tgIdToStore = telegramId || (senderId.match(/^\d+$/) ? senderId : null)

    await sql`
      INSERT INTO support_agents (
        id, name, username, telegram_id, role, status, org_id, created_at
      )
      VALUES (
        ${id}, ${name}, ${username || null}, ${tgIdToStore},
        ${role}, 'offline', ${orgId}, NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `

    // 4. Считаем, сколько сообщений сразу подвязалось
    const [{ count }] = (await sql`
      SELECT COUNT(*)::int AS count
      FROM support_messages
      WHERE org_id = ${orgId}
        AND is_from_client = false
        AND (
          sender_id::text = ${id}
          OR (${tgIdToStore}::text IS NOT NULL AND sender_id::text = ${tgIdToStore})
          OR (${username}::text <> '' AND LOWER(sender_username) = LOWER(${username}))
        )
    `) as any[]

    return json({
      success: true,
      action: 'restored',
      agent: { id, orgId, name, username: username || null, telegramId: tgIdToStore, role },
      messagesAttached: count,
      message: `Сотрудник восстановлен. К нему привязано ${count} исторических сообщений.`,
    })
  } catch (e: any) {
    console.error('[agents/restore] error:', e)
    return json({ success: false, error: e?.message || 'restore error' }, 500)
  }
}
