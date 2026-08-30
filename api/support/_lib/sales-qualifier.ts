import type { NeonQueryFunction } from '@neondatabase/serverless'
import { getOpenAIKey, getSalesBotToken } from './db.js'
import { salesId } from './sales-schema.js'
import { scoreIcp } from './sales-icp.js'
import { logAssistant } from './sales-assistant.js'
import { logChatMessage } from './sales-intake.js'
import { tokenForPage } from './meta-config.js'
import { tgSend } from './sales-bot.js'

type SQL = NeonQueryFunction<false, false>

/**
 * Агент-квалификатор: разговаривает с лидом и заполняет квалификацию.
 *
 * Прогреватель пишет тем, кто молчит. Квалификатор — его зеркало: работает
 * с теми, кто ответил. Пока сейлз доедет до диалога, агент успевает выяснить
 * кассу, филиалы и поток заказов — и каждый выясненный факт тут же
 * пересчитывает балл ICP, так что зелёный лид уходит человеку уже тёплым.
 *
 * Границы намеренные:
 *   • молчит, если в диалоге за последние два часа писал живой сотрудник —
 *     перебивать человека автоматикой нельзя;
 *   • не больше шести своих сообщений на лида — дальше очевидно, что нужен
 *     человек, а не седьмой вопрос;
 *   • цен, скидок и сроков не называет; просьба о звонке, разговор о цене
 *     или отказ — немедленная передача менеджеру с уведомлением;
 *   • извлечение фактов происходит всегда, отправка — по режиму:
 *     auto (пишет сам), draft (готовит черновик в журнал), off (молчит);
 *   • каждое действие — в журнал ассистента, тот же, что у прогрева.
 */

const MODE_KEY = 'sales_qualifier_mode'
const MAX_MESSAGES = 6
const HUMAN_QUIET_HOURS = 2
/** Имя, под которым агент пишет в ленту: то же, что у комментариев. */
const AGENT_NAME = 'Агент'

/**
 * Что агент выясняет — в порядке живого разговора, а не анкеты. Порядок
 * важен: список уходит модели как приоритет вопросов. Сначала лёгкое,
 * о чём человек сам охотно рассказывает, техника — в конце и с объяснением,
 * зачем спрашиваем. Касса — сильнейший сигнал скоринга, но спросить её
 * первой значит превратить знакомство в допрос.
 */
const ASK_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'city', label: 'в каком городе заведение' },
  { key: 'points', label: 'сколько точек или филиалов' },
  { key: 'orders_per_day', label: 'сколько примерно заказов в день' },
  { key: 'aggregators', label: 'работают ли с агрегаторами (Yandex, Wolt, Uzum...)' },
  { key: 'delivery_type', label: 'есть ли своя доставка или курьеры' },
  { key: 'pos', label: 'какая касса (POS-система) — спрашивать с объяснением, что это нужно для подключения' },
]

export type QualifierMode = 'auto' | 'draft' | 'off'

