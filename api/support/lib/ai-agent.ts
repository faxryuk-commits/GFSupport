import { getSQL } from './db.js'

const TOGETHER_API = 'https://api.together.xyz/v1/chat/completions'
const DEFAULT_MODEL = 'Qwen/Qwen2.5-72B-Instruct-Turbo'
const FAST_MODEL = 'Qwen/Qwen2.5-7B-Instruct-Turbo'

export interface AgentDecision {
  action: 'reply' | 'tag_agent' | 'escalate' | 'create_case' | 'wait' | 'reply_and_tag'
  replyText?: string
  tagAgentId?: string
  tagAgentName?: string
  escalateToRole?: string
  casePriority?: 'low' | 'medium' | 'high' | 'critical'
  caseTitle?: string
  reasoning: string
  confidence: number
}

export interface AgentContext {
  channelId: string
  channelName: string
  orgId: string
  incomingMessage: string
  senderName: string
  senderPhone?: string
  isGroup: boolean
  source: 'telegram' | 'whatsapp'
}

async function getTogetherKey(orgId?: string): Promise<string | null> {
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

async function getAgentSettings(orgId: string) {
  const sql = getSQL()
  try {
    const rows = await sql`
      SELECT key, value FROM support_settings WHERE org_id = ${orgId} AND key LIKE 'ai_agent_%'
    `
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key] = r.value
    return {
      enabled: settings['ai_agent_enabled'] === 'true',
      mode: (settings['ai_agent_mode'] || 'assist') as 'autonomous' | 'assist' | 'night_only',
      autoReply: settings['ai_agent_auto_reply'] === 'true',
      maxConfidenceForAutoReply: parseFloat(settings['ai_agent_min_confidence'] || '0.8'),
      workingHoursStart: parseInt(settings['ai_agent_work_start'] || '9'),
      workingHoursEnd: parseInt(settings['ai_agent_work_end'] || '22'),
      timezone: settings['ai_agent_timezone'] || 'Asia/Tashkent',
      excludeChannels: (settings['ai_agent_exclude_channels'] || '').split(',').filter(Boolean),
      model: settings['ai_agent_model'] || DEFAULT_MODEL,
    }
  } catch {
    return { enabled: false, mode: 'assist' as const, autoReply: false, maxConfidenceForAutoReply: 0.8, workingHoursStart: 9, workingHoursEnd: 22, timezone: 'Asia/Tashkent', excludeChannels: [] as string[], model: DEFAULT_MODEL }
  }
}

function isWorkingHours(start: number, end: number): boolean {
  const now = new Date()
  const tashkentHour = (now.getUTCHours() + 5) % 24
  return tashkentHour >= start && tashkentHour < end
}

async function fetchRecentMessages(orgId: string, channelId: string, limit = 20) {
  const sql = getSQL()
  const msgs = await sql`
    SELECT sender_name, sender_role, is_from_client, text_content, transcript, content_type, created_at
    FROM support_messages
    WHERE channel_id = ${channelId} AND org_id = ${orgId}
    ORDER BY created_at DESC LIMIT ${limit}
  `
  return msgs.reverse().map((m: any) => ({
    sender: m.sender_name,
    role: m.is_from_client ? 'client' : 'support',
    text: (m.text_content || m.transcript || `[${m.content_type}]`).slice(0, 300),
    time: m.created_at,
  }))
}

async function fetchAvailableAgents(orgId: string) {
  const sql = getSQL()
  const agents = await sql`
    SELECT id, name, role, status FROM support_agents
    WHERE org_id = ${orgId} AND status != 'offline'
    ORDER BY CASE WHEN status = 'online' THEN 0 ELSE 1 END, name
  `
  return agents.map((a: any) => ({ id: a.id, name: a.name, role: a.role, status: a.status }))
}

async function fetchSimilarHistory(orgId: string, query: string) {
  const sql = getSQL()
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 4)
  if (words.length === 0) return []
  const pattern = `%${words[0]}%`
  try {
    const rows = await sql`
      SELECT DISTINCT ON (m2.text_content) 
        m1.text_content as question, m2.text_content as answer, m2.sender_name as answered_by
      FROM support_messages m1
      JOIN support_messages m2 ON m2.channel_id = m1.channel_id AND m2.org_id = m1.org_id
        AND m2.is_from_client = false AND m2.created_at > m1.created_at
        AND m2.created_at < m1.created_at + INTERVAL '2 hours'
      WHERE m1.org_id = ${orgId} AND m1.is_from_client = true
        AND m1.text_content ILIKE ${pattern}
      ORDER BY m2.text_content, m1.created_at DESC
      LIMIT 5
    `
    return rows.map((r: any) => ({
      question: (r.question || '').slice(0, 200),
      answer: (r.answer || '').slice(0, 300),
      answeredBy: r.answered_by,
    }))
  } catch { return [] }
}

