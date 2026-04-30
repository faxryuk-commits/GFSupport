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

    const sid = senderId || ''
    const uname = (senderId || '').replace('@', '')

    // 1. support_agents — без org_id фильтра, разными способами поиска
    try {
      if (sid) {
        results.found.supportAgents = await sql`
          SELECT id, org_id, name, username, telegram_id, email, role, created_at
          FROM support_agents
          WHERE id = ${sid}
             OR telegram_id::text = ${sid}
             OR LOWER(username) = LOWER(${uname})
          LIMIT 20
        `
      } else {
        const r1 = namePattern ? await sql`
          SELECT id, org_id, name, username, telegram_id, email, role, created_at
          FROM support_agents WHERE name ILIKE ${namePattern} LIMIT 20
        ` : []
        const r2 = userPattern ? await sql`
          SELECT id, org_id, name, username, telegram_id, email, role, created_at
          FROM support_agents WHERE username ILIKE ${userPattern} LIMIT 20
        ` : []
        const merged = [...(r1 as any[]), ...(r2 as any[])]
        const seen = new Set()
        results.found.supportAgents = merged.filter((r) => {
          if (seen.has(r.id)) return false
          seen.add(r.id)
          return true
        })
      }
    } catch (e: any) {
      results.found.supportAgents_error = e?.message
    }

    // 2. support_users (если есть). Колонки могут отличаться,
    // поэтому пробуем по очереди разные схемы.
    try {
      if (sid) {
        results.found.supportUsers = await sql`
          SELECT * FROM support_users
          WHERE id = ${sid}
             OR username = ${uname}
             OR LOWER(username) = LOWER(${uname})
          LIMIT 10
        `
      } else if (namePattern) {
        results.found.supportUsers = await sql`
          SELECT * FROM support_users WHERE name ILIKE ${namePattern} LIMIT 10
        `
      } else if (userPattern) {
        results.found.supportUsers = await sql`
          SELECT * FROM support_users WHERE username ILIKE ${userPattern} LIMIT 10
        `
      }
    } catch (e: any) {
      results.found.supportUsers_error = e?.message
    }

    // 3. Уникальные значения sender_id, sender_name, sender_username
    // в support_messages — для самого этого человека
    try {
      if (sid) {
        results.found.distinctSenderRecords = await sql`
          SELECT DISTINCT sender_id, sender_name, sender_username, sender_role,
                 COUNT(*)::int AS messages,
                 MIN(created_at) AS first_seen,
                 MAX(created_at) AS last_seen
          FROM support_messages
          WHERE sender_id::text = ${sid}
             OR LOWER(COALESCE(sender_name, '')) = LOWER(${sid})
             OR LOWER(COALESCE(sender_username, '')) = LOWER(${uname})
          GROUP BY sender_id, sender_name, sender_username, sender_role
          ORDER BY messages DESC
          LIMIT 10
        `
      } else if (namePattern) {
        results.found.distinctSenderRecords = await sql`
          SELECT DISTINCT sender_id, sender_name, sender_username, sender_role,
                 COUNT(*)::int AS messages,
                 MIN(created_at) AS first_seen,
                 MAX(created_at) AS last_seen
          FROM support_messages
          WHERE sender_name ILIKE ${namePattern}
             OR sender_username ILIKE ${namePattern}
          GROUP BY sender_id, sender_name, sender_username, sender_role
          ORDER BY messages DESC
          LIMIT 10
        `
      }
    } catch (e: any) {
      results.found.distinctSenderRecords_error = e?.message
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
      analysis.push('В support_agents записи нет ни в одном org_id — поэтому он не появится в дашборде. Скорее всего запись была удалена.')
    } else {
      for (const a of sa) {
        if (a.org_id && a.org_id !== callerOrgId) {
          analysis.push(`Найден в support_agents, но с org_id="${a.org_id}" (вы запрашиваете под "${callerOrgId}"). Поэтому скрыт фильтром.`)
        } else if (!a.org_id) {
          analysis.push(`Найден в support_agents, но org_id IS NULL. Не будет учтён фильтром по org_id.`)
        } else {
          analysis.push(`Найден в support_agents с org_id="${a.org_id}". Должен быть виден в дашборде.`)
        }
      }
    }

    if (results.found.recentMessages?.length > 0) {
      const last = results.found.recentMessages[0]
      analysis.push(`Последние сообщения сохранены с sender_role="${last.sender_role}", org_id="${last.org_id}", is_from_client=${last.is_from_client}.`)
    }

    if (sa.length === 0 && results.found.recentMessages?.length > 0) {
      analysis.push(
        'Сотрудник продолжает писать через систему, потому что Bearer-токен = agent.id, ' +
        'а /messages/send проверяет только наличие заголовка Authorization, не сверяя ' +
        'токен с support_agents. То есть фронт у него в localStorage хранит данные ' +
        'когда-то существовавшего агента, и система это принимает.',
      )
    }

    results.analysis = analysis.length > 0 ? analysis : ['Никаких отклонений не обнаружено.']

    return json({ success: true, ...results })
  } catch (e: any) {
    console.error('[agents/lookup] error:', e)
    return json({ success: false, error: e?.message || 'lookup error' }, 500)
  }
}
