import type { NeonQueryFunction } from '@neondatabase/serverless'
import { salesId } from './sales-schema.js'
import { pipelineForMarket } from './sales-amo.js'
import { getOpenAIKey } from './db.js'

/**
 * Операционка продаж в Telegram.
 *
 * Интерфейс сейлза — существующий платформенный бот (@gfsupport_robot): через
 * него сотрудники уже регистрируются, значит связь telegram_id ↔ support_agents
 * есть, и заводить третьего бота не нужно. Здесь только логика: карточка лида,
 * кнопки, очередь дня. Отправка идёт тем же токеном, что и регистрация.
 *
 * Формат callback_data: sl:<действие>:<id> — префикс sl отделяет продажи от
 * остальных возможных обработчиков платформенного бота.
 */

type SQL = NeonQueryFunction<false, false>

export async function getBotToken(sql: SQL): Promise<string | null> {
  try {
    const [row] = await sql`
      SELECT value FROM support_platform_settings WHERE key = 'platform_bot_token'
    `
    return row?.value || process.env.PLATFORM_BOT_TOKEN || null
  } catch {
    return process.env.PLATFORM_BOT_TOKEN || null
  }
}

type Keyboard = Array<Array<{ text: string; callback_data: string }>>

export async function tgSend(token: string, chatId: string | number, text: string, keyboard?: Keyboard) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  })
  return res.ok
}

async function tgAnswer(token: string, callbackId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  })
}

async function tgEdit(token: string, chatId: string | number, messageId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
  })
}

const BAND_ICON: Record<string, string> = { green: '🟢', yellow: '🟡', red: '🔴' }

/** Карточка лида: всё, что нужно решить «беру или нет», без открытия браузера. */
export function leadCard(lead: any, sourceLabel: string): string {
  const icp = lead.icp_score ?? 0
  const band = icp >= 60 ? 'green' : icp >= 30 ? 'yellow' : 'red'
  const reasons = Array.isArray(lead.icp_reasons)
    ? lead.icp_reasons.slice(0, 3).map((r: any) => `${r.label} ${r.points > 0 ? '+' : ''}${r.points}`).join(' · ')
    : ''
  const lines = [
    `${BAND_ICON[band]} <b>${lead.name || 'Лид без названия'}</b> · ICP ${icp}`,
    lead.city ? `📍 ${lead.city}` : '',
    lead.phone ? `📞 ${lead.phone}` : '',
    `📥 ${sourceLabel}${lead.campaign ? ` · ${lead.campaign}` : ''}`,
    reasons ? `\n<i>${reasons}</i>` : '',
    lead.text ? `\n«${String(lead.text).slice(0, 240)}»` : '',
    `\n⏱ Первое касание — <b>15 минут</b>. Не успеете — лид уйдёт свободному.`,
  ]
  return lines.filter(Boolean).join('\n')
}

export function leadKeyboard(leadId: string): Keyboard {
  return [[
    { text: '✅ Беру', callback_data: `sl:take:${leadId}` },
    { text: '⏳ +30 мин', callback_data: `sl:snooze:${leadId}` },
    { text: '↩️ Не мой', callback_data: `sl:skip:${leadId}` },
  ]]
}

/** Отправка карточки назначенному сейлзу. Вызывается из приёмника лидов. */
export async function notifyLeadAssigned(sql: SQL, lead: any, sourceLabel: string): Promise<void> {
  if (!lead.assigned_agent_id) return
  const [agent] = await sql`
    SELECT telegram_id FROM support_agents WHERE id = ${lead.assigned_agent_id} LIMIT 1
  `
  if (!agent?.telegram_id) return
  const token = await getBotToken(sql)
  if (!token) return
  await tgSend(token, agent.telegram_id, leadCard(lead, sourceLabel), leadKeyboard(lead.id))
}

