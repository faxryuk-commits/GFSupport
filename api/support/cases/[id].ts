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

const VALID_STATUSES = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved', 'closed', 'recurring']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/')
  const caseId = pathParts[pathParts.length - 1]

  if (!caseId || caseId === 'cases') {
    return json({ error: 'Case ID required' }, 400)
  }

  const sql = getSQL()

  // GET - получить кейс с историей
  if (req.method === 'GET') {
    try {
      const caseResult = await sql`
        SELECT 
          c.*,
          ch.name as channel_name,
          ch.telegram_chat_id,
          comp.name as company_name,
          m.name as assignee_name
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        LEFT JOIN crm_companies comp ON c.company_id = comp.id
        LEFT JOIN crm_managers m ON c.assigned_to = m.id
        WHERE c.id = ${caseId}
      `

      if (!caseResult || caseResult.length === 0) {
        return json({ error: 'Case not found' }, 404)
      }

      const c = caseResult[0]

      // Получаем историю активностей
      const activities = await sql`
        SELECT 
          a.*,
          m.name as manager_name
        FROM support_case_activities a
        LEFT JOIN crm_managers m ON a.manager_id = m.id
        WHERE a.case_id = ${caseId}
        ORDER BY a.created_at DESC
        LIMIT 50
      `

      // Получаем связанные сообщения
      const messages = await sql`
        SELECT * FROM support_messages
        WHERE case_id = ${caseId}
        ORDER BY created_at ASC
        LIMIT 100
      `

      return json({
        case: {
          id: c.id,
          channelId: c.channel_id,
          channelName: c.channel_name,
          telegramChatId: c.telegram_chat_id,
          companyId: c.company_id,
          companyName: c.company_name,
          leadId: c.lead_id,
          title: c.title,
          description: c.description,
          status: c.status,
          category: c.category,
          subcategory: c.subcategory,
          rootCause: c.root_cause,
          priority: c.priority,
          severity: c.severity,
          assignedTo: c.assigned_to,
          assigneeName: c.assignee_name,
          firstResponseAt: c.first_response_at,
          resolvedAt: c.resolved_at,
          resolutionTimeMinutes: c.resolution_time_minutes,
          resolutionNotes: c.resolution_notes,
          impactMrr: parseFloat(c.impact_mrr || 0),
          churnRiskScore: c.churn_risk_score,
          isRecurring: c.is_recurring,
          relatedCaseId: c.related_case_id,
          tags: c.tags || [],
          metadata: c.metadata || {},
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        },
        activities: activities.map((a: any) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          description: a.description,
          fromStatus: a.from_status,
          toStatus: a.to_status,
          managerId: a.manager_id,
          managerName: a.manager_name,
          metadata: a.metadata,
          createdAt: a.created_at,
        })),
        messages: messages.map((m: any) => ({
          id: m.id,
          telegramMessageId: m.telegram_message_id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          senderUsername: m.sender_username,
          isFromClient: m.is_from_client,
          contentType: m.content_type,
          textContent: m.text_content,
          mediaUrl: m.media_url,
          transcript: m.transcript,
          aiSummary: m.ai_summary,
          aiCategory: m.ai_category,
          aiSentiment: m.ai_sentiment,
          aiIntent: m.ai_intent,
          aiUrgency: m.ai_urgency,
          isProblem: m.is_problem,
          createdAt: m.created_at,
        }))
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch case', details: e.message }, 500)
    }
  }

  // PUT/PATCH - обновить кейс
  if (req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const body = await req.json()
      const { 
        status, priority, severity, category, subcategory, rootCause,
        assignedTo, description, resolutionNotes, tags, impactMrr, churnRiskScore,
        updatedBy // ID менеджера который делает изменение
      } = body

      // Получаем текущий статус для истории
      const current = await sql`SELECT status, assigned_to FROM support_cases WHERE id = ${caseId}`
      if (!current || current.length === 0) {
        return json({ error: 'Case not found' }, 404)
      }

      const oldStatus = current[0].status
      const oldAssignee = current[0].assigned_to

      // Формируем update (updated_by временно отключен - нужна миграция БД)
      const updates: any = { updated_at: new Date() }
      
      if (status && VALID_STATUSES.includes(status)) {
        updates.status = status
        if (status === 'resolved' || status === 'closed') {
          updates.resolved_at = new Date()
          // Вычисляем время решения
          const caseData = await sql`SELECT created_at FROM support_cases WHERE id = ${caseId}`
          if (caseData[0]) {
            const created = new Date(caseData[0].created_at)
            updates.resolution_time_minutes = Math.floor((Date.now() - created.getTime()) / 60000)
          }
        }
      }
      if (priority) updates.priority = priority
      if (severity) updates.severity = severity
      if (category !== undefined) updates.category = category
      if (subcategory !== undefined) updates.subcategory = subcategory
      if (rootCause !== undefined) updates.root_cause = rootCause
      if (assignedTo !== undefined) updates.assigned_to = assignedTo
      if (description !== undefined) updates.description = description
      if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes
      if (tags !== undefined) updates.tags = tags
      if (impactMrr !== undefined) updates.impact_mrr = impactMrr
      if (churnRiskScore !== undefined) updates.churn_risk_score = churnRiskScore

      // Обновляем кейс
      await sql`
        UPDATE support_cases SET
          status = COALESCE(${updates.status}, status),
          priority = COALESCE(${updates.priority}, priority),
          severity = COALESCE(${updates.severity}, severity),
          category = COALESCE(${updates.category}, category),
          subcategory = COALESCE(${updates.subcategory}, subcategory),
          root_cause = COALESCE(${updates.root_cause}, root_cause),
          assigned_to = ${updates.assigned_to !== undefined ? updates.assigned_to : sql`assigned_to`},
          description = COALESCE(${updates.description}, description),
          resolution_notes = COALESCE(${updates.resolution_notes}, resolution_notes),
          tags = COALESCE(${updates.tags}, tags),
          impact_mrr = COALESCE(${updates.impact_mrr}, impact_mrr),
          churn_risk_score = COALESCE(${updates.churn_risk_score}, churn_risk_score),
          resolved_at = ${updates.resolved_at || sql`resolved_at`},
          resolution_time_minutes = ${updates.resolution_time_minutes || sql`resolution_time_minutes`},
          updated_at = NOW()
        WHERE id = ${caseId}
      `

      // Создаём записи в истории для значимых изменений
      if (status && status !== oldStatus) {
        await sql`
          INSERT INTO support_case_activities (id, case_id, type, title, from_status, to_status)
          VALUES (
            ${'act_' + Date.now()},
            ${caseId},
            'status_change',
            'Статус изменён',
            ${oldStatus},
            ${status}
          )
        `
      }

      if (assignedTo !== undefined && assignedTo !== oldAssignee) {
        await sql`
          INSERT INTO support_case_activities (id, case_id, type, title, description)
          VALUES (
            ${'act_' + Date.now() + '_assign'},
            ${caseId},
            'assignment',
            'Назначен ответственный',
            ${assignedTo ? 'Назначен новый ответственный' : 'Ответственный снят'}
          )
        `
      }

      // Получаем обновлённый кейс для возврата
      const updated = await sql`
        SELECT c.*, ch.name as channel_name
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.id = ${caseId}
      `
      
      const c = updated[0]

      return json({
        success: true,
        caseId,
        message: 'Case updated',
        case: {
          id: c.id,
          ticketNumber: c.ticket_number,
          channelId: c.channel_id,
          channelName: c.channel_name || 'Без канала',
          title: c.title,
          description: c.description,
          status: c.status,
          category: c.category,
          priority: c.priority,
          assignedTo: c.assigned_to,
          tags: c.tags || [],
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        }
      })

    } catch (e: any) {
      console.error('Case update error:', e)
      return json({ error: 'Failed to update case', details: e.message }, 500)
    }
  }

  // DELETE - удалить кейс
  if (req.method === 'DELETE') {
    try {
      // Сначала удаляем связанные записи
      await sql`DELETE FROM support_case_activities WHERE case_id = ${caseId}`
      await sql`UPDATE support_messages SET case_id = NULL WHERE case_id = ${caseId}`
      
      // Удаляем кейс
      const result = await sql`DELETE FROM support_cases WHERE id = ${caseId} RETURNING id`
      
      if (!result || result.length === 0) {
        return json({ error: 'Case not found' }, 404)
      }

      return json({
        success: true,
        message: 'Case deleted'
      })

    } catch (e: any) {
      return json({ error: 'Failed to delete case', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
