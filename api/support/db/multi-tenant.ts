import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

async function safe(label: string, fn: () => Promise<any>): Promise<string> {
  try {
    await fn()
    return `OK: ${label}`
  } catch (e: any) {
    return `SKIP: ${label} — ${e.message?.slice(0, 80)}`
  }
}

// Step A: Create new tables
async function stepA(sql: any): Promise<string[]> {
  const log: string[] = []

  log.push(await safe('TABLE support_organizations', () => sql`
    CREATE TABLE IF NOT EXISTS support_organizations (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      logo_url TEXT,
      plan VARCHAR(50) DEFAULT 'starter',
      telegram_bot_token TEXT,
      telegram_bot_username VARCHAR(100),
      whatsapp_bridge_url TEXT,
      whatsapp_bridge_secret TEXT,
      openai_api_key TEXT,
      ai_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
      settings JSONB DEFAULT '{}',
      max_agents INTEGER DEFAULT 5,
      max_channels INTEGER DEFAULT 50,
      max_messages_per_month INTEGER DEFAULT 10000,
      is_active BOOLEAN DEFAULT true,
      trial_ends_at TIMESTAMP,
      owner_agent_id VARCHAR(50),
      custom_domain VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `))

  log.push(await safe('TABLE support_otp', () => sql`
    CREATE TABLE IF NOT EXISTS support_otp (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(6) NOT NULL,
      purpose VARCHAR(50) DEFAULT 'registration',
      attempts INTEGER DEFAULT 0,
      expires_at TIMESTAMP NOT NULL,
      verified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `))

  log.push(await safe('INDEX support_otp', () => sql`
    CREATE INDEX IF NOT EXISTS idx_otp_email ON support_otp(email, purpose)
  `))

  log.push(await safe('TABLE support_audit_log', () => sql`
    CREATE TABLE IF NOT EXISTS support_audit_log (
      id BIGSERIAL PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      agent_id VARCHAR(50),
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50),
      resource_id VARCHAR(50),
      details JSONB DEFAULT '{}',
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `))

  log.push(await safe('INDEX audit_org', () => sql`
    CREATE INDEX IF NOT EXISTS idx_audit_org ON support_audit_log(org_id)
  `))
  log.push(await safe('INDEX audit_created', () => sql`
    CREATE INDEX IF NOT EXISTS idx_audit_created ON support_audit_log(created_at DESC)
  `))

  return log
}