/** Очередь дня: то же, что на экране «Очередь», только текстом. */
export async function queueText(sql: SQL, orgId: string, agentId: string): Promise<string> {
  const [leads, tasks, stalled] = await Promise.all([
    sql`
      SELECT id, name, icp_score, sla_due_at
      FROM sales_leads
      WHERE org_id = ${orgId} AND assigned_agent_id = ${agentId}
        AND first_touch_at IS NULL AND status = 'assigned'
      ORDER BY sla_due_at ASC LIMIT 10
    `,
    sql`
      SELECT t.id, t.title, t.due_at, d.title AS deal_title
      FROM sales_tasks t
      LEFT JOIN sales_deals d ON d.id = t.deal_id
      WHERE t.org_id = ${orgId} AND t.assignee_agent_id = ${agentId}
        AND t.done_at IS NULL AND t.due_at <= NOW() + INTERVAL '1 day'
      ORDER BY t.due_at ASC LIMIT 10
    `,
    sql`
      SELECT d.id, d.title, s.label AS stage, d.stage_since
      FROM sales_deals d
      JOIN sales_stages s ON s.id = d.stage_id
      WHERE d.org_id = ${orgId} AND d.owner_agent_id = ${agentId}
        AND d.won_at IS NULL AND d.lost_at IS NULL
        AND s.sla_hours IS NOT NULL
        AND d.stage_since < NOW() - (s.sla_hours * INTERVAL '1 hour')
      ORDER BY d.stage_since ASC LIMIT 10
    `,
  ])

  const parts: string[] = ['<b>Очередь на сегодня</b>']

  if (leads.length) {
    parts.push('\n🔴 <b>Горит SLA</b>')
    for (const l of leads) {
      const mins = Math.round((new Date(l.sla_due_at).getTime() - Date.now()) / 60000)
      parts.push(`• ${l.name} · ICP ${l.icp_score ?? 0} · ${mins > 0 ? `${mins} мин осталось` : 'просрочено'}`)
    }
  }
  if (tasks.length) {
    parts.push('\n📌 <b>Задачи</b>')
    for (const t of tasks) {
      const overdue = new Date(t.due_at).getTime() < Date.now()
      parts.push(`• ${t.deal_title ? `${t.deal_title}: ` : ''}${t.title}${overdue ? ' — просрочена' : ''}`)
    }
  }
  if (stalled.length) {
    parts.push('\n⚡ <b>Застряли</b>')
    for (const d of stalled) {
      const days = Math.floor((Date.now() - new Date(d.stage_since).getTime()) / 86400000)
      parts.push(`• ${d.title} · ${d.stage} · ${days} дн без движения`)
    }
  }
  if (parts.length === 1) parts.push('\nПусто. Все касания сделаны, лидов в работе нет.')
  return parts.join('\n')
}

/**
 * Обработка нажатий. Возвращает true, если апдейт относился к продажам —
 * платформенный бот в этом случае не делает ничего своего.
 */
