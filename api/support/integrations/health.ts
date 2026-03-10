import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 10,
}

function getSQL() {
  const url = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!url) throw new Error('No DB')
  return neon(url)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

type ServiceStatus = 'active' | 'inactive' | 'error'

async function checkTelegram(sql: any): Promise<{
  status: ServiceStatus; botUsername?: string; botName?: string; channelsCount: number
}> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { status: 'inactive', channelsCount: 0 }

  try {
    let channelsCount = 0
    const [botRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(4000) }),
      sql`SELECT COUNT(*)::int as cnt FROM support_channels`.then(r => { channelsCount = r[0]?.cnt || 0 }).catch(() => {}),
    ])

    if (!botRes.ok) return { status: 'error', channelsCount }
    const data = await botRes.json() as any
    if (!data.ok) return { status: 'error', channelsCount }

    return {
      status: 'active',
      botUsername: data.result.username,
      botName: data.result.first_name,
      channelsCount,
    }
  } catch {
    return { status: 'error', channelsCount: 0 }
  }
}

async function checkOpenAI(): Promise<{ status: ServiceStatus; model: string; source: 'db' | 'env' | 'none'; httpStatus?: number; detail?: string }> {
  const sql = getSQL()
  let model = 'gpt-4o-mini'
  let dbKey = ''
  try {
    const rows = await sql`SELECT key, value FROM support_settings WHERE key IN ('ai_model', 'openai_api_key')`
    for (const r of rows) {
      if (r.key === 'ai_model' && r.value) model = r.value
      if (r.key === 'openai_api_key' && r.value) dbKey = r.value
    }
  } catch {}

  const key = dbKey || process.env.OPENAI_API_KEY
  const source = dbKey ? 'db' : process.env.OPENAI_API_KEY ? 'env' : 'none'
  if (!key) return { status: 'inactive', model, source: 'none' }

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { status: 'active', model, source }
    const errText = await res.text().catch(() => '')
    return { status: 'error', model, source, httpStatus: res.status, detail: errText.slice(0, 200) }
  } catch (e: any) {
    return { status: 'error', model, source, detail: e.message }
  }
}

async function checkWhisper(sql: any): Promise<{ status: ServiceStatus; language: string }> {
  try {
    const rows = await sql`
      SELECT key, value FROM support_settings WHERE key IN ('auto_transcribe_voice', 'whisper_language')
    `
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const enabled = map.auto_transcribe_voice !== 'false'
    const language = map.whisper_language || 'ru'
    let hasKey = false
    try {
      const keyRow = await sql`SELECT value FROM support_settings WHERE key = 'openai_api_key' LIMIT 1`
      hasKey = !!(keyRow[0]?.value) || !!process.env.OPENAI_API_KEY
    } catch { hasKey = !!process.env.OPENAI_API_KEY }

    return { status: enabled && hasKey ? 'active' : 'inactive', language }
  } catch {
    return { status: 'inactive', language: 'ru' }
  }
}

async function checkNotify(sql: any): Promise<{ status: ServiceStatus; chatId: string | null }> {
  try {
    const rows = await sql`
      SELECT key, value FROM support_settings WHERE key IN ('notify_on_problem', 'notify_chat_id')
    `
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const enabled = map.notify_on_problem !== 'false'
    const chatId = map.notify_chat_id || process.env.TELEGRAM_CHAT_ID || null

    return { status: enabled && chatId ? 'active' : 'inactive', chatId }
  } catch {
    return { status: 'inactive', chatId: null }
  }
}

async function checkWhatsApp(sql: any): Promise<{
  status: ServiceStatus; phone: string | null; filterMode: string | null; channelsCount: number
}> {
  const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL
  const base = { phone: null, filterMode: null, channelsCount: 0 }

  let channelsCount = 0
  try {
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM support_channels WHERE source = 'whatsapp'`.catch(() => [{ cnt: 0 }])
    channelsCount = cnt[0]?.cnt || 0
  } catch {}

  if (!bridgeUrl) return { status: 'inactive', ...base, channelsCount }

  try {
    const res = await fetch(`${bridgeUrl}/qr`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { status: 'error', ...base, channelsCount }

    const data = await res.json() as any
    return {
      status: data.connected ? 'active' : 'inactive',
      phone: data.phone || null,
      filterMode: data.filterMode || 'all',
      channelsCount,
    }
  } catch {
    return { status: 'error', ...base, channelsCount }
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  try {
    const sql = getSQL()

    const [telegram, openai, whisper, notify, whatsapp] = await Promise.all([
      checkTelegram(sql),
      checkOpenAI(),
      checkWhisper(sql),
      checkNotify(sql),
      checkWhatsApp(sql),
    ])

    return json({ telegram, openai, whisper, notify, whatsapp })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
