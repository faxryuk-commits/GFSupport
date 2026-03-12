import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'
import { runAgent, type AgentContext } from '../lib/ai-agent.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 30,
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  await sql`
    CREATE TABLE IF NOT EXISTS support_agent_decisions (
      id VARCHAR(60) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      channel_id VARCHAR(50),
      channel_name VARCHAR(255),
      source VARCHAR(20),
      incoming_message TEXT,
      sender_name VARCHAR(255),
      action VARCHAR(30),
      reply_text TEXT,
      tag_agent_id VARCHAR(60),
      tag_agent_name VARCHAR(255),
      escalate_to_role VARCHAR(50),
      case_priority VARCHAR(20),
      case_title VARCHAR(255),
      reasoning TEXT,
      confidence REAL,
      context_messages_count INTEGER DEFAULT 0,
      similar_history_count INTEGER DEFAULT 0,
      feedback VARCHAR(20),
      feedback_note TEXT,
      executed_actions TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(() => {})

  if (req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '30')
    const channelId = url.searchParams.get('channelId')

    try {
      const decisions = channelId
        ? await sql`
            SELECT * FROM support_agent_decisions
            WHERE org_id = ${orgId} AND channel_id = ${channelId}
            ORDER BY created_at DESC LIMIT ${limit}
          `
        : await sql`
            SELECT * FROM support_agent_decisions
            WHERE org_id = ${orgId}
            ORDER BY created_at DESC LIMIT ${limit}
          `

      const stats = await sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE action = 'reply')::int as replies,
          COUNT(*) FILTER (WHERE action = 'tag_agent' OR action = 'reply_and_tag')::int as tags,
          COUNT(*) FILTER (WHERE action = 'escalate')::int as escalations,
          COUNT(*) FILTER (WHERE action = 'create_case')::int as cases_created,
          COUNT(*) FILTER (WHERE action = 'wait')::int as waits,
          COUNT(*) FILTER (WHERE feedback = 'correct')::int as correct,
          COUNT(*) FILTER (WHERE feedback = 'wrong')::int as wrong,
          ROUND(AVG(confidence)::numeric, 2) as avg_confidence
        FROM support_agent_decisions WHERE org_id = ${orgId}
      `.catch(() => [{}])

      return json({
        decisions: decisions.map(formatDecision),
        stats: stats[0] || {},
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'POST') {
    const body = await req.json()

    if (body.action === 'feedback') {
      const { decisionId, feedback, note } = body
      if (!decisionId || !feedback) return json({ error: 'decisionId and feedback required' }, 400)
      await sql`
        UPDATE support_agent_decisions SET feedback = ${feedback}, feedback_note = ${note || null}
        WHERE id = ${decisionId} AND org_id = ${orgId}
      `
      return json({ success: true })
    }

    if (body.action === 'test') {
      const { channelId, channelName, message, senderName, source } = body
      if (!channelId || !message) return json({ error: 'channelId and message required' }, 400)

      const ctx: AgentContext = {
        channelId,
        channelName: channelName || 'Test',
        orgId,
        incomingMessage: message,
        senderName: senderName || 'Тестовый клиент',
        isGroup: true,
        source: source || 'telegram',
      }

      try {
        const result = await runAgent(ctx)
        if (!result) {
          return json({ result: null, error: 'Agent returned null — check Together API key and logs' })
        }
        return json({ result })
      } catch (e: any) {
        console.error('[AI Agent Test] Error:', e.message, e.stack?.slice(0, 300))
        return json({ result: null, error: `Agent error: ${e.message}` })
      }
    }

    return json({ error: 'Unknown action' }, 400)
  }

  if (req.method === 'PUT') {
    const body = await req.json()
    const { decisionId, executedActions } = body
    if (!decisionId) return json({ error: 'decisionId required' }, 400)
    await sql`
      UPDATE support_agent_decisions SET executed_actions = ${executedActions || []}
      WHERE id = ${decisionId} AND org_id = ${orgId}
    `
    return json({ success: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function formatDecision(d: any) {
  return {
    id: d.id,
    channelId: d.channel_id,
    channelName: d.channel_name,
    source: d.source,
    incomingMessage: d.incoming_message,
    senderName: d.sender_name,
    action: d.action,
    replyText: d.reply_text,
    tagAgentId: d.tag_agent_id,
    tagAgentName: d.tag_agent_name,
    escalateToRole: d.escalate_to_role,
    casePriority: d.case_priority,
    caseTitle: d.case_title,
    reasoning: d.reasoning,
    confidence: d.confidence,
    contextMessagesCount: d.context_messages_count,
    similarHistoryCount: d.similar_history_count,
    feedback: d.feedback,
    feedbackNote: d.feedback_note,
    executedActions: d.executed_actions,
    createdAt: d.created_at,
  }
}
