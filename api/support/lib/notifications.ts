import { neon } from '@neondatabase/serverless'

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export interface NotificationPayload {
  orgId: string
  type: 'escalation' | 'tag' | 'critical_case' | 'agent_decision' | 'sla_breach'
  title: string
  body: string
  channelId?: string
  channelName?: string
  senderName?: string
  decisionId?: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  targetAgentIds?: string[]
  targetRoles?: string[]
}

async function getOrgBotToken(orgId: string): Promise<string | null> {
  const sql = getSQL()
  try {
    const [s] = await sql`SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'telegram_bot_token' LIMIT 1`
    if (s?.value) return s.value
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

async function getNotifyTargets(orgId: string, payload: NotificationPayload) {
  const sql = getSQL()
  const targets: { agentId: string; name: string; telegramId: string | null; role: string }[] = []

  try {
    if (payload.targetAgentIds?.length) {
      const agents = await sql`
        SELECT id, name, telegram_id, role FROM support_agents
        WHERE org_id = ${orgId} AND id = ANY(${payload.targetAgentIds})
      `
      for (const a of agents) targets.push({ agentId: a.id, name: a.name, telegramId: a.telegram_id, role: a.role })
    }

    if (payload.targetRoles?.length) {
      for (const role of payload.targetRoles) {
        const agents = await sql`
          SELECT id, name, telegram_id, role FROM support_agents
          WHERE org_id = ${orgId} AND role = ${role} AND status != 'offline'
        `
        for (const a of agents) {
          if (!targets.find(t => t.agentId === a.id)) {
            targets.push({ agentId: a.id, name: a.name, telegramId: a.telegram_id, role: a.role })
          }
        }
      }
    }

    if (targets.length === 0 && (payload.priority === 'critical' || payload.type === 'escalation')) {
      const admins = await sql`
        SELECT id, name, telegram_id, role FROM support_agents
        WHERE org_id = ${orgId} AND role IN ('admin', 'owner', 'manager')
      `
      for (const a of admins) targets.push({ agentId: a.id, name: a.name, telegramId: a.telegram_id, role: a.role })
    }
  } catch (e) {
    console.error('[Notifications] getNotifyTargets error:', e)
  }

  return targets
}

export async function sendNotification(payload: NotificationPayload) {
  const sql = getSQL()
  const targets = await getNotifyTargets(payload.orgId, payload)

  const results: { agentId: string; telegram: boolean; inApp: boolean }[] = []

  for (const target of targets) {
    let tgSent = false
    let inAppSent = false

    if (target.telegramId) {
      tgSent = await sendTelegramDM(payload.orgId, target.telegramId, payload)
    }

    inAppSent = await saveInAppNotification(sql, payload, target)

    results.push({ agentId: target.agentId, telegram: tgSent, inApp: inAppSent })
  }

  console.log(`[Notifications] Sent ${payload.type} to ${results.length} targets: ${results.map(r => `${r.agentId}(tg:${r.telegram},app:${r.inApp})`).join(', ')}`)
  return results
}

async function sendTelegramDM(orgId: string, telegramId: string, payload: NotificationPayload): Promise<boolean> {
  const botToken = await getOrgBotToken(orgId)
  if (!botToken || !telegramId) return false

  const icons: Record<string, string> = {
    escalation: '🔴',
    tag: '⚡',
    critical_case: '🚨',
    agent_decision: '🤖',
    sla_breach: '⏰',
  }

  const icon = icons[payload.type] || '📢'
  const text = `${icon} <b>${payload.title}</b>\n\n${payload.body}${payload.channelName ? `\n\n📍 Канал: ${payload.channelName}` : ''}${payload.senderName ? `\n👤 Клиент: ${payload.senderName}` : ''}`

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json() as any
    if (!data.ok) {
      console.error(`[Notifications] TG DM failed for ${telegramId}:`, data.description)
    }
    return data.ok === true
  } catch (e: any) {
    console.error(`[Notifications] TG DM error:`, e.message)
    return false
  }
}

async function saveInAppNotification(sql: any, payload: NotificationPayload, target: { agentId: string; name: string }): Promise<boolean> {
  const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_notifications (
        id VARCHAR(60) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        agent_id VARCHAR(60) NOT NULL,
        type VARCHAR(30) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        channel_id VARCHAR(60),
        channel_name VARCHAR(255),
        sender_name VARCHAR(255),
        decision_id VARCHAR(60),
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    await sql`
      INSERT INTO support_notifications (id, org_id, agent_id, type, title, body, priority, channel_id, channel_name, sender_name, decision_id, created_at)
      VALUES (${id}, ${payload.orgId}, ${target.agentId}, ${payload.type}, ${payload.title}, ${payload.body}, ${payload.priority}, ${payload.channelId || null}, ${payload.channelName || null}, ${payload.senderName || null}, ${payload.decisionId || null}, NOW())
    `
    return true
  } catch (e: any) {
    console.error('[Notifications] In-app save error:', e.message)
    return false
  }
}
