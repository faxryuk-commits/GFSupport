import {
import { getSQL } from './db.js'
  getTogetherKey, getAgentSettings, isWorkingHours,
  fetchRecentMessages, fetchAvailableAgents, fetchSimilarHistory,
  fetchRelevantDocs, fetchFeedbackExamples, fetchOpenCases,
  fetchTeamStyleExamples, fetchTopCategories, fetchOverdueCommitments,
  fetchChannelProfile, shouldSkipChannel,
  type AgentRuleItem,
} from './ai-agent-data.js'

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

function buildSystemPrompt(agents: any[], isWorkHours: boolean, docs: any[], customInstructions: string, topCategories?: any[], teamExamples?: any[], rules?: AgentRuleItem[]): string {
  const primary = agents.find((a: any) => a.isChannelPrimary)
  const agentLines = agents.map((a: any) => {
    const parts = [`${a.name} (${a.role}, ${a.status === 'online' ? 'онлайн' : 'занят'})`]
    if (a.specializations?.length) parts.push(`темы: ${a.specializations.join(', ')}`)
    if (a.isChannelPrimary) parts.push('★ ОСНОВНОЙ МЕНЕДЖЕР КАНАЛА')
    return `- ${parts.join(' | ')}: id=${a.id}`
  })
  const agentList = agentLines.length > 0 ? agentLines.join('\n') : 'Сейчас нет доступных сотрудников'

  const docsBlock = docs.length > 0
    ? `\nБАЗА ЗНАНИЙ:\n${docs.map(d => `• [${d.category}] ${d.title}\n  ${d.url}\n  ${d.excerpt}`).join('\n')}`
    : ''

  const customBlock = customInstructions.trim()
    ? `\nИНСТРУКЦИИ РУКОВОДСТВА:\n${customInstructions.trim()}`
    : ''

  const activeRules = (rules || []).filter(r => r.enabled)
  const rulesBlock = activeRules.length > 0
    ? `\n═══ ПРАВИЛА ОТ РУКОВОДСТВА (ОБЯЗАТЕЛЬНО СОБЛЮДАЙ!) ═══\n${
        activeRules.map((r, i) => `${i + 1}. [${r.category}] ${r.text}`).join('\n')
      }`
    : ''

  const categoriesBlock = topCategories && topCategories.length > 0
    ? `\nЧАСТЫЕ ТЕМЫ: ${topCategories.map(c => `${c.category}(${c.count})`).join(', ')}`
    : ''

  const teamStyleBlock = teamExamples && teamExamples.length > 0
    ? `\nСТИЛЬ КОМАНДЫ:\n${teamExamples.map((e, i) => `${i + 1}. "${e.client}" → ${e.agent}: "${e.reply}"`).join('\n')}`
    : ''

  return `Ты — менеджер поддержки Delever (платформа онлайн-заказов для ресторанов, Узбекистан).

ВРЕМЯ: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}
РАБОЧИЕ ЧАСЫ: ${isWorkHours ? 'ДА' : 'НЕТ'}

СОТРУДНИКИ:
${agentList}
${primary ? `\n★ Основной менеджер канала: ${primary.name} (id=${primary.id}) — тегай ЕГО первым.` : ''}
${docsBlock}${customBlock}${rulesBlock}${categoriesBlock}${teamStyleBlock}

═══ КАТЕГОРИЧЕСКИЕ ЗАПРЕТЫ ═══

1. НЕ ПОВТОРЯЙ слова клиента дословно. "ТС Сатпаева д30/5" — не пиши это обратно.
2. НЕ ЗДОРОВАЙСЯ повторно. Посмотри переписку — если уже здоровался, не делай этого снова.
3. НЕ ОБЕЩАЙ действий. Ты НЕ МОЖЕШЬ проверить сервер, зайти в панель, починить.
   ❌ "Сейчас проверю", "Я посмотрю", "Сходим и починим"
   ✅ "Передаю специалисту", "Попробуйте: 1)... 2)...", "Вот инструкция: ..."
4. НЕ ПИШИ как робот: "Ваше обращение зарегистрировано", "Я AI-ассистент"
5. НЕ ПИШИ грубо, даже на узбекском

═══ ЯЗЫК ═══

Определи язык клиента и отвечай ТАК ЖЕ (узб. латиница / узб. кириллица / русский).

═══ СТИЛЬ ═══

- 1-3 предложения. Конкретно. Без воды.
- Если знаешь ответ → инструкция (1, 2, 3) или ссылка
- Если не знаешь → "Передаю коллегам" + tag_agent. Не додумывай.

═══ КТО ТЕГАТЬ ═══

1. ★ Основной менеджер канала (если есть) — он знает контекст
2. Сотрудник по специализации ("темы" в списке)
3. Если никто не подходит → admin

═══ РЕШЕНИЯ ═══

1. ESCALATE — клиент злится, повторная жалоба, критический сбой, потеря денег.
   Маркеры: "опять", "снова", "ishlamayapti", "yana", "buzilgan", "бузилган"
   → escalateToRole="admin", casePriority="critical"

2. REPLY — знаешь ответ. Дай конкретику, не обещания.

3. REPLY_AND_TAG — ответил + нужен специалист для подтверждения.

4. TAG_AGENT — не можешь помочь сам, передай. Не пиши клиенту ничего лишнего.

5. CREATE_CASE — новая проблема. critical если массовый сбой.

6. WAIT — не срочно, лучше дождаться специалиста.

JSON:
{
  "action": "reply|tag_agent|escalate|create_case|wait|reply_and_tag",
  "replyText": "текст (без повторов слов клиента!)",
  "tagAgentId": "id", "tagAgentName": "имя",
  "escalateToRole": "admin",
  "casePriority": "low|medium|high|critical",
  "caseTitle": "заголовок",
  "reasoning": "причина (русский)",
  "confidence": 0.85,
  "docLinks": ["url"]
}`
}

