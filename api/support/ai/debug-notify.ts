import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge' }

function getSQL() {
  const c = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!c) throw new Error('DB not found')
  return neon(c)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id' } })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'test-send') {
    try {
      const { sendNotification } = await import('../lib/notifications.js')
      const result = await sendNotification({
        orgId,
        type: 'escalation',
        title: 'Тестовая эскалация',
        body: 'Это тестовое уведомление для проверки работоспособности системы нотификаций.',
        channelName: 'Тестовый канал',
        senderName: 'Система',
        priority: 'critical',
        targetRoles: ['admin'],
      })
      return json({ ok: true, result })
    } catch (e: any) {
      return json({ ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 5) })
    }
  }

  try {
    const [botTokenSetting] = await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'telegram_bot_token' LIMIT 1
    `.catch(() => [null])
    const botToken = botTokenSetting?.value || process.env.TELEGRAM_BOT_TOKEN || null

    const admins = await sql`
      SELECT id, name, role, status, telegram_id, phone
      FROM support_agents WHERE org_id = ${orgId} AND role IN ('admin', 'owner', 'manager')
    `

    const onlineAdmins = await sql`
      SELECT id, name, role, status, telegram_id
      FROM support_agents WHERE org_id = ${orgId} AND role IN ('admin', 'owner', 'manager') AND status != 'offline'
    `

    const recentDecisions = await sql`
      SELECT id, action, confidence, reasoning, incoming_message, sender_name, channel_name, created_at,
        case_priority, escalate_to_role, tag_agent_id, tag_agent_name, feedback
      FROM support_agent_decisions WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 10
    `

    const escalations = await sql`
      SELECT id, action, reasoning, incoming_message, sender_name, channel_name, created_at
      FROM support_agent_decisions WHERE org_id = ${orgId} AND action IN ('escalate', 'tag_agent', 'reply_and_tag')
      ORDER BY created_at DESC LIMIT 10
    `

    const notifications = await sql`
      SELECT id, agent_id, type, title, body, priority, is_read, created_at
      FROM support_notifications WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 10
    `.catch(() => [])

    let botInfo = null
    if (botToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(5000) })
        botInfo = await res.json()
      } catch (e: any) {
        botInfo = { error: e.message }
      }
    }

    let testDMResult = null
    const myAdmin = admins.find((a: any) => a.telegram_id && a.role === 'admin')
    if (myAdmin && botToken) {
      try {
        const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: myAdmin.telegram_id }),
          signal: AbortSignal.timeout(5000),
        })
        testDMResult = await chatRes.json()
      } catch (e: any) {
        testDMResult = { error: e.message }
      }
    }

    return json({
      orgId,
      botConfig: {
        hasToken: !!botToken,
        tokenSource: botTokenSetting?.value ? 'database' : (process.env.TELEGRAM_BOT_TOKEN ? 'env' : 'none'),
        tokenPreview: botToken ? `${botToken.slice(0, 8)}...${botToken.slice(-4)}` : null,
        botInfo,
      },
      admins: admins.map((a: any) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        telegramId: a.telegram_id || null,
        phone: a.phone || null,
        hasTelegramId: !!a.telegram_id,
      })),
      onlineAdmins: onlineAdmins.map((a: any) => ({
        id: a.id, name: a.name, status: a.status, telegramId: a.telegram_id,
      })),
      testDMResult,
      recentDecisions: recentDecisions.map((d: any) => ({
        id: d.id,
        action: d.action,
        confidence: d.confidence,
        reasoning: (d.reasoning || '').slice(0, 200),
        message: (d.incoming_message || '').slice(0, 100),
        sender: d.sender_name,
        channel: d.channel_name,
        date: d.created_at,
        casePriority: d.case_priority,
        escalateToRole: d.escalate_to_role,
        tagAgent: d.tag_agent_name,
        feedback: d.feedback,
      })),
      escalations: escalations.map((e: any) => ({
        id: e.id, action: e.action, reasoning: (e.reasoning || '').slice(0, 200),
        message: (e.incoming_message || '').slice(0, 100), sender: e.sender_name, date: e.created_at,
      })),
      notifications,
    })
  } catch (e: any) {
    return json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) }, 500)
  }
}
