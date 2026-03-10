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
      'Access-Control-Expose-Headers': 'X-Org-Id',
    },
  })
}

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  telegram_bot_token: '', // Пустой = использовать env
  telegram_bot_username: '',
  openai_api_key: '', // Пустой = использовать env
  auto_create_cases: true,
  min_urgency_for_case: 2,
  auto_transcribe_voice: true,
  auto_transcribe_video: true,
  notify_on_problem: true,
  notify_chat_id: '',
  working_hours_start: 9,
  working_hours_end: 18,
  escalation_hours: 24,
  ai_model: 'gpt-4o-mini',
  whisper_language: 'ru',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  
  // Auth required for write operations
  if (req.method !== 'GET') {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authorization required' }, 401)
    }
    // Accept any valid Bearer token (agents can manage settings)
  }

  // Убедимся что таблица настроек существует
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS support_settings (
        org_id VARCHAR(50) NOT NULL DEFAULT 'org_delever',
        key VARCHAR(100) NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (org_id, key)
      )
    `
  } catch (e) {
    // Таблица уже существует
  }
  await sql`ALTER TABLE support_settings ADD COLUMN IF NOT EXISTS org_id VARCHAR(50) DEFAULT 'org_delever'`.catch(() => {})
  await sql`UPDATE support_settings SET org_id = 'org_delever' WHERE org_id IS NULL`.catch(() => {})
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS support_settings_org_key ON support_settings(org_id, key)`.catch(() => {})
  // Migration: drop old PK(key) to allow multi-tenant (org_id, key)
  await sql`ALTER TABLE support_settings DROP CONSTRAINT IF EXISTS support_settings_pkey`.catch(() => {})
  await sql`ALTER TABLE support_settings ADD PRIMARY KEY (org_id, key)`.catch(() => {})

  // GET - получить настройки
  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT key, value FROM support_settings WHERE org_id = ${orgId}`
      
      // Собираем настройки из БД
      const dbSettings: Record<string, any> = {}
      for (const row of rows) {
        try {
          dbSettings[row.key] = JSON.parse(row.value)
        } catch {
          dbSettings[row.key] = row.value
        }
      }

      // Мержим с дефолтами
      const settings = { ...DEFAULT_SETTINGS, ...dbSettings }

      // Маскируем токены для безопасности
      const hasBotToken = !!dbSettings.telegram_bot_token
      const hasOpenAIKey = !!dbSettings.openai_api_key

      const maskedSettings = {
        ...settings,
        telegram_bot_token: hasBotToken
          ? `${settings.telegram_bot_token.slice(0, 10)}...${settings.telegram_bot_token.slice(-4)}`
          : '',
        openai_api_key: hasOpenAIKey
          ? `sk-...${settings.openai_api_key.slice(-4)}`
          : '',
      }

      // Показываем env vars только для org_delever (legacy)
      const isLegacyOrg = orgId === 'org_delever'
      const envStatus = {
        TELEGRAM_BOT_TOKEN: isLegacyOrg && !!process.env.TELEGRAM_BOT_TOKEN,
        OPENAI_API_KEY: isLegacyOrg && !!process.env.OPENAI_API_KEY,
        TELEGRAM_CHAT_ID: isLegacyOrg && !!process.env.TELEGRAM_CHAT_ID,
      }

      return json({
        settings: maskedSettings,
        envStatus,
        defaults: Object.keys(DEFAULT_SETTINGS),
      })

    } catch (e: any) {
      return json({ error: 'Failed to fetch settings', details: e.message }, 500)
    }
  }

  // PUT - обновить настройки
  if (req.method === 'PUT') {
    try {
      const body = await req.json()
      const { settings } = body

      if (!settings || typeof settings !== 'object') {
        return json({ error: 'Settings object required' }, 400)
      }

      // Валидация и сохранение каждой настройки
      const updated: string[] = []
      
      for (const [key, value] of Object.entries(settings)) {
        // Пропускаем неизвестные ключи
        if (!(key in DEFAULT_SETTINGS)) continue
        
        // Не сохраняем маскированные значения
        if (typeof value === 'string' && (value.includes('...') || value === '(using env)')) {
          continue
        }

        const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
        
        await sql`
          INSERT INTO support_settings (org_id, key, value, updated_at)
          VALUES (${orgId}, ${key}, ${stringValue}, NOW())
          ON CONFLICT (org_id, key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = NOW()
        `
        updated.push(key)
      }

      return json({
        success: true,
        updated,
        message: `Updated ${updated.length} settings`
      })

    } catch (e: any) {
      return json({ error: 'Failed to update settings', details: e.message }, 500)
    }
  }

  // POST - сбросить настройки к дефолтам
  if (req.method === 'POST') {
    try {
      const { action } = await req.json()
      
      if (action === 'reset') {
        await sql`DELETE FROM support_settings WHERE org_id = ${orgId}`
        return json({
          success: true,
          message: 'Settings reset to defaults'
        })
      }

      if (action === 'test_bot') {
        const tokenRow = await sql`SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'telegram_bot_token'`
        const token = tokenRow[0]?.value || process.env.TELEGRAM_BOT_TOKEN
        
        if (!token) {
          return json({ error: 'No bot token configured' }, 400)
        }

        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
          const data = await res.json()
          
          if (data.ok) {
            return json({
              success: true,
              bot: {
                id: data.result.id,
                username: data.result.username,
                firstName: data.result.first_name,
              }
            })
          } else {
            return json({ error: 'Bot token invalid', details: data.description }, 400)
          }
        } catch (e: any) {
          return json({ error: 'Failed to connect to Telegram', details: e.message }, 500)
        }
      }

      if (action === 'test_openai') {
        const keyRow = await sql`SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'openai_api_key'`
        const key = keyRow[0]?.value || process.env.OPENAI_API_KEY
        if (!key) return json({ error: 'Нет API ключа OpenAI' }, 400)

        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` },
            signal: AbortSignal.timeout(5000),
          })
          if (res.ok) {
            const modelRow = await sql`SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'ai_model'`
            const model = modelRow[0]?.value || 'gpt-4o-mini'
            return json({ success: true, model })
          }
          const err = await res.json().catch(() => ({})) as any
          return json({ error: 'Ключ недействителен', details: err.error?.message || `HTTP ${res.status}` }, 400)
        } catch (e: any) {
          return json({ error: 'Не удалось подключиться к OpenAI', details: e.message }, 500)
        }
      }

      return json({ error: 'Unknown action' }, 400)

    } catch (e: any) {
      return json({ error: 'Action failed', details: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

// Хелпер для получения актуального токена (используется в других модулях)
export async function getActiveBotToken(): Promise<string | null> {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
    if (!connectionString) return process.env.TELEGRAM_BOT_TOKEN || null
    
    const sql = neon(connectionString)
    const result = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token'`
    
    const dbToken = result[0]?.value
    return dbToken || process.env.TELEGRAM_BOT_TOKEN || null
  } catch {
    return process.env.TELEGRAM_BOT_TOKEN || null
  }
}

export async function getActiveOpenAIKey(): Promise<string | null> {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
    if (!connectionString) return process.env.OPENAI_API_KEY || null
    
    const sql = neon(connectionString)
    const result = await sql`SELECT value FROM support_settings WHERE key = 'openai_api_key'`
    
    const dbKey = result[0]?.value
    return dbKey || process.env.OPENAI_API_KEY || null
  } catch {
    return process.env.OPENAI_API_KEY || null
  }
}
