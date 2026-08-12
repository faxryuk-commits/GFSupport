/**
 * Генерация договоров через Google Docs.
 *
 * Почему так, а не сборка .docx у себя: у вас уже есть готовые договоры со
 * сложным оформлением и корпоративные папки, куда их складывают. Копия шаблона
 * в Google сохраняет вёрстку целиком, а файл сразу оказывается там, где его
 * ждёт бухгалтерия. Нам остаётся подставить значения и отдать ссылку.
 *
 * Доступ — сервисный аккаунт: шаблон и папка расшариваются на его почту.
 * Переменные: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_CONTRACTS_FOLDER_ID.
 */

const SCOPE = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive'

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PEM → CryptoKey. Ключ сервисного аккаунта приходит с \n внутри строки. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const raw = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/** Токен по OAuth2 JWT-bearer: обычный пользовательский токен здесь не годится. */
async function getAccessToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SA_EMAIL
  const key = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!email || !key) return null

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', await importKey(key), new TextEncoder().encode(`${header}.${claim}`))
  const jwt = `${header}.${claim}.${b64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    console.error('[google] token failed:', await res.text())
    return null
  }
  const data: any = await res.json()
  return data.access_token || null
}

export interface GeneratedDoc {
  ok: boolean
  documentId?: string
  url?: string
  pdfUrl?: string
  error?: string
}

/**
 * Копирует шаблон, подставляет значения и кладёт в папку договоров.
 * values: { '{{contract_number}}': '108/26', ... }
 */
export async function generateFromTemplate(
  templateId: string, name: string, values: Record<string, string>,
): Promise<GeneratedDoc> {
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'Google не настроен: нет GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY' }
  const folder = process.env.GOOGLE_CONTRACTS_FOLDER_ID
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 1. Копия шаблона сразу в нужную папку — иначе файл осядет в «Мой диск»
  //    сервисного аккаунта, куда у команды нет доступа
  const copyRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name, ...(folder ? { parents: [folder] } : {}) }),
    })
  if (!copyRes.ok) return { ok: false, error: `копия шаблона: ${await copyRes.text()}` }
  const copy: any = await copyRes.json()

  // 2. Подстановка значений одним запросом
  const requests = Object.entries(values).map(([placeholder, value]) => ({
    replaceAllText: {
      containsText: { text: placeholder, matchCase: true },
      replaceText: value ?? '',
    },
  }))
  if (requests.length) {
    const upd = await fetch(
      `https://docs.googleapis.com/v1/documents/${copy.id}:batchUpdate`, {
        method: 'POST', headers: auth, body: JSON.stringify({ requests }),
      })
    if (!upd.ok) return { ok: false, error: `подстановка: ${await upd.text()}` }
  }

  return {
    ok: true,
    documentId: copy.id,
    url: `https://docs.google.com/document/d/${copy.id}/edit`,
    pdfUrl: `https://docs.google.com/document/d/${copy.id}/export?format=pdf`,
  }
}
