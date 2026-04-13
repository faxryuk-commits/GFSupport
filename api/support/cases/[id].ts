import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

const VALID_STATUSES = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved', 'closed', 'recurring']

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

  const orgId = await getRequestOrgId(req)
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
          a.name as assignee_name
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        LEFT JOIN support_agents a ON c.assigned_to = a.id
        WHERE c.id = ${caseId} AND c.org_id = ${orgId}
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
        WHERE case_id = ${caseId} AND org_id = ${orgId}
        ORDER BY created_at ASC
        LIMIT 100
      `

      return json({
        case: {
          id: c.id,
          ticketNumber: c.ticket_number,
          channelId: c.channel_id,
          channelName: c.channel_name || 'Без канала',
          telegramChatId: c.telegram_chat_id,
          companyId: c.company_id,
          companyName: c.channel_name || 'Без компании', // TODO: JOIN with crm_companies
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
          assigneeName: c.assignee_name, // Now from support_agents
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
          sourceMessageId: c.source_message_id, // Added: was missing
          updatedBy: c.updated_by,
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
      return json({ error: 'Failed to fetch case' }, 500)
    }
  }

  // POST - добавить комментарий/активность к кейсу
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        text,           // текст комментария
        isInternal,     // внутренний комментарий (не виден клиенту)
        type = 'comment', // comment, note, escalation
        authorId,       // ID автора (агента/менеджера)
        authorName      // Имя автора
      } = body

      if (!text?.trim()) {
        return json({ error: 'Comment text is required' }, 400)
      }

      // Проверяем существование кейса
      const caseExists = await sql`SELECT id FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId}`
      if (!caseExists || caseExists.length === 0) {
        return json({ error: 'Case not found' }, 404)
      }

      const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Определяем тип и заголовок
      const activityType = type === 'escalation' ? 'escalation' 
        : type === 'note' ? 'internal_note' 
        : isInternal ? 'internal_comment' 
        : 'comment'
      
      const activityTitle = type === 'escalation' ? 'Эскалация'
        : type === 'note' ? 'Внутренняя заметка'
        : isInternal ? 'Внутренний комментарий'
        : 'Комментарий'

      await sql`
        INSERT INTO support_case_activities (
          id, case_id, type, title, description, manager_id, created_at
        ) VALUES (
          ${activityId},
          ${caseId},
          ${activityType},
          ${activityTitle},
          ${text},
          ${authorId || null},
          NOW()
        )
      `

      // Обновляем время изменения кейса
      await sql`UPDATE support_cases SET updated_at = NOW() WHERE id = ${caseId} AND org_id = ${orgId}`

      // Получаем созданную активность
      const [activity] = await sql`
        SELECT a.*, m.name as manager_name
        FROM support_case_activities a
        LEFT JOIN crm_managers m ON a.manager_id = m.id
        WHERE a.id = ${activityId}
      `

      return json({
        success: true,
        activity: {
          id: activity.id,
          caseId: activity.case_id,
          type: activity.type,
          title: activity.title,
          description: activity.description,
          authorId: activity.manager_id,
          authorName: activity.manager_name || authorName || 'Unknown',
          isInternal: activityType.includes('internal'),
          createdAt: activity.created_at,
        }
      })

    } catch (e: any) {
      console.error('Add comment error:', e)
      return json({ error: 'Failed to add comment' }, 500)
    }
  }

  // PUT/PATCH - обновить кейс или работа с комментариями
  if (req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const body = await req.json()
      const { action } = body

      // Добавление комментария
      if (action === 'add_comment') {
        const { text, isInternal, authorName, authorId } = body
        if (!text) return json({ error: 'Comment text required' }, 400)

        const commentId = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await sql`
          INSERT INTO support_case_comments (id, case_id, author_id, author_name, text, is_internal)
          VALUES (${commentId}, ${caseId}, ${authorId || null}, ${authorName || 'Система'}, ${text}, ${isInternal || false})
        `.catch(async () => {
          await sql`CREATE TABLE IF NOT EXISTS support_case_comments (
            id VARCHAR(50) PRIMARY KEY, case_id VARCHAR(50) NOT NULL, author_id VARCHAR(50),
            author_name VARCHAR(255), text TEXT NOT NULL, is_internal BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
          )`
          await sql`
            INSERT INTO support_case_comments (id, case_id, author_id, author_name, text, is_internal)
            VALUES (${commentId}, ${caseId}, ${authorId || null}, ${authorName || 'Система'}, ${text}, ${isInternal || false})
          `
        })
        await sql`UPDATE support_cases SET updated_at = NOW() WHERE id = ${caseId} AND org_id = ${orgId}`

        const comments = await sql`
          SELECT id, author_id, author_name, text, is_internal, created_at
          FROM support_case_comments WHERE case_id = ${caseId} ORDER BY created_at ASC
        `
        return json({
          success: true,
          commentId,
          comments: comments.map((c: any) => ({
            id: c.id, author: c.author_name || 'Система', authorId: c.author_id,
            text: c.text, isInternal: c.is_internal, time: c.created_at,
          })),
        })
      }

      // Получение комментариев
      if (action === 'get_comments') {
        const comments = await sql`
          SELECT id, author_id, author_name, text, is_internal, created_at
          FROM support_case_comments WHERE case_id = ${caseId} ORDER BY created_at ASC
        `.catch(() => [])

        return json({
          comments: comments.map((c: any) => ({
            id: c.id, author: c.author_name || 'Система', authorId: c.author_id,
            text: c.text, isInternal: c.is_internal, time: c.created_at,
          })),
        })
      }

      const { 
        status, priority, severity, category, subcategory, rootCause,
        assignedTo, description, resolutionNotes, tags, impactMrr, churnRiskScore,
        updatedBy
      } = body

      // Получаем текущий статус для истории
      const current = await sql`SELECT status, assigned_to FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId}`
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
          const caseData = await sql`SELECT created_at FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId}`
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
      
      // Handle assignedTo - verify agent exists or set null
      if (assignedTo !== undefined) {
        if (assignedTo && assignedTo !== '' && assignedTo !== 'null') {
          // Verify agent exists
          const agentExists = await sql`SELECT id FROM support_agents WHERE id = ${assignedTo} AND org_id = ${orgId} LIMIT 1`
          if (agentExists.length > 0) {
            updates.assigned_to = assignedTo
          } else {
            console.log(`[Cases] Agent ${assignedTo} not found, skipping assignment`)
            // Don't update assigned_to if agent doesn't exist
          }
        } else {
          // Allow unassigning (set to null)
          updates.assigned_to = null
        }
      }
      if (description !== undefined) updates.description = description
      if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes
      if (tags !== undefined) updates.tags = tags
      if (impactMrr !== undefined) updates.impact_mrr = impactMrr
      if (churnRiskScore !== undefined) updates.churn_risk_score = churnRiskScore

      // Обновляем кейс
      if (updates.resolved_at) {
        await sql`
          UPDATE support_cases SET
            status = COALESCE(${updates.status}, status),
            priority = COALESCE(${updates.priority}, priority),
            severity = COALESCE(${updates.severity}, severity),
            category = COALESCE(${updates.category}, category),
            subcategory = COALESCE(${updates.subcategory}, subcategory),
            root_cause = COALESCE(${updates.root_cause}, root_cause),
            assigned_to = COALESCE(${updates.assigned_to}, assigned_to),
            description = COALESCE(${updates.description}, description),
            resolution_notes = COALESCE(${updates.resolution_notes}, resolution_notes),
            tags = COALESCE(${updates.tags}, tags),
            impact_mrr = COALESCE(${updates.impact_mrr}, impact_mrr),
            churn_risk_score = COALESCE(${updates.churn_risk_score}, churn_risk_score),
            resolved_at = ${updates.resolved_at},
            resolution_time_minutes = ${updates.resolution_time_minutes || 0},
            updated_at = NOW()
          WHERE id = ${caseId} AND org_id = ${orgId}
        `
      } else {
        await sql`
          UPDATE support_cases SET
            status = COALESCE(${updates.status}, status),
            priority = COALESCE(${updates.priority}, priority),
            severity = COALESCE(${updates.severity}, severity),
            category = COALESCE(${updates.category}, category),
            subcategory = COALESCE(${updates.subcategory}, subcategory),
            root_cause = COALESCE(${updates.root_cause}, root_cause),
            assigned_to = COALESCE(${updates.assigned_to}, assigned_to),
            description = COALESCE(${updates.description}, description),
            resolution_notes = COALESCE(${updates.resolution_notes}, resolution_notes),
            tags = COALESCE(${updates.tags}, tags),
            impact_mrr = COALESCE(${updates.impact_mrr}, impact_mrr),
            churn_risk_score = COALESCE(${updates.churn_risk_score}, churn_risk_score),
            updated_at = NOW()
          WHERE id = ${caseId} AND org_id = ${orgId}
        `
      }

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
        
        // ОТКЛЮЧЕНО: Уведомления клиентам при изменении статуса
        // Информирование работает только внутри системы для сотрудников
        // if (status === 'resolved' && oldStatus !== 'resolved') { ... }
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
        LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
        WHERE c.id = ${caseId} AND c.org_id = ${orgId}
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
      return json({ error: 'Failed to update case' }, 500)
    }
  }

  // DELETE - удалить кейс
  if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM support_case_comments WHERE case_id = ${caseId}`.catch(() => {})
      await sql`DELETE FROM support_case_activities WHERE case_id = ${caseId}`
      await sql`UPDATE support_messages SET case_id = NULL WHERE case_id = ${caseId} AND org_id = ${orgId}`
      
      // Удаляем кейс
      const result = await sql`DELETE FROM support_cases WHERE id = ${caseId} AND org_id = ${orgId} RETURNING id`
      
      if (!result || result.length === 0) {
        return json({ error: 'Case not found' }, 404)
      }

      return json({
        success: true,
        message: 'Case deleted'
      })

    } catch (e: any) {
      return json({ error: 'Failed to delete case' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
