import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

function getSQL() {
  const c = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!c) throw new Error('DB not found')
  return neon(c)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  try {
    const [msgStats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_from_client)::int as from_clients,
        COUNT(*) FILTER (WHERE NOT is_from_client)::int as from_team,
        COUNT(DISTINCT channel_id)::int as channels_used,
        COUNT(DISTINCT sender_name)::int as unique_senders,
        MIN(created_at) as first_message,
        MAX(created_at) as last_message
      FROM support_messages WHERE org_id = ${orgId}
    `

    const [chStats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE type = 'client')::int as client_channels,
        COUNT(*) FILTER (WHERE type = 'partner')::int as partner_channels,
        COUNT(*) FILTER (WHERE awaiting_reply)::int as awaiting_reply
      FROM support_channels WHERE org_id = ${orgId}
    `

    const agents = await sql`
      SELECT id, name, role, status, telegram_id, phone, created_at
      FROM support_agents WHERE org_id = ${orgId} ORDER BY name
    `

    const [caseStats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'detected')::int as detected,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved')::int as resolved,
        COUNT(*) FILTER (WHERE priority = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE priority = 'high')::int as high
      FROM support_cases WHERE org_id = ${orgId}
    `

    const [docStats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(DISTINCT category)::int as categories,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL AND array_length(embedding, 1) > 0)::int as with_embeddings
      FROM support_docs WHERE org_id = ${orgId}
    `

    const [decisionStats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE feedback = 'correct')::int as correct,
        COUNT(*) FILTER (WHERE feedback = 'wrong')::int as wrong,
        ROUND(AVG(confidence)::numeric, 2) as avg_confidence
      FROM support_agent_decisions WHERE org_id = ${orgId}
    `

    const topSenders = await sql`
      SELECT sender_name, COUNT(*)::int as messages, is_from_client
      FROM support_messages WHERE org_id = ${orgId}
      GROUP BY sender_name, is_from_client
      ORDER BY messages DESC LIMIT 20
    `

    const msgByMonth = await sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*)::int as messages
      FROM support_messages WHERE org_id = ${orgId}
      GROUP BY month ORDER BY month DESC LIMIT 12
    `

    const topCategories = await sql`
      SELECT ai_category, COUNT(*)::int as cnt
      FROM support_messages WHERE org_id = ${orgId} AND ai_category IS NOT NULL
      GROUP BY ai_category ORDER BY cnt DESC LIMIT 15
    `

    const commitments = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
        COUNT(*) FILTER (WHERE status = 'overdue')::int as overdue
      FROM support_commitments WHERE org_id = ${orgId}
    `.catch(() => [{}])

    const sampleClientMsgs = await sql`
      SELECT text_content, sender_name, created_at, ai_category, ai_sentiment
      FROM support_messages WHERE org_id = ${orgId} AND is_from_client = true AND text_content IS NOT NULL AND LENGTH(text_content) > 10
      ORDER BY created_at DESC LIMIT 10
    `

    const sampleTeamMsgs = await sql`
      SELECT text_content, sender_name, created_at
      FROM support_messages WHERE org_id = ${orgId} AND is_from_client = false AND text_content IS NOT NULL AND LENGTH(text_content) > 10
      ORDER BY created_at DESC LIMIT 10
    `

    return json({
      orgId,
      messages: msgStats,
      channels: chStats,
      agents: agents.map((a: any) => ({
        id: a.id, name: a.name, role: a.role, status: a.status,
        hasTelegramId: !!a.telegram_id, hasPhone: !!a.phone,
      })),
      cases: caseStats,
      docs: docStats,
      aiDecisions: decisionStats,
      commitments: commitments[0] || {},
      topSenders: topSenders.map((s: any) => ({ name: s.sender_name, messages: s.messages, isClient: s.is_from_client })),
      messagesByMonth: msgByMonth.map((m: any) => ({ month: m.month, count: m.messages })),
      topCategories: topCategories.map((c: any) => ({ category: c.ai_category, count: c.cnt })),
      recentClientMessages: sampleClientMsgs.map((m: any) => ({ text: (m.text_content || '').slice(0, 150), sender: m.sender_name, category: m.ai_category, sentiment: m.ai_sentiment })),
      recentTeamResponses: sampleTeamMsgs.map((m: any) => ({ text: (m.text_content || '').slice(0, 150), sender: m.sender_name })),
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
