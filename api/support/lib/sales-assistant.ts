import type { NeonQueryFunction } from '@neondatabase/serverless'
import { salesId } from './sales-schema.js'
import { getOpenAIKey } from './db.js'

type SQL = NeonQueryFunction<false, false>

/**
 * ИИ-ассистент прогрева.
 *
 * Работает там, где человек всё равно не работает: лид оставил заявку ночью,
 * не ответил на два звонка, попросил «напишите позже». Ассистент пишет сам,
 * держит короткий диалог и отдаёт менеджеру, как только человек ответил, —
 * дальше продаёт живой сейлз.
 *
 * Границы намеренные:
 *   • не обещает скидок и сроков — только вопросы и польза;
 *   • не пишет чаще, чем раз в N дней, и не больше четырёх раз всего;
 *   • ответ клиента останавливает цепочку немедленно и зовёт менеджера;
 *   • каждое действие пишется в журнал: молчаливая автоматика через неделю
 *     превращается в чёрный ящик, из которого не выбраться.
 */

/** Шаги цепочки: через сколько дней после предыдущего и с какой целью. */
export const NURTURE_STEPS = [
  { day: 0, goal: 'познакомиться и понять задачу: что сейчас с доставкой и заказами' },
  { day: 3, goal: 'дать конкретную пользу: как считается экономия на комиссии агрегаторов' },
  { day: 7, goal: 'предложить короткое демо на 15 минут в удобное время' },
  { day: 21, goal: 'последнее касание: спросить, актуально ли, и попрощаться, если нет' },
] as const

export const MAX_STEPS = NURTURE_STEPS.length

export interface AssistantMessage {
  text: string
  model: string
}

/**
 * Текст касания. Пишет модель, но рамка жёсткая: короткое сообщение на языке
 * клиента, один вопрос, без обещаний и без давления.
 */
export async function draftNurtureMessage(
  lead: any,
  step: number,
  orgName = 'Delever',
): Promise<AssistantMessage | null> {
  const key = await getOpenAIKey()
  if (!key) return null

  const goal = NURTURE_STEPS[Math.min(step, MAX_STEPS - 1)].goal
  const facts = [
    lead.name && `бренд: ${lead.name}`,
    lead.city && `город: ${lead.city}`,
    lead.raw?.pos && `касса: ${lead.raw.pos}`,
    lead.raw?.orders_per_day && `заказов в день: ${lead.raw.orders_per_day}`,
    lead.text && `что писал: ${String(lead.text).slice(0, 300)}`,
  ].filter(Boolean).join('\n')

  const system = [
    `Ты — ассистент отдела продаж ${orgName}, платформы доставки для ресторанов.`,
    'Пишешь первое короткое сообщение клиенту, который оставил заявку и не вышел на связь.',
    'Правила: не более 320 знаков; один вопрос в конце; без смайлов больше одного;',
    'без обещаний скидок, сроков и цен; без давления и без «спешите»;',
    'на языке клиента (русский или узбекский — по тексту заявки, по умолчанию русский);',
    'обращение на «вы»; не выдумывай фактов о клиенте, опирайся только на данные ниже.',
  ].join(' ')

  const user = `Цель этого касания: ${goal}\n\nЧто известно о клиенте:\n${facts || 'ничего, кроме контакта'}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content?.trim()
    if (!text) return null
    return { text, model: 'gpt-4o-mini' }
  } catch {
    return null
  }
}

/** Запись в журнал: без неё ассистента невозможно ни проверить, ни отключить осознанно. */
export async function logAssistant(
  sql: SQL,
  orgId: string,
  entry: {
    leadId?: string | null
    dealId?: string | null
    accountId?: string | null
    action: string
    channel?: string | null
    step?: number
    message?: string | null
    reply?: string | null
    status?: string
    error?: string | null
  },
): Promise<void> {
  await sql`
    INSERT INTO sales_assistant_log (id, org_id, lead_id, deal_id, account_id, action,
                                     channel, step, message, reply, status, error)
    VALUES (${salesId('sal')}, ${orgId}, ${entry.leadId || null}, ${entry.dealId || null},
            ${entry.accountId || null}, ${entry.action}, ${entry.channel || null},
            ${entry.step ?? 0}, ${entry.message || null}, ${entry.reply || null},
            ${entry.status || 'sent'}, ${entry.error || null})
  `
}

/**
 * Ответ клиента останавливает прогрев: дальше разговаривает человек.
 * Вызывается из приёмника сообщений — там, где мы вообще узнаём про ответ.
 */
export async function stopNurtureOnReply(
  sql: SQL,
  orgId: string,
  leadId: string,
  reply: string,
): Promise<void> {
  await sql`
    UPDATE sales_leads
    SET status = 'assigned', nurture_paused_at = NOW(), nurture_next_at = NULL,
        sla_due_at = NOW() + INTERVAL '15 minutes', updated_at = NOW()
    WHERE id = ${leadId} AND org_id = ${orgId}
  `
  await logAssistant(sql, orgId, {
    leadId, action: 'handover', reply: reply.slice(0, 500), status: 'handover',
    message: 'Клиент ответил — прогрев остановлен, лид возвращён сейлзу с нормативом 15 минут',
  })
}

/**
 * Ответ команды клиенту — это и есть первое касание.
 *
 * До сих пор время касания проставлялось только в очереди дня и при
 * конвертации в сделку, поэтому в базе оно стояло у двух обращений из 2741:
 * норматив «15 минут» был написан, но не измерялся ничем. Считать касанием
 * нажатие «беру в работу» нельзя — это взятие ответственности, а не разговор
 * с человеком. Настоящее касание видно там, где команда написала в канал.
 *
 * Вызывается из вебхуков на исходящем сообщении. Работает тихо: сбой здесь не
 * должен ломать приём сообщений.
 */
export async function markSalesTouch(
  sql: any,
  orgId: string,
  channelId: string,
  agentName?: string | null,
): Promise<void> {
  try {
    const leads = await sql`
      UPDATE sales_leads SET first_touch_at = NOW(), updated_at = NOW()
      WHERE org_id = ${orgId}
        AND first_touch_at IS NULL
        AND archived_at IS NULL
        AND status IN ('new', 'assigned', 'nurture')
        AND account_id IN (SELECT id FROM sales_accounts WHERE org_id = ${orgId} AND channel_id = ${channelId})
      RETURNING id, account_id
    ` as any[]
    if (!leads.length) return

    // Касание записываем событием: по нему считается, сколько внимания
    // потрачено на обращение до того, как оно стало сделкой
    for (const lead of leads) {
      await sql`
        INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel, title, identity)
        VALUES (${`stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`}, ${orgId},
                ${lead.account_id}, ${lead.id}, 'reply', 'chat',
                ${'Команда ответила клиенту'}, ${agentName || null})
      `
    }
  } catch {
    // Тишина намеренная: приём сообщений важнее статистики
  }
}
