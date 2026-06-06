import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

interface FeedItem {
  actor: 'ai_agent' | 'sla_guard'
  ts: string
  channel: string | null
  title: string
  reasoning: string | null
  action?: string
  confidence?: number
  reply?: string | null
  tier?: string | null
  mode?: string | null
  kind?: string
  outcome?: 'correct' | 'wrong' | null
}

export default async function handler(req: Request): Promise<Response> {
  const orgId = await getRequestOrgId(req)
  const sql = getSQL()

  let agentRows: any[] = []
  try {
    agentRows = await sql`
      SELECT channel_name, incoming_message, action, reply_text, reasoning, confidence, feedback, created_at
      FROM support_agent_decisions
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 60` as any[]
  } catch {
    try {
      agentRows = await sql`
        SELECT channel_name, incoming_message, action, reply_text, reasoning, confidence, created_at
        FROM support_agent_decisions WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 60` as any[]
    } catch { agentRows = [] }
  }

  let guardRows: any[] = []
  try {
    guardRows = await sql`
      SELECT actor, kind, channel_name, tier, reasoning, payload, mode, created_at
      FROM support_ai_events
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 60` as any[]
  } catch { guardRows = [] }

  // merge feed
  const feed: FeedItem[] = []
  for (const r of agentRows) {
    feed.push({
      actor: 'ai_agent', ts: r.created_at, channel: r.channel_name,
      title: (r.incoming_message || '').slice(0, 120),
      reasoning: r.reasoning, action: r.action, confidence: r.confidence,
      reply: r.reply_text ? String(r.reply_text).slice(0, 200) : null,
      outcome: r.feedback === 'correct' ? 'correct' : r.feedback === 'wrong' ? 'wrong' : null,
    })
  }
  for (const r of guardRows) {
    feed.push({
      actor: 'sla_guard', ts: r.created_at, channel: r.channel_name,
      title: r.kind === 'cycle' ? 'Цикл проверки' : `${r.tier || ''} ${r.channel_name || ''}`.trim(),
      reasoning: r.reasoning, tier: r.tier, mode: r.mode, kind: r.kind,
    })
  }
  feed.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  // aggregates: agent
  const byAction: Record<string, number> = {}
  let confSum = 0, confN = 0
  for (const r of agentRows) {
    byAction[r.action] = (byAction[r.action] || 0) + 1
    if (typeof r.confidence === 'number') { confSum += r.confidence; confN++ }
  }
  const labeled = agentRows.filter((r) => r.feedback === 'correct' || r.feedback === 'wrong')
  const correct = agentRows.filter((r) => r.feedback === 'correct').length
  const agent = {
    total: agentRows.length,
    avgConfidence: confN ? +(confSum / confN).toFixed(2) : null,
    byAction: Object.entries(byAction).map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n),
    successRate: labeled.length ? Math.round((100 * correct) / labeled.length) : null,
    labeled: labeled.length,
  }

  // aggregates: guard — последний cycle + последние алерты
  const lastCycle = guardRows.find((r) => r.kind === 'cycle')
  const guardAlerts = guardRows.filter((r) => r.kind === 'alert').slice(0, 20).map((r) => ({
    channel: r.channel_name, tier: r.tier, reasoning: r.reasoning, mode: r.mode, ts: r.created_at,
    ask: r.payload?.ask || null,
  }))
  const guard = {
    lastCycle: lastCycle ? { ...lastCycle.payload, mode: lastCycle.mode, ts: lastCycle.created_at } : null,
    recentAlerts: guardAlerts,
  }

  return json({ available: agentRows.length > 0 || guardRows.length > 0, feed: feed.slice(0, 80), agent, guard })
}
