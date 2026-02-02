import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * POST /api/support/db/rebalance-cases
 * 
 * Пересматривает статусы кейсов на основе логики:
 * - Если resolved_at заполнен -> resolved
 * - Если есть сообщение от поддержки -> in_progress  
 * - Если последнее сообщение от клиента и >24ч -> waiting
 * - Если кейс старше 7 дней без активности -> closed
 * - Новые без ответа -> detected
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || (!authHeader.includes('admin') && !authHeader.startsWith('Bearer '))) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const stats = { detected: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0, blocked: 0 }

  try {
    // Получаем все активные кейсы (не closed)
    const cases = await sql`
      SELECT 
        c.id, 
        c.status,
        c.channel_id,
        c.resolved_at,
        c.created_at,
        c.updated_at,
        (SELECT COUNT(*) FROM support_messages m WHERE m.case_id = c.id) as msg_count,
        (SELECT COUNT(*) FROM support_messages m WHERE m.case_id = c.id AND m.sender_role IN ('support', 'team')) as team_msgs,
        (SELECT MAX(created_at) FROM support_messages m WHERE m.case_id = c.id) as last_msg_at,
        (SELECT sender_role FROM support_messages m WHERE m.case_id = c.id ORDER BY created_at DESC LIMIT 1) as last_sender_role
      FROM support_cases c
      WHERE c.status != 'closed'
      ORDER BY c.created_at DESC
    `

    const now = new Date()
    const dayMs = 24 * 60 * 60 * 1000

    for (const c of cases) {
      let newStatus = c.status

      // Логика определения статуса
      if (c.resolved_at) {
        // Есть дата решения -> resolved
        newStatus = 'resolved'
      } else if (c.status === 'resolved') {
        // Уже resolved но без resolved_at - оставляем
        newStatus = 'resolved'
      } else {
        const createdAt = new Date(c.created_at)
        const lastMsgAt = c.last_msg_at ? new Date(c.last_msg_at) : createdAt
        const ageMs = now.getTime() - createdAt.getTime()
        const lastMsgAgeMs = now.getTime() - lastMsgAt.getTime()

        if (ageMs > 30 * dayMs && !c.team_msgs) {
          // Старше 30 дней без ответа команды -> closed
          newStatus = 'closed'
        } else if (c.team_msgs > 0) {
          // Есть ответы от поддержки
          if (c.last_sender_role === 'client' && lastMsgAgeMs > 2 * dayMs) {
            // Последнее сообщение от клиента >2 дней назад -> waiting (ждём ответа от нас)
            newStatus = 'waiting'
          } else if (c.last_sender_role === 'client') {
            // Последнее сообщение от клиента недавно -> in_progress
            newStatus = 'in_progress'
          } else {
            // Последнее сообщение от поддержки -> waiting (ждём клиента)
            newStatus = 'waiting'
          }
        } else {
          // Нет ответов от поддержки
          if (ageMs > 7 * dayMs) {
            // Старше 7 дней без ответа -> blocked (требует внимания)
            newStatus = 'blocked'
          } else if (ageMs > 2 * dayMs) {
            // 2-7 дней без ответа -> waiting
            newStatus = 'waiting'
          } else {
            // Новый кейс -> detected
            newStatus = 'detected'
          }
        }
      }

      // Обновляем если статус изменился
      if (newStatus !== c.status) {
        await sql`UPDATE support_cases SET status = ${newStatus}, updated_at = NOW() WHERE id = ${c.id}`
      }

      stats[newStatus as keyof typeof stats]++
    }

    // Получаем финальную статистику
    const finalStats = await sql`
      SELECT status, COUNT(*) as count 
      FROM support_cases 
      GROUP BY status
      ORDER BY 
        CASE status 
          WHEN 'detected' THEN 1 
          WHEN 'in_progress' THEN 2 
          WHEN 'waiting' THEN 3 
          WHEN 'blocked' THEN 4 
          WHEN 'resolved' THEN 5 
          WHEN 'closed' THEN 6 
        END
    `

    return json({
      success: true,
      casesProcessed: cases.length,
      newDistribution: Object.fromEntries(finalStats.map((s: any) => [s.status, parseInt(s.count)])),
      logic: {
        detected: 'Новые кейсы (< 2 дней) без ответа команды',
        in_progress: 'Есть ответ команды, клиент ответил недавно',
        waiting: 'Ждём ответа (от клиента или >2 дней без активности)',
        blocked: 'Без ответа 7+ дней, требует внимания',
        resolved: 'Есть resolved_at или уже resolved',
        closed: 'Неактивные >30 дней'
      }
    })

  } catch (e: any) {
    console.error('Rebalance error:', e)
    return json({ error: 'Failed to rebalance cases', details: e.message }, 500)
  }
}
