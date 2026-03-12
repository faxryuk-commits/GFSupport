import { neon } from '@neondatabase/serverless'
import {
  getTogetherKey, getAgentSettings, isWorkingHours,
  fetchRecentMessages, fetchAvailableAgents, fetchSimilarHistory,
  fetchRelevantDocs, fetchFeedbackExamples, fetchOpenCases,
  fetchTeamStyleExamples, fetchTopCategories, fetchOverdueCommitments,
  fetchChannelProfile,
} from './ai-agent-data.js'

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

function buildSystemPrompt(agents: any[], isWorkHours: boolean, docs: any[], customInstructions: string, topCategories?: any[], teamExamples?: any[]): string {
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}, ${a.status === 'online' ? 'онлайн' : 'занят'}): id=${a.id}`).join('\n')
    : 'Сейчас нет доступных сотрудников'

  const docsBlock = docs.length > 0
    ? `\nБАЗА ЗНАНИЙ DELEVER (используй для ответов, ссылайся на статьи):\n${docs.map(d => `• [${d.category}] ${d.title}\n  URL: ${d.url}\n  ${d.excerpt}`).join('\n')}`
    : ''

  const customBlock = customInstructions.trim()
    ? `\nОСОБЫЕ ИНСТРУКЦИИ ОТ РУКОВОДСТВА (строго соблюдай):\n${customInstructions.trim()}`
    : ''

  const categoriesBlock = topCategories && topCategories.length > 0
    ? `\nЧАСТЫЕ ТЕМЫ ОБРАЩЕНИЙ (по убыванию): ${topCategories.map(c => `${c.category}(${c.count})`).join(', ')}`
    : ''

  const teamStyleBlock = teamExamples && teamExamples.length > 0
    ? `\nПРИМЕРЫ ОТВЕТОВ КОМАНДЫ (копируй их стиль, длину, тон):\n${teamExamples.map((e, i) => `${i + 1}. Клиент: "${e.client}"\n   ${e.agent}: "${e.reply}"`).join('\n')}`
    : ''

  return `Ты — опытный менеджер поддержки Delever. Delever — платформа управления онлайн-заказами и доставкой для ресторанов в Узбекистане. Клиенты — владельцы/менеджеры ресторанов, они используют Delever для приёма заказов, меню, интеграции с iiko/R-Keeper, мобильного приложения.

ТЕКУЩЕЕ ВРЕМЯ: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}
РАБОЧИЕ ЧАСЫ: ${isWorkHours ? 'ДА' : 'НЕТ — ночь/выходной'}

ДОСТУПНЫЕ СОТРУДНИКИ:
${agentList}
${docsBlock}
${customBlock}
${categoriesBlock}
${teamStyleBlock}

═══ ЯЗЫК / TIL / LANGUAGE ═══

Клиенты пишут на ТРЁХ языках, часто смешивая в одном сообщении:

1. УЗБЕКСКИЙ ЛАТИНИЦА (самый частый): "salom", "ishlamayapti", "yordam bering", "buyurtma", "filial"
2. РУССКИЙ: "здравствуйте", "не работает", "помогите"
3. УЗБЕКСКИЙ КИРИЛЛИЦА: "ишламаяпти", "буюртма", "ёрдам"

ПРАВИЛО: Определи язык клиента и отвечай НА ТОМ ЖЕ ЯЗЫКЕ и в ТОЙ ЖЕ ПИСЬМЕННОСТИ.

Примеры на узбекском (учись):
- "Assalomu alaykum! Tushundim, hozir ko'rib beraman 😊"
- "Salom! Muammoni tushundim. Quyidagilarni tekshirib ko'ring: ..."
- "Rahmat, murojaat uchun! Hozir mutaxassis ulayaman."
- "Kechirasiz noqulaylik uchun! Buni tezda hal qilamiz."

Примеры на русском:
- "Здравствуйте! Давайте разберёмся, сейчас посмотрю."
- "Понял, спасибо что написали. Проверьте пожалуйста..."
- "Передам коллегам, скоро вернусь с ответом."

НИКОГДА НЕ ПИШИ:
- Формально: "Ваше обращение зарегистрировано", "Благодарим за обращение"
- Грубо: "Конкретроқ айтсангиз", "Нима демоқчисиз?"
- Роботоподобно: "Я AI-ассистент...", "Как языковая модель..."

═══ СТИЛЬ ═══

- Пиши как живой менеджер: коротко, конкретно, тепло
- Называй клиента по имени если знаешь
- Уточняй мягко если мало деталей: "Qaysi filial?", "Скрин юборсангиз тезроқ ёрдам берамиз"
- Если знаешь ответ — давай пошаговую инструкцию (1, 2, 3...)
- Если есть статья в базе — дай ссылку: "Batafsil: <url>" / "Подробнее: <url>"
- Если не знаешь точно — "Yaxshi savol, hozir hamkasblarimdan aniqlab javob beraman"
- Длина: 2-4 предложения. Не перегружай

═══ ПРАВИЛА РЕШЕНИЙ (строго по приоритету) ═══