async function fetchOpenCases(orgId: string, channelId: string) {
  const sql = getSQL()
  try {
    const cases = await sql`
      SELECT id, title, priority, status, assigned_agent_id
      FROM support_cases
      WHERE channel_id = ${channelId} AND org_id = ${orgId} AND status NOT IN ('resolved', 'closed')
      ORDER BY created_at DESC LIMIT 3
    `
    return cases.map((c: any) => ({ id: c.id, title: c.title, priority: c.priority, status: c.status, assignedTo: c.assigned_agent_id }))
  } catch { return [] }
}

function buildSystemPrompt(agents: any[], isWorkHours: boolean): string {
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}, ${a.status === 'online' ? 'онлайн' : 'занят'}): id=${a.id}`).join('\n')
    : 'Нет доступных сотрудников'

  return `Ты — AI-агент службы поддержки. Анализируешь входящие сообщения клиентов и принимаешь решения.

ТЕКУЩЕЕ ВРЕМЯ: ${new Date().toISOString()}
РАБОЧИЕ ЧАСЫ: ${isWorkHours ? 'ДА' : 'НЕТ (ночь/выходной)'}

ДОСТУПНЫЕ СОТРУДНИКИ:
${agentList}

ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЙ:
1. Если вопрос простой и ты уверен в ответе (приветствие, часы работы, статус) → action: "reply"
2. Если есть похожие решения из истории и ответ ясен → action: "reply"
3. Если нужен конкретный специалист (техническая проблема, конкретный вопрос) → action: "tag_agent"
4. Если клиент злится / проблема критическая / повторное обращение → action: "escalate"
5. Если требуется расследование / новая проблема → action: "create_case"
6. Если нужно и ответить и позвать кого-то → action: "reply_and_tag"
7. Если ты не уверен / лучше подождать сотрудника → action: "wait"

В НЕРАБОЧЕЕ ВРЕМЯ: отвечай клиенту что обращение зафиксировано + создавай кейс.

СТИЛЬ ОТВЕТОВ: вежливый, профессиональный, на русском. Не выдавай что ты AI.

ОТВЕЧАЙ СТРОГО JSON:
{
  "action": "reply|tag_agent|escalate|create_case|wait|reply_and_tag",
  "replyText": "текст ответа клиенту (если action включает reply)",
  "tagAgentId": "id сотрудника (если tag_agent/reply_and_tag)",
  "tagAgentName": "имя сотрудника",
  "escalateToRole": "admin (если escalate)",
  "casePriority": "low|medium|high|critical",
  "caseTitle": "заголовок кейса (если create_case)",
  "reasoning": "почему принял такое решение (1-2 предложения)",
  "confidence": 0.85
}`
}

function buildUserPrompt(ctx: AgentContext, messages: any[], history: any[], cases: any[]): string {
  const chatHistory = messages.map(m => `[${m.role}] ${m.sender}: ${m.text}`).join('\n')

  const historyBlock = history.length > 0
    ? `\nПОХОЖИЕ РЕШЕНИЯ ИЗ ИСТОРИИ:\n${history.map(h => `Вопрос: ${h.question}\nОтвет (${h.answeredBy}): ${h.answer}`).join('\n---\n')}`
    : ''

  const casesBlock = cases.length > 0
    ? `\nОТКРЫТЫЕ КЕЙСЫ ПО ЭТОМУ КАНАЛУ:\n${cases.map(c => `- [${c.priority}] ${c.title} (${c.status})`).join('\n')}`
    : ''

  return `КАНАЛ: ${ctx.channelName} (${ctx.source}, ${ctx.isGroup ? 'группа' : 'личка'})
ОТПРАВИТЕЛЬ: ${ctx.senderName}

ИСТОРИЯ ПЕРЕПИСКИ (последние сообщения):
${chatHistory}

НОВОЕ СООБЩЕНИЕ ОТ КЛИЕНТА:
${ctx.senderName}: ${ctx.incomingMessage}
${historyBlock}${casesBlock}