export async function handleSalesCallback(sql: SQL, update: any): Promise<boolean> {
  const cb = update.callback_query
  if (!cb?.data || !String(cb.data).startsWith('sl:')) return false

  const [, action, entityId] = String(cb.data).split(':')
  const token = await getBotToken(sql)
  const telegramId = String(cb.from?.id || '')

  const [agent] = await sql`
    SELECT id, name, org_id FROM support_agents WHERE telegram_id = ${telegramId} LIMIT 1
  `
  if (!agent) {
    if (token) await tgAnswer(token, cb.id, 'Вы не привязаны к сотруднику — напишите /start')
    return true
  }

  if (action === 'take') {
    const [lead] = await sql`
      SELECT id, name, account_id, market_id, status, assigned_agent_id
      FROM sales_leads WHERE id = ${entityId} AND org_id = ${agent.org_id} LIMIT 1
    `
    if (!lead) {
      if (token) await tgAnswer(token, cb.id, 'Лид не найден')
      return true
    }
    if (lead.status === 'converted' && lead.assigned_agent_id !== agent.id) {
      if (token) await tgAnswer(token, cb.id, 'Лид уже взят другим сотрудником')
      return true
    }

    // Первый этап воронки для новой сделки
    const [stage] = await sql`
      SELECT id FROM sales_stages
      WHERE org_id = ${agent.org_id} AND pipeline = ${pipelineForMarket(lead.market_id)}
        AND kind = 'open' AND is_active = true
      ORDER BY sort_order OFFSET 1 LIMIT 1
    `
    const dealId = salesId('sd')
    await sql`
      INSERT INTO sales_deals (id, org_id, account_id, stage_id, owner_agent_id, market_id,
                               title, deal_type, source_lead_id, pipeline)
      VALUES (${dealId}, ${agent.org_id}, ${lead.account_id}, ${stage?.id || ''}, ${agent.id},
              ${lead.market_id}, ${lead.name}, 'new', ${lead.id}, ${pipelineForMarket(lead.market_id)})
    `
    await sql`
      INSERT INTO sales_deal_events (org_id, deal_id, old_stage_id, new_stage_id, changed_by)
      VALUES (${agent.org_id}, ${dealId}, NULL, ${stage?.id || ''}, ${agent.name})
    `
    // Взял в работу = первое касание: таймер SLA останавливается здесь
    await sql`
      UPDATE sales_leads
      SET status = 'converted', assigned_agent_id = ${agent.id},
          assigned_at = COALESCE(assigned_at, NOW()), first_touch_at = NOW()
      WHERE id = ${lead.id}
    `
    if (token) {
      await tgAnswer(token, cb.id, 'Взяли в работу')
      await tgEdit(token, cb.message.chat.id, cb.message.message_id,
        `✅ <b>${lead.name}</b> — в работе у вас.\n\nСоздана сделка на этапе «Дозвон». ` +
        `Дальше: дозвон, 7 полей квалификации. Заполнить можно голосовым сообщением сюда.`)
    }
    return true
  }

  if (action === 'snooze') {
    await sql`
      UPDATE sales_leads SET sla_due_at = NOW() + INTERVAL '30 minutes'
      WHERE id = ${entityId} AND org_id = ${agent.org_id}
    `
    if (token) await tgAnswer(token, cb.id, 'Отложено на 30 минут')
    return true
  }

  if (action === 'skip') {
    // Возврат в общую очередь: лид не пропадает, его увидят остальные
    await sql`
      UPDATE sales_leads SET status = 'new', assigned_agent_id = NULL, assigned_at = NULL
      WHERE id = ${entityId} AND org_id = ${agent.org_id}
    `
    if (token) {
      await tgAnswer(token, cb.id, 'Вернули в общую очередь')
      await tgEdit(token, cb.message.chat.id, cb.message.message_id, '↩️ Лид возвращён в общую очередь.')
    }
    return true
  }

  if (action === 'done') {
    await sql`
      UPDATE sales_tasks SET done_at = NOW(), done_result = 'done'
      WHERE id = ${entityId} AND org_id = ${agent.org_id} AND done_at IS NULL
    `
    if (token) await tgAnswer(token, cb.id, 'Задача закрыта')
    return true
  }

  if (token) await tgAnswer(token, cb.id, 'Неизвестное действие')
  return true
}

/** Текстовые команды сейлза. true — команда обработана здесь. */
export async function handleSalesCommand(sql: SQL, message: any): Promise<boolean> {
  const text = (message.text || '').trim().toLowerCase()
  if (!['/queue', '/очередь', '/my', '/мои'].includes(text)) return false

  const telegramId = String(message.from?.id || '')
  const [agent] = await sql`
    SELECT id, name, org_id FROM support_agents WHERE telegram_id = ${telegramId} LIMIT 1
  `
  const token = await getBotToken(sql)
  if (!token) return true
  if (!agent) {
    await tgSend(token, message.chat.id, 'Вы ещё не привязаны к сотруднику. Напишите /start и завершите регистрацию.')
    return true
  }
  await tgSend(token, message.chat.id, await queueText(sql, agent.org_id, agent.id))
  return true
}


/**
 * Голосовая заметка после звонка → поля сделки.
 *
 * Это замена телефонии: записи звонков у вас нет, а семь полей квалификации
 * руками не заполнит никто. Сейлз наговаривает 20 секунд, система расшифровывает
 * и раскладывает в поля.
 *
 * Осторожность намеренная: заполняются ТОЛЬКО пустые поля. Перезаписывать то,
 * что человек ввёл руками, по расшифровке нельзя — ошибка распознавания тогда
 * тихо испортит данные, на которых стоят отчёты.
 */
const VOICE_FIELDS = ['city', 'points', 'orders_per_day', 'pos', 'aggregators',
  'delivery_type', 'pain', 'dm_name', 'budget_stated', 'next_step'] as const