export async function readQualifierMode(sql: SQL, orgId: string): Promise<QualifierMode> {
  try {
    const rows = await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = ${MODE_KEY} LIMIT 1
    ` as any[]
    const v = String(rows[0]?.value || 'auto')
    return v === 'draft' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

interface QualifierInput {
  leadId: string
  /** Канал переписки — из него берётся история и адрес для ответа. */
  channelId?: string | null
  inboundText: string
}

interface LlmVerdict {
  intent: 'answering' | 'question' | 'wants_call' | 'price' | 'not_interested' | 'other'
  extracted: Record<string, string>
  reply: string | null
  done: boolean
}

/**
 * Главный вход. Зовётся из приёмников на входящем сообщении клиента.
 * Никогда не бросает: сбой квалификатора не должен ломать приём сообщений.
 */
export async function runQualifier(sql: SQL, orgId: string, input: QualifierInput): Promise<void> {
  try {
    await qualify(sql, orgId, input)
  } catch (e: any) {
    await logAssistant(sql, orgId, {
      leadId: input.leadId, action: 'qualify_failed', status: 'error',
      error: String(e?.message || e).slice(0, 300),
    }).catch(() => {})
  }
}

/**
 * Похоже ли значение на своё поле. Ловит типовую путаницу модели:
 * число в кассе, название кассы в филиалах. Не строгая схема, а сито.
 */
function plausible(key: string, v: string): boolean {
  const hasDigit = /\d/.test(v)
  const onlyDigits = /^[\d\s\-–—+.]+$/.test(v)
  switch (key) {
    case 'pos': return !onlyDigits            // касса — название, не число
    case 'points': return hasDigit && v.length <= 30
    case 'orders_per_day': return hasDigit && v.length <= 40
    case 'city': return !hasDigit && v.length >= 2
    default: return true
  }
}

async function qualify(sql: SQL, orgId: string, input: QualifierInput): Promise<void> {
  const mode = await readQualifierMode(sql, orgId)
  if (mode === 'off') return

  const [lead] = await sql`
    SELECT l.id, l.name, l.contact_name, l.city, l.status, l.qual, l.raw, l.text,
           l.assigned_agent_id, l.account_id, l.market_id
    FROM sales_leads l
    WHERE l.id = ${input.leadId} AND l.org_id = ${orgId}
      AND l.archived_at IS NULL AND l.status IN ('new', 'assigned', 'nurture')
    LIMIT 1
  ` as any[]
  if (!lead) return

  // Сколько агент уже написал этому лиду — и не писал ли только что:
  // на очередь быстрых сообщений клиента отвечаем один раз, а не залпом
  const [sent] = await sql`
    SELECT COUNT(*)::int AS n,
           MAX(created_at) FILTER (WHERE created_at > NOW() - INTERVAL '90 seconds') AS just_now
    FROM sales_assistant_log
    WHERE org_id = ${orgId} AND lead_id = ${lead.id} AND action = 'qualify_sent'
  ` as any[]
  const exhausted = Number(sent?.n || 0) >= MAX_MESSAGES
  const justReplied = Boolean(sent?.just_now)

  // История диалога и живой ли в нём человек
  let history: Array<{ from: string; text: string }> = []
  let humanActive = false
  let channel: any = null
  if (input.channelId) {
    const [ch] = await sql`
      SELECT id, source, external_chat_id, telegram_chat_id, meta_page_id
      FROM support_channels WHERE id = ${input.channelId} AND org_id = ${orgId} LIMIT 1
    ` as any[]
    channel = ch || null
    const msgs = await sql`
      SELECT sender_name, is_from_client, text_content, created_at
      FROM support_messages
      WHERE channel_id = ${input.channelId} AND org_id = ${orgId}
        AND text_content IS NOT NULL
      ORDER BY created_at DESC LIMIT 12
    ` as any[]
    history = msgs.reverse().map((m: any) => ({
      from: m.is_from_client ? 'клиент' : (m.sender_name || 'команда'),
      text: String(m.text_content).slice(0, 400),
    }))
    humanActive = msgs.some((m: any) =>
      !m.is_from_client && m.sender_name !== AGENT_NAME
      && Date.now() - new Date(m.created_at).getTime() < HUMAN_QUIET_HOURS * 3600 * 1000)
  }

  const qual = { ...(lead.raw && typeof lead.raw === 'object' ? {} : {}), ...(lead.qual || {}) }
  const knownOf = (k: string) => String(qual[k] ?? lead.raw?.[k] ?? (k === 'city' ? lead.city : '') ?? '').trim()
  const known = ASK_FIELDS.filter(f => knownOf(f.key))
  const missing = ASK_FIELDS.filter(f => !knownOf(f.key))

  const key = await getOpenAIKey(orgId)
  if (!key) return

  const verdict = await askModel(key, lead, history, input.inboundText, known.map(f => `${f.label}: ${knownOf(f.key)}`), missing.map(f => f.label))
  if (!verdict) return

  // 1. Факты сохраняем всегда — даже когда отвечать нельзя. Заполненное не
  //    перетираем, с одним исключением: если старое значение не проходит
  //    проверку формы (модель однажды записала «3» в кассу), новое валидное
  //    его лечит — иначе ошибка добычи застревала бы навсегда
  const patch: Record<string, string> = {}
  for (const f of ASK_FIELDS) {
    const v = String(verdict.extracted?.[f.key] || '').trim().slice(0, 200)
    if (!v || !plausible(f.key, v)) continue
    const cur = knownOf(f.key)
    if (!cur || !plausible(f.key, cur)) patch[f.key] = v
  }
  if (Object.keys(patch).length) {
    const { city, ...qualPatch } = patch
    if (Object.keys(qualPatch).length) {
      await sql`
        UPDATE sales_leads
        SET qual = COALESCE(qual, '{}'::jsonb) || ${JSON.stringify(qualPatch)}::jsonb, updated_at = NOW()
        WHERE id = ${lead.id} AND org_id = ${orgId}
      `
    }
    if (city) {
      await sql`
        UPDATE sales_leads SET city = COALESCE(city, ${city}), updated_at = NOW()
        WHERE id = ${lead.id} AND org_id = ${orgId}
      `
    }
    // Каждый выясненный факт пересчитывает балл — ровно как при квалификации
    // сделки руками
    const merged = (k: string) => patch[k] || knownOf(k) || null
    const icp = scoreIcp({
      pos: merged('pos'), points: merged('points'), ordersPerDay: merged('orders_per_day'),
      aggregators: merged('aggregators'), deliveryType: merged('delivery_type'),
      city: merged('city'), text: lead.text,
    })
    await sql`
      UPDATE sales_leads SET icp_score = ${icp.score},
        icp_reasons = ${JSON.stringify(icp.reasons)}::jsonb
      WHERE id = ${lead.id} AND org_id = ${orgId}
    `
    await logAssistant(sql, orgId, {
      leadId: lead.id, accountId: lead.account_id, action: 'qualify_extracted',
      status: 'ok',
      message: `Выяснено: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')} → балл ${icp.score}`,
    })
  }

  // 2. Передача человеку: цена, звонок, отказ — или всё выяснено
  const handover = ['wants_call', 'price', 'not_interested'].includes(verdict.intent)
    || verdict.done || missing.length === 0
  if (handover) {
    await notifyHandover(sql, orgId, lead, verdict.intent, input.inboundText)
  }

  // 3. Ответ клиенту. Молчим, когда: живой сотрудник в диалоге, лимит
  //    сообщений исчерпан, только что отвечали, отвечать нечего или клиент
  //    отказался — уговаривать после «нет» будет человек, если сочтёт нужным
  const reply = String(verdict.reply || '').trim()
  if (!reply || humanActive || exhausted || justReplied || verdict.intent === 'not_interested') return

  if (mode === 'draft') {
    await logAssistant(sql, orgId, {
      leadId: lead.id, accountId: lead.account_id, action: 'qualify_draft',
      channel: channel?.source || null, message: reply, status: 'draft',
    })
    return
  }

  const delivered = await deliver(sql, orgId, channel, reply)
  await logAssistant(sql, orgId, {
    leadId: lead.id, accountId: lead.account_id,
    action: delivered ? 'qualify_sent' : 'qualify_failed',
    channel: channel?.source || null, message: reply,
    status: delivered ? 'sent' : 'error',
    error: delivered ? undefined : 'не нашлось пути доставки',
  })
  if (delivered && lead.account_id) {
    await logChatMessage(sql, orgId, lead.account_id, 'out', reply, AGENT_NAME).catch(() => {})
  }
}

