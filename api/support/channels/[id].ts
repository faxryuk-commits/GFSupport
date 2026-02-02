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
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // Extract channel ID from URL
  const url = new URL(req.url)
  const pathParts = url.pathname.split('/')
  const channelId = pathParts[pathParts.length - 1]

  if (!channelId || channelId === '[id]') {
    return json({ error: 'Channel ID required' }, 400)
  }

  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      // Get channel with company info (safe query - no mrr dependency)
      const channelResult = await sql`
        SELECT 
          c.*,
          comp.name as company_name
        FROM support_channels c
        LEFT JOIN crm_companies comp ON c.company_id = comp.id
        WHERE c.id = ${channelId}
      `

      if (channelResult.length === 0) {
        return json({ error: 'Channel not found' }, 404)
      }

      const channel = channelResult[0]

      // Get case statistics
      const caseStats = await sql`
        SELECT 
          COUNT(*) as total_cases,
          COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) as open_cases,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved_cases,
          AVG(resolution_time_minutes) FILTER (WHERE resolution_time_minutes > 0) as avg_resolution_minutes
        FROM support_cases
        WHERE channel_id = ${channelId}
      `

      // Get recent resolved cases (for context)
      const recentCases = await sql`
        SELECT id, title, category, status, resolution_notes, resolved_at
        FROM support_cases
        WHERE channel_id = ${channelId} AND status IN ('resolved', 'closed')
        ORDER BY resolved_at DESC NULLS LAST
        LIMIT 5
      `

      // Get message statistics
      const messageStats = await sql`
        SELECT 
          COUNT(*) as total_messages,
          COUNT(*) FILTER (WHERE is_from_client = true) as client_messages,
          COUNT(*) FILTER (WHERE is_problem = true) as problem_messages,
          COUNT(*) FILTER (WHERE is_read = false) as unread_messages,
          MAX(created_at) FILTER (WHERE is_from_client = true) as last_client_message,
          MAX(created_at) FILTER (WHERE is_from_client = false) as last_team_message
        FROM support_messages
        WHERE channel_id = ${channelId}
      `

      // Get top categories from this channel
      const topCategories = await sql`
        SELECT ai_category, COUNT(*) as count
        FROM support_messages
        WHERE channel_id = ${channelId} AND ai_category IS NOT NULL
        GROUP BY ai_category
        ORDER BY count DESC
        LIMIT 5
      `

      // Get solution recommendations based on recent problems
      const topCategory = topCategories[0]?.ai_category
      let recommendations: any[] = []
      
      if (topCategory) {
        const solutions = await sql`
          SELECT * FROM support_solutions 
          WHERE is_active = true AND category = ${topCategory}
          ORDER BY used_count DESC, success_score DESC
          LIMIT 3
        `
        recommendations = solutions.map((s: any) => ({
          id: s.id,
          category: s.category,
          solutionText: s.solution_text,
          confidence: Math.min(95, 50 + (s.used_count || 0) + (s.success_score || 3) * 5),
          usedCount: s.used_count,
          avgResolutionMinutes: s.resolution_time_minutes,
        }))
      }

      // Calculate VIP status (mrr may not exist)
      const mrr = 0 // Company MRR not available without CRM integration
      const isVIP = false
      const isHighValue = false

      // Calculate risk indicators
      const avgResolution = parseFloat(caseStats[0]?.avg_resolution_minutes || 0)
      const openCases = parseInt(caseStats[0]?.open_cases || 0)

      let riskLevel = 'low'
      let riskReasons: string[] = []

      if (openCases >= 3) {
        riskLevel = 'medium'
        riskReasons.push(`${openCases} open cases`)
      }
      if (openCases >= 5) {
        riskLevel = 'high'
      }
      if (avgResolution > 120 && avgResolution > 0) {
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel
        riskReasons.push('Slow resolution time')
      }

      return json({
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          telegramChatId: channel.telegram_chat_id,
          isActive: channel.is_active,
          createdAt: channel.created_at,
          lastMessageAt: channel.last_message_at,
        },
        company: channel.company_name ? {
          id: channel.company_id,
          name: channel.company_name,
          mrr: mrr,
          plan: channel.type === 'internal' ? 'Team' : 'Client',
          segment: channel.type,
          isVIP,
          isHighValue,
          healthScore: 80,
          lastActivity: channel.last_message_at,
        } : null,
        caseStats: {
          total: parseInt(caseStats[0]?.total_cases || 0),
          open: openCases,
          resolved: parseInt(caseStats[0]?.resolved_cases || 0),
          avgResolutionMinutes: Math.round(avgResolution),
          avgResolutionFormatted: avgResolution > 60 
            ? `${Math.round(avgResolution / 60)}ч ${Math.round(avgResolution % 60)}м`
            : `${Math.round(avgResolution)}м`,
        },
        messageStats: {
          total: parseInt(messageStats[0]?.total_messages || 0),
          fromClient: parseInt(messageStats[0]?.client_messages || 0),
          problems: parseInt(messageStats[0]?.problem_messages || 0),
          unread: parseInt(messageStats[0]?.unread_messages || 0),
          lastClientMessage: messageStats[0]?.last_client_message,
          lastTeamMessage: messageStats[0]?.last_team_message,
        },
        recentCases: recentCases.map((c: any) => ({
          id: c.id,
          title: c.title,
          category: c.category,
          status: c.status,
          resolution: c.resolution_notes,
          resolvedAt: c.resolved_at,
        })),
        topCategories: topCategories.map((c: any) => ({
          category: c.ai_category,
          count: parseInt(c.count),
        })),
        risk: {
          level: riskLevel,
          churnScore: 0,
          reasons: riskReasons,
        },
        context: {
          // Quick summary for support agent
          summary: buildContextSummary(channel, caseStats[0], messageStats[0], isVIP, riskLevel),
          quickActions: buildQuickActions(channel, openCases, riskLevel),
        },
        recommendations,
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch channel details', details: e.message }, 500)
    }
  }

  // PUT - обновление канала (например, awaitingReply)
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      
      // Обновление статуса "ожидает ответа"
      if (typeof body.awaitingReply === 'boolean') {
        if (body.awaitingReply === false) {
          // Отмечаем что не ждёт ответа - обновляем last_team_message_at
          await sql`
            UPDATE support_channels 
            SET 
              awaiting_reply = false,
              last_team_message_at = NOW()
            WHERE id = ${channelId}
          `
        } else {
          await sql`
            UPDATE support_channels 
            SET awaiting_reply = true
            WHERE id = ${channelId}
          `
        }
        
        return json({ success: true, message: 'Channel updated' })
      }
      
      return json({ error: 'No valid fields to update' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to update channel', details: e.message }, 500)
    }
  }

  // PUT - update channel (e.g., mark as not awaiting reply)
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { awaitingReply } = body
      
      if (typeof awaitingReply === 'boolean') {
        // Update awaiting_reply status
        await sql`
          UPDATE support_channels 
          SET awaiting_reply = ${awaitingReply}
          WHERE id = ${channelId}
        `
        
        return json({ 
          success: true, 
          message: awaitingReply ? 'Marked as awaiting reply' : 'Marked as answered'
        })
      }
      
      return json({ error: 'No valid fields to update' }, 400)
    } catch (e: any) {
      return json({ error: 'Failed to update channel', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

function buildContextSummary(channel: any, caseStats: any, messageStats: any, isVIP: boolean, riskLevel: string): string {
  const parts: string[] = []
  
  if (isVIP) parts.push('VIP клиент')
  if (riskLevel === 'high') parts.push('⚠️ Высокий риск оттока')
  if (riskLevel === 'medium') parts.push('Средний риск')
  
  const openCases = parseInt(caseStats?.open_cases || 0)
  if (openCases > 0) parts.push(`${openCases} открытых кейсов`)
  
  const unread = parseInt(messageStats?.unread_messages || 0)
  if (unread > 0) parts.push(`${unread} непрочитанных`)
  
  return parts.join(' • ') || 'Нет особых заметок'
}

function buildQuickActions(channel: any, openCases: number, riskLevel: string): Array<{action: string, label: string, priority: string}> {
  const actions: Array<{action: string, label: string, priority: string}> = []
  
  if (riskLevel === 'high') {
    actions.push({ action: 'escalate', label: 'Эскалировать', priority: 'high' })
  }
  
  if (openCases > 0) {
    actions.push({ action: 'view_cases', label: `Посмотреть кейсы (${openCases})`, priority: 'medium' })
  }
  
  actions.push({ action: 'create_case', label: 'Создать кейс', priority: 'low' })
  actions.push({ action: 'view_history', label: 'История', priority: 'low' })
  
  return actions
}
