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

// Валидные статусы кейсов
const VALID_STATUSES = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved', 'closed', 'recurring']
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent']
const VALID_SEVERITIES = ['low', 'normal', 'high', 'critical']

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
      const companyId = url.searchParams.get('companyId')
      const assignedTo = url.searchParams.get('assignedTo')
      const search = url.searchParams.get('search')
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const offset = parseInt(url.searchParams.get('offset') || '0')

      // Парсим множественные статусы (status=open,in_progress,detected)
      const statuses = statusParam && statusParam !== 'all' 
        ? statusParam.split(',').map(s => s.trim())
        : null

      // Базовый запрос без JOIN на несуществующие таблицы
      let cases = await sql`
        SELECT 
          c.*,
          ch.name as channel_name,
          ch.telegram_chat_id,
          (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id) as messages_count
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE 1=1
          ${statuses && statuses.length > 0 ? sql`AND c.status = ANY(${statuses})` : sql``}
          ${priority ? sql`AND c.priority = ${priority}` : sql``}
          ${channelId ? sql`AND c.channel_id = ${channelId}` : sql``}
          ${companyId ? sql`AND c.company_id = ${companyId}` : sql``}
          ${assignedTo ? sql`AND c.assigned_to = ${assignedTo}` : sql``}
          ${search ? sql`AND (c.title ILIKE ${'%' + search + '%'} OR c.description ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY 
          CASE c.priority 
            WHEN 'urgent' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
          END,
          c.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      // Общее количество
      const countResult = await sql`
        SELECT COUNT(*) as total FROM support_cases c
        WHERE 1=1
          ${statuses && statuses.length > 0 ? sql`AND c.status = ANY(${statuses})` : sql``}
          ${priority ? sql`AND c.priority = ${priority}` : sql``}
          ${channelId ? sql`AND c.channel_id = ${channelId}` : sql``}
          ${companyId ? sql`AND c.company_id = ${companyId}` : sql``}
          ${assignedTo ? sql`AND c.assigned_to = ${assignedTo}` : sql``}
          ${search ? sql`AND (c.title ILIKE ${'%' + search + '%'} OR c.description ILIKE ${'%' + search + '%'})` : sql``}
      `

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
          companyName: c.channel_name || 'Компания', // Берём из канала
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
          assigneeName: c.assigned_to ? 'Назначен' : null, // TODO: получить имя из support_agents
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
        limit,
        offset,
        hasMore: offset + limit < total,
        stats
      })

    } catch (e: any) {
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
      
      // Получаем следующий номер тикета из sequence
      let ticketNumber = null
      try {
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1')
      } catch {
        // Sequence может не существовать - создаём
        await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1`
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1')
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

      // Создаём запись в истории
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, to_status)
        VALUES (
          ${'act_' + Date.now()},
          ${caseId},
          'created',
          ${'Тикет #' + String(ticketNumber).padStart(3, '0') + ' создан'},
          'detected'
        )
      `

      return json({
        success: true,
        caseId,
        ticketNumber,
        message: 'Case created'
      })

    } catch (e: any) {
      return json({ error: 'Failed to create case', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
