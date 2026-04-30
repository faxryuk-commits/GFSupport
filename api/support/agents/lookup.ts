import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * Отладочный endpoint: ищет конкретного отправителя ВО ВСЕХ релевантных
 * таблицах БД, чтобы понять «почему его не видно в дашборде».
 *
 *   GET /agents/lookup?senderId=<id>
 *   GET /agents/lookup?name=<part>
 *   GET /agents/lookup?username=<part>
 *
 * Проверяет:
 *  - support_agents (с любым org_id, в т.ч. NULL и другим)
 *  - crm_managers
 *  - support_users
 *  - последние сообщения этого отправителя
 *
 * Вернёт «карту» где этот человек есть и почему он не попадает в стандартный
 * список агентов (например: «есть в support_agents, но org_id=null» или
 * «есть в crm_managers с role=manager, поэтому не агент поддержки»).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() })
  }
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const callerOrgId = await getRequestOrgId(req)
  const senderId = url.searchParams.get('senderId') || ''
  const namePart = url.searchParams.get('name') || ''
  const userPart = url.searchParams.get('username') || ''

  if (!senderId && !namePart && !userPart) {
    return json({ error: 'senderId | name | username required' }, 400)
  }

  const namePattern = namePart ? `%${namePart}%` : null
  const userPattern = userPart ? `%${userPart.replace('@', '')}%` : null

  try {
    const results: any = {
      callerOrgId,
      query: { senderId, name: namePart, username: userPart },
      found: {},
    }

    // 1. support_agents — везде, без org_id фильтра
    try {
      results.found.supportAgents = await sql`
        SELECT id, org_id, name, username, telegram_id, email, role,
               created_at, deleted_at IS NOT NULL AS is_deleted
        FROM support_agents
        WHERE
          (${senderId || null}::text IS NOT NULL AND (
              telegram_id::text = ${senderId || ''}
              OR id = ${senderId || ''}
              OR LOWER(username) = LOWER(${senderId || ''})
          ))
          OR (${namePattern}::text IS NOT NULL AND name ILIKE ${namePattern})
          OR (${userPattern}::text IS NOT NULL AND username ILIKE ${userPattern})
        LIMIT 20
      `
    } catch (e: any) {
      results.found.supportAgents_error = e?.message
      // Fallback на старую схему без deleted_at
      try {
        results.found.supportAgents = await sql`
          SELECT id, org_id, name, username, telegram_id, email, role, created_at
          FROM support_agents
          WHERE
            (${senderId || null}::text IS NOT NULL AND (
                telegram_id::text = ${senderId || ''}
                OR id = ${senderId || ''}
                OR LOWER(username) = LOWER(${senderId || ''})
            ))
            OR (${namePattern}::text IS NOT NULL AND name ILIKE ${namePattern})
            OR (${userPattern}::text IS NOT NULL AND username ILIKE ${userPattern})
          LIMIT 20
        `
      } catch (e2: any) {
        results.found.supportAgents_error2 = e2?.message
      }
    }

    // 2. crm_managers (если таблица существует)
    try {
      results.found.crmManagers = await sql`
        SELECT id, name, telegram_username, telegram_id, role
        FROM crm_managers
        WHERE
          (${senderId || null}::text IS NOT NULL AND (
              telegram_id::text = ${senderId || ''}
              OR id = ${senderId || ''}
              OR LOWER(telegram_username) = LOWER(${(senderId || '').replace('@', '')})
          ))
          OR (${namePattern}::text IS NOT NULL AND name ILIKE ${namePattern})
          OR (${userPattern}::text IS NOT NULL AND telegram_username ILIKE ${userPattern})
        LIMIT 20
      `
    } catch (e: any) {
      results.found.crmManagers_error = e?.message
    }

    // 3. support_users (Telegram-юзеры всех типов)
    try {
      results.found.supportUsers = await sql`
        SELECT user_id, name, username, role,
               last_seen_at, created_at
        FROM support_users
        WHERE
          (${senderId || null}::text IS NOT NULL AND (
              user_id::text = ${senderId || ''}
              OR LOWER(username) = LOWER(${(senderId || '').replace('@', '')})
          ))
          OR (${namePattern}::text IS NOT NULL AND name ILIKE ${namePattern})
          OR (${userPattern}::text IS NOT NULL AND username ILIKE ${userPattern})
        LIMIT 20
      `
    } catch (e: any) {
      results.found.supportUsers_error = e?.message
    }

    // 4. Образцы недавних сообщений с этим sender_id
    if (senderId) {
      try {
        results.found.recentMessages = await sql`
          SELECT id, channel_id, org_id, sender_id, sender_name,
                 sender_username, sender_role, is_from_client, created_at
          FROM support_messages
          WHERE sender_id::text = ${senderId}
          ORDER BY created_at DESC
          LIMIT 5
        `
      } catch (e: any) {
        results.found.recentMessages_error = e?.message
      }
    }

    // 5. Анализ — почему его не видно в дашборде
    const analysis: string[] = []
    const sa = results.found.supportAgents || []
    if (sa.length === 0) {
      analysis.push('В support_agents записи нет — поэтому он не появится в дашборде агентов.')
    } else {
      for (const a of sa) {
        if (a.org_id && a.org_id !== callerOrgId) {
          analysis.push(`Найден в support_agents, но с org_id="${a.org_id}" (вы запрашиваете под "${callerOrgId}"). Поэтому скрыт фильтром.`)
        } else if (!a.org_id) {
          analysis.push(`Найден в support_agents, но org_id IS NULL. Не будет учтён фильтром по org_id.`)
        }
        if (a.is_deleted) {
          analysis.push(`Найден в support_agents, но помечен как удалённый (deleted_at IS NOT NULL).`)
        }
      }
    }

    const cm = results.found.crmManagers || []
    if (cm.length > 0) {
      analysis.push(`Найден в crm_managers (${cm.length}). Эта таблица влияет на identifySender, но НЕ показывается в /agents.`)
    }

    if (results.found.recentMessages?.length > 0) {
      const last = results.found.recentMessages[0]
      analysis.push(`Последние сообщения сохранены с sender_role="${last.sender_role}", org_id="${last.org_id}", is_from_client=${last.is_from_client}.`)
    }

    results.analysis = analysis.length > 0 ? analysis : ['Никаких отклонений не обнаружено.']

    return json({ success: true, ...results })
  } catch (e: any) {
    console.error('[agents/lookup] error:', e)
    return json({ success: false, error: e?.message || 'lookup error' }, 500)
  }
}
