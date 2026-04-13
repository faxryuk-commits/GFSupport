import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 10,
}

type ServiceStatus = 'active' | 'inactive' | 'error'

async function getOrgSettings(sql: any, orgId: string): Promise<Record<string, string>> {
  try {
    const rows = await sql`SELECT key, value FROM support_settings WHERE org_id = ${orgId}`
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value || ''
    return map
  } catch {
    return {}
  }
}

async function getOrgIntegrationTokens(sql: any, orgId: string, isLegacy: boolean) {
  const orgSettings = await getOrgSettings(sql, orgId)

  const botToken = orgSettings.telegram_bot_token || (isLegacy ? process.env.TELEGRAM_BOT_TOKEN : '') || ''
  const botUsername = orgSettings.telegram_bot_username || ''
  const openaiKey = orgSettings.openai_api_key || (isLegacy ? process.env.OPENAI_API_KEY : '') || ''
  const aiModel = orgSettings.ai_model || 'gpt-4o-mini'
  const notifyChatId = orgSettings.notify_chat_id || (isLegacy ? process.env.TELEGRAM_CHAT_ID : '') || ''
  const notifyEnabled = orgSettings.notify_on_problem !== 'false'
  const transcribeEnabled = orgSettings.auto_transcribe_voice !== 'false'
  const whisperLang = orgSettings.whisper_language || 'ru'

  let bridgeUrl = ''
  let bridgeSecret = ''
  if (isLegacy) {
    bridgeUrl = process.env.WHATSAPP_BRIDGE_URL || ''
    bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET || ''
  } else {
    try {
      const [orgRow] = await sql`
        SELECT whatsapp_bridge_url, whatsapp_bridge_secret 
        FROM support_organizations WHERE id = ${orgId} LIMIT 1
      `
      bridgeUrl = orgRow?.whatsapp_bridge_url || ''
      bridgeSecret = orgRow?.whatsapp_bridge_secret || ''
    } catch {}
  }

  return { botToken, botUsername, openaiKey, aiModel, notifyChatId, notifyEnabled, transcribeEnabled, whisperLang, bridgeUrl, bridgeSecret }
}

async function checkTelegram(sql: any, orgId: string, botToken: string): Promise<{
  status: ServiceStatus; botUsername?: string; botName?: string; channelsCount: number
}> {
  if (!botToken) return { status: 'inactive', channelsCount: 0 }

  try {
    let channelsCount = 0
    const [botRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(4000) }),
      sql`SELECT COUNT(*)::int as cnt FROM support_channels WHERE org_id = ${orgId} AND (source = 'telegram' OR source IS NULL)`.then((r: any) => { channelsCount = r[0]?.cnt || 0 }).catch(() => {}),
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

async function checkOpenAI(openaiKey: string, aiModel: string): Promise<{
  status: ServiceStatus; model: string; source: string
}> {
  if (!openaiKey) return { status: 'inactive', model: aiModel, source: 'none' }

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    return { status: res.ok ? 'active' : 'error', model: aiModel, source: 'db' }
  } catch {
    return { status: 'error', model: aiModel, source: 'db' }
  }
}

async function checkWhatsApp(sql: any, orgId: string, bridgeUrl: string, bridgeSecret: string): Promise<{
  status: ServiceStatus; phone: string | null; channelsCount: number
}> {
  let channelsCount = 0
  try {
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM support_channels WHERE org_id = ${orgId} AND source = 'whatsapp'`
    channelsCount = cnt[0]?.cnt || 0
  } catch {}

  if (!bridgeUrl) return { status: 'inactive', phone: null, channelsCount }

  try {
    const res = await fetch(`${bridgeUrl}/qr`, {
      headers: { 'Cache-Control': 'no-cache', 'Authorization': `Bearer ${bridgeSecret}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { status: 'error', phone: null, channelsCount }

    const data = await res.json() as any
    return {
      status: data.connected ? 'active' : 'inactive',
      phone: data.phone || null,
      channelsCount,
    }
  } catch {
    return { status: 'error', phone: null, channelsCount }
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  try {
    const sql = getSQL()
    const orgId = await getRequestOrgId(req)
    const isLegacy = orgId === 'org_delever'
    const tokens = await getOrgIntegrationTokens(sql, orgId, isLegacy)

    const [telegram, openai, whatsapp] = await Promise.all([
      checkTelegram(sql, orgId, tokens.botToken),
      checkOpenAI(tokens.openaiKey, tokens.aiModel),
      checkWhatsApp(sql, orgId, tokens.bridgeUrl, tokens.bridgeSecret),
    ])

    const whisper = {
      status: (tokens.transcribeEnabled && tokens.openaiKey ? 'active' : 'inactive') as ServiceStatus,
      language: tokens.whisperLang,
    }

    const notify = {
      status: (tokens.notifyEnabled && tokens.notifyChatId ? 'active' : 'inactive') as ServiceStatus,
      chatId: tokens.notifyChatId || null,
    }

    return json({ telegram, openai, whisper, notify, whatsapp })
  } catch (e: any) {
    return json({ error: "Internal server error" }, 500)
  }
}