function buildUserPrompt(
  ctx: AgentContext, messages: any[], history: any[], cases: any[],
  profile: any, feedback?: { good: any[]; bad: any[] }, overdueCommitments?: any[]
): string {
  const chatHistory = messages.length > 0
    ? messages.map(m => `[${m.role === 'client' ? '👤' : '💬'}] ${m.sender}: ${m.text}`).join('\n')
    : '(новый диалог)'

  const myPrevReplies = messages
    .filter(m => m.role === 'support' && (m.sender === 'AI Agent' || m.sender === 'Delever Support' || m.sender === 'Delever Assistent'))
    .map(m => m.text).slice(-2)
  const alreadyGreeted = myPrevReplies.some(t =>
    /здравствуйте|добр|salom|assalomu/i.test(t)
  )

  const historyBlock = history.length > 0
    ? `\n\nПОХОЖИЕ ДИАЛОГИ:\n${history.map((h, i) => `${i + 1}. "${h.question}" → ${h.answeredBy}: "${h.answer}"`).join('\n')}`
    : ''

  const casesBlock = cases.length > 0
    ? `\n\nОТКРЫТЫЕ КЕЙСЫ:\n${cases.map(c => `- [${c.priority}] ${c.title} (${c.status})`).join('\n')}`
    : ''

  const profileBlock = profile
    ? `\nКАНАЛ: ${profile.name}, ${profile.type}${profile.waitingMinutes ? `, ждёт ${profile.waitingMinutes} мин` : ''}`
    : ''

  let feedbackBlock = ''
  if (feedback) {
    if (feedback.good.length > 0) {
      feedbackBlock += `\n\nУДАЧНЫЕ ОТВЕТЫ:\n${feedback.good.map((f, i) => `✅ "${f.msg}" → ${f.action}: "${f.reply}"`).join('\n')}`
    }
    if (feedback.bad.length > 0) {
      feedbackBlock += `\n\nОШИБКИ (не повторяй!):\n${feedback.bad.map((f, i) => `❌ "${f.msg}" → "${f.reply}"${f.note ? ` [${f.note}]` : ''}`).join('\n')}`
    }
  }

  const overdueBlock = overdueCommitments && overdueCommitments.length > 0
    ? `\n\n⚠️ ПРОСРОЧЕННЫЕ ОБЯЗАТЕЛЬСТВА:\n${overdueCommitments.map(c => `- "${c.text}" (дедлайн: ${c.deadline}, ${c.agent})`).join('\n')}`
    : ''

  const waitWarning = profile?.waitingMinutes && profile.waitingMinutes > 30
    ? `\n⚠️ КЛИЕНТ ЖДЁТ ${profile.waitingMinutes} МИНУТ!`
    : ''

  return `${ctx.channelName} (${ctx.source}, ${ctx.isGroup ? 'группа' : 'личка'})
${ctx.senderName}${profileBlock}${waitWarning}

ПЕРЕПИСКА:
${chatHistory}

НОВОЕ СООБЩЕНИЕ: ${ctx.senderName}: ${ctx.incomingMessage}
${alreadyGreeted ? '\n⚠️ Ты уже здоровался в этом диалоге — НЕ ЗДОРОВАЙСЯ снова.' : ''}
${historyBlock}${casesBlock}${overdueBlock}${feedbackBlock}

Прими решение.`
}

