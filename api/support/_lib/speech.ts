import { getSQL, getOpenAIKey } from './db.js'
import { scoreIcp } from './sales-icp.js'

/**
 * Расшифровка звонков и разбор разговора.
 *
 * Узбекскую речь из телефонии (8 кГц, сильное сжатие) разбирает только Chirp
 * от Google — проверено на боевых записях: Whisper принимает узбекский за
 * азербайджанский и выдаёт бессмыслицу, стандартная модель Google — набор
 * несвязанных слов. Chirp даёт читаемый текст, из которого ИИ вытаскивает
 * итог разговора и следующий шаг.
 *
 * Ключ сервисного аккаунта Google живёт в переменной GOOGLE_SPEECH_KEY
 * (JSON целиком) — у аккаунта должна быть роль Cloud Speech Client.
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHIRP_REGION = 'us-central1'

interface SpeechKey {
  client_email: string
  private_key: string
  project_id: string
}

function getKey(): SpeechKey | null {
  const raw = process.env.GOOGLE_SPEECH_KEY || ''
  if (!raw) return null
  try {
    const k = JSON.parse(raw)
    return k?.private_key && k?.client_email ? k : null
  } catch { return null }
}

const b64url = (buf: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PEM → CryptoKey: в edge-рантайме нет node:crypto, подписываем WebCrypto. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

let cachedToken: { token: string; exp: number } | null = null

async function accessToken(): Promise<string | null> {
  const key = getKey()
  if (!key) return null
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: GOOGLE_TOKEN_URL, exp: now + 3600, iat: now,
  }))
  const ck = await importPrivateKey(key.private_key)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ck,
    new TextEncoder().encode(`${header}.${claim}`))
  const jwt = `${header}.${claim}.${b64url(sig)}`

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }),
  })
  const j = await res.json()
  if (!j.access_token) return null
  cachedToken = { token: j.access_token, exp: Date.now() + 3500_000 }
  return j.access_token
}

/** Один заход в синхронный :recognize (лимит — минута аудио). */
async function recognizeChunk(
  key: SpeechKey, token: string, contentB64: string, languageCodes: string[],
): Promise<string | null> {
  const url = `https://${CHIRP_REGION}-speech.googleapis.com/v2/projects/${key.project_id}`
    + `/locations/${CHIRP_REGION}/recognizers/_:recognize`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { autoDecodingConfig: {}, languageCodes, model: 'chirp_2' },
      content: contentB64,
    }),
    signal: AbortSignal.timeout(25000),
  })
  const j = await res.json()
  if (j.error) {
    // Несколько языков признаёт не каждая связка модель+регион: не гадаем,
    // а пробуем и откатываемся на первый язык из списка
    if (languageCodes.length > 1) return recognizeChunk(key, token, contentB64, [languageCodes[0]])
    return null
  }
  const text = (j.results || [])
    .map((r: any) => r.alternatives?.[0]?.transcript)
    .filter(Boolean).join(' ').trim()
  return text || null
}

export interface TranscribeOpts {
  /** Длительность разговора; по ней запись режется под минутный лимит API. */
  talkSec?: number | null
  /** Языки распознавания; по умолчанию узбекский с русским фолбэком. */
  languageCodes?: string[]
}

/**
 * Расшифровка аудио. Синхронный :recognize принимает не больше минуты —
 * запись длиннее режется на куски по ~55 секунд и распознаётся по частям
 * (декодер сам находит границы кадров MP3, стык теряет максимум слово).
 * Раньше длинные звонки не резались, а падали целиком: API отвечал ошибкой,
 * и все разговоры дольше минуты — самые ценные — оставались без текста.
 */
