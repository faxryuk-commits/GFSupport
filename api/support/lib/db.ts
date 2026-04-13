import { neon, NeonQueryFunction } from '@neondatabase/serverless'

let migrated = false

export function getSQL(): NeonQueryFunction<false, false> {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export async function ensureMigrated() {
  if (migrated) return
  
  const sql = getSQL()
  
  try {
    // Check if migrations needed by testing for latest table/column
    const test = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'support_messages' AND column_name = 'reactions'
    `
    
    if (test.length > 0) {
      migrated = true
      return
    }
  } catch (e) {
    // Table doesn't exist, need full migration
  }

  // Run migrations
  console.log('[DB] Running migrations...')
  
  // Core tables
  await sql`
    CREATE TABLE IF NOT EXISTS support_channels (
      id VARCHAR(50) PRIMARY KEY,
      telegram_chat_id BIGINT UNIQUE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) DEFAULT 'client',
      company_id VARCHAR(50),
      is_forum BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      awaiting_reply BOOLEAN DEFAULT false,
      unread_count INT DEFAULT 0,
      last_message_at TIMESTAMP,
      last_sender_name VARCHAR(255),
      last_message_preview TEXT,
      assigned_to VARCHAR(255),
      tags TEXT[],
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS support_messages (
      id VARCHAR(50) PRIMARY KEY,
      channel_id VARCHAR(50) REFERENCES support_channels(id),
      case_id VARCHAR(50),
      telegram_message_id BIGINT,
      sender_id BIGINT,
      sender_name VARCHAR(255),
      sender_username VARCHAR(255),
      sender_role VARCHAR(50) DEFAULT 'client',
      is_from_client BOOLEAN DEFAULT true,
      content_type VARCHAR(50) DEFAULT 'text',
      text_content TEXT,
      media_url TEXT,
      file_id VARCHAR(255),
      transcript TEXT,
      ai_summary TEXT,
      ai_category VARCHAR(100),
      ai_sentiment VARCHAR(50),
      ai_intent VARCHAR(100),
      ai_urgency INT DEFAULT 0,
      ai_extracted_entities JSONB,
      is_problem BOOLEAN DEFAULT false,
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMP,
      thread_id BIGINT,
      thread_name VARCHAR(255),
      reply_to_message_id BIGINT,
      reactions JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS support_topics (
      id VARCHAR(50) PRIMARY KEY,
      channel_id VARCHAR(50) REFERENCES support_channels(id),
      thread_id BIGINT,
      name VARCHAR(255),
      icon_color VARCHAR(50),
      message_count INT DEFAULT 0,
      last_message_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS support_reactions (
      id VARCHAR(50) PRIMARY KEY,
      message_id VARCHAR(50) NOT NULL,
      channel_id VARCHAR(50) NOT NULL,
      telegram_message_id BIGINT,
      user_id BIGINT,
      user_name VARCHAR(255),
      emoji VARCHAR(50) NOT NULL,
      is_from_bot BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  // Indexes
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_channel ON support_messages(channel_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON support_messages(created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_thread ON support_messages(channel_id, thread_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_topics_channel ON support_topics(channel_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_reactions_message ON support_reactions(message_id)`
    // Performance indexes for common queries
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_org_created ON support_messages(org_id, created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_org_active ON support_channels(org_id, is_active)`
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_org_awaiting ON support_channels(org_id, awaiting_reply) WHERE awaiting_reply = true`
  } catch (e) { /* indexes exist */ }

  // Add missing columns to existing tables (explicit to avoid dynamic sql)
  try {
    await sql`SELECT reactions FROM support_messages LIMIT 1`
  } catch (e) {
    await sql`ALTER TABLE support_messages ADD COLUMN reactions JSONB DEFAULT '{}'`
  }
  try {
    await sql`SELECT thread_id FROM support_messages LIMIT 1`
  } catch (e) {
    await sql`ALTER TABLE support_messages ADD COLUMN thread_id BIGINT`
  }
  try {
    await sql`SELECT thread_name FROM support_messages LIMIT 1`
  } catch (e) {
    await sql`ALTER TABLE support_messages ADD COLUMN thread_name VARCHAR(255)`
  }
  try {
    await sql`SELECT is_forum FROM support_channels LIMIT 1`
  } catch (e) {
    await sql`ALTER TABLE support_channels ADD COLUMN is_forum BOOLEAN DEFAULT false`
  }
  // Add photo_url column for channel avatars
  try {
    await sql`SELECT photo_url FROM support_channels LIMIT 1`
  } catch (e) {
    await sql`ALTER TABLE support_channels ADD COLUMN photo_url TEXT`
  }

  migrated = true
  console.log('[DB] Migrations complete')
}

export async function getOpenAIKey(orgId?: string | null): Promise<string | null> {
  const sql = getSQL()
  if (orgId) {
    try {
      const [org] = await sql`SELECT openai_api_key FROM support_organizations WHERE id = ${orgId} LIMIT 1`
      if (org?.openai_api_key) return org.openai_api_key
    } catch {}
  }
  try {
    const rows = await sql`SELECT value FROM support_settings WHERE key = 'openai_api_key' LIMIT 1`
    if (rows[0]?.value) return rows[0].value
  } catch {}
  return process.env.OPENAI_API_KEY || null
}

export async function getOrgBotToken(orgId?: string | null): Promise<string | null> {
  const sql = getSQL()
  if (orgId) {
    try {
      const [org] = await sql`SELECT telegram_bot_token FROM support_organizations WHERE id = ${orgId} LIMIT 1`
      if (org?.telegram_bot_token) return org.telegram_bot_token
    } catch {}
  }
  try {
    const rows = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token' LIMIT 1`
    if (rows[0]?.value) return rows[0].value
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

export async function getOrgWhatsAppBridge(orgId?: string | null): Promise<{ url: string | null; secret: string | null }> {
  const sql = getSQL()
  if (orgId) {
    try {
      const [org] = await sql`SELECT whatsapp_bridge_url, whatsapp_bridge_secret FROM support_organizations WHERE id = ${orgId} LIMIT 1`
      if (org?.whatsapp_bridge_url) return { url: org.whatsapp_bridge_url, secret: org.whatsapp_bridge_secret }
    } catch {}
  }
  try {
    const rows = await sql`SELECT key, value FROM support_settings WHERE key IN ('whatsapp_bridge_url', 'whatsapp_bridge_secret')`
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    if (map.whatsapp_bridge_url) return { url: map.whatsapp_bridge_url, secret: map.whatsapp_bridge_secret || null }
  } catch {}
  return {
    url: process.env.WHATSAPP_BRIDGE_URL || null,
    secret: process.env.WHATSAPP_BRIDGE_SECRET || null,
  }
}

export function json(data: any, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
  }
  return new Response(JSON.stringify(data), { status, headers })
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
  }
}
