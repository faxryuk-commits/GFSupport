import OpenAI from 'openai'
import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, getOpenAIKey, json, corsHeaders } from '../lib/db.js'
import {
  ensureChatTables,
  getOpenAITools,
  isActiveTool,
  TOOLS,
  type ToolCtx,
} from '../lib/insights-tools.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 60,
}

/**
 * ИИ-чат: аналитический ассистент по данным системы поддержки.
 *
 *   GET    ?list=1                → список сессий пользователя
 *   GET    ?sessionId=...         → история сообщений сессии
 *   POST   {sessionId?, message, period?, source?, includePII?}
 *                                 → ответ ассистента (без стрима в этой версии)
 *   PATCH  {sessionId, title}     → переименовать сессию
 *   DELETE ?sessionId=...         → удалить сессию
 *
 * Безопасность:
 * - orgId фиксируется из middleware, LLM не может его переопределить;
 * - включены только whitelisted tools (см. lib/insights-tools.ts);
 * - PII-маска по умолчанию;
 * - до 5 шагов tool-calling, лимит времени всего цикла ~50с.
 */

const SYSTEM_PROMPT = `Ты — аналитик службы поддержки Delever (платформа для ресторанов и доставки).
Тебе помогают инструменты, которые ходят в нашу базу и возвращают свежие цифры.
Отвечай менеджеру/руководителю.

Жёсткие правила:
- Пиши ПО-РУССКИ, без markdown-таблиц. Списки и короткие маркированные пункты — ок.
- НЕ выдумывай факты. Если для ответа нужны данные — вызови инструмент. Если инструменты не подходят — честно скажи: «у меня нет такого инструмента».
- Каждый числовой тезис подкрепи конкретной цифрой из инструмента. Не округляй слишком грубо.
- Учитывай период: если пользователь не указал — по умолчанию 7 дней. Если просит «вчера/неделю/месяц» — подбери ближайший: today/7d/30d.
- Источник: telegram/whatsapp/all. По умолчанию — all.
- В конце ответа кратко напомни параметры запроса в скобках, например: «(7d, источник all, 142 замера)».
- НИКОГДА не показывай телефоны и email клиентов в открытом виде. Если они мелькнули в данных — оставь как «***».

Если запрос неоднозначный — задай ОДИН уточняющий вопрос, не десять.
Если данных мало (n < 5) — честно скажи «выборка маленькая, цифры неустойчивые».`

const MODEL = 'gpt-4o-mini'
const MAX_TOOL_LOOPS = 5
const TOTAL_TIMEOUT_MS = 55_000

interface ChatMessageRow {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | null
  tool_name: string | null
  tool_args: any
  tool_result: any
  created_at: string
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function trimTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 60 ? `${t.slice(0, 57)}…` : t
}

