import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders, getOpenAIKey } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureErrorFeedSchema, activeIncidents, recentErrorsForChannel } from '../lib/error-feed.js'
import { similarExamples } from '../lib/reply-examples.js'

export const config = { runtime: 'edge' }

/**
 * Черновик со знаниями — по кнопке ✨ в чате.
 *
 * Слой знаний работал, но до чата не доставал: черновики агента жили в
 * журнале, а сотрудник в переписке видел старые заготовки. Эта ручка
 * замыкает цепь: судьба заказов ресторана + сводка аварий + примеры
 * команды → готовый текст прямо в поле ввода. Отправка — рукой человека.
 *
 * GET ?channelId=... → { draft, knowledge, basis }
 */
const SYSTEM = `Ты — менеджер поддержки Delever (платформа онлайн-заказов для ресторанов).
ЗАПРЕТЫ: не повторяй слова клиента; не здоровайся, если уже здоровались; не обещай «сейчас проверю»; не пиши как робот.
ЯЗЫК: отвечай на языке клиента (узб. латиница/кириллица, русский, казахский).
СТИЛЬ: 1-3 предложения. Знаешь причину из данных — назови её и дай следующий шаг.
Если данных мало — задай ОДИН уточняющий вопрос (номер заказа, филиал, скрин).
Если вопрос адресован партнёру (доступы iiko, кабинет Wolt/Yandex) — так и скажи сотруднику в basis, а draft оставь пустым.
JSON: {"draft":"текст клиенту","basis":"на чём основан ответ, одной строкой для сотрудника"}`

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const channelId = url.searchParams.get('channelId')
  if (!channelId) return json({ error: 'channelId is required' }, 400)

  const [channel] = await sql`
    SELECT id, name FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId} LIMIT 1
  ` as any[]
  if (!channel) return json({ error: 'channel not found' }, 404)

  // Последние сообщения: свежая мысль клиента часто разбита на 3-5 реплик
  const msgs = await sql`
    SELECT is_from_client, sender_name, text_content FROM support_messages
    WHERE channel_id = ${channelId} AND text_content IS NOT NULL AND text_content <> ''
    ORDER BY created_at DESC LIMIT 12
  ` as any[]
  const dialog = (msgs as any[]).reverse()
    .map(m => `${m.is_from_client ? 'КЛИЕНТ' : 'СОТРУДНИК'}(${m.sender_name || ''}): ${String(m.text_content).slice(0, 200)}`)
    .join('\n')
  const lastClient = (msgs as any[]).find(m => m.is_from_client)?.text_content || ''

  await ensureErrorFeedSchema(sql)
  const [incidents, errors, examples] = await Promise.all([
    activeIncidents(sql).catch(() => []),
    recentErrorsForChannel(sql, channel.name, 12).catch(() => []),
    similarExamples(sql, lastClient, 3).catch(() => []),
  ])

  const kParts: string[] = []
  if ((incidents as any[]).length) {
    kParts.push('АВАРИИ СЕЙЧАС:\n' + (incidents as any[]).map((i: any) =>
      `• ${i.system}: ${String(i.title).slice(0, 70)} — с ${new Date(i.first_seen).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })}`).join('\n'))
  }
  if ((errors as any[]).length) {
    kParts.push('ОШИБКИ ЭТОГО РЕСТОРАНА ИЗ ФИДА (12ч):\n' + (errors as any[]).slice(0, 6).map((e: any) =>
      `• ${new Date(e.msg_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })} [${e.source}] ${String(e.error_text).slice(0, 110)}`).join('\n'))
  }
  if ((examples as any[]).length) {
    kParts.push('КАК КОМАНДА ОТВЕЧАЛА НА ПОХОЖЕЕ:\n' + (examples as any[]).map((x: any, i: number) =>
      `${i + 1}. «${String(x.client_text).slice(0, 70)}» → ${String(x.human_reply).slice(0, 110)}`).join('\n'))
  }

  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey) return json({ error: 'нет ключа модели' }, 200)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM + (kParts.length ? '\n\n' + kParts.join('\n\n') : '') },
        { role: 'user', content: `Канал: ${channel.name}\n\nПЕРЕПИСКА:\n${dialog}\n\nСоставь черновик ответа на последние сообщения клиента.` },
      ],
    }),
  })
  if (!res.ok) return json({ error: 'модель недоступна' }, 200)
  const data = await res.json()
  let out: any = {}
  try { out = JSON.parse(data.choices[0].message.content) } catch { out = {} }

  return json({
    draft: out.draft || '',
    basis: out.basis || '',
    knowledge: {
      incidents: (incidents as any[]).length,
      errors: (errors as any[]).length,
      examples: (examples as any[]).length,
    },
  })
}