// Step B: Add org_id to all existing tables
async function stepB(sql: any): Promise<string[]> {
  const log: string[] = []

  log.push(await safe('support_agents.org_id', () =>
    sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_channels.org_id', () =>
    sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_messages.org_id', () =>
    sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_cases.org_id', () =>
    sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_automations.org_id', () =>
    sql`ALTER TABLE support_automations ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_users.org_id', () =>
    sql`ALTER TABLE support_users ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_markets.org_id', () =>
    sql`ALTER TABLE support_markets ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_commitments.org_id', () =>
    sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_reminders.org_id', () =>
    sql`ALTER TABLE support_reminders ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_solutions.org_id', () =>
    sql`ALTER TABLE support_solutions ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_topics.org_id', () =>
    sql`ALTER TABLE support_topics ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_invites.org_id', () =>
    sql`ALTER TABLE support_invites ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_conversations.org_id', () =>
    sql`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_conversation_sessions.org_id', () =>
    sql`ALTER TABLE support_conversation_sessions ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_feedback.org_id', () =>
    sql`ALTER TABLE support_feedback ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_patterns.org_id', () =>
    sql`ALTER TABLE support_patterns ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_dialogs.org_id', () =>
    sql`ALTER TABLE support_dialogs ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_reactions.org_id', () =>
    sql`ALTER TABLE support_reactions ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))

  return log
}

// Step C: Create indexes on org_id
async function stepC(sql: any): Promise<string[]> {
  const log: string[] = []

  log.push(await safe('idx_agents_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_agents_org ON support_agents(org_id)`))
  log.push(await safe('idx_channels_org_id', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_channels_org_id ON support_channels(org_id)`))
  log.push(await safe('idx_messages_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_messages_org ON support_messages(org_id)`))
  log.push(await safe('idx_cases_org_id', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cases_org_id ON support_cases(org_id)`))
  log.push(await safe('idx_automations_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_automations_org ON support_automations(org_id)`))
  log.push(await safe('idx_users_org_id', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_users_org_id ON support_users(org_id)`))
  log.push(await safe('idx_commitments_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_commitments_org ON support_commitments(org_id)`))
  log.push(await safe('idx_conversations_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_conversations_org ON support_conversations(org_id)`))
  log.push(await safe('idx_conv_sessions_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_conv_sessions_org ON support_conversation_sessions(org_id)`))

  // Composite indexes for frequent queries
  log.push(await safe('idx_messages_org_channel', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_messages_org_channel ON support_messages(org_id, channel_id)`))
  log.push(await safe('idx_cases_org_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cases_org_status ON support_cases(org_id, status)`))
  log.push(await safe('idx_channels_org_active', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_channels_org_active ON support_channels(org_id, is_active)`))

  return log
}

// Step D: Create default org + migrate existing data
async function stepD(sql: any): Promise<string[]> {
  const log: string[] = []

  // Read current settings
  let telegramToken: string | null = null
  let openaiKey: string | null = null
  let aiModel: string | null = null
  let botUsername: string | null = null
  const settingsObj: Record<string, string> = {}

  try {
    const rows = await sql`SELECT key, value FROM support_settings`
    for (const r of rows) {
      if (r.key === 'telegram_bot_token') telegramToken = r.value
      else if (r.key === 'openai_api_key') openaiKey = r.value
      else if (r.key === 'ai_model') aiModel = r.value
      else if (r.key === 'telegram_bot_username') botUsername = r.value
      else settingsObj[r.key] = r.value
    }
    log.push(`READ settings: ${rows.length} keys`)
  } catch {
    log.push('SKIP settings: table not found or empty')
  }

  // Find first admin as owner
  let ownerId: string | null = null
  try {
    const admins = await sql`SELECT id FROM support_agents WHERE role = 'admin' ORDER BY created_at LIMIT 1`
    if (admins[0]) ownerId = admins[0].id
  } catch {}

  // UPSERT org_delever
  await sql`
    INSERT INTO support_organizations (
      id, name, slug, plan,
      telegram_bot_token, telegram_bot_username,
      openai_api_key, ai_model, settings,
      owner_agent_id, max_agents, max_channels, max_messages_per_month
    ) VALUES (
      'org_delever', 'Delever', 'delever', 'enterprise',
      ${telegramToken}, ${botUsername},
      ${openaiKey}, ${aiModel || 'gpt-4o-mini'},
      ${JSON.stringify(settingsObj)}::jsonb, ${ownerId},
      100, 1000, 1000000
    )
    ON CONFLICT (id) DO UPDATE SET
      telegram_bot_token = COALESCE(EXCLUDED.telegram_bot_token, support_organizations.telegram_bot_token),
      openai_api_key = COALESCE(EXCLUDED.openai_api_key, support_organizations.openai_api_key),
      settings = EXCLUDED.settings,
      updated_at = NOW()
  `
  log.push('UPSERT org_delever')

  // Fill org_id = 'org_delever' WHERE NULL (safe to re-run)
  log.push(await safe('agents → org_delever', () =>
    sql`UPDATE support_agents SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('channels → org_delever', () =>
    sql`UPDATE support_channels SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('messages → org_delever', () =>
    sql`UPDATE support_messages SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('cases → org_delever', () =>
    sql`UPDATE support_cases SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('automations → org_delever', () =>
    sql`UPDATE support_automations SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('users → org_delever', () =>
    sql`UPDATE support_users SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('markets → org_delever', () =>
    sql`UPDATE support_markets SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('commitments → org_delever', () =>
    sql`UPDATE support_commitments SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('reminders → org_delever', () =>
    sql`UPDATE support_reminders SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('solutions → org_delever', () =>
    sql`UPDATE support_solutions SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('topics → org_delever', () =>
    sql`UPDATE support_topics SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('invites → org_delever', () =>
    sql`UPDATE support_invites SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('conversations → org_delever', () =>
    sql`UPDATE support_conversations SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('conv_sessions → org_delever', () =>
    sql`UPDATE support_conversation_sessions SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('feedback → org_delever', () =>
    sql`UPDATE support_feedback SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('patterns → org_delever', () =>
    sql`UPDATE support_patterns SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('dialogs → org_delever', () =>
    sql`UPDATE support_dialogs SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('reactions → org_delever', () =>
    sql`UPDATE support_reactions SET org_id = 'org_delever' WHERE org_id IS NULL`))

  return log
}

// Step E: Verify integrity
async function stepE(sql: any): Promise<Record<string, any>> {
  const checks: Record<string, any> = {}

  try {
    const org = await sql`SELECT id, name, slug, plan FROM support_organizations WHERE id = 'org_delever'`
    checks.org_delever = org[0] || 'MISSING'
  } catch (e: any) {
    checks.org_delever = { error: e.message?.slice(0, 80) }
  }

  async function checkTable(name: string, query: () => Promise<any>, nullQuery: () => Promise<any>) {
    try {
      const [total] = await query()
      const [nulls] = await nullQuery()
      const t = parseInt(total?.c || '0')
      const n = parseInt(nulls?.c || '0')
      checks[name] = { total: t, without_org_id: n, status: n === 0 ? (t > 0 ? 'OK' : 'EMPTY') : 'HAS_NULLS' }
    } catch (e: any) {
      checks[name] = { error: e.message?.slice(0, 80) }
    }
  }

  await checkTable('agents',
    () => sql`SELECT COUNT(*) as c FROM support_agents`,
    () => sql`SELECT COUNT(*) as c FROM support_agents WHERE org_id IS NULL`)
  await checkTable('channels',
    () => sql`SELECT COUNT(*) as c FROM support_channels`,
    () => sql`SELECT COUNT(*) as c FROM support_channels WHERE org_id IS NULL`)
  await checkTable('messages',
    () => sql`SELECT COUNT(*) as c FROM support_messages`,
    () => sql`SELECT COUNT(*) as c FROM support_messages WHERE org_id IS NULL`)
  await checkTable('cases',
    () => sql`SELECT COUNT(*) as c FROM support_cases`,
    () => sql`SELECT COUNT(*) as c FROM support_cases WHERE org_id IS NULL`)
  await checkTable('users',
    () => sql`SELECT COUNT(*) as c FROM support_users`,
    () => sql`SELECT COUNT(*) as c FROM support_users WHERE org_id IS NULL`)

  return checks
}

/**
 * POST /api/support/db/multi-tenant?step=all    — full migration (A+B+C+D)
 * POST /api/support/db/multi-tenant?step=A      — only create tables
 * POST /api/support/db/multi-tenant?step=B      — only add org_id columns
 * POST /api/support/db/multi-tenant?step=C      — only create indexes
 * POST /api/support/db/multi-tenant?step=D      — only migrate data
 * GET  /api/support/db/multi-tenant?step=verify — check integrity
 */
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.includes('admin')) {
    return json({ error: 'Admin access required' }, 403)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const step = url.searchParams.get('step') || 'verify'

  if (req.method === 'GET' || step === 'verify') {
    const verification = await stepE(sql)
    return json({ step: 'verify', verification, timestamp: new Date().toISOString() })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Use POST to run migration, GET to verify' }, 405)
  }

  try {
    const result: Record<string, any> = { step, timestamp: new Date().toISOString() }

    if (step === 'A' || step === 'all') result.stepA = await stepA(sql)
    if (step === 'B' || step === 'all') result.stepB = await stepB(sql)
    if (step === 'C' || step === 'all') result.stepC = await stepC(sql)
    if (step === 'D' || step === 'all') result.stepD = await stepD(sql)

    result.verification = await stepE(sql)
    return json(result)
  } catch (e: any) {
    console.error('[Multi-tenant migration] Error:', e)
    return json({ error: e.message, stack: e.stack?.slice(0, 300) }, 500)
  }
}
