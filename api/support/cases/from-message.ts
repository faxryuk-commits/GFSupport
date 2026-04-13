import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const sql = getSQL()
    const orgId = await getRequestOrgId(req)
    const { messageId, description, title, priority = 'medium' } = await req.json()

    if (!messageId) {
      return json({ error: 'messageId required' }, 400)
    }

    // Get message details
    const msgResult = await sql`
      SELECT m.*, c.name as channel_name, c.company_id
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id AND c.org_id = ${orgId}
      WHERE m.id = ${messageId} AND m.org_id = ${orgId}
    `

    if (msgResult.length === 0) {
      return json({ error: 'Message not found' }, 404)
    }

    const msg = msgResult[0]

    // Determine priority based on AI analysis
    function determinePriority(message: any, manualPriority?: string): string {
      // If manually specified, use it
      if (manualPriority && manualPriority !== 'medium') {
        return manualPriority
      }
      
      const urgency = parseInt(message.ai_urgency) || 0
      const sentiment = message.ai_sentiment || 'neutral'
      const isProblem = message.is_problem === true
      
      // Urgency-based priority
      // 5 = urgent, 4 = high, 3 = medium, 1-2 = low
      if (urgency >= 5) return 'urgent'
      if (urgency === 4) return 'high'
      
      // Negative sentiment increases priority
      if (sentiment === 'negative' || sentiment === 'frustrated') {
        if (urgency >= 3) return 'high'
        return 'medium'
      }
      
      // Problem messages get at least medium
      if (isProblem) {
        if (urgency >= 3) return 'high'
        return 'medium'
      }
      
      // Default based on urgency
      if (urgency >= 3) return 'medium'
      return 'low'
    }

    // Create case
    const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const caseTitle = title || msg.ai_summary || description?.slice(0, 100) || 'Новое обращение'
    const casePriority = determinePriority(msg, priority !== 'medium' ? priority : undefined)

    // Add source_message_id column if not exists
    try {
      await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(64)`
    } catch (e) { /* column exists */ }

    await sql`
      INSERT INTO support_cases (
        id, org_id, channel_id, company_id, title, description,
        category, priority, severity, status, source_message_id
      ) VALUES (
        ${caseId},
        ${orgId},
        ${msg.channel_id},
        ${msg.company_id},
        ${caseTitle},
        ${description || msg.text_content || ''},
        ${msg.ai_category || 'general'},
        ${casePriority},
        ${msg.ai_urgency >= 4 ? 'critical' : msg.ai_urgency >= 3 ? 'high' : 'normal'},
        'detected',
        ${messageId}
      )
    `

    // Link message to case
    await sql`
      UPDATE support_messages SET case_id = ${caseId} WHERE id = ${messageId} AND org_id = ${orgId}
    `

    // Create activity
    await sql`
      INSERT INTO support_case_activities (id, case_id, type, title, description)
      VALUES (
        ${'act_' + Date.now()},
        ${caseId},
        'manual_created',
        'Тикет создан вручную',
        ${'Создан из сообщения от ' + msg.sender_name}
      )
    `

    // Загружаем созданный кейс для возврата в response
    const [newCase] = await sql`
      SELECT 
        c.*,
        ch.name as channel_name,
        ch.telegram_chat_id
      FROM support_cases c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
      WHERE c.id = ${caseId} AND c.org_id = ${orgId}
    `

    return json({
      success: true,
      caseId,
      message: 'Case created successfully',
      case: {
        id: newCase.id,
        ticketNumber: newCase.ticket_number,
        channelId: newCase.channel_id,
        channelName: newCase.channel_name || msg.channel_name || 'Без канала',
        telegramChatId: newCase.telegram_chat_id,
        companyId: newCase.company_id,
        title: newCase.title,
        description: newCase.description || '',
        status: newCase.status || 'detected',
        category: newCase.category || 'general',
        priority: newCase.priority || 'medium',
        severity: newCase.severity,
        assignedTo: newCase.assigned_to,
        sourceMessageId: newCase.source_message_id,
        tags: newCase.tags || [],
        createdAt: newCase.created_at,
        updatedAt: newCase.updated_at,
      }
    })

  } catch (e: any) {
    console.error('Create case error:', e)
    return json({ error: "Internal server error" }, 500)
  }
}