1. **ESCALATE** — ОБЯЗАТЕЛЬНО при ЛЮБОМ из условий:
   - Клиент злится/расстроен, КАПС, много "!" или "?"
   - Повторная жалоба (в переписке видно что он уже писал об этом)
   - Критический сбой: система/сайт/приложение не работает, заказы не проходят
   - Клиент ждёт больше 30 мин и повторяет вопрос
   - Потеря денег/клиентов/данных
   - Просроченное обязательство перед клиентом
   - МАРКЕРЫ на узбекском: "ishlamayapti", "yana", "yana xuddi shunday", "necha marta aytaman", "javob bermayapsizlar", "buzilgan", "yo'qoldi", "pul qaytaring"
   - МАРКЕРЫ на русском: "опять", "снова", "третий раз", "сколько можно", "никто не отвечает", "верните деньги"
   - МАРКЕРЫ на кириллице: "ишламаяпти", "бузилган", "яна", "жавоб берилмаяпти"
   - Всегда ставь escalateToRole="admin", casePriority="critical"

2. **REPLY** — можешь помочь сам (есть в документации или истории). Если мало данных — вежливо уточни

3. **REPLY_AND_TAG** — ответил клиенту, но нужен специалист для доработки

4. **TAG_AGENT** — технический вопрос, нужен конкретный человек (iiko-интеграция, биллинг, баг)

5. **CREATE_CASE** — новая проблема для расследования. priority=critical если: массовый сбой, потеря данных

6. **WAIT** — только если вопрос не срочный и лучше дождаться специалиста

═══ ЭКСПЕРТНЫЕ ЗНАНИЯ DELEVER ═══

Частые проблемы и решения (используй в ответах):
- iiko интеграция (стоп-лист, модификаторы, синхронизация) → проверь настройки в iiko и Delever
- Меню (позиции не отображаются, модификаторы) → Delever CMS → Меню → проверь активность
- Заказы (не приходят, дублируются, статус) → проверь интеграцию и подключение
- Приложение (не открывается, крашится) → версия, ОС, переустановка
- Оплата/биллинг → передай менеджеру

═══ ОТВЕТ JSON ═══

{
  "action": "reply|tag_agent|escalate|create_case|wait|reply_and_tag",
  "replyText": "тёплый живой текст на языке клиента",
  "tagAgentId": "id (если тегаешь)",
  "tagAgentName": "имя (если тегаешь)",
  "escalateToRole": "admin",
  "casePriority": "low|medium|high|critical",
  "caseTitle": "краткий заголовок",
  "reasoning": "почему принял решение (на русском)",
  "confidence": 0.85,
  "docLinks": ["url1"]
}`
}

function buildUserPrompt(
  ctx: AgentContext, messages: any[], history: any[], cases: any[],
  profile: any, feedback?: { good: any[]; bad: any[] }, overdueCommitments?: any[]
): string {
  const chatHistory = messages.length > 0
    ? messages.map(m => `[${m.role === 'client' ? '👤' : '💬'}] ${m.sender}: ${m.text}`).join('\n')
    : '(новый диалог, истории нет)'

  const historyBlock = history.length > 0
    ? `\n\nПОХОЖИЕ ДИАЛОГИ ИЗ ПРОШЛОГО (учись на них, повторяй стиль ответов):\n${history.map((h, i) => `--- Пример ${i + 1} ---\nКлиент: ${h.question}\nОтвет (${h.answeredBy}): ${h.answer}`).join('\n')}`
    : ''

  const casesBlock = cases.length > 0
    ? `\n\nОТКРЫТЫЕ КЕЙСЫ ПО ЭТОМУ КАНАЛУ:\n${cases.map(c => `- [${c.priority}] ${c.title} (${c.status})`).join('\n')}`
    : ''

  const profileBlock = profile
    ? `\nПРОФИЛЬ КАНАЛА: ${profile.name}, тип: ${profile.type}${profile.tags?.length ? ', теги: ' + profile.tags.join(', ') : ''}${profile.waitingMinutes ? ', ⚠️ КЛИЕНТ ЖДЁТ: ' + profile.waitingMinutes + ' мин!' : ''}`
    : ''

  let feedbackBlock = ''
  if (feedback) {
    if (feedback.good.length > 0) {
      feedbackBlock += `\n\nТВОИ УДАЧНЫЕ ОТВЕТЫ (повторяй стиль):\n${feedback.good.map((f, i) => `✅ ${i + 1}. "${f.msg}" → ${f.action}: "${f.reply}"`).join('\n')}`
    }
    if (feedback.bad.length > 0) {
      feedbackBlock += `\n\nТВОИ ОШИБКИ (не повторяй!):\n${feedback.bad.map((f, i) => `❌ ${i + 1}. "${f.msg}" → ${f.action}: "${f.reply}"${f.note ? ` [${f.note}]` : ''}`).join('\n')}`
    }
  }

  const overdueBlock = overdueCommitments && overdueCommitments.length > 0
    ? `\n\n⚠️ ПРОСРОЧЕННЫЕ ОБЯЗАТЕЛЬСТВА перед этим клиентом (ОБЯЗАТЕЛЬНО учти при ответе, извинись!):\n${overdueCommitments.map(c => `- "${c.text}" (дедлайн: ${c.deadline}, ответственный: ${c.agent})`).join('\n')}`
    : ''

  const waitWarning = profile?.waitingMinutes && profile.waitingMinutes > 30
    ? `\n\n⚠️ КЛИЕНТ ЖДЁТ ${profile.waitingMinutes} МИНУТ! Это критично — извинись за задержку и помоги быстро.`
    : ''

  return `КАНАЛ: ${ctx.channelName} (${ctx.source}, ${ctx.isGroup ? 'группа' : 'личка'})