export async function transcribeCall(audioUrl: string, opts?: TranscribeOpts): Promise<string | null> {
  const key = getKey()
  const token = await accessToken()
  if (!key || !token) return null

  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(25000) })
  if (!audioRes.ok) return null
  const buf = new Uint8Array(await audioRes.arrayBuffer())
  if (!buf.length) return null

  const languageCodes = opts?.languageCodes?.length ? opts.languageCodes : ['uz-UZ', 'ru-RU']

  // Сколько кусков: по длительности, а без неё — по размеру с консервативной
  // оценкой битрейта (занизить длину куска безопасно, завысить — отказ API)
  const estSec = opts?.talkSec && opts.talkSec > 0 && opts.talkSec < 36000
    ? opts.talkSec
    : buf.length / 4000
  const chunks = Math.max(1, Math.min(12, Math.ceil(estSec / 55)))
  const step = Math.ceil(buf.length / chunks)

  const parts: string[] = []
  for (let i = 0; i < chunks; i++) {
    const slice = buf.subarray(i * step, Math.min((i + 1) * step, buf.length))
    if (!slice.length) break
    const content = b64url(slice).replace(/-/g, '+').replace(/_/g, '/')
    const text = await recognizeChunk(key, token, content, languageCodes)
    if (text) parts.push(text)
  }
  const full = parts.join(' ').trim()
  return full || null
}

export interface CallDigest {
  summary: string
  outcome: string
  nextStep: string | null
  facts: Record<string, string | null>
}

/**
 * Разбор расшифровки: сводка, итог, следующий шаг. Модели прямо сказано, что
 * расшифровка с ошибками распознавания — иначе она принимает шум за факты.
 */
export async function digestCall(orgId: string, transcript: string): Promise<CallDigest | null> {
  const apiKey = await getOpenAIKey(orgId)
  if (!apiKey || transcript.length < 40) return null

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: [
          'Ты разбираешь запись звонка менеджера Delever — это B2B SaaS для ресторанов',
          '(онлайн-заказы, доставка, QR-меню по подписке).',
          'Расшифровка автоматическая, узбекская речь с ошибками распознавания:',
          'восстанавливай смысл по контексту, но НЕ выдумывай фактов, которых не было.',
          'Верни JSON: {"summary":"1-2 предложения по-русски, что было в разговоре",',
          '"outcome":"дозвонились|не дозвонились|договорились|перезвонить|отказ|непонятно",',
          '"next_step":"короткое действие или null","facts":{"city":null,"segment":null,"points":null,',
          '"orders_per_day":null,"pos":null,"aggregators":null,"delivery_type":null,"pain":null,',
          '"budget":null,"dm":null}}',
          'Факты — только то, что клиент сказал сам, по-русски, коротко: city — город;',
          'segment — тип заведения (ресторан, кафе, фастфуд, доставка, кондитерская, сеть...);',
          'points — число точек или филиалов (цифрой); orders_per_day — заказов в день (как сказал: «15-20», «больше 100»);',
          'pos — НАЗВАНИЕ кассовой системы (iiko, RKeeper, Jowi, Poster, Klop...), никогда не число;',
          'delivery_type — своя доставка, курьеры агрегаторов, самовывоз; pain — что болит у клиента одной фразой.',
          'Поле aggregators — с какими агрегаторами клиент уже работает (Express24, Uzum Tezkor,',
          'Yandex Eats, Wolt, Glovo). Если сказал, что не работает ни с кем — так и напиши «нет».',
          'Если о чём-то не говорили — null, догадки недопустимы. Сомневаешься, к какому полю',
          'относится сказанное, — оставь null.',
          'Если разговор пустой (гудки, «алло-алло», ошиблись номером) — summary честно об этом.',
        ].join(' ') },
        { role: 'user', content: transcript.slice(0, 4000) },
      ],
    }),
  })
  if (!res.ok) return null
  const j = await res.json()
  try {
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    if (!out.summary) return null
    return {
      summary: String(out.summary).slice(0, 600),
      outcome: String(out.outcome || 'непонятно'),
      nextStep: out.next_step ? String(out.next_step).slice(0, 200) : null,
      facts: out.facts && typeof out.facts === 'object' ? out.facts : {},
    }
  } catch { return null }
}

