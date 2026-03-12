import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
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

const SETTINGS_KEYS = [
  'ai_agent_enabled',
  'ai_agent_mode',
  'ai_agent_auto_reply',
  'ai_agent_min_confidence',
  'ai_agent_work_start',
  'ai_agent_work_end',
  'ai_agent_timezone',
  'ai_agent_exclude_channels',
  'ai_agent_model',
  'together_api_key',
]

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT key, value FROM support_settings WHERE org_id = ${orgId} AND key LIKE 'ai_agent_%' OR (org_id = ${orgId} AND key = 'together_api_key')
      `
      const settings: Record<string, string> = {}
      for (const r of rows) settings[r.key] = r.value

      return json({
        enabled: settings['ai_agent_enabled'] === 'true',
        mode: settings['ai_agent_mode'] || 'assist',
        autoReply: settings['ai_agent_auto_reply'] === 'true',
        minConfidence: parseFloat(settings['ai_agent_min_confidence'] || '0.8'),
        workStart: parseInt(settings['ai_agent_work_start'] || '9'),
        workEnd: parseInt(settings['ai_agent_work_end'] || '22'),
        timezone: settings['ai_agent_timezone'] || 'Asia/Tashkent',
        excludeChannels: (settings['ai_agent_exclude_channels'] || '').split(',').filter(Boolean),
        model: settings['ai_agent_model'] || 'Qwen/Qwen2.5-72B-Instruct-Turbo',
        hasApiKey: !!settings['together_api_key'],
      })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const updates: [string, string][] = []

      if (body.enabled !== undefined) updates.push(['ai_agent_enabled', String(body.enabled)])
      if (body.mode) updates.push(['ai_agent_mode', body.mode])
      if (body.autoReply !== undefined) updates.push(['ai_agent_auto_reply', String(body.autoReply)])
      if (body.minConfidence !== undefined) updates.push(['ai_agent_min_confidence', String(body.minConfidence)])
      if (body.workStart !== undefined) updates.push(['ai_agent_work_start', String(body.workStart)])
      if (body.workEnd !== undefined) updates.push(['ai_agent_work_end', String(body.workEnd)])
      if (body.timezone) updates.push(['ai_agent_timezone', body.timezone])
      if (body.excludeChannels !== undefined) updates.push(['ai_agent_exclude_channels', body.excludeChannels.join(',')])
      if (body.model) updates.push(['ai_agent_model', body.model])
      if (body.togetherApiKey) updates.push(['together_api_key', body.togetherApiKey])

      for (const [key, value] of updates) {
        await sql`
          INSERT INTO support_settings (org_id, key, value) VALUES (${orgId}, ${key}, ${value})
          ON CONFLICT (org_id, key) DO UPDATE SET value = ${value}
        `
      }

      return json({ success: true, updated: updates.length })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
