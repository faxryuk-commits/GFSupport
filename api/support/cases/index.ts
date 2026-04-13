import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  // GET - список кейсов
  if (req.method === 'GET') {
    try {
      const statusParam = url.searchParams.get('status')
      const priority = url.searchParams.get('priority')
      const channelId = url.searchParams.get('channelId')
      const assignedTo = url.searchParams.get('assignedTo')
      const search = url.searchParams.get('search')
      const market = url.searchParams.get('market') || null
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
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND c.status = ANY(${statuses}) AND (${market}::text IS NULL OR c.market_id = ${market})
          ORDER BY CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (priority) {
        cases = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND c.priority = ${priority} AND (${market}::text IS NULL OR c.market_id = ${market})
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (channelId) {
        cases = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND c.channel_id = ${channelId}
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (assignedTo) {
        cases = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND c.assigned_to = ${assignedTo} AND (${market}::text IS NULL OR c.market_id = ${market})
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else if (search) {
        cases = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND (c.title ILIKE ${'%' + search + '%'} OR c.description ILIKE ${'%' + search + '%'})
            AND (${market}::text IS NULL OR c.market_id = ${market})
          ORDER BY c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      } else {
        cases = await sql`
          SELECT c.*, ch.name as channel_name, ch.telegram_chat_id, ch.company_id as ch_company_id,
            a.name as assignee_name,
            (SELECT COUNT(*) FROM support_messages WHERE case_id = c.id AND org_id = ${orgId}) as messages_count,
            (SELECT sender_name FROM support_messages WHERE case_id = c.id AND org_id = ${orgId} ORDER BY created_at ASC LIMIT 1) as reporter_name
          FROM support_cases c
          LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
          LEFT JOIN support_agents a ON c.assigned_to = a.id
          WHERE c.org_id = ${orgId} AND (${market}::text IS NULL OR c.market_id = ${market})
          ORDER BY CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `
      }

      const countResult = await sql`SELECT COUNT(*) as total FROM support_cases WHERE org_id = ${orgId} AND (${market}::text IS NULL OR market_id = ${market})`
      const total = parseInt(countResult[0]?.total || '0')

      // Статистика по статусам
      const statsResult = await sql`
        SELECT status, COUNT(*) as count 
        FROM support_cases 
        WHERE org_id = ${orgId}
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
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases WHERE org_id = ${orgId}`
        const maxNum = parseInt(maxResult[0]?.max_num || '1000')
        await sql`SELECT setval('support_case_ticket_seq', GREATEST(nextval('support_case_ticket_seq'), ${maxNum + 1}), false)`
        const seqResult = await sql`SELECT nextval('support_case_ticket_seq') as num`
        ticketNumber = parseInt(seqResult[0]?.num || '1001')
      } catch {
        // Fallback: use max + 1
        const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as max_num FROM support_cases WHERE org_id = ${orgId}`
        ticketNumber = parseInt(maxResult[0]?.max_num || '1000') + 1
      }
      
      await sql`
        INSERT INTO support_cases (
          id, org_id, ticket_number, channel_id, company_id, lead_id, title, description,
          category, subcategory, priority, severity, assigned_to, tags
        ) VALUES (
          ${caseId},
          ${orgId},
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
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        LEFT JOIN support_agents a ON c.assigned_to = a.id
        WHERE c.id = ${caseId} AND c.org_id = ${orgId}
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
      const { id, status, priority, assignedTo, title, description, action } = body

      if (!id) {
        return json({ error: 'Case ID required' }, 400)
      }

      // Добавление комментария
      if (action === 'add_comment') {
        const { text, isInternal, authorName, authorId } = body
        if (!text) return json({ error: 'Comment text required' }, 400)

        try {
          await sql`CREATE TABLE IF NOT EXISTS support_case_comments (
            id VARCHAR(50) PRIMARY KEY,
            case_id VARCHAR(50) NOT NULL,
            author_id VARCHAR(50),
            author_name VARCHAR(255),
            text TEXT NOT NULL,
            is_internal BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
          )`
        } catch { /* exists */ }

        const commentId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO support_case_comments (id, case_id, author_id, author_name, text, is_internal)
          VALUES (${commentId}, ${id}, ${authorId || null}, ${authorName || 'Система'}, ${text}, ${isInternal || false})
        `
        await sql`UPDATE support_cases SET updated_at = NOW() WHERE id = ${id} AND org_id = ${orgId}`

        const comments = await sql`
          SELECT id, author_id, author_name, text, is_internal, created_at
          FROM support_case_comments WHERE case_id = ${id} ORDER BY created_at ASC
        `

        return json({
          success: true,
          commentId,
          comments: comments.map((c: any) => ({
            id: c.id,
            author: c.author_name || 'Система',
            authorId: c.author_id,
            text: c.text,
            isInternal: c.is_internal,
            time: c.created_at,
          })),
        })
      }

      // Получение комментариев
      if (action === 'get_comments') {
        try {
          await sql`CREATE TABLE IF NOT EXISTS support_case_comments (
            id VARCHAR(50) PRIMARY KEY,
            case_id VARCHAR(50) NOT NULL,
            author_id VARCHAR(50),
            author_name VARCHAR(255),
            text TEXT NOT NULL,
            is_internal BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
          )`
        } catch { /* exists */ }

        const comments = await sql`
          SELECT id, author_id, author_name, text, is_internal, created_at
          FROM support_case_comments WHERE case_id = ${id} ORDER BY created_at ASC
        `

        return json({
          comments: comments.map((c: any) => ({
            id: c.id,
            author: c.author_name || 'Система',
            authorId: c.author_id,
            text: c.text,
            isInternal: c.is_internal,
            time: c.created_at,
          })),
        })
      }

      await sql`
        UPDATE support_cases SET
          status = COALESCE(${status}, status),
          priority = COALESCE(${priority}, priority),
          assigned_to = COALESCE(${assignedTo}, assigned_to),
          title = COALESCE(${title}, title),
          description = COALESCE(${description}, description),
          updated_at = NOW()
        WHERE id = ${id} AND org_id = ${orgId}
      `

      return json({ success: true, caseId: id })

    } catch (e: any) {
      return json({ error: 'Failed to update case', details: e.message }, 500)
    }
  }

  // DELETE - удалить кейс
  if (req.method === 'DELETE') {
    try {
      const caseId = url.searchParams.get('id')
      if (!caseId) return json({ error: 'Case ID required' }, 400)

      await sql`DELETE FROM support_case_comments WHERE case_id = ${caseId}`.catch(() => {})
      await sql`UPDATE support_messages SET case_id = NULL WHERE case_id = ${caseId} AND org_id = ${orgId}`.catch(() => {})
      await sql`DELETE FROM support_case_activities WHERE case_id = ${caseId}`.catch(() => {})
      await sql`DELETE FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId}`

      return json({ success: true, deleted: caseId })
    } catch (e: any) {
      return json({ error: 'Failed to delete case', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
