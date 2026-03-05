import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge', maxDuration: 30 }

function getSQL() {
  const cs = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!cs) throw new Error('No database URL')
  return neon(cs)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

type Purpose = 'problem_resolution' | 'customer_inquiry' | 'team_coordination' | 'status_update' | 'general_chat'

function classifyPurpose(intents: string[], hasProblem: boolean, roles: string[]): Purpose {
  const problemIntents = ['report_problem', 'complaint']
  const questionIntents = ['ask_question', 'faq_pricing', 'faq_hours', 'faq_contacts', 'request_feature']
  const socialIntents = ['greeting', 'closing', 'gratitude']

  if (hasProblem || intents.some(i => problemIntents.includes(i))) return 'problem_resolution'
  if (intents.some(i => questionIntents.includes(i))) return 'customer_inquiry'

  const uniqueRoles = new Set(roles)
  if (uniqueRoles.size === 1 && uniqueRoles.has('support')) return 'team_coordination'
  if (uniqueRoles.size === 1 && uniqueRoles.has('client')) return 'general_chat'

  const nonSocial = intents.filter(i => !socialIntents.includes(i))
  if (nonSocial.length === 0 && intents.length > 0) return 'general_chat'
  if (intents.includes('information') || intents.includes('response')) return 'status_update'

  return 'general_chat'
}

function calculateValueScore(purpose: Purpose, hasCaseLinked: boolean, msgCount: number): number {
  const base: Record<Purpose, number> = {
    problem_resolution: 90,
    customer_inquiry: 75,
    team_coordination: 55,
    status_update: 35,
    general_chat: 10,
  }
  let score = base[purpose]
  if (hasCaseLinked) score = Math.min(100, score + 10)
  if (msgCount > 10) score = Math.min(100, score + 5)
  return score
}

