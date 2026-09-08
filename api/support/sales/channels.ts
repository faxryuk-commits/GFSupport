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
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  await ensureSchema(sql)
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

  if (refresh || !cached?.fresh) {
    const waUrl = process.env.WHATSAPP_BRIDGE_URL
    const waSecret = process.env.WHATSAPP_BRIDGE_SECRET
    const tgUrl = process.env.TELEGRAM_BRIDGE_URL
    const tgSecret = process.env.TELEGRAM_BRIDGE_SECRET
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
  })
}