export async function handleVoiceNote(sql: SQL, message: any): Promise<boolean> {
  const voice = message.voice || message.audio
  if (!voice?.file_id) return false

  const telegramId = String(message.from?.id || '')
  const [agent] = await sql`
    SELECT id, name, org_id FROM support_agents WHERE telegram_id = ${telegramId} LIMIT 1
  `
  const token = await getBotToken(sql)
  if (!agent || !token) return false

  // Сделка берётся последняя тронутая этим сейлзом: в 95% случаев голосовое
  // приходит сразу после разговора по ней
  const [deal] = await sql`
    SELECT * FROM sales_deals
    WHERE org_id = ${agent.org_id} AND owner_agent_id = ${agent.id}
      AND won_at IS NULL AND lost_at IS NULL
    ORDER BY updated_at DESC LIMIT 1
  `
  if (!deal) {
    await tgSend(token, message.chat.id, 'Нет активной сделки, к которой отнести заметку.')
    return true
  }

  const apiKey = await getOpenAIKey(agent.org_id)
  if (!apiKey) {
    await tgSend(token, message.chat.id, 'Распознавание не настроено: нет ключа OpenAI.')
    return true
  }

  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${voice.file_id}`)
    const fileData: any = await fileRes.json()
    const path = fileData?.result?.file_path
    if (!path) throw new Error('файл не получен')
    const audio = await (await fetch(`https://api.telegram.org/file/bot${token}/${path}`)).blob()

    const form = new FormData()
    form.append('file', audio, 'voice.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'ru')
    const trRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    })
    const tr: any = await trRes.json()
    const text = String(tr?.text || '').trim()
    if (!text) throw new Error('пустая расшифровка')

    const empty = VOICE_FIELDS.filter(f => deal[f] === null || deal[f] === undefined || deal[f] === '')
    const extract = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content:
            'Ты разбираешь заметку менеджера по продажам после звонка в ресторан. ' +
            'Верни JSON только с теми полями из списка, которые ЯВНО прозвучали: ' +
            empty.join(', ') + '. Не додумывай. Значения — короткие строки на русском. ' +
            'orders_per_day — число или диапазон, points — число точек, ' +
            'budget_stated — сумма, next_step — что и когда делаем дальше.' },
          { role: 'user', content: text },
        ],
      }),
    })
    const ex: any = await extract.json()
    let fields: Record<string, any> = {}
    try { fields = JSON.parse(ex?.choices?.[0]?.message?.content || '{}') } catch {}

    await sql`
      INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction, result, text, agent_id)
      VALUES (${salesId('sac')}, ${agent.org_id}, ${deal.id}, ${deal.account_id},
              'note', 'out', 'voice', ${text}, ${agent.id})
    `

    const applied: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      if (!(VOICE_FIELDS as readonly string[]).includes(k)) continue
      if (!empty.includes(k as any)) continue          // занятое поле не трогаем
      if (v === null || v === undefined || String(v).trim() === '') continue
      const val = String(v).slice(0, 500)
      switch (k) {
        case 'city': await sql`UPDATE sales_deals SET city = ${val} WHERE id = ${deal.id}`; break
        case 'points': await sql`UPDATE sales_deals SET points = ${parseInt(val, 10) || null} WHERE id = ${deal.id}`; break
        case 'orders_per_day': await sql`UPDATE sales_deals SET orders_per_day = ${val} WHERE id = ${deal.id}`; break
        case 'pos': await sql`UPDATE sales_deals SET pos = ${val} WHERE id = ${deal.id}`; break
        case 'aggregators': await sql`UPDATE sales_deals SET aggregators = ${val} WHERE id = ${deal.id}`; break
        case 'delivery_type': await sql`UPDATE sales_deals SET delivery_type = ${val} WHERE id = ${deal.id}`; break
        case 'pain': await sql`UPDATE sales_deals SET pain = ${val} WHERE id = ${deal.id}`; break
        case 'dm_name': await sql`UPDATE sales_deals SET dm_name = ${val} WHERE id = ${deal.id}`; break
        case 'budget_stated': await sql`UPDATE sales_deals SET budget_stated = ${parseFloat(val.replace(/[^\d.]/g, '')) || null} WHERE id = ${deal.id}`; break
        case 'next_step': await sql`UPDATE sales_deals SET next_step = ${val} WHERE id = ${deal.id}`; break
      }
      applied.push(`${k}: ${val}`)
    }

    await tgSend(token, message.chat.id,
      `🎤 <b>${deal.title || 'Сделка'}</b>\n\n<i>${text.slice(0, 400)}</i>\n\n` +
      (applied.length
        ? `Заполнено:\n${applied.map(a => `• ${a}`).join('\n')}\n\nЗанятые поля не трогал — проверьте карточку.`
        : 'Новых полей не нашёл — заметка сохранена в истории сделки.'))
  } catch (e: any) {
    console.error('[sales-bot] voice failed:', e)
    await tgSend(token, message.chat.id, 'Не смог разобрать голосовое. Напишите коротко текстом.')
  }
  return true
}