export async function runAgent(ctx: AgentContext): Promise<{ decision: AgentDecision; skipped?: boolean; reason?: string } | null> {
  const settings = await getAgentSettings(ctx.orgId, DEFAULT_MODEL)
  if (!settings.enabled) return { decision: null as any, skipped: true, reason: 'agent_disabled' }
  if (settings.excludeChannels.includes(ctx.channelId)) return { decision: null as any, skipped: true, reason: 'channel_excluded' }

  const workHours = isWorkingHours(settings.workingHoursStart, settings.workingHoursEnd)
  if (settings.mode === 'night_only' && workHours) return { decision: null as any, skipped: true, reason: 'working_hours' }

  const skipCheck = await shouldSkipChannel(ctx.orgId, ctx.channelId)
  if (skipCheck.skip) return { decision: null as any, skipped: true, reason: skipCheck.reason }

  const apiKey = await getTogetherKey(ctx.orgId)
  if (!apiKey) return { decision: null as any, skipped: true, reason: 'no_api_key' }

  const [messages, agents, history, cases, docs, profile, feedback, teamExamples, topCategories, overdueCommitments] = await Promise.all([
    fetchRecentMessages(ctx.orgId, ctx.channelId),
    fetchAvailableAgents(ctx.orgId, ctx.channelId),
    fetchSimilarHistory(ctx.orgId, ctx.incomingMessage),
    fetchOpenCases(ctx.orgId, ctx.channelId),
    fetchRelevantDocs(ctx.orgId, ctx.incomingMessage, apiKey),
    fetchChannelProfile(ctx.orgId, ctx.channelId),
    fetchFeedbackExamples(ctx.orgId),
    fetchTeamStyleExamples(ctx.orgId),
    fetchTopCategories(ctx.orgId),
    fetchOverdueCommitments(ctx.orgId, ctx.channelId),
  ])

  const systemPrompt = buildSystemPrompt(agents, workHours, docs, settings.customInstructions, topCategories, teamExamples, settings.rules)
  const userPrompt = buildUserPrompt(ctx, messages, history, cases, profile, feedback, overdueCommitments)

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
        temperature: 0.3,
        max_tokens: 600,
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

    try {
      const { sendNotification } = await import('./notifications.js')
      if (decision.tagAgentId) {
        await sendNotification({
          orgId: ctx.orgId, type: 'tag',
          title: `Вас тегнул AI-агент`,
          body: `Клиент "${ctx.senderName}": "${ctx.incomingMessage.slice(0, 150)}"\nПричина: ${decision.reasoning?.slice(0, 150) || ''}`,
          channelId: ctx.channelId, channelName: ctx.channelName, senderName: ctx.senderName,
          priority: 'high', targetAgentIds: [decision.tagAgentId],
        })
      }
      await sendNotification({
        orgId: ctx.orgId, type: 'tag',
        title: `AI тегнул ${decision.tagAgentName}`,
        body: `${ctx.channelName}: "${ctx.incomingMessage.slice(0, 150)}"`,
        channelId: ctx.channelId, channelName: ctx.channelName, senderName: ctx.senderName,
        priority: 'high', targetRoles: ['admin'],
      })
      executed.push('notification_sent')
    } catch (e: any) { console.error('[AI Agent] Tag notification failed:', e.message) }
  }

  if (decision.action === 'escalate') {
    try {
      await sendMessage(ctx.channelId, `🔴 Эскалация: ${decision.reasoning}`)
      executed.push('escalated')
    } catch {}

    try {
      const { sendNotification } = await import('./notifications.js')
      await sendNotification({
        orgId: ctx.orgId, type: 'escalation',
        title: `Эскалация`,
        body: `${ctx.senderName}: "${ctx.incomingMessage.slice(0, 200)}"\nПричина: ${decision.reasoning}`,
        channelId: ctx.channelId, channelName: ctx.channelName, senderName: ctx.senderName,
        priority: 'critical', targetRoles: ['admin', 'owner', 'manager'],
      })
      executed.push('escalation_notification_sent')
    } catch (e: any) { console.error('[AI Agent] Escalation notification failed:', e.message) }
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

    if (decision.casePriority === 'critical' || decision.casePriority === 'high') {
      try {
        const { sendNotification } = await import('./notifications.js')
        await sendNotification({
          orgId: ctx.orgId, type: 'critical_case',
          title: `${decision.casePriority === 'critical' ? 'Критический' : 'Важный'} кейс`,
          body: `"${decision.caseTitle || ctx.incomingMessage.slice(0, 100)}"\nОт: ${ctx.senderName}`,
          channelId: ctx.channelId, channelName: ctx.channelName, senderName: ctx.senderName,
          priority: decision.casePriority,
        })
        executed.push('case_notification_sent')
      } catch (e: any) { console.error('[AI Agent] Case notification failed:', e.message) }
    }
  }

  return { executed }
}
