import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractSuperAdminContext } from '../lib/sa-auth.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sa = await extractSuperAdminContext(req)
  if (!sa.saId) return json({ error: 'Unauthorized' }, 403)

  const sql = getSQL()

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT key, value FROM support_platform_settings
        WHERE key IN ('platform_bot_token', 'platform_bot_username')
      `
      const settings: Record<string, string> = {}
      for (const r of rows) {
        settings[r.key] = r.key === 'platform_bot_token'
          ? (r.value ? `***${r.value.slice(-6)}` : '')
          : r.value || ''
      }
      return json({ settings })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const { botToken, botUsername } = await req.json()

      if (botToken) {
        await sql`
          INSERT INTO support_platform_settings (key, value, updated_at)
          VALUES ('platform_bot_token', ${botToken}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${botToken}, updated_at = NOW()
        `
      }

      if (botUsername) {
        const clean = botUsername.replace(/^@/, '').trim()
        await sql`
          INSERT INTO support_platform_settings (key, value, updated_at)
          VALUES ('platform_bot_username', ${clean}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${clean}, updated_at = NOW()
        `
      }

      if (botToken) {
        const webhookUrl = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://gfsupport.uz'}/api/support/webhook/platform-bot`
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl }),
          })
        } catch (e) {
          console.error('[PlatformSettings] Failed to set webhook:', e)
        }
      }

      return json({ success: true })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