Прими решение.`
}

export async function runAgent(ctx: AgentContext): Promise<{ decision: AgentDecision; skipped?: boolean; reason?: string } | null> {
  const settings = await getAgentSettings(ctx.orgId)
  if (!settings.enabled) return { decision: null as any, skipped: true, reason: 'agent_disabled' }

  if (settings.excludeChannels.includes(ctx.channelId)) {
    return { decision: null as any, skipped: true, reason: 'channel_excluded' }
  }

  const workHours = isWorkingHours(settings.workingHoursStart, settings.workingHoursEnd)
  if (settings.mode === 'night_only' && workHours) {
    return { decision: null as any, skipped: true, reason: 'working_hours' }
  }

  const apiKey = await getTogetherKey(ctx.orgId)
  if (!apiKey) return { decision: null as any, skipped: true, reason: 'no_api_key' }

  const [messages, agents, history, cases] = await Promise.all([
    fetchRecentMessages(ctx.orgId, ctx.channelId),
    fetchAvailableAgents(ctx.orgId),
    fetchSimilarHistory(ctx.orgId, ctx.incomingMessage),
    fetchOpenCases(ctx.orgId, ctx.channelId),
  ])

  const systemPrompt = buildSystemPrompt(agents, workHours)
  const userPrompt = buildUserPrompt(ctx, messages, history, cases)

  try {
    const res = await fetch(TOGETHER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown')
      console.error(`[AI Agent] Together API error: ${res.status} ${err}`)
      return null
    }

    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || ''
    const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const decision: AgentDecision = JSON.parse(clean)

    await logDecision(ctx, decision, messages.length, history.length)

    return { decision }
  } catch (e: any) {
    console.error('[AI Agent] Error:', e.message)
    return null
  }
}

async function logDecision(ctx: AgentContext, decision: AgentDecision, msgCount: number, historyCount: number) {
  const sql = getSQL()
  const id = `ad_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  try {
    await sql`
      INSERT INTO support_agent_decisions (
        id, org_id, channel_id, channel_name, source, incoming_message, sender_name,
        action, reply_text, tag_agent_id, tag_agent_name, escalate_to_role,
        case_priority, case_title, reasoning, confidence,
        context_messages_count, similar_history_count, created_at
      ) VALUES (
        ${id}, ${ctx.orgId}, ${ctx.channelId}, ${ctx.channelName}, ${ctx.source},
        ${ctx.incomingMessage.slice(0, 1000)}, ${ctx.senderName},
        ${decision.action}, ${decision.replyText || null}, ${decision.tagAgentId || null},
        ${decision.tagAgentName || null}, ${decision.escalateToRole || null},
        ${decision.casePriority || null}, ${decision.caseTitle || null},
        ${decision.reasoning}, ${decision.confidence},
        ${msgCount}, ${historyCount}, NOW()
      )
    `
  } catch (e: any) {
    console.error('[AI Agent] Log error:', e.message)
  }
}

export async function executeDecision(
  ctx: AgentContext,
  decision: AgentDecision,
  sendMessage: (chatId: string, text: string) => Promise<void>
): Promise<{ executed: string[] }> {
  const executed: string[] = []

  if ((decision.action === 'reply' || decision.action === 'reply_and_tag') && decision.replyText) {
    try {
      await sendMessage(ctx.channelId, decision.replyText)
      executed.push('reply_sent')
    } catch (e: any) {
      console.error('[AI Agent] Reply failed:', e.message)
    }
  }

  if ((decision.action === 'tag_agent' || decision.action === 'reply_and_tag') && decision.tagAgentName) {
    const tagText = `⚡ @${decision.tagAgentName}, обратите внимание на сообщение от ${ctx.senderName}`
    try {
      await sendMessage(ctx.channelId, tagText)
      executed.push('agent_tagged')
    } catch (e: any) {
      console.error('[AI Agent] Tag failed:', e.message)
    }
  }

  if (decision.action === 'escalate') {
    const escText = `🔴 Эскалация: ${decision.reasoning}`
    try {
      await sendMessage(ctx.channelId, escText)
      executed.push('escalated')
    } catch {}
  }

  if (decision.action === 'create_case' || decision.casePriority) {
    const sql = getSQL()
    const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    try {
      await sql`
        INSERT INTO support_cases (id, channel_id, org_id, title, description, priority, status, source_message_id)
        VALUES (${caseId}, ${ctx.channelId}, ${ctx.orgId},
          ${(decision.caseTitle || ctx.incomingMessage.slice(0, 100))},
          ${ctx.incomingMessage.slice(0, 500)},
          ${decision.casePriority || 'medium'}, 'detected', ${`ai_agent_${Date.now()}`})
      `
      executed.push('case_created')
    } catch (e: any) {
      console.error('[AI Agent] Case creation failed:', e.message)
    }
  }

  return { executed }
}