ОТПРАВИТЕЛЬ: ${ctx.senderName}${profileBlock}
${waitWarning}
ПЕРЕПИСКА:
${chatHistory}

НОВОЕ СООБЩЕНИЕ:
${ctx.senderName}: ${ctx.incomingMessage}
${historyBlock}${casesBlock}${overdueBlock}${feedbackBlock}

Прими решение. Отвечай на языке клиента, тепло и конкретно.`
}

export async function runAgent(ctx: AgentContext): Promise<{ decision: AgentDecision; skipped?: boolean; reason?: string } | null> {
  const settings = await getAgentSettings(ctx.orgId, DEFAULT_MODEL)
  if (!settings.enabled) return { decision: null as any, skipped: true, reason: 'agent_disabled' }
  if (settings.excludeChannels.includes(ctx.channelId)) return { decision: null as any, skipped: true, reason: 'channel_excluded' }

  const workHours = isWorkingHours(settings.workingHoursStart, settings.workingHoursEnd)
  if (settings.mode === 'night_only' && workHours) return { decision: null as any, skipped: true, reason: 'working_hours' }

  const apiKey = await getTogetherKey(ctx.orgId)
  if (!apiKey) return { decision: null as any, skipped: true, reason: 'no_api_key' }

  const [messages, agents, history, cases, docs, profile, feedback, teamExamples, topCategories, overdueCommitments] = await Promise.all([
    fetchRecentMessages(ctx.orgId, ctx.channelId),
    fetchAvailableAgents(ctx.orgId),
    fetchSimilarHistory(ctx.orgId, ctx.incomingMessage),
    fetchOpenCases(ctx.orgId, ctx.channelId),
    fetchRelevantDocs(ctx.orgId, ctx.incomingMessage, apiKey),
    fetchChannelProfile(ctx.orgId, ctx.channelId),
    fetchFeedbackExamples(ctx.orgId),
    fetchTeamStyleExamples(ctx.orgId),
    fetchTopCategories(ctx.orgId),
    fetchOverdueCommitments(ctx.orgId, ctx.channelId),
  ])

  const systemPrompt = buildSystemPrompt(agents, workHours, docs, settings.customInstructions, topCategories, teamExamples)
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

    try {
      const { sendNotification } = await import('./notifications.js')
      if (decision.tagAgentId) {
        await sendNotification({
          orgId: ctx.orgId,
          type: 'tag',
          title: `Вас тегнул AI-агент`,
          body: `Клиент "${ctx.senderName}" написал: "${ctx.incomingMessage.slice(0, 150)}"\n\nАгент считает, что нужна ваша помощь.`,
          channelId: ctx.channelId,
          channelName: ctx.channelName,
          senderName: ctx.senderName,
          priority: 'high',
          targetAgentIds: [decision.tagAgentId],
        })
      }
      await sendNotification({
        orgId: ctx.orgId,
        type: 'tag',
        title: `AI-агент тегнул ${decision.tagAgentName || 'сотрудника'}`,
        body: `Канал: ${ctx.channelName}\nКлиент "${ctx.senderName}" написал: "${ctx.incomingMessage.slice(0, 150)}"\n\nПричина: ${decision.reasoning?.slice(0, 200) || 'нужна помощь'}`,
        channelId: ctx.channelId,
        channelName: ctx.channelName,
        senderName: ctx.senderName,
        priority: 'high',
        targetRoles: ['admin'],
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
        orgId: ctx.orgId,
        type: 'escalation',
        title: `Эскалация от AI-агента`,
        body: `Клиент "${ctx.senderName}" написал: "${ctx.incomingMessage.slice(0, 200)}"\n\nПричина: ${decision.reasoning}`,
        channelId: ctx.channelId,
        channelName: ctx.channelName,
        senderName: ctx.senderName,
        priority: 'critical',
        targetRoles: ['admin', 'owner', 'manager'],
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
          orgId: ctx.orgId,
          type: 'critical_case',
          title: `Новый ${decision.casePriority === 'critical' ? 'критический' : 'важный'} кейс`,
          body: `"${decision.caseTitle || ctx.incomingMessage.slice(0, 100)}"\n\nОт: ${ctx.senderName}\nПриоритет: ${decision.casePriority}`,
          channelId: ctx.channelId,
          channelName: ctx.channelName,
          senderName: ctx.senderName,
          priority: decision.casePriority,
        })
        executed.push('case_notification_sent')
      } catch (e: any) { console.error('[AI Agent] Case notification failed:', e.message) }
    }
  }

  return { executed }
}
