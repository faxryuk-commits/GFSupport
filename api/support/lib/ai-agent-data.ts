import { neon } from '@neondatabase/serverless'

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export async function getTogetherKey(orgId?: string): Promise<string | null> {
  const sql = getSQL()
  if (orgId) {
    try {
      const [setting] = await sql`
        SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'together_api_key' LIMIT 1
      `
      if (setting?.value) return setting.value
    } catch {}
  }
  return process.env.TOGETHER_API_KEY || null
}

export async function getAgentSettings(orgId: string, defaultModel: string) {
  const sql = getSQL()
  try {
    const rows = await sql`SELECT key, value FROM support_settings WHERE org_id = ${orgId} AND key LIKE 'ai_agent_%'`
    const s: Record<string, string> = {}
    for (const r of rows) s[r.key] = r.value
    return {
      enabled: s['ai_agent_enabled'] === 'true',
      mode: (s['ai_agent_mode'] || 'assist') as 'autonomous' | 'assist' | 'night_only',
      maxConfidenceForAutoReply: parseFloat(s['ai_agent_min_confidence'] || '0.8'),
      workingHoursStart: parseInt(s['ai_agent_work_start'] || '9'),
      workingHoursEnd: parseInt(s['ai_agent_work_end'] || '22'),
      excludeChannels: (s['ai_agent_exclude_channels'] || '').split(',').filter(Boolean),
      model: s['ai_agent_model'] || defaultModel,
      customInstructions: s['ai_agent_custom_instructions'] || '',
    }
  } catch {
    return { enabled: false, mode: 'assist' as const, maxConfidenceForAutoReply: 0.8, workingHoursStart: 9, workingHoursEnd: 22, excludeChannels: [] as string[], model: defaultModel, customInstructions: '' }
  }
}

export function isWorkingHours(start: number, end: number): boolean {
  const h = (new Date().getUTCHours() + 5) % 24
  return h >= start && h < end
}

export async function fetchRecentMessages(orgId: string, channelId: string, limit = 30) {
  const sql = getSQL()
  const msgs = await sql`
    SELECT sender_name, sender_role, is_from_client, text_content, transcript, content_type, created_at
    FROM support_messages WHERE channel_id = ${channelId} AND org_id = ${orgId}
    ORDER BY created_at DESC LIMIT ${limit}
  `
  return msgs.reverse().map((m: any) => ({
    sender: m.sender_name,
    role: m.is_from_client ? 'client' : 'support',
    text: (m.text_content || m.transcript || `[${m.content_type}]`).slice(0, 400),
    time: m.created_at,
  }))
}

export async function fetchAvailableAgents(orgId: string, channelId?: string) {
  const sql = getSQL()
  const agents = await sql`
    SELECT id, name, role, status FROM support_agents
    WHERE org_id = ${orgId} AND status != 'offline'
    ORDER BY CASE WHEN status = 'online' THEN 0 ELSE 1 END, name
  `

  let channelTopAgent: string | null = null
  if (channelId) {
    try {
      const [top] = await sql`
        SELECT sender_name, COUNT(*)::int as cnt
        FROM support_messages
        WHERE channel_id = ${channelId} AND org_id = ${orgId} AND is_from_client = false
          AND sender_name IS NOT NULL AND LENGTH(sender_name) > 1
        GROUP BY sender_name ORDER BY cnt DESC LIMIT 1
      `
      if (top?.sender_name) channelTopAgent = top.sender_name
    } catch {}
  }

  const agentSpecs: Record<string, string[]> = {}
  try {
    const rows = await sql`
      SELECT m.sender_name, m.ai_category, COUNT(*)::int as cnt
      FROM support_messages m
      WHERE m.org_id = ${orgId} AND m.is_from_client = false AND m.ai_category IS NOT NULL
        AND m.sender_name IS NOT NULL AND LENGTH(m.sender_name) > 1
      GROUP BY m.sender_name, m.ai_category
      HAVING COUNT(*) >= 5
      ORDER BY m.sender_name, cnt DESC
    `
    for (const r of rows) {
      if (!agentSpecs[r.sender_name]) agentSpecs[r.sender_name] = []
      if (agentSpecs[r.sender_name].length < 4) {
        agentSpecs[r.sender_name].push(r.ai_category)
      }
    }
  } catch {}

  return agents.map((a: any) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    specializations: agentSpecs[a.name] || [],
    isChannelPrimary: channelTopAgent ? a.name === channelTopAgent : false,
  }))
}

