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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_email_unique ON support_otp(email)
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

  log.push(await safe('TABLE support_platform_settings', () => sql`
    CREATE TABLE IF NOT EXISTS support_platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `))

  log.push(await safe('TABLE support_platform_users', () => sql`
    CREATE TABLE IF NOT EXISTS support_platform_users (
      id SERIAL PRIMARY KEY,
      telegram_id VARCHAR(50) UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      reg_code VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `))

  log.push(await safe('platform_users.reg_code', () =>
    sql`ALTER TABLE support_platform_users ADD COLUMN IF NOT EXISTS reg_code VARCHAR(10)`))

  log.push(await safe('TABLE support_super_admins', () => sql`
    CREATE TABLE IF NOT EXISTS support_super_admins (
      id VARCHAR(50) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'admin',
      is_active BOOLEAN DEFAULT true,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
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

  // Phase 8 fix: tables missed in original stepB
  log.push(await safe('support_settings.org_id', () =>
    sql`ALTER TABLE support_settings ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_broadcasts.org_id', () =>
    sql`ALTER TABLE support_broadcasts ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_broadcast_scheduled.org_id', () =>
    sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_broadcast_clicks.org_id', () =>
    sql`ALTER TABLE support_broadcast_clicks ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_case_activities.org_id', () =>
    sql`ALTER TABLE support_case_activities ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_auto_templates.org_id', () =>
    sql`ALTER TABLE support_auto_templates ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_ai_patterns.org_id', () =>
    sql`ALTER TABLE support_ai_patterns ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_agent_markets.org_id', () =>
    sql`ALTER TABLE support_agent_markets ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_agent_sessions.org_id', () =>
    sql`ALTER TABLE support_agent_sessions ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_learning_stats.org_id', () =>
    sql`ALTER TABLE support_learning_stats ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_embeddings.org_id', () =>
    sql`ALTER TABLE support_embeddings ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))
  log.push(await safe('support_docs.org_id', () =>
    sql`ALTER TABLE support_docs ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)`))

  // support_otp extensions for Telegram registration
  log.push(await safe('support_otp.telegram_username', () =>
    sql`ALTER TABLE support_otp ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(255)`))
  log.push(await safe('support_otp.company_name', () =>
    sql`ALTER TABLE support_otp ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`))

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

  // Phase 8 fix: missing indexes
  log.push(await safe('idx_markets_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_markets_org ON support_markets(org_id)`))
  log.push(await safe('idx_reminders_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_reminders_org ON support_reminders(org_id)`))
  log.push(await safe('idx_solutions_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_solutions_org ON support_solutions(org_id)`))
  log.push(await safe('idx_topics_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_topics_org ON support_topics(org_id)`))
  log.push(await safe('idx_invites_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_invites_org ON support_invites(org_id)`))
  log.push(await safe('idx_feedback_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_feedback_org ON support_feedback(org_id)`))
  log.push(await safe('idx_dialogs_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_dialogs_org ON support_dialogs(org_id)`))
  log.push(await safe('idx_reactions_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_reactions_org ON support_reactions(org_id)`))
  log.push(await safe('idx_settings_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_settings_org ON support_settings(org_id)`))
  log.push(await safe('idx_broadcasts_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_broadcasts_org ON support_broadcasts(org_id)`))
  log.push(await safe('idx_agent_sessions_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON support_agent_sessions(org_id)`))
  log.push(await safe('idx_docs_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_docs_org ON support_docs(org_id)`))
  log.push(await safe('idx_embeddings_org', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_embeddings_org ON support_embeddings(org_id)`))
  // Additional composite indexes
  log.push(await safe('idx_messages_org_created', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_messages_org_created ON support_messages(org_id, created_at DESC)`))
  log.push(await safe('idx_commitments_org_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_commitments_org_status ON support_commitments(org_id, status)`))

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

  // Phase 8 fix: migrate missed tables
  log.push(await safe('settings → org_delever', () =>
    sql`UPDATE support_settings SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('broadcasts → org_delever', () =>
    sql`UPDATE support_broadcasts SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('broadcast_scheduled → org_delever', () =>
    sql`UPDATE support_broadcast_scheduled SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('broadcast_clicks → org_delever', () =>
    sql`UPDATE support_broadcast_clicks SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('case_activities → org_delever', () =>
    sql`UPDATE support_case_activities SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('auto_templates → org_delever', () =>
    sql`UPDATE support_auto_templates SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('ai_patterns → org_delever', () =>
    sql`UPDATE support_ai_patterns SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('agent_markets → org_delever', () =>
    sql`UPDATE support_agent_markets SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('agent_sessions → org_delever', () =>
    sql`UPDATE support_agent_sessions SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('learning_stats → org_delever', () =>
    sql`UPDATE support_learning_stats SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('embeddings → org_delever', () =>
    sql`UPDATE support_embeddings SET org_id = 'org_delever' WHERE org_id IS NULL`))
  log.push(await safe('docs → org_delever', () =>
    sql`UPDATE support_docs SET org_id = 'org_delever' WHERE org_id IS NULL`))

  // Seed super admin
  const saEmail = (process.env.SA_EMAIL || 'admin@gfsupport.uz').trim()
  const saPasswordHash = (process.env.SA_PASSWORD_HASH || 'hrvasz911').trim()
  log.push(await safe('seed super_admin', () => sql`
    INSERT INTO support_super_admins (id, email, name, password_hash, role, is_active)
    VALUES ('sa_root', ${saEmail}, 'Root Admin', ${saPasswordHash}, 'owner', true)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash
  `))

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
 * Step F: Audit log indexes + OTP unique constraint
 */
async function stepF_auditIndexes(sql: any): Promise<string[]> {
  const log: string[] = []
  log.push(await safe('IDX audit_log org+created', () => sql`CREATE INDEX IF NOT EXISTS idx_audit_org_created ON support_audit_log(org_id, created_at DESC)`))
  log.push(await safe('IDX audit_log action', () => sql`CREATE INDEX IF NOT EXISTS idx_audit_action ON support_audit_log(action)`))
  log.push(await safe('IDX audit_log agent', () => sql`CREATE INDEX IF NOT EXISTS idx_audit_agent ON support_audit_log(agent_id)`))
  log.push(await safe('IDX org slug', () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug ON support_organizations(slug)`))
  return log
}

/**
 * POST /api/support/db/multi-tenant?step=all    — full migration (A+B+C+D+F)
 * POST /api/support/db/multi-tenant?step=A      — only create tables
 * POST /api/support/db/multi-tenant?step=B      — only add org_id columns
 * POST /api/support/db/multi-tenant?step=C      — only create indexes
 * POST /api/support/db/multi-tenant?step=D      — only migrate data
 * POST /api/support/db/multi-tenant?step=F      — audit indexes + constraints
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
    if (step === 'F' || step === 'all') result.stepF = await stepF_auditIndexes(sql)

    result.verification = await stepE(sql)
    return json(result)
  } catch (e: any) {
    console.error('[Multi-tenant migration] Error:', e)
    return json({ error: e.message, stack: e.stack?.slice(0, 300) }, 500)
  }
}
