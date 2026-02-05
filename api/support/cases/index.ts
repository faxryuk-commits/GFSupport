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
      
      // Base query with JOINs for assignee name and company
      if (statuses && statuses.length > 0) {
        cases = await sql`
          SELECT 
            c.*,
            ch.name as channel_name,
            ch.telegram_chat_id,
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
            ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id
          LEFT JOIN support_agents a ON c.assigned_to = a.id
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
          companyId: c.company_id || c.ch_company_id,
          companyName: c.channel_name || 'Без компании', // TODO: JOIN with crm_companies when available
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
          assigneeName: c.assignee_name || null, // From JOIN with support_agents
          reporterName: c.reporter_name, // Кто инициировал тикет
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
          sourceMessageId: c.source_message_id, // Fixed: was 'messageId'
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          updatedBy: c.updated_by,
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
      console.log('Create case request body:', JSON.stringify(body))
      
      const { 
        channelId, companyId, companyName, leadId, title, description,
        category, subcategory, priority, severity, assignedTo, tags
      } = body

      if (!title) {
        return json({ error: 'Title is required' }, 400)
      }
      
      // Log what we're inserting
      console.log('Creating case with:', { 
        channelId: channelId || null, 
        companyId: companyId || null,
        companyName,
        title, 
        category, 
        priority 
      })

      const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Получаем следующий номер тикета
      let ticketNumber: number
      try {
        // Ensure sequence exists and synced with max ticket_number
        await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases`
        const maxNum = parseInt(maxResult[0]?.max_num || '1000')
        await sql`SELECT setval('support_case_ticket_seq', GREATEST(nextval('support_case_ticket_seq'), ${maxNum + 1}), false)`
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1001')
      } catch {
        // Fallback: use max + 1
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases`
        ticketNumber = parseInt(maxResult[0]?.max_num || '1000') + 1
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

      // Fetch created case with channel info for full response
      const createdCase = await sql`
        SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, a.name as assignee_name
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        LEFT JOIN support_agents a ON c.assigned_to = a.id
        WHERE c.id = ${caseId}
      `
      
      const c = createdCase[0]

      return json({
        success: true,
        caseId,
        ticketNumber,
        message: 'Case created',
        case: {
          id: c.id,
          ticketNumber: c.ticket_number,
          channelId: c.channel_id,
          channelName: c.channel_name || 'Без канала',
          telegramChatId: c.telegram_chat_id,
          companyId: c.company_id,
          companyName: c.channel_name || 'Без компании',
          leadId: c.lead_id,
          title: c.title,
          description: c.description || '',
          status: c.status || 'detected',
          category: c.category || 'general',
          subcategory: c.subcategory,
          priority: c.priority || 'medium',
          severity: c.severity,
          assignedTo: c.assigned_to,
          assigneeName: c.assignee_name,
          tags: c.tags || [],
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        }
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