export async function fetchSimilarHistory(orgId: string, query: string) {
  const sql = getSQL()
  const words = query.toLowerCase().replace(/[^\wа-яёўқғҳ\s]/gi, '').split(/\s+/).filter(w => w.length > 3).slice(0, 5)
  if (words.length === 0) return []
  const patterns = words.map(w => `%${w}%`)
  try {
    const rows = await sql`
      SELECT DISTINCT ON (m2.text_content)
        m1.text_content as question, m2.text_content as answer, m2.sender_name as answered_by,
        m1.channel_id
      FROM support_messages m1
      JOIN support_messages m2 ON m2.channel_id = m1.channel_id AND m2.org_id = m1.org_id
        AND m2.is_from_client = false AND m2.created_at > m1.created_at
        AND m2.created_at < m1.created_at + INTERVAL '4 hours'
      WHERE m1.org_id = ${orgId} AND m1.is_from_client = true
        AND (m1.text_content ILIKE ${patterns[0]} OR m1.text_content ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]})
      ORDER BY m2.text_content, m1.created_at DESC
      LIMIT 8
    `
    return rows.map((r: any) => ({
      question: (r.question || '').slice(0, 300),
      answer: (r.answer || '').slice(0, 400),
      answeredBy: r.answered_by,
    }))
  } catch { return [] }
}