const PURPOSE_LABELS: Record<string, string> = {
  problem_resolution: 'Решение проблем',
  customer_inquiry: 'Вопросы клиентов',
  team_coordination: 'Координация команды',
  status_update: 'Обновления статусов',
  general_chat: 'Общее общение',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const url = new URL(req.url)
  const market = url.searchParams.get('market') || null

  // Ensure table exists
  try {
    await sql`CREATE TABLE IF NOT EXISTS support_conversation_sessions (
      id VARCHAR(50) PRIMARY KEY,
      channel_id VARCHAR(50) NOT NULL,
      started_at TIMESTAMP NOT NULL,
      ended_at TIMESTAMP,
      purpose VARCHAR(50),
      value_score INTEGER DEFAULT 0,
      participants TEXT[],
      message_count INTEGER DEFAULT 0,
      agent_message_count INTEGER DEFAULT 0,
      client_message_count INTEGER DEFAULT 0,
      has_case BOOLEAN DEFAULT false,
      case_id VARCHAR(50),
      summary TEXT,
      market_id VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )`
  } catch { /* exists */ }

  // POST - rebuild sessions from messages
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const days = body.days || 30
    const SESSION_GAP_MINUTES = 30

    // Fetch messages grouped by channel with gap detection
    const messages = await sql`
      SELECT m.id, m.channel_id, m.created_at, m.sender_role, m.ai_intent, m.is_problem, m.case_id,
        m.sender_name, c.market_id
      FROM support_messages m
      JOIN support_channels c ON m.channel_id = c.id
      WHERE m.created_at > NOW() - INTERVAL '1 day' * ${days}
        AND (${market}::text IS NULL OR c.market_id = ${market})
      ORDER BY m.channel_id, m.created_at ASC
    `

    if (messages.length === 0) return json({ sessions: 0, message: 'No messages to process' })

    // Group into sessions
    const sessions: Array<{
      channelId: string; startedAt: string; endedAt: string; participants: Set<string>;
      intents: string[]; roles: string[]; hasProblem: boolean; caseId: string | null;
      msgCount: number; agentCount: number; clientCount: number; marketId: string | null;
    }> = []

    let current: typeof sessions[0] | null = null

    for (const msg of messages) {
      const ts = new Date(msg.created_at).getTime()
      const lastEnd = current ? new Date(current.endedAt).getTime() : 0
      const sameChannel = current && msg.channel_id === current.channelId
      const gap = (ts - lastEnd) / 60000

      if (!sameChannel || gap > SESSION_GAP_MINUTES) {
        if (current) sessions.push(current)
        current = {
          channelId: msg.channel_id,
          startedAt: msg.created_at,
          endedAt: msg.created_at,
          participants: new Set(),
          intents: [],
          roles: [],
          hasProblem: false,
          caseId: null,
          msgCount: 0,
          agentCount: 0,
          clientCount: 0,
          marketId: msg.market_id || null,
        }
      }

      current!.endedAt = msg.created_at
      current!.msgCount++
      if (msg.sender_name) current!.participants.add(msg.sender_name)
      if (msg.ai_intent) current!.intents.push(msg.ai_intent)
      if (msg.sender_role) current!.roles.push(msg.sender_role)
      if (msg.is_problem) current!.hasProblem = true
      if (msg.case_id && !current!.caseId) current!.caseId = msg.case_id
      if (msg.sender_role === 'client') current!.clientCount++
      else current!.agentCount++
    }
    if (current) sessions.push(current)

    // Insert sessions (batch)
    let inserted = 0
    for (const s of sessions) {
      const purpose = classifyPurpose(s.intents, s.hasProblem, s.roles)
      const valueScore = calculateValueScore(purpose, !!s.caseId, s.msgCount)
      const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${inserted}`
      const participants = Array.from(s.participants)

      try {
        await sql`
          INSERT INTO support_conversation_sessions (
            id, channel_id, started_at, ended_at, purpose, value_score,
            participants, message_count, agent_message_count, client_message_count,
            has_case, case_id, market_id
          ) VALUES (
            ${id}, ${s.channelId}, ${s.startedAt}, ${s.endedAt}, ${purpose}, ${valueScore},
            ${participants}, ${s.msgCount}, ${s.agentCount}, ${s.clientCount},
            ${!!s.caseId}, ${s.caseId}, ${s.marketId}
          )
        `
        inserted++
      } catch { /* skip duplicates */ }
    }

    return json({ success: true, sessions: inserted, total: sessions.length })
  }

  // GET - read sessions analytics
  if (req.method === 'GET') {
    const period = url.searchParams.get('period') || '30'
    const agentFilter = url.searchParams.get('agent') || null

    // Purpose distribution
    const purposeStats = await sql`
      SELECT s.purpose, COUNT(*) as count, AVG(s.value_score) as avg_value,
        SUM(s.message_count) as total_messages
      FROM support_conversation_sessions s
      LEFT JOIN support_channels c ON s.channel_id = c.id
      WHERE s.started_at > NOW() - INTERVAL '1 day' * ${parseInt(period)}
        AND (${market}::text IS NULL OR s.market_id = ${market})
      GROUP BY s.purpose
      ORDER BY count DESC
    `

    // Per-agent breakdown (who participates in what)
    const agentPurposeRaw = await sql`
      SELECT unnest(s.participants) as agent_name, s.purpose, COUNT(*) as count
      FROM support_conversation_sessions s
      WHERE s.started_at > NOW() - INTERVAL '1 day' * ${parseInt(period)}
        AND (${market}::text IS NULL OR s.market_id = ${market})
        AND s.agent_message_count > 0
      GROUP BY agent_name, s.purpose
      ORDER BY agent_name, count DESC
    `

    // Group by agent
    const agentMap = new Map<string, Record<string, number>>()
    for (const row of agentPurposeRaw) {
      if (!agentMap.has(row.agent_name)) agentMap.set(row.agent_name, {})
      agentMap.get(row.agent_name)![row.purpose] = parseInt(row.count)
    }

    const agentBreakdown = Array.from(agentMap.entries()).map(([name, purposes]) => {
      const total = Object.values(purposes).reduce((s, c) => s + c, 0)
      const productiveCount = (purposes.problem_resolution || 0) + (purposes.customer_inquiry || 0) + (purposes.team_coordination || 0)
      return {
        name,
        purposes,
        total,
        productivityPercent: total > 0 ? Math.round((productiveCount / total) * 100) : 0,
      }
    }).sort((a, b) => b.total - a.total)

    // Daily trend
    const dailyTrend = await sql`
      SELECT DATE(s.started_at) as day, s.purpose, COUNT(*) as count
      FROM support_conversation_sessions s
      WHERE s.started_at > NOW() - INTERVAL '1 day' * ${parseInt(period)}
        AND (${market}::text IS NULL OR s.market_id = ${market})
      GROUP BY day, s.purpose
      ORDER BY day
    `

    // Shadow cases (resolved in chat without formal ticket)
    let shadowCases: any[] = []
    try {
      shadowCases = await sql`
        SELECT c.id, c.title, c.channel_id, ch.name as channel_name, c.created_at, c.priority
        FROM support_cases c
        LEFT JOIN support_channels ch ON c.channel_id = ch.id
        WHERE c.is_shadow = true
          AND c.created_at > NOW() - INTERVAL '1 day' * ${parseInt(period)}
          AND (${market}::text IS NULL OR c.market_id = ${market})
        ORDER BY c.created_at DESC
        LIMIT 50
      `
    } catch { /* is_shadow column may not exist yet */ }

    // Overall stats
    const totalSessions = purposeStats.reduce((s: number, r: any) => s + parseInt(r.count), 0)
    const productiveSessions = purposeStats
      .filter((r: any) => ['problem_resolution', 'customer_inquiry', 'team_coordination'].includes(r.purpose))
      .reduce((s: number, r: any) => s + parseInt(r.count), 0)

    return json({
      overview: {
        totalSessions,
        productiveSessions,
        productivityPercent: totalSessions > 0 ? Math.round((productiveSessions / totalSessions) * 100) : 0,
        shadowCasesCount: shadowCases.length,
      },
      purposeDistribution: purposeStats.map((r: any) => ({
        purpose: r.purpose,
        label: PURPOSE_LABELS[r.purpose] || r.purpose,
        count: parseInt(r.count),
        avgValue: Math.round(parseFloat(r.avg_value) || 0),
        totalMessages: parseInt(r.total_messages),
      })),
      agentBreakdown,
      dailyTrend: dailyTrend.map((r: any) => ({
        day: r.day,
        purpose: r.purpose,
        label: PURPOSE_LABELS[r.purpose] || r.purpose,
        count: parseInt(r.count),
      })),
      shadowCases: shadowCases.map((c: any) => ({
        id: c.id,
        title: c.title,
        channelName: c.channel_name,
        priority: c.priority,
        createdAt: c.created_at,
      })),
    })
  }

  return json({ error: 'Method not allowed' }, 405)
}
