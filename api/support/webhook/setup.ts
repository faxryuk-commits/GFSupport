import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const url = new URL(req.url)
  
  // Debug mode - database status check (no auth)
  if (url.searchParams.get('debug') === 'db') {
    try {
      const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
      if (!connectionString) return json({ error: 'No DB connection' }, 500)
      
      const sql = neon(connectionString)
      const channels = await sql`SELECT COUNT(*) as c FROM support_channels WHERE is_active = true`
      const messages = await sql`SELECT COUNT(*) as c FROM support_messages`
      const recent = await sql`
        SELECT id, channel_id, sender_name, SUBSTRING(text_content, 1, 50) as text, created_at
        FROM support_messages ORDER BY created_at DESC LIMIT 10
      `
      
      return json({
        debug: true,
        stats: { channels: channels[0]?.c, messages: messages[0]?.c },
        recentMessages: recent
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }
  
  // Debug channel - check specific channel
  const channelName = url.searchParams.get('channel')
  if (channelName) {
    try {
      const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
      if (!connectionString) return json({ error: 'No DB connection' }, 500)
      
      const sql = neon(connectionString)
      const channelInfo = await sql`
        SELECT * FROM support_channels 
        WHERE name ILIKE ${'%' + channelName + '%'} 
        LIMIT 1
      `
      
      if (channelInfo.length === 0) {
        return json({ error: 'Channel not found', search: channelName })
      }
      
      const ch = channelInfo[0]
      const msgCount = await sql`SELECT COUNT(*) as c FROM support_messages WHERE channel_id = ${ch.id}`
      const recentMsgs = await sql`
        SELECT id, sender_name, sender_role, SUBSTRING(text_content, 1, 100) as text, content_type, created_at
        FROM support_messages 
        WHERE channel_id = ${ch.id}
        ORDER BY created_at DESC 
        LIMIT 20
      `
      
      return json({
        channel: ch,
        messageCount: msgCount[0]?.c,
        recentMessages: recentMsgs
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }
  
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.includes('admin')) {
    return json({ error: 'Admin access required' }, 403)
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return json({ error: 'TELEGRAM_BOT_TOKEN not configured in environment' }, 500)
  }

  // Use custom domain if available, otherwise Vercel URL
  const customDomain = process.env.CUSTOM_DOMAIN || 'gf-support.vercel.app'
  const webhookUrl = `https://${customDomain}/api/support/webhook/telegram`

  // GET - Check current webhook status
  if (req.method === 'GET') {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
      const data = await res.json()
      
      return json({
        currentWebhook: data.result,
        expectedUrl: webhookUrl,
        isConfigured: data.result?.url === webhookUrl,
        instructions: data.result?.url !== webhookUrl 
          ? 'POST to this endpoint to register webhook' 
          : 'Webhook is configured correctly'
      })
    } catch (e: any) {
      return json({ error: 'Failed to check webhook', details: e.message }, 500)
    }
  }

  // POST - Register webhook
  if (req.method === 'POST') {
    try {
      // First, delete any existing webhook
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`)

      // Register new webhook with reactions support
      const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query', 'message_reaction'],
          drop_pending_updates: false, // Keep pending messages
        })
      })

      const result = await res.json()

      if (result.ok) {
        // Verify it was set
        const verifyRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
        const verifyData = await verifyRes.json()

        return json({
          success: true,
          message: 'Webhook registered successfully!',
          webhook: verifyData.result,
          pendingUpdates: verifyData.result?.pending_update_count || 0,
        })
      } else {
        return json({
          success: false,
          error: result.description || 'Failed to set webhook',
          telegramResponse: result,
        }, 500)
      }
    } catch (e: any) {
      return json({ error: 'Failed to register webhook', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