export async function fetchRelevantDocs(orgId: string, query: string, apiKey: string | null) {
  const sql = getSQL()

  const hasEmbeddings = await sql`
    SELECT COUNT(*) as cnt FROM support_docs WHERE org_id = ${orgId} AND embedding IS NOT NULL AND array_length(embedding, 1) > 0
  `.then(r => Number(r[0]?.cnt || 0) > 10).catch(() => false)

  if (hasEmbeddings && apiKey) {
    try {
      const res = await fetch('https://api.together.xyz/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'intfloat/multilingual-e5-large-instruct', input: query.slice(0, 400) }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json() as any
        const emb = data.data?.[0]?.embedding
        if (emb) {
          const embStr = `{${emb.join(',')}}`
          const docs = await sql`
            SELECT title, url, category, LEFT(content, 400) as excerpt
            FROM support_docs
            WHERE org_id = ${orgId} AND embedding IS NOT NULL AND array_length(embedding, 1) > 0
            ORDER BY (
              (SELECT SUM(a * b) FROM unnest(embedding, ${embStr}::real[]) AS t(a, b)) /
              NULLIF(
                SQRT((SELECT SUM(a * a) FROM unnest(embedding) AS t(a))) *
                SQRT((SELECT SUM(b * b) FROM unnest(${embStr}::real[]) AS t(b))),
                0
              )
            ) DESC NULLS LAST
            LIMIT 4
          `
          if (docs.length > 0) {
            return docs.map((d: any) => ({
              title: d.title, url: d.url, category: d.category,
              excerpt: (d.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            }))
          }
        }
      }
    } catch {}
  }

  const words = query.toLowerCase().replace(/[^\wа-яёўқғҳ\s]/gi, '').split(/\s+/).filter(w => w.length > 3).slice(0, 6)
  if (words.length === 0) return []
  try {
    const patterns = words.map(w => `%${w}%`)
    const docs = await sql`
      SELECT title, url, category, LEFT(content, 400) as excerpt,
        (CASE WHEN title ILIKE ${patterns[0]} THEN 15 ELSE 0 END +
         CASE WHEN content ILIKE ${patterns[0]} THEN 5 ELSE 0 END +
         CASE WHEN title ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]} THEN 10 ELSE 0 END +
         CASE WHEN content ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]} THEN 3 ELSE 0 END
        ) as score
      FROM support_docs WHERE org_id = ${orgId}
        AND (title ILIKE ${patterns[0]} OR content ILIKE ${patterns[0]}
             OR title ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]}
             OR content ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]})
      ORDER BY score DESC LIMIT 5
    `
    return docs.filter((d: any) => d.score > 0).map((d: any) => ({
      title: d.title, url: d.url, category: d.category,
      excerpt: (d.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    }))
  } catch { return [] }
}

export async function fetchFeedbackExamples(orgId: string) {
  const sql = getSQL()
  try {
    const good = await sql`
      SELECT incoming_message, action, reply_text, reasoning
      FROM support_agent_decisions WHERE org_id = ${orgId} AND feedback = 'correct'
      ORDER BY created_at DESC LIMIT 3
    `
    const bad = await sql`
      SELECT incoming_message, action, reply_text, reasoning, feedback_note
      FROM support_agent_decisions WHERE org_id = ${orgId} AND feedback = 'wrong'
      ORDER BY created_at DESC LIMIT 3
    `
    return {
      good: good.map((r: any) => ({ msg: (r.incoming_message || '').slice(0, 150), action: r.action, reply: (r.reply_text || '').slice(0, 200) })),
      bad: bad.map((r: any) => ({ msg: (r.incoming_message || '').slice(0, 150), action: r.action, reply: (r.reply_text || '').slice(0, 200), note: r.feedback_note || '' })),
    }
  } catch { return { good: [], bad: [] } }
}

export async function fetchOpenCases(orgId: string, channelId: string) {
  const sql = getSQL()
  try {
    const cases = await sql`
      SELECT id, title, priority, status, assigned_agent_id
      FROM support_cases
      WHERE channel_id = ${channelId} AND org_id = ${orgId} AND status NOT IN ('resolved', 'closed')
      ORDER BY created_at DESC LIMIT 3
    `
    return cases.map((c: any) => ({ id: c.id, title: c.title, priority: c.priority, status: c.status }))
  } catch { return [] }
}

export async function fetchTeamStyleExamples(orgId: string) {
  const sql = getSQL()
  try {
    const rows = await sql`
      SELECT DISTINCT ON (m2.text_content)
        m1.text_content as client_msg,
        m2.text_content as team_reply,
        m2.sender_name as agent
      FROM support_messages m1
      JOIN support_messages m2 ON m2.channel_id = m1.channel_id AND m2.org_id = m1.org_id
        AND m2.is_from_client = false AND m2.created_at > m1.created_at
        AND m2.created_at < m1.created_at + INTERVAL '30 minutes'
      WHERE m1.org_id = ${orgId} AND m1.is_from_client = true
        AND LENGTH(m1.text_content) > 15 AND LENGTH(m2.text_content) > 20
        AND m2.text_content NOT LIKE '%[Сообщение удалено]%'
        AND m1.ai_sentiment IN ('negative', 'neutral')
      ORDER BY m2.text_content, m2.created_at DESC
      LIMIT 6
    `
    return rows.map((r: any) => ({
      client: (r.client_msg || '').slice(0, 150),
      reply: (r.team_reply || '').slice(0, 250),
      agent: r.agent,
    }))
  } catch { return [] }
}

export async function fetchTopCategories(orgId: string) {
  const sql = getSQL()
  try {
    const rows = await sql`
      SELECT ai_category, COUNT(*)::int as cnt
      FROM support_messages WHERE org_id = ${orgId} AND ai_category IS NOT NULL AND is_from_client = true
      GROUP BY ai_category ORDER BY cnt DESC LIMIT 8
    `
    return rows.map((r: any) => ({ category: r.ai_category, count: r.cnt }))
  } catch { return [] }
}

export async function fetchOverdueCommitments(orgId: string, channelId: string) {
  const sql = getSQL()
  try {
    const rows = await sql`
      SELECT commitment_text, deadline, status, agent_name
      FROM support_commitments
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND status = 'overdue'
      ORDER BY deadline DESC LIMIT 3
    `
    return rows.map((r: any) => ({
      text: (r.commitment_text || '').slice(0, 150),
      deadline: r.deadline,
      agent: r.agent_name,
    }))
  } catch { return [] }
}

export async function shouldSkipChannel(orgId: string, channelId: string): Promise<{ skip: boolean; reason?: string }> {
  const sql = getSQL()
  try {
    const [lastTeamMsg] = await sql`
      SELECT created_at FROM support_messages
      WHERE channel_id = ${channelId} AND org_id = ${orgId} AND is_from_client = false
      ORDER BY created_at DESC LIMIT 1
    `
    const [lastClientMsg] = await sql`
      SELECT created_at FROM support_messages
      WHERE channel_id = ${channelId} AND org_id = ${orgId} AND is_from_client = true
      ORDER BY created_at DESC LIMIT 1
    `
    if (lastTeamMsg?.created_at && lastClientMsg?.created_at) {
      const teamTime = new Date(lastTeamMsg.created_at).getTime()
      const clientTime = new Date(lastClientMsg.created_at).getTime()
      if (teamTime > clientTime) {
        return { skip: true, reason: 'team_already_replied' }
      }
    }

    const [lastAgentReply] = await sql`
      SELECT created_at FROM support_agent_decisions
      WHERE channel_id = ${channelId} AND org_id = ${orgId}
        AND action IN ('reply', 'reply_and_tag', 'tag_agent')
      ORDER BY created_at DESC LIMIT 1
    `
    if (lastAgentReply?.created_at) {
      const agentTime = new Date(lastAgentReply.created_at).getTime()
      const minsSinceAgent = (Date.now() - agentTime) / 60000
      if (minsSinceAgent < 5) {
        return { skip: true, reason: `agent_replied_${Math.round(minsSinceAgent)}m_ago` }
      }
    }
  } catch {}
  return { skip: false }
}

export async function fetchChannelProfile(orgId: string, channelId: string) {
  const sql = getSQL()
  try {
    const [ch] = await sql`
      SELECT name, type, tags, awaiting_reply, last_client_message_at, last_team_message_at
      FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId} LIMIT 1
    `
    if (!ch) return null
    let waitMin: number | null = null
    if (ch.awaiting_reply && ch.last_client_message_at) {
      waitMin = Math.round((Date.now() - new Date(ch.last_client_message_at).getTime()) / 60000)
    }
    return { name: ch.name, type: ch.type, tags: ch.tags, waitingMinutes: waitMin }
  } catch { return null }
}
