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
    stream?: boolean
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

  const client = new OpenAI({ apiKey })
  const toolCtx: ToolCtx = {
    orgId,
    includePII: !!body.includePII,
    maxBytes: 8 * 1024,
  }

  const wantStream = body.stream !== false
  if (wantStream) {
    return streamRun({
      client,
      llmMessages,
      sessionId,
      isNewSession,
      sql,
      toolCtx,
    })
  }
  return jsonRun({
    client,
    llmMessages,
    sessionId,
    isNewSession,
    sql,
    toolCtx,
  })
}

// =====================================================================
// JSON-режим (без стрима) — оставлен для curl и обратной совместимости.
// =====================================================================

interface RunCtx {
  client: OpenAI
  llmMessages: any[]
  sessionId: string
  isNewSession: boolean
  sql: ReturnType<typeof getSQL>
  toolCtx: ToolCtx
}

async function jsonRun(ctx: RunCtx): Promise<Response> {
  const startedAt = Date.now()
  const collected: any[] = []
  let finalContent = ''

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
      finalContent = 'Не успел собрать данные за отведённое время.'
      break
    }
    const resp = await ctx.client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: ctx.llmMessages,
      tools: getOpenAITools(),
    })
    const choice = resp.choices?.[0]?.message
    if (!choice) { finalContent = 'Не удалось получить ответ.'; break }
    const toolCalls = choice.tool_calls || []
    if (!toolCalls.length) {
      finalContent = (choice.content || '').trim() || 'Не удалось сформулировать ответ.'
      break
    }
    ctx.llmMessages.push({ role: 'assistant', content: choice.content || '', tool_calls: toolCalls })
    for (const tc of toolCalls) {
      const out = await runOneTool(tc, ctx)
      collected.push(out)
      ctx.llmMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out.result) })
    }
  }
  if (!finalContent) finalContent = 'Слишком много шагов рассуждения, уточни вопрос.'

  const assistantMsgId = genId('msg')
  await ctx.sql`
    INSERT INTO support_ai_chat_messages (id, session_id, role, content)
    VALUES (${assistantMsgId}, ${ctx.sessionId}, 'assistant', ${finalContent})
  `
  await ctx.sql`UPDATE support_ai_chat_sessions SET updated_at = NOW() WHERE id = ${ctx.sessionId}`

  return json({
    sessionId: ctx.sessionId,
    isNewSession: ctx.isNewSession,
    assistantMessage: {
      id: assistantMsgId,
      role: 'assistant',
      content: finalContent,
      toolCalls: collected,
      createdAt: new Date().toISOString(),
    },
  })
}

async function runOneTool(tc: any, ctx: RunCtx) {
  const name = tc.function?.name || ''
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
  let result: unknown
  const t0 = Date.now()
  if (!isActiveTool(name)) {
    result = { error: 'unknown_tool', tried: name }
  } else {
    try { result = await TOOLS[name].execute(args, ctx.toolCtx) }
    catch (e: any) { result = { error: 'tool_failed', message: e?.message || 'tool error' } }
  }
  const durationMs = Date.now() - t0
  await ctx.sql`
    INSERT INTO support_ai_chat_messages (id, session_id, role, tool_name, tool_args, tool_result)
    VALUES (
      ${genId('msg')}, ${ctx.sessionId}, 'tool',
      ${name},
      ${JSON.stringify(args)}::jsonb,
      ${JSON.stringify(result)}::jsonb
    )
  `
  return { id: tc.id || genId('tc'), name, args, result, durationMs }
}

// =====================================================================
// SSE-стрим — основной режим для UI.
// События: ready, tool_start, tool_end, token, done, error.
// Token-стрим включается на финальной итерации (когда модель не зовёт tools).
// =====================================================================

function streamRun(ctx: RunCtx): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const startedAt = Date.now()
      const collected: any[] = []
      let finalContent = ''

      try {
        send('ready', { sessionId: ctx.sessionId, isNewSession: ctx.isNewSession })

        for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
          if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
            finalContent = 'Не успел собрать данные за отведённое время. Уточни вопрос.'
            break
          }

          // Не-стримящий запрос — нам нужен либо весь tool_calls, либо явный финал.
          const resp = await ctx.client.chat.completions.create({
            model: MODEL,
            temperature: 0.2,
            max_tokens: 700,
            messages: ctx.llmMessages,
            tools: getOpenAITools(),
          })
          const choice = resp.choices?.[0]?.message
          if (!choice) { finalContent = 'Не удалось получить ответ.'; break }
          const toolCalls = choice.tool_calls || []

          if (!toolCalls.length) {
            // Финал. Здесь делаем второй вызов УЖЕ в стрим-режиме, чтобы пользователь
            // видел токены по мере появления. Это второй запрос к LLM, но дешёвый —
            // на финальной итерации tool_calls уже не будет.
            finalContent = (choice.content || '').trim() || 'Не удалось сформулировать ответ.'

            const ts = await ctx.client.chat.completions.create({
              model: MODEL,
              temperature: 0.2,
              max_tokens: 700,
              messages: ctx.llmMessages,
              tools: getOpenAITools(),
              stream: true,
            })
            let streamed = ''
            for await (const part of ts) {
              const delta = part.choices?.[0]?.delta?.content || ''
              if (delta) {
                streamed += delta
                send('token', { delta })
              }
              const finish = part.choices?.[0]?.finish_reason
              if (finish === 'stop') break
            }
            if (streamed.trim()) finalContent = streamed.trim()
            break
          }

          // Есть tool_calls — выполняем их и шлём прогресс на фронт.
          ctx.llmMessages.push({
            role: 'assistant',
            content: choice.content || '',
            tool_calls: toolCalls,
          })
          for (const tc of toolCalls) {
            send('tool_start', {
              id: tc.id,
              name: tc.function?.name,
              args: safeParse(tc.function?.arguments),
            })
            const out = await runOneTool(tc, ctx)
            collected.push(out)
            send('tool_end', {
              id: out.id,
              name: out.name,
              args: out.args,
              result: out.result,
              durationMs: out.durationMs,
            })
            ctx.llmMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(out.result),
            })
          }
        }

        if (!finalContent) finalContent = 'Слишком много шагов рассуждения. Уточни вопрос.'

        const assistantMsgId = genId('msg')
        await ctx.sql`
          INSERT INTO support_ai_chat_messages (id, session_id, role, content)
          VALUES (${assistantMsgId}, ${ctx.sessionId}, 'assistant', ${finalContent})
        `
        await ctx.sql`UPDATE support_ai_chat_sessions SET updated_at = NOW() WHERE id = ${ctx.sessionId}`

        send('done', {
          messageId: assistantMsgId,
          content: finalContent,
          toolCalls: collected,
          createdAt: new Date().toISOString(),
        })
      } catch (e: any) {
        send('error', { message: e?.message || 'stream failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      // Чтобы Vercel/прокси не буферизовали:
      'X-Accel-Buffering': 'no',
    },
  })
}

function safeParse(s: string | undefined | null): any {
  try { return JSON.parse(s || '{}') } catch { return {} }
}