/** Ответ уходит тем же путём, каким пришло входящее. */
async function deliver(sql: SQL, orgId: string, channel: any, text: string): Promise<boolean> {
  if (!channel) return false
  const source = String(channel.source || '')

  if (source === 'instagram' || source === 'messenger') {
    const token = await tokenForPage(orgId, channel.meta_page_id || null)
    if (!token || !channel.external_chat_id) return false
    // Входящее пришло только что — окно суток заведомо открыто
    const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: channel.external_chat_id },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    })
    if (!r.ok) return false
  } else if (source === 'telegram_bot') {
    const token = await getSalesBotToken(orgId)
    if (!token || !channel.telegram_chat_id) return false
    await tgSend(token, channel.telegram_chat_id, text)
  } else {
    return false
  }

  // Ответ агента — часть переписки: без этой записи в «Диалогах» видна только
  // половина разговора, и сейлз не понимает, откуда клиент знает вопросы
  await sql`
    INSERT INTO support_messages (id, channel_id, org_id, sender_name, sender_role,
                                  is_from_client, content_type, text_content, is_read, created_at)
    VALUES (${salesId('msg')}, ${channel.id}, ${orgId}, ${AGENT_NAME}, 'support',
            false, 'text', ${text}, true, NOW())
  `
  await sql`
    UPDATE support_channels
    SET last_message_at = NOW(), last_message_preview = ${text.slice(0, 100)},
        last_sender_name = ${AGENT_NAME}, awaiting_reply = false
    WHERE id = ${channel.id}
  `
  return true
}

