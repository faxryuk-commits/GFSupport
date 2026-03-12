import { neon } from '@neondatabase/serverless'

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

const TOGETHER_API = 'https://api.together.xyz/v1/chat/completions'
const DEFAULT_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct'

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
  docLinks?: string[]
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
      model: s['ai_agent_model'] || DEFAULT_MODEL,
    }
  } catch {
    return { enabled: false, mode: 'assist' as const, maxConfidenceForAutoReply: 0.8, workingHoursStart: 9, workingHoursEnd: 22, excludeChannels: [] as string[], model: DEFAULT_MODEL }
  }
}

function isWorkingHours(start: number, end: number): boolean {
  const h = (new Date().getUTCHours() + 5) % 24
  return h >= start && h < end
}

async function fetchRecentMessages(orgId: string, channelId: string, limit = 30) {
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

async function fetchRelevantDocs(orgId: string, query: string) {
  const sql = getSQL()
  const words = query.toLowerCase().replace(/[^\wа-яёўқғҳ\s]/gi, '').split(/\s+/).filter(w => w.length > 3).slice(0, 6)
  if (words.length === 0) return []
  try {
    const patterns = words.map(w => `%${w}%`)
    const docs = await sql`
      SELECT title, url, category, LEFT(content, 500) as excerpt,
        (CASE WHEN title ILIKE ${patterns[0]} THEN 15 ELSE 0 END +
         CASE WHEN content ILIKE ${patterns[0]} THEN 5 ELSE 0 END +
         CASE WHEN title ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]} THEN 10 ELSE 0 END +
         CASE WHEN content ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]} THEN 3 ELSE 0 END
        ) as score
      FROM support_docs
      WHERE org_id = ${orgId}
        AND (title ILIKE ${patterns[0]} OR content ILIKE ${patterns[0]}
             OR title ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]}
             OR content ILIKE ${patterns.length > 1 ? patterns[1] : patterns[0]})
      ORDER BY score DESC
      LIMIT 5
    `
    return docs.filter((d: any) => d.score > 0).map((d: any) => ({
      title: d.title,
      url: d.url,
      category: d.category,
      excerpt: (d.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300),
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
    return cases.map((c: any) => ({ id: c.id, title: c.title, priority: c.priority, status: c.status }))
  } catch { return [] }
}

async function fetchChannelProfile(orgId: string, channelId: string) {
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

function buildSystemPrompt(agents: any[], isWorkHours: boolean, docs: any[]): string {
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}, ${a.status === 'online' ? 'онлайн' : 'занят'}): id=${a.id}`).join('\n')
    : 'Сейчас нет доступных сотрудников'

  const docsBlock = docs.length > 0
    ? `\nБАЗА ЗНАНИЙ DELEVER (используй для ответов, ссылайся на статьи):\n${docs.map(d => `• [${d.category}] ${d.title}\n  URL: ${d.url}\n  ${d.excerpt}`).join('\n')}`
    : ''

  return `Ты — опытный специалист службы поддержки Delever. Тебя зовут как обычного сотрудника. Ты общаешься живо и естественно, как реальный менеджер.

ТЕКУЩЕЕ ВРЕМЯ: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}
РАБОЧИЕ ЧАСЫ: ${isWorkHours ? 'ДА' : 'НЕТ — ночь/выходной'}

ДОСТУПНЫЕ СОТРУДНИКИ:
${agentList}
${docsBlock}

ТВОЙ СТИЛЬ ОБЩЕНИЯ:
- Пиши как живой человек, НЕ как робот. Без шаблонных "Ваше обращение зафиксировано"
- Задавай уточняющие вопросы: "А какой у вас филиал?", "Можете скинуть скрин?", "Это в приложении или на сайте?"
- Используй имя клиента если знаешь: "Да, Ахмед, сейчас разберёмся"
- Если знаешь ответ — давай конкретную инструкцию, а не общие фразы
- Если есть статья в базе знаний — дай ссылку: "Вот инструкция: [ссылка]"
- Если не знаешь — честно скажи "Сейчас уточню у коллег" вместо пустых обещаний
- Пиши коротко. Не растекайся. 2-3 предложения максимум

ПРАВИЛА РЕШЕНИЙ:
1. REPLY — если можешь дать полезный ответ (есть в документации, знаешь из истории, простой вопрос). ВСЕГДА задавай уточняющий вопрос если информации мало
2. REPLY_AND_TAG — если ответил, но нужно внимание специалиста (сложный кейс)
3. TAG_AGENT — если вопрос техничный / нужен конкретный человек и ты не можешь помочь
4. ESCALATE — клиент злится, повторное обращение без решения, критическая проблема
5. CREATE_CASE — новая проблема, нужно расследование
6. WAIT — если лучше дождаться сотрудника (сомнения, непонятный контекст)

ЕСЛИ ЕСТЬ СТАТЬЯ В БАЗЕ ЗНАНИЙ — обязательно включи ссылку в replyText. Формат: "Подробнее: <url>"

В НЕРАБОЧЕЕ ВРЕМЯ: "Привет! Сейчас нерабочее время, но я зафиксировал обращение. Утром коллеги свяжутся с вами. Если срочно — опишите подробнее, передам."

ОТВЕЧАЙ JSON:
{
  "action": "reply|tag_agent|escalate|create_case|wait|reply_and_tag",
  "replyText": "живой текст ответа (если отвечаешь)",
  "tagAgentId": "id (если тегаешь)",
  "tagAgentName": "имя (если тегаешь)",
  "escalateToRole": "admin",
  "casePriority": "low|medium|high|critical",
  "caseTitle": "краткий заголовок кейса",
  "reasoning": "почему принял такое решение",
  "confidence": 0.85,
  "docLinks": ["url1", "url2"]
}`
}

function buildUserPrompt(ctx: AgentContext, messages: any[], history: any[], cases: any[], profile: any): string {
  const chatHistory = messages.length > 0
    ? messages.map(m => `[${m.role === 'client' ? '👤' : '💬'}] ${m.sender}: ${m.text}`).join('\n')
    : '(новый диалог, истории нет)'

  const historyBlock = history.length > 0
    ? `\n\nПОХОЖИЕ ДИАЛОГИ ИЗ ПРОШЛОГО (учись на них, повторяй стиль ответов сотрудников):\n${history.map((h, i) => `--- Пример ${i + 1} ---\nКлиент: ${h.question}\nОтвет (${h.answeredBy}): ${h.answer}`).join('\n')}`
    : ''

  const casesBlock = cases.length > 0
    ? `\n\nОТКРЫТЫЕ КЕЙСЫ:\n${cases.map(c => `- [${c.priority}] ${c.title} (${c.status})`).join('\n')}`
    : ''

  const profileBlock = profile
    ? `\nПРОФИЛЬ КАНАЛА: ${profile.name}, тип: ${profile.type}${profile.tags?.length ? ', теги: ' + profile.tags.join(', ') : ''}${profile.waitingMinutes ? ', клиент ждёт: ' + profile.waitingMinutes + ' мин' : ''}`
    : ''

  return `КАНАЛ: ${ctx.channelName} (${ctx.source}, ${ctx.isGroup ? 'группа' : 'личка'})
ОТПРАВИТЕЛЬ: ${ctx.senderName}${profileBlock}

ПЕРЕПИСКА:
${chatHistory}

НОВОЕ СООБЩЕНИЕ:
${ctx.senderName}: ${ctx.incomingMessage}
${historyBlock}${casesBlock}

Прими решение. Помни: отвечай как живой человек, не как бот.`
}

export async function runAgent(ctx: AgentContext): Promise<{ decision: AgentDecision; skipped?: boolean; reason?: string } | null> {
  const settings = await getAgentSettings(ctx.orgId)
  if (!settings.enabled) return { decision: null as any, skipped: true, reason: 'agent_disabled' }
  if (settings.excludeChannels.includes(ctx.channelId)) return { decision: null as any, skipped: true, reason: 'channel_excluded' }

  const workHours = isWorkingHours(settings.workingHoursStart, settings.workingHoursEnd)
  if (settings.mode === 'night_only' && workHours) return { decision: null as any, skipped: true, reason: 'working_hours' }

  const apiKey = await getTogetherKey(ctx.orgId)
  if (!apiKey) return { decision: null as any, skipped: true, reason: 'no_api_key' }

  const [messages, agents, history, cases, docs, profile] = await Promise.all([
    fetchRecentMessages(ctx.orgId, ctx.channelId),
    fetchAvailableAgents(ctx.orgId),
    fetchSimilarHistory(ctx.orgId, ctx.incomingMessage),
    fetchOpenCases(ctx.orgId, ctx.channelId),
    fetchRelevantDocs(ctx.orgId, ctx.incomingMessage),
    fetchChannelProfile(ctx.orgId, ctx.channelId),
  ])

  const systemPrompt = buildSystemPrompt(agents, workHours, docs)
  const userPrompt = buildUserPrompt(ctx, messages, history, cases, profile)

  try {
    const res = await fetch(TOGETHER_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.35,
        max_tokens: 700,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown')
      console.error(`[AI Agent] Together API error: ${res.status} ${err}`)
      return { decision: null as any, skipped: true, reason: `Together API: ${res.status} — ${err.slice(0, 200)}` }
    }

    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || ''
    if (!content) return { decision: null as any, skipped: true, reason: 'Пустой ответ модели' }

    const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/^<think>[\s\S]*?<\/think>\s*/i, '').trim()
    let decision: AgentDecision
    try {
      decision = JSON.parse(clean)
    } catch {
      console.error('[AI Agent] JSON parse failed:', clean.slice(0, 300))
      return { decision: null as any, skipped: true, reason: `Ошибка парсинга: ${clean.slice(0, 100)}` }
    }

    await logDecision(ctx, decision, messages.length, history.length, docs.length)
    return { decision }
  } catch (e: any) {
    console.error('[AI Agent] Error:', e.message)
    return { decision: null as any, skipped: true, reason: `Ошибка: ${e.message}` }
  }
}

async function logDecision(ctx: AgentContext, d: AgentDecision, msgCount: number, historyCount: number, docsCount: number) {
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
        ${d.action}, ${d.replyText || null}, ${d.tagAgentId || null},
        ${d.tagAgentName || null}, ${d.escalateToRole || null},
        ${d.casePriority || null}, ${d.caseTitle || null},
        ${d.reasoning}, ${d.confidence}, ${msgCount}, ${historyCount}, NOW()
      )
    `
  } catch (e: any) { console.error('[AI Agent] Log error:', e.message) }
}

export async function executeDecision(
  ctx: AgentContext, decision: AgentDecision,
  sendMessage: (chatId: string, text: string) => Promise<void>
): Promise<{ executed: string[] }> {
  const executed: string[] = []

  if ((decision.action === 'reply' || decision.action === 'reply_and_tag') && decision.replyText) {
    try {
      await sendMessage(ctx.channelId, decision.replyText)
      executed.push('reply_sent')
    } catch (e: any) { console.error('[AI Agent] Reply failed:', e.message) }
  }

  if ((decision.action === 'tag_agent' || decision.action === 'reply_and_tag') && decision.tagAgentName) {
    try {
      await sendMessage(ctx.channelId, `⚡ @${decision.tagAgentName}, обратите внимание на сообщение от ${ctx.senderName}`)
      executed.push('agent_tagged')
    } catch (e: any) { console.error('[AI Agent] Tag failed:', e.message) }
  }

  if (decision.action === 'escalate') {
    try {
      await sendMessage(ctx.channelId, `🔴 Эскалация: ${decision.reasoning}`)
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
    } catch (e: any) { console.error('[AI Agent] Case failed:', e.message) }
  }

  return { executed }
}