export async function ensureCallDigestSchema(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_call_digests (
      call_uuid VARCHAR(80) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      account_id VARCHAR(50),
      transcript TEXT,
      summary TEXT,
      outcome VARCHAR(30),
      next_step TEXT,
      facts JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `.catch(() => {})
  // Что из разговора уехало в квалификацию. Нужно в ленте: сейлз должен
  // видеть не только сводку, но и что машина заполнила поле за него
  await sql`ALTER TABLE sales_call_digests ADD COLUMN IF NOT EXISTS filled jsonb`.catch(() => {})
  // Когда факты разнесены по карточкам: старые сводки без отметки крон
  // доприменит — до этого из разговора заполнялись только агрегаторы сделки
  await sql`ALTER TABLE sales_call_digests ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ`.catch(() => {})
  await sql`ALTER TABLE sales_call_digests ADD COLUMN IF NOT EXISTS lead_id VARCHAR(60)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS sales_call_digests_acc ON sales_call_digests(org_id, account_id)`.catch(() => {})
}

/** Поля квалификации, которые заполняются со слов клиента, с подписями для ленты. */
export const CALL_FACT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'city', label: 'город' },
  { key: 'segment', label: 'тип заведения' },
  { key: 'points', label: 'точек' },
  { key: 'orders_per_day', label: 'заказов в день' },
  { key: 'pos', label: 'касса' },
  { key: 'aggregators', label: 'агрегаторы' },
  { key: 'delivery_type', label: 'доставка' },
  { key: 'pain', label: 'боль' },
]

/**
 * Годится ли сказанное в поле. Модель однажды записала «3» в кассу и
 * «null» строкой в город — форма поля проверяется до записи, как у
 * агента-квалификатора в директе.
 */
export function plausibleFact(key: string, v: string): boolean {
  const s = v.trim()
  if (!s || s.length > 200 || /^(null|none|нет данных|не указано|неизвестно|n\/a|-)$/i.test(s)) return false
  const hasDigit = /\d/.test(s)
  const onlyDigits = /^[\d\s\-–—+.]+$/.test(s)
  switch (key) {
    case 'pos': return !onlyDigits
    case 'points': return hasDigit && s.length <= 30
    case 'orders_per_day': return hasDigit && s.length <= 40
    case 'city': return !hasDigit && s.length >= 2 && s.length <= 60
    case 'segment': return !hasDigit && s.length <= 60
    default: return true
  }
}

/** Первое число из «2-3 точки» — колонка сделки числовая, обращения — текст. */
export const firstInt = (v: string): number | null => {
  const m = String(v).match(/\d+/)
  return m ? Number(m[0]) : null
}

/**
 * Разнести факты разговора по карточкам: квалификация обращения и пустые
 * поля открытых сделок клиента. Заполняется только пустое — сказанное
 * человеком руками важнее расшифровки. Возвращает подписи для ленты:
 * сейлз должен видеть, что именно машина вписала за него.
 */
export async function applyCallFacts(
  sql: any, orgId: string,
  target: { leadId?: string | null; accountId?: string | null },
  facts: Record<string, unknown>,
): Promise<string[]> {
  const said: Record<string, string> = {}
  for (const f of CALL_FACT_FIELDS) {
    const v = facts?.[f.key]
    if (v === null || v === undefined) continue
    const str = String(v).trim()
    if (plausibleFact(f.key, str)) said[f.key] = str.slice(0, 200)
  }
  if (!Object.keys(said).length) return []

  const filled: string[] = []
  const note = (key: string, v: string) => {
    const label = CALL_FACT_FIELDS.find(f => f.key === key)?.label || key
    if (!filled.some(x => x.startsWith(label + ':'))) filled.push(`${label}: ${v}`)
  }

  // 1. Обращение: квалификация живёт в qual, город — колонкой. Карточка
  //    показывает qual поверх raw (ответы формы), поэтому пустым считаем
  //    поле, пустое в обоих слоях
  if (target.leadId) {
    const [lead] = await sql`
      SELECT id, city, qual, raw, text, icp_score FROM sales_leads
      WHERE id = ${target.leadId} AND org_id = ${orgId} LIMIT 1
    ` as any[]
    if (lead) {
      const qual = (lead.qual && typeof lead.qual === 'object' ? lead.qual : {}) as Record<string, any>
      const raw = (lead.raw && typeof lead.raw === 'object' ? lead.raw : {}) as Record<string, any>
      const known = (k: string) => String(qual[k] ?? raw[k] ?? (k === 'city' ? lead.city : '') ?? '').trim()
      const patch: Record<string, string> = {}
      for (const [k, v] of Object.entries(said)) {
        if (k === 'city') continue
        if (!known(k) || !plausibleFact(k, known(k))) patch[k] = v
      }
      if (Object.keys(patch).length) {
        await sql`
          UPDATE sales_leads
          SET qual = COALESCE(qual, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
          WHERE id = ${lead.id} AND org_id = ${orgId}
        `
        for (const [k, v] of Object.entries(patch)) note(k, v)
      }
      if (said.city && !String(lead.city || '').trim()) {
        await sql`
          UPDATE sales_leads SET city = ${said.city}, updated_at = NOW()
          WHERE id = ${lead.id} AND org_id = ${orgId} AND COALESCE(city, '') = ''
        `
        note('city', said.city)
      }
      // Каждый факт пересчитывает балл — так же, как квалификация руками
      if (Object.keys(patch).length || said.city) {
        const merged = (k: string) => patch[k] || known(k) || null
        const icp = scoreIcp({
          pos: merged('pos'), points: merged('points'), ordersPerDay: merged('orders_per_day'),
          aggregators: merged('aggregators'), deliveryType: merged('delivery_type'),
          city: said.city || lead.city || null, text: lead.text,
        })
        await sql`
          UPDATE sales_leads SET icp_score = ${icp.score}, icp_reasons = ${JSON.stringify(icp.reasons)}::jsonb
          WHERE id = ${lead.id} AND org_id = ${orgId}
        `.catch(() => {})
      }
    }
  }

  // 2. Открытые сделки клиента: те же поля колонками, точки — числом
  if (target.accountId) {
    const deals = await sql`
      SELECT id, city, segment, points, orders_per_day, pos, aggregators, delivery_type, pain
      FROM sales_deals
      WHERE org_id = ${orgId} AND account_id = ${target.accountId}
        AND archived_at IS NULL AND won_at IS NULL AND lost_at IS NULL
    ` as any[]
    for (const d of deals) {
      const empty = (k: string) => d[k] === null || d[k] === undefined || String(d[k]).trim() === ''
      const set = {
        city: said.city && empty('city') ? said.city.slice(0, 100) : null,
        segment: said.segment && empty('segment') ? said.segment.slice(0, 255) : null,
        points: said.points && empty('points') ? firstInt(said.points) : null,
        orders_per_day: said.orders_per_day && empty('orders_per_day') ? said.orders_per_day.slice(0, 255) : null,
        pos: said.pos && empty('pos') ? said.pos.slice(0, 100) : null,
        aggregators: said.aggregators && empty('aggregators') ? said.aggregators.slice(0, 255) : null,
        delivery_type: said.delivery_type && empty('delivery_type') ? said.delivery_type.slice(0, 255) : null,
        pain: said.pain && empty('pain') ? said.pain : null,
      }
      if (!Object.values(set).some(v => v !== null)) continue
      await sql`
        UPDATE sales_deals SET
          city = COALESCE(${set.city}, city),
          segment = COALESCE(${set.segment}, segment),
          points = COALESCE(${set.points}, points),
          orders_per_day = COALESCE(${set.orders_per_day}, orders_per_day),
          pos = COALESCE(${set.pos}, pos),
          aggregators = COALESCE(${set.aggregators}, aggregators),
          delivery_type = COALESCE(${set.delivery_type}, delivery_type),
          pain = COALESCE(${set.pain}, pain),
          updated_at = NOW()
        WHERE id = ${d.id} AND org_id = ${orgId}
      `
      for (const [k, v] of Object.entries(set)) if (v !== null) note(k, String(said[k]))
    }
  }
  return filled
}

export function hasSpeechKey(): boolean {
  return !!getKey()
}