/** Менеджеру — уведомление с причиной; лиду в норматив — 15 минут. */
async function notifyHandover(
  sql: SQL, orgId: string, lead: any, intent: string, lastText: string,
): Promise<void> {
  const reason = intent === 'wants_call' ? 'клиент просит звонок'
    : intent === 'price' ? 'клиент спрашивает про цену'
    : intent === 'not_interested' ? 'клиент отказался'
    : 'квалификация собрана'
  await logAssistant(sql, orgId, {
    leadId: lead.id, accountId: lead.account_id, action: 'qualify_handover',
    status: 'handover', message: reason, reply: lastText.slice(0, 300),
  })
  try {
    const { sendNotification } = await import('./notifications.js')
    await sendNotification({
      orgId, type: 'assignment',
      priority: intent === 'wants_call' ? 'high' : 'medium',
      title: `Лид готов: ${lead.contact_name || lead.name}`,
      body: `${reason}. Последнее сообщение: «${lastText.slice(0, 120)}»`,
      link: `/sales/leads/${lead.id}`,
      ...(lead.assigned_agent_id ? { targetAgentIds: [lead.assigned_agent_id] } : {}),
    })
  } catch { /* уведомление — не повод уронить квалификацию */ }
}

export async function askModel(
  key: string, lead: any,
  history: Array<{ from: string; text: string }>,
  inbound: string, known: string[], missing: string[],
): Promise<LlmVerdict | null> {
  const system = [
    'Ты — ассистент отдела продаж Delever, платформы автоматизации доставки для ресторанов',
    '(приём заказов через сайт/бот/приложение, интеграции с кассами iiko, RKeeper, Jowi, Poster,',
    'с агрегаторами Yandex, Wolt, Uzum, свои курьеры, аналитика).',
    'Твоя работа: вести живой разговор, как хороший менеджер, и по ходу выяснять факты о заведении.',
    'Лестница разговора: на приветствие или первое сообщение — коротко поздоровайся и задай один',
    'открытый вопрос о заведении и задаче (например: «Расскажите, что у вас за заведение и что',
    'хотели бы наладить с доставкой?») — анкетных вопросов в первом ответе не задавай.',
    'Дальше вопросы вплетай в разговор по одному, в порядке списка невыясненного, реагируя на то,',
    'что человек сказал: сначала отклик на его слова, потом вопрос. Если клиент сам спросил —',
    'сначала ответь ему. Технические вопросы (касса) объясняй пользой: «чтобы понять, как подключимся».',
    'Не переспрашивай то, что уже известно, и не здоровайся повторно.',
    'Правила ответа: не более 300 знаков. СТРОГО один вопрос за сообщение — два вопроса подряд',
    'превращают разговор в допрос; выбери один, остальные задашь в следующих сообщениях;',
    'на языке клиента (русский, узбекский или азербайджанский — по его сообщениям);',
    'обращение на «вы»; никаких цен, скидок, сроков и обещаний — про цену отвечай, что менеджер',
    'подберёт тариф и свяжется; не выдумывай возможностей продукта; не представляйся человеком, если спросят.',
    'Верни строго JSON: {"intent": "answering|question|wants_call|price|not_interested|other",',
    '"extracted": {"pos": "...", "points": "...", "orders_per_day": "...", "aggregators": "...",',
    '"delivery_type": "...", "city": "..."} — только то, что клиент реально сообщил, иначе пропусти ключ.',
    'Семантика полей: pos — НАЗВАНИЕ кассовой системы (iiko, RKeeper, Jowi, Poster...), никогда не число;',
    'points — число точек/филиалов; orders_per_day — заказы в день; city — город.',
    'Сомневаешься, к какому полю относится сказанное, — пропусти ключ, не угадывай.',
    '"reply": "текст ответа клиенту или null, если отвечать не нужно",',
    '"done": true, если все факты собраны или разговор пора отдать человеку}',
  ].join(' ')

  const dialog = history.map(h => `${h.from}: ${h.text}`).join('\n') || '(истории нет)'
  const user = [
    `Клиент: ${lead.contact_name || lead.name}`,
    `Уже известно:\n${known.length ? known.join('\n') : 'ничего'}`,
    `Ещё не выяснено:\n${missing.length ? missing.join('\n') : 'всё собрано'}`,
    `Диалог:\n${dialog}`,
    `Новое сообщение клиента: ${inbound.slice(0, 500)}`,
  ].join('\n\n')

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    const data = await res.json()
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      intent: ['answering', 'question', 'wants_call', 'price', 'not_interested', 'other']
        .includes(parsed.intent) ? parsed.intent : 'other',
      extracted: parsed.extracted && typeof parsed.extracted === 'object' ? parsed.extracted : {},
      reply: typeof parsed.reply === 'string' ? parsed.reply : null,
      done: Boolean(parsed.done),
    }
  } catch {
    return null
  }
}
