import { getSQL, getOpenAIKey } from './db.js'

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

/**
 * Расшифровка аудио. Быстрый режим Google принимает до минуты — этого хватает
 * на дозвон и первое касание; длинные демо режутся по первой минуте, там всё
 * равно самое важное: кто звонит и зачем.
 */
export async function transcribeCall(audioUrl: string): Promise<string | null> {
  const key = getKey()
  const token = await accessToken()
  if (!key || !token) return null

  const audioRes = await fetch(audioUrl)
  if (!audioRes.ok) return null
  const audio = b64url(await audioRes.arrayBuffer())
    .replace(/-/g, '+').replace(/_/g, '/')

  const url = `https://${CHIRP_REGION}-speech.googleapis.com/v2/projects/${key.project_id}`
    + `/locations/${CHIRP_REGION}/recognizers/_:recognize`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { autoDecodingConfig: {}, languageCodes: ['uz-UZ'], model: 'chirp_2' },
      content: audio,
    }),
  })
  const j = await res.json()
  if (j.error) return null
  const text = (j.results || [])
    .map((r: any) => r.alternatives?.[0]?.transcript)
    .filter(Boolean).join(' ').trim()
  return text || null
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
          '"next_step":"короткое действие или null","facts":{"city":null,"points":null,',
          '"pos":null,"pain":null,"budget":null,"dm":null,"aggregators":null,"delivery_type":null}}',
          'Поле aggregators — с какими агрегаторами клиент уже работает (Express24, Uzum Tezkor,',
          'Yandex Eats, Wolt, Glovo). Если сказал, что не работает ни с кем — так и напиши «нет».',
          'Если про агрегаторы не говорили — null, догадки недопустимы.',
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
  await sql`CREATE INDEX IF NOT EXISTS sales_call_digests_acc ON sales_call_digests(org_id, account_id)`.catch(() => {})
}

export function hasSpeechKey(): boolean {
  return !!getKey()
}
