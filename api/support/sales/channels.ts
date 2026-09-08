import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders, ensureOnce } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Какие каналы есть у телефона: звонок, WhatsApp, Telegram, живая переписка.
 *
 * Три источника, от надёжного к менее надёжному:
 *  1. Своя база — если человек уже писал нам, канал известен точно, и туда
 *     можно ответить из системы (переписка останется в карточке);
 *  2. Мосты — WhatsApp умеет проверить регистрацию номера, Telegram-мост
 *     (когда подключён) ищет аккаунт по номеру;
 *  3. Ничего — тогда у номера остаются звонок и внешние ссылки.
 *
 * Результат кэшируется на сутки: дёргать мосты на каждое открытие карточки
 * незачем, а номер за день не «появляется» в мессенджере и обратно.
 */

const CACHE_HOURS = 24

async function ensureSchema(sql: any) {
  await ensureOnce('phone_channels', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_phone_channels (
        org_id VARCHAR(50) NOT NULL,
        phone_norm VARCHAR(20) NOT NULL,
        has_wa BOOLEAN,
        has_tg BOOLEAN,
        tg_username TEXT,
        tg_name TEXT,
        tg_last_seen TEXT,
        tg_premium BOOLEAN,
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (org_id, phone_norm)
      )
    `.catch(() => {})
    await sql`ALTER TABLE sales_phone_channels ADD COLUMN IF NOT EXISTS tg_name TEXT`.catch(() => {})
    await sql`ALTER TABLE sales_phone_channels ADD COLUMN IF NOT EXISTS tg_last_seen TEXT`.catch(() => {})
    await sql`ALTER TABLE sales_phone_channels ADD COLUMN IF NOT EXISTS tg_premium BOOLEAN`.catch(() => {})
    // Аватар клиента (у заведений — логотип) храним как data-URI: пара десятков
    // килобайт на номер, зато карточка узнаётся с одного взгляда
    await sql`ALTER TABLE sales_phone_channels ADD COLUMN IF NOT EXISTS tg_photo TEXT`.catch(() => {})
  })
}

/** Последние 9 цифр — так номера сходятся независимо от формата записи. */
const tail9 = (raw: string) => raw.replace(/\D/g, '').slice(-9)

/** Спросить мост. Любая ошибка — «не знаем», а не падение карточки. */
async function askBridge(url: string, secret: string, phone: string): Promise<any | null> {
  try {
    const res = await fetch(`${url}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const body = await res.json() as any
    return typeof body?.exists === 'boolean' ? body : null
  } catch {
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  await ensureSchema(sql)

  /**
   * Обогащение контакта данными из мессенджера.
   *
   * Заполняем ТОЛЬКО пустое: имя у безымянного контакта, ник Telegram,
   * логотип клиента. То, что человек занёс руками, не трогаем — иначе
   * однажды «Ибрагим, владелец» превратится в «ابراهيم» из чужого профиля.
   */
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    // Написать в WhatsApp с рабочего номера компании: диалог ляжет в CRM,
    // потому что входящие того же моста уже приходят в «Чаты»
    if (String(body.action || '') === 'wa_send') {
      const phone = String(body.phone || '')
      const text = String(body.text || '').trim()
      if (!phone || !text) return json({ error: 'нужны номер и текст' }, 400)
      const url = process.env.WA_SALES_URL
      const secret = process.env.WA_SALES_SECRET
      if (!url || !secret) return json({ error: 'WhatsApp для продаж не настроен' }, 400)
      const res = await fetch(`${url}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ agentId: ctx.agentId, phone, text }),
        signal: AbortSignal.timeout(25000),
      }).catch(() => null)
      const out = await res?.json().catch(() => null) as any
      if (!res?.ok || !out?.ok) {
        return json({ error: out?.error || 'WhatsApp сейчас недоступен' }, 502)
      }
      if (body.dealId) {
        await sql`
          INSERT INTO sales_activities (id, org_id, deal_id, type, direction, text, agent_id, happened_at)
          VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
                  ${orgId}, ${String(body.dealId)}, 'message', 'out',
                  ${'WhatsApp: ' + text}, ${ctx.agentId}, NOW())
        `.catch(() => {})
      }
      return json({ ok: true })
    }

    if (String(body.action || '') !== 'enrich') return json({ error: 'unknown action' }, 400)
    const contactId = String(body.contactId || '')
    if (!contactId) return json({ error: 'contactId required' }, 400)

    const [c] = await sql`
      SELECT id, account_id, name, telegram, phone FROM sales_contacts
      WHERE id = ${contactId} AND org_id = ${orgId}
    `
    if (!c) return json({ error: 'контакт не найден' }, 404)
    const key = String(c.phone || '').replace(/\D/g, '').slice(-9)
    const [known] = await sql`
      SELECT tg_name, tg_username, tg_photo FROM sales_phone_channels
      WHERE org_id = ${orgId} AND phone_norm = ${key}
    `
    if (!known) return json({ error: 'по номеру ещё нет данных — сначала проверьте каналы' }, 400)

    const filled: string[] = []

    // Пустым считаем только пустое и явную заглушку целиком: «Без имени,
    // звонил в мае» — это уже чья-то запись, и трогать её нельзя.
    // Условие продублировано в самом UPDATE: между чтением и записью
    // коллега может успеть вписать имя руками, и затирать его мы не вправе
    const PLACEHOLDER = '^\\s*(без имени|no name|-|—|н/д)\\s*$'

    if (known.tg_name) {
      const upd = await sql`
        UPDATE sales_contacts SET name = ${known.tg_name}
        WHERE id = ${contactId} AND org_id = ${orgId}
          AND (name IS NULL OR trim(name) = '' OR name ~* ${PLACEHOLDER})
        RETURNING id
      `
      if ((upd as any[]).length) filled.push('имя')
    }
    if (known.tg_username) {
      const upd = await sql`
        UPDATE sales_contacts SET telegram = ${'@' + known.tg_username}
        WHERE id = ${contactId} AND org_id = ${orgId}
          AND (telegram IS NULL OR trim(telegram) = '')
        RETURNING id
      `
      if ((upd as any[]).length) filled.push('Telegram')
    }
    // Логотип клиента: у заведений аватар в мессенджере — это их вывеска
    if (body.withPhoto && known.tg_photo && c.account_id) {
      await sql`ALTER TABLE sales_accounts ADD COLUMN IF NOT EXISTS photo TEXT`.catch(() => {})
      const upd = await sql`
        UPDATE sales_accounts SET photo = ${known.tg_photo}
        WHERE id = ${c.account_id} AND org_id = ${orgId}
          AND (photo IS NULL OR trim(photo) = '')
        RETURNING id
      `
      if ((upd as any[]).length) filled.push('логотип')
    }

    // След в ленте: видно, что данные пришли из мессенджера, а не набраны
    // человеком — и всегда понятно, откуда взялось имя в карточке
    if (filled.length && c.account_id) {
      const [deal] = await sql`
        SELECT id FROM sales_deals
        WHERE account_id = ${c.account_id} AND org_id = ${orgId} AND archived_at IS NULL
        ORDER BY (won_at IS NULL AND lost_at IS NULL) DESC, updated_at DESC LIMIT 1
      `
      if (deal) {
        await sql`
          INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction, text, agent_id, happened_at)
          VALUES (${'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
                  ${orgId}, ${deal.id}, ${c.account_id}, 'note', 'out',
                  ${'Контакт дополнен из Telegram: ' + filled.join(', ')}, ${ctx.agentId}, NOW())
        `.catch(() => {})
      }
    }

    return json({ ok: true, filled })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const url = new URL(req.url)
  const raw = url.searchParams.get('phone') || ''
  const digits = tail9(raw)
  if (digits.length < 9) return json({ error: 'phone required' }, 400)
  const refresh = url.searchParams.get('refresh') === '1'

  // 1. Известные диалоги: клиент уже писал — отвечаем из системы.
  // Канал висит на карточке клиента (sales_accounts.channel_id); у обращений
  // своей колонки канала нет, поэтому идём через их аккаунт.
  // Ошибку здесь НЕ глушим: молчаливый catch однажды уже спрятал сломанный
  // запрос, и каналы «не находились» без единого следа в логах
  const known = await sql`
    SELECT c.id, c.source, c.name, c.last_message_at,
           (SELECT COUNT(*)::int FROM support_messages m WHERE m.channel_id = c.id) AS messages
    FROM support_channels c
    WHERE c.org_id = ${orgId} AND c.is_active = true
      AND c.id IN (
        SELECT a.channel_id FROM sales_accounts a
        WHERE a.org_id = ${orgId} AND a.channel_id IS NOT NULL AND a.archived_at IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM sales_contacts sc
              WHERE sc.account_id = a.id AND sc.phone IS NOT NULL
                AND right(regexp_replace(sc.phone, '[^0-9]', '', 'g'), 9) = ${digits}
            )
            OR EXISTS (
              SELECT 1 FROM sales_leads l
              WHERE l.account_id = a.id AND l.phone_norm IS NOT NULL
                AND right(regexp_replace(l.phone_norm, '[^0-9]', '', 'g'), 9) = ${digits}
            )
          )
      )
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT 5
  `

  // 1b. История переписки по номеру: сообщения из Telegram и WhatsApp,
  // которые уже прошли через систему, лежат в ленте сделок этого клиента.
  // Раньше меню показывало «переписки нет», хотя разговор был — просто
  // канал к карточке не привязан, а переписка жила в ленте
  const history = await sql`
    SELECT a.type, a.direction, a.text, a.happened_at, a.deal_id,
           ag.name AS agent_name
    FROM sales_activities a
    LEFT JOIN support_agents ag ON ag.id = a.agent_id
    WHERE a.org_id = ${orgId} AND a.type = 'message'
      AND a.account_id IN (
        SELECT acc.id FROM sales_accounts acc
        WHERE acc.org_id = ${orgId} AND acc.archived_at IS NULL
          AND (
            EXISTS (SELECT 1 FROM sales_contacts sc WHERE sc.account_id = acc.id AND sc.phone IS NOT NULL
                      AND right(regexp_replace(sc.phone, '[^0-9]', '', 'g'), 9) = ${digits})
            OR EXISTS (SELECT 1 FROM sales_leads l WHERE l.account_id = acc.id AND l.phone_norm IS NOT NULL
                      AND right(regexp_replace(l.phone_norm, '[^0-9]', '', 'g'), 9) = ${digits})
          )
      )
    ORDER BY a.happened_at DESC
    LIMIT 6
  `

  // 2. Кэш проверок
  const [cached] = await sql`
    SELECT has_wa, has_tg, tg_username, tg_name, tg_last_seen, tg_premium, tg_photo, checked_at,
           (checked_at > NOW() - make_interval(hours => ${CACHE_HOURS})) AS fresh
    FROM sales_phone_channels WHERE org_id = ${orgId} AND phone_norm = ${digits}
  `
  let hasWa: boolean | null = cached?.has_wa ?? null
  let hasTg: boolean | null = cached?.has_tg ?? null
  let tgUsername: string | null = cached?.tg_username ?? null
  let tgName: string | null = cached?.tg_name ?? null
  let tgLastSeen: string | null = cached?.tg_last_seen ?? null
  let tgPremium: boolean | null = cached?.tg_premium ?? null
  let tgPhoto: string | null = cached?.tg_photo ?? null
  let checkedAt: string | null = cached?.checked_at ?? null

  // Проверяем через сервис продаж (личные номера сейлзов). Поддержка живёт
  // на GreenAPI и в проверке номеров не участвует — там другой контур
  const waUrl = process.env.WA_SALES_URL
  const waSecret = process.env.WA_SALES_SECRET
  const tgUrl = process.env.TELEGRAM_BRIDGE_URL
  const tgSecret = process.env.TELEGRAM_BRIDGE_SECRET
  // Кэш «не знаем» — не ответ: номер проверяли, когда WhatsApp ещё не был
  // подключён, и сутки после подключения он оставался «не проверено».
  // Пока для настроенного моста ответа нет — спрашиваем снова
  const unknownWa = Boolean(waUrl && waSecret) && hasWa === null
  const unknownTg = Boolean(tgUrl && tgSecret) && hasTg === null
  if (refresh || !cached?.fresh || unknownWa || unknownTg) {
    const e164 = '+' + raw.replace(/\D/g, '')

    const [wa, tg] = await Promise.all([
      waUrl && waSecret ? askBridge(waUrl, waSecret, e164) : Promise.resolve(null),
      tgUrl && tgSecret ? askBridge(tgUrl, tgSecret, e164) : Promise.resolve(null),
    ])
    // Не затираем прежний ответ, если мост сейчас молчит
    if (wa !== null) hasWa = wa.exists
    if (tg !== null) {
      hasTg = tg.exists
      tgUsername = tg.username ?? tgUsername
      tgName = tg.name ?? tgName
      tgLastSeen = tg.lastSeen ?? tgLastSeen
      tgPremium = typeof tg.premium === 'boolean' ? tg.premium : tgPremium
      if (tg.photo) tgPhoto = tg.photo
    }
    if (wa !== null || tg !== null) {
      checkedAt = new Date().toISOString()
      await sql`
        INSERT INTO sales_phone_channels (
          org_id, phone_norm, has_wa, has_tg, tg_username, tg_name, tg_last_seen, tg_premium, tg_photo, checked_at
        )
        VALUES (${orgId}, ${digits}, ${hasWa}, ${hasTg}, ${tgUsername}, ${tgName}, ${tgLastSeen}, ${tgPremium}, ${tgPhoto}, NOW())
        ON CONFLICT (org_id, phone_norm) DO UPDATE SET
          has_wa = ${hasWa}, has_tg = ${hasTg}, tg_username = ${tgUsername},
          tg_name = ${tgName}, tg_last_seen = ${tgLastSeen}, tg_premium = ${tgPremium},
          tg_photo = COALESCE(${tgPhoto}, sales_phone_channels.tg_photo), checked_at = NOW()
      `.catch(() => {})
    }
  }

  // Известный диалог — сам по себе доказательство канала
  const chans = known as any[]
  if (chans.some(c => c.source === 'whatsapp')) hasWa = true
  if (chans.some(c => String(c.source).startsWith('telegram'))) hasTg = true

  return json({
    phone: digits,
    hasWhatsapp: hasWa,
    hasTelegram: hasTg,
    tgUsername,
    tgName,
    tgLastSeen,
    tgPremium,
    tgPhoto,
    checkedAt,
    channels: chans.map(c => ({
      id: c.id, source: c.source, name: c.name,
      messages: Number(c.messages) || 0, lastAt: c.last_message_at,
    })),
    history: (history as any[]).map(h => ({
      text: String(h.text || '').replace(/^Telegram:\s*/, '').slice(0, 160),
      out: h.direction === 'out',
      at: h.happened_at,
      who: h.agent_name || null,
      dealId: h.deal_id,
    })),
  })
}