function formatSessionRow(r: any) {
  return {
    id: r.id,
    title: r.title,
    periodDefault: r.period_default,
    sourceDefault: r.source_default,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function formatMessageRow(r: ChatMessageRow) {
  return {
    id: r.id,
    role: r.role,
    content: r.content || '',
    toolName: r.tool_name || undefined,
    toolArgs: r.tool_args || undefined,
    toolResult: r.tool_result || undefined,
    createdAt: r.created_at,
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const orgId = ctx.orgId || (await getRequestOrgId(req))
  if (!orgId) return json({ error: 'no_org' }, 400)

  await ensureChatTables()
  const sql = getSQL()
  const url = new URL(req.url)

  // ---- GET --------------------------------------------------------------
  if (req.method === 'GET') {
    if (url.searchParams.get('list') === '1') {
      const rows = await sql`
        SELECT id, title, period_default, source_default, archived, created_at, updated_at
        FROM support_ai_chat_sessions
        WHERE org_id = ${orgId} AND user_id = ${ctx.agentId} AND archived = false
        ORDER BY updated_at DESC
        LIMIT 50
      `
      return json({ sessions: (rows as any[]).map(formatSessionRow) })
    }

    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) return json({ error: 'sessionId_or_list_required' }, 400)

    const [session] = await sql`
      SELECT id, title, period_default, source_default, archived, created_at, updated_at
      FROM support_ai_chat_sessions
      WHERE id = ${sessionId} AND org_id = ${orgId} AND user_id = ${ctx.agentId}
      LIMIT 1
    `
    if (!session) return json({ error: 'not_found' }, 404)

    const messages = await sql`
      SELECT id, session_id, role, content, tool_name, tool_args, tool_result, created_at
      FROM support_ai_chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `
    return json({
      session: formatSessionRow(session),
      messages: (messages as any[]).map((r) => formatMessageRow(r as ChatMessageRow)),
    })
  }

  // ---- DELETE -----------------------------------------------------------
  if (req.method === 'DELETE') {
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) return json({ error: 'sessionId_required' }, 400)
    await sql`
      DELETE FROM support_ai_chat_messages WHERE session_id = ${sessionId}
        AND session_id IN (
          SELECT id FROM support_ai_chat_sessions
          WHERE id = ${sessionId} AND org_id = ${orgId} AND user_id = ${ctx.agentId}
        )
    `
    await sql`
      DELETE FROM support_ai_chat_sessions
      WHERE id = ${sessionId} AND org_id = ${orgId} AND user_id = ${ctx.agentId}
    `
    return json({ ok: true })
  }

  // ---- PATCH (rename) ---------------------------------------------------
  if (req.method === 'PATCH') {
    let body: { sessionId?: string; title?: string } = {}
    try { body = await req.json() } catch {}
    if (!body.sessionId || !body.title) return json({ error: 'sessionId_and_title_required' }, 400)
    await sql`
      UPDATE support_ai_chat_sessions
      SET title = ${trimTitle(String(body.title))}, updated_at = NOW()
      WHERE id = ${body.sessionId} AND org_id = ${orgId} AND user_id = ${ctx.agentId}
    `
    return json({ ok: true })
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // ---- POST -------------------------------------------------------------
  let body: {
    sessionId?: string
    message?: string
    period?: string
    source?: string
    includePII?: boolean
  } = {}
  try { body = await req.json() } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const userMessage = String(body.message || '').trim()
  if (!userMessage) return json({ error: 'message_required' }, 400)
  if (userMessage.length > 4000) return json({ error: 'message_too_long' }, 400)

  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey) {
    return json({
      error: 'no_openai_key',
      message: 'Не настроен OPENAI_API_KEY для организации. Settings → AI и контент → AI Агент.',
    }, 400)
  }

  // Создаём сессию или подгружаем существующую.
  let sessionId = body.sessionId || ''
  let isNewSession = false
  if (!sessionId) {
    sessionId = genId('chat')
    isNewSession = true
    await sql`
      INSERT INTO support_ai_chat_sessions (id, org_id, user_id, title, period_default, source_default)
      VALUES (
        ${sessionId}, ${orgId}, ${ctx.agentId},
        ${trimTitle(userMessage) || 'Новый чат'},
        ${body.period || '7d'},
        ${body.source || 'all'}
      )
    `
  } else {
    const [s] = await sql`
      SELECT id FROM support_ai_chat_sessions
      WHERE id = ${sessionId} AND org_id = ${orgId} AND user_id = ${ctx.agentId}
      LIMIT 1
    `
    if (!s) return json({ error: 'session_not_found' }, 404)
  }

  // Сохраняем user-сообщение.
  const userMsgId = genId('msg')
  await sql`
    INSERT INTO support_ai_chat_messages (id, session_id, role, content)
    VALUES (${userMsgId}, ${sessionId}, 'user', ${userMessage})
  `

  // Подгружаем последние ~30 сообщений для контекста (без лишнего).
  const historyRows = await sql`
    SELECT id, session_id, role, content, tool_name, tool_args, tool_result, created_at
    FROM support_ai_chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT 30
  ` as any[]
  const history = historyRows.slice().reverse() as ChatMessageRow[]

  const llmMessages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const r of history) {
    if (r.role === 'user') {
      llmMessages.push({ role: 'user', content: r.content || '' })
    } else if (r.role === 'assistant') {
      llmMessages.push({ role: 'assistant', content: r.content || '' })
    }
    // tool-сообщения в LLM-контекст не подмешиваем — их контекст уже сжат
    // в финальный assistant-ответ. Если нужно вернуться к сырым данным,
    // пользователь спросит явно, и инструменты сходят заново.
  }

  // ---- LLM tool-loop ---------------------------------------------------
  const client = new OpenAI({ apiKey })
  const toolCtx: ToolCtx = {
    orgId,
    includePII: !!body.includePII,
    maxBytes: 8 * 1024,
  }

  const startedAt = Date.now()
  const collectedToolCalls: Array<{
    id: string
    name: string
    args: unknown
    result: unknown
    durationMs: number
  }> = []

  let finalContent = ''
  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
      finalContent = 'Не успел собрать данные за отведённое время. Попробуй уточнить вопрос или сократить период.'
      break
    }

    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: llmMessages,
      tools: getOpenAITools(),
    })

    const choice = resp.choices?.[0]?.message
    if (!choice) {
      finalContent = 'Не удалось получить ответ модели.'
      break
    }

    const toolCalls = choice.tool_calls || []
    if (!toolCalls.length) {
      finalContent = (choice.content || '').trim() || 'Не удалось сформулировать ответ.'
      break
    }

    // Подшиваем сам assistant-сообщение с tool_calls в контекст.
    llmMessages.push({
      role: 'assistant',
      content: choice.content || '',
      tool_calls: toolCalls,
    })

    for (const tc of toolCalls) {
      const name = tc.function?.name || ''
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}

      let result: unknown
      const t0 = Date.now()
      if (!isActiveTool(name)) {
        result = { error: 'unknown_tool', tried: name }
      } else {
        try {
          result = await TOOLS[name].execute(args, toolCtx)
        } catch (e: any) {
          result = { error: 'tool_failed', message: e?.message || 'tool error' }
        }
      }
      const durationMs = Date.now() - t0

      collectedToolCalls.push({
        id: tc.id || genId('tc'),
        name,
        args,
        result,
        durationMs,
      })

      // Сохраняем tool-вызов отдельным сообщением — будет видно во фронте.
      await sql`
        INSERT INTO support_ai_chat_messages (id, session_id, role, tool_name, tool_args, tool_result)
        VALUES (
          ${genId('msg')}, ${sessionId}, 'tool',
          ${name},
          ${JSON.stringify(args)}::jsonb,
          ${JSON.stringify(result)}::jsonb
        )
      `

      llmMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }
  }

  if (!finalContent) {
    finalContent = 'Слишком много шагов рассуждения, не уложился. Уточни вопрос.'
  }

  // Сохраняем финальный ответ ассистента.
  const assistantMsgId = genId('msg')
  await sql`
    INSERT INTO support_ai_chat_messages (id, session_id, role, content)
    VALUES (${assistantMsgId}, ${sessionId}, 'assistant', ${finalContent})
  `
  await sql`
    UPDATE support_ai_chat_sessions
    SET updated_at = NOW()
    WHERE id = ${sessionId}
  `

  return json({
    sessionId,
    isNewSession,
    assistantMessage: {
      id: assistantMsgId,
      role: 'assistant',
      content: finalContent,
      toolCalls: collectedToolCalls,
      createdAt: new Date().toISOString(),
    },
  })
}
