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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // GET - список кейсов
  if (req.method === 'GET') {
    try {
      const statusParam = url.searchParams.get('status')
      const priority = url.searchParams.get('priority')
      const channelId = url.searchParams.get('channelId')
      const assignedTo = url.searchParams.get('assignedTo')
      const search = url.searchParams.get('search')
      const limitParam = parseInt(url.searchParams.get('limit') || '50')
      const offsetParam = parseInt(url.searchParams.get('offset') || '0')

      // Парсим статусы
      const statuses = statusParam && statusParam !== 'all' 
        ? statusParam.split(',').map(s => s.trim())
        : null

      // Простые запросы без вложенных sql``
      let cases
      
      if (statuses && statuses.length > 0) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.status = ANY(${statuses})
          ORDER BY 
            CASE c.priority 
              WHEN 'urgent' THEN 1 
              WHEN 'high' THEN 2 
              WHEN 'medium' THEN 3 
              ELSE 4 
            END,
            c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (priority) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.priority = ${priority}
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (channelId) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.channel_id = ${channelId}
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (assignedTo) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.assigned_to = ${assignedTo}
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (search) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          WHERE c.title ILIKE ${'%' + search + '%'} OR c.description ILIKE ${'%' + search + '%'}
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          ORDER BY 
            CASE c.priority 
              WHEN 'urgent' THEN 1 
              WHEN 'high' THEN 2 
              WHEN 'medium' THEN 3 
              ELSE 4 
            END,
            c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      }

      // Общее количество
      const countResult = await sql`SELECT COUNT(*) as total FROM support_cases`
      const total = parseInt(countResult[0]?.total || '0')

      // Статистика по статусам
      const statsResult = await sql`
        SELECT status, COUNT(*) as count 
        FROM support_cases 
        GROUP BY status
      `
      const stats = Object.fromEntries(statsResult.map((s: any) => [s.status, parseInt(s.count)]))

      return json({
        cases: cases.map((c: any) => ({
          id: c.id,
          ticketNumber: c.ticket_number,
          channelId: c.channel_id,
          channelName: c.channel_name || 'Без канала',
          telegramChatId: c.telegram_chat_id,
          companyId: c.company_id,
          companyName: c.channel_name || 'Компания',
          leadId: c.lead_id,
          title: c.title || 'Без названия',
          description: c.description || '',
          status: c.status || 'detected',
          category: c.category || 'general',
          subcategory: c.subcategory,
          rootCause: c.root_cause,
          priority: c.priority || 'medium',
          severity: c.severity,
          assignedTo: c.assigned_to,
          assigneeName: c.assigned_to ? 'Назначен' : null,
          firstResponseAt: c.first_response_at,
          resolvedAt: c.resolved_at,
          resolutionTimeMinutes: c.resolution_time_minutes,
          resolutionNotes: c.resolution_notes,
          impactMrr: parseFloat(c.impact_mrr || 0),
          churnRiskScore: c.churn_risk_score,
          isRecurring: c.is_recurring,
          relatedCaseId: c.related_case_id,
          tags: c.tags || [],
          messagesCount: parseInt(c.messages_count || 0),
          messageId: c.source_message_id,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        })),
        total,
        limit: limitParam,
        offset: offsetParam,
        hasMore: offsetParam + limitParam < total,
        stats
      })

    } catch (e: any) {
      console.error('Cases fetch error:', e)
      return json({ error: 'Failed to fetch cases', details: e.message }, 500)
    }
  }

  // POST - создать кейс
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        channelId, companyId, leadId, title, description,
        category, subcategory, priority, severity, assignedTo, tags
      } = body

      if (!title) {
        return json({ error: 'Title is required' }, 400)
      }

      const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Получаем следующий номер тикета
      let ticketNumber = 1
      try {
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1')
      } catch {
        try {
          await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1`
          const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
          ticketNumber = parseInt(seqResult[0]?.num || '1')
        } catch {
          // Если sequence не работает, генерируем из timestamp
          ticketNumber = Math.floor(Date.now() / 1000) % 100000
        }
      }
      
      await sql`
        INSERT INTO support_cases (
          id, ticket_number, channel_id, company_id, lead_id, title, description,
          category, subcategory, priority, severity, assigned_to, tags
        ) VALUES (
          ${caseId},
          ${ticketNumber},
          ${channelId || null},
          ${companyId || null},
          ${leadId || null},
          ${title},
          ${description || null},
          ${category || null},
          ${subcategory || null},
          ${priority || 'medium'},
          ${severity || 'normal'},
          ${assignedTo || null},
          ${tags || []}
        )
      `

      return json({
        success: true,
        caseId,
        ticketNumber,
        message: 'Case created'
      })

    } catch (e: any) {
      console.error('Case create error:', e)
      return json({ error: 'Failed to create case', details: e.message }, 500)
    }
  }

  // PUT - обновить кейс
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { id, status, priority, assignedTo, title, description } = body

      if (!id) {
        return json({ error: 'Case ID required' }, 400)
      }

      await sql`
        UPDATE support_cases SET
          status = COALESCE(${status}, status),
          priority = COALESCE(${priority}, priority),
          assigned_to = COALESCE(${assignedTo}, assigned_to),
          title = COALESCE(${title}, title),
          description = COALESCE(${description}, description),
          updated_at = NOW()
        WHERE id = ${id}
      `

      return json({ success: true, caseId: id })

    } catch (e: any) {
      return json({ error: 'Failed to update case', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
