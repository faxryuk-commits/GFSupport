import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
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

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.includes('admin')) {
    return json({ error: 'Admin access required' }, 403)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Use POST to run migrations' }, 405)
  }

  const sql = getSQL()
  const migrations: string[] = []

  try {
    // Migration 1: Add sender_role to messages
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_role VARCHAR(20) DEFAULT 'client'`
      migrations.push('Added sender_role to messages')
    } catch (e) { /* column exists */ }

    // Migration 2: Add is_read to messages
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`
      migrations.push('Added is_read to messages')
    } catch (e) { /* column exists */ }

    // Migration 3: Add read_at to messages
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`
      migrations.push('Added read_at to messages')
    } catch (e) { /* column exists */ }

    // Migration 4: Add reply tracking to channels
    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_client_message_at TIMESTAMP`
      migrations.push('Added last_client_message_at to channels')
    } catch (e) { /* column exists */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_team_message_at TIMESTAMP`
      migrations.push('Added last_team_message_at to channels')
    } catch (e) { /* column exists */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN DEFAULT false`
      migrations.push('Added awaiting_reply to channels')
    } catch (e) { /* column exists */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0`
      migrations.push('Added unread_count to channels')
    } catch (e) { /* column exists */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_sender_name VARCHAR(255)`
      migrations.push('Added last_sender_name to channels')
    } catch (e) { /* column exists */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_message_preview TEXT`
      migrations.push('Added last_message_preview to channels')
    } catch (e) { /* column exists */ }

    // Migration 5: Add manager_id to messages (for tracking who replied)
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS manager_id VARCHAR(50)`
      migrations.push('Added manager_id to messages')
    } catch (e) { /* column exists */ }

    // Create indexes for new fields
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_messages_sender_role ON support_messages(sender_role)`
      await sql`CREATE INDEX IF NOT EXISTS idx_messages_is_read ON support_messages(is_read) WHERE is_read = false`
      await sql`CREATE INDEX IF NOT EXISTS idx_channels_awaiting ON support_channels(awaiting_reply) WHERE awaiting_reply = true`
      migrations.push('Created indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 6: Create support_solutions table for knowledge base
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_solutions (
          id VARCHAR(50) PRIMARY KEY,
          case_id VARCHAR(50),
          category VARCHAR(100),
          subcategory VARCHAR(100),
          problem_keywords TEXT[],
          problem_pattern TEXT,
          solution_text TEXT NOT NULL,
          solution_steps JSONB DEFAULT '[]',
          success_score INTEGER DEFAULT 3,
          resolution_time_minutes INTEGER,
          used_count INTEGER DEFAULT 0,
          helpful_votes INTEGER DEFAULT 0,
          not_helpful_votes INTEGER DEFAULT 0,
          created_by VARCHAR(50),
          is_verified BOOLEAN DEFAULT false,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `
      migrations.push('Created support_solutions table')
    } catch (e) { /* table exists */ }

    // Migration 7: Create support_reminders table for commitments tracking
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_reminders (
          id VARCHAR(50) PRIMARY KEY,
          channel_id VARCHAR(50) NOT NULL,
          case_id VARCHAR(50),
          message_id VARCHAR(50),
          commitment_text TEXT NOT NULL,
          commitment_type VARCHAR(30) DEFAULT 'vague',
          is_vague BOOLEAN DEFAULT false,
          detected_deadline TIMESTAMP,
          auto_deadline TIMESTAMP,
          reminder_at TIMESTAMP,
          escalation_level INTEGER DEFAULT 0,
          assigned_to VARCHAR(50),
          assigned_name VARCHAR(255),
          status VARCHAR(20) DEFAULT 'active',
          completed_at TIMESTAMP,
          escalated_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      migrations.push('Created support_reminders table')
    } catch (e) { /* table exists */ }

    // Create indexes for solutions and reminders
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_solutions_category ON support_solutions(category)`
      await sql`CREATE INDEX IF NOT EXISTS idx_solutions_keywords ON support_solutions USING GIN(problem_keywords)`
      await sql`CREATE INDEX IF NOT EXISTS idx_reminders_status ON support_reminders(status) WHERE status = 'active'`
      await sql`CREATE INDEX IF NOT EXISTS idx_reminders_deadline ON support_reminders(auto_deadline) WHERE status = 'active'`
      migrations.push('Created solution and reminder indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 8: Add Topics/Threads support
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thread_id BIGINT`
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thread_name VARCHAR(255)`
      migrations.push('Added thread_id and thread_name to messages')
    } catch (e) { /* columns exist */ }

    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS is_forum BOOLEAN DEFAULT false`
      migrations.push('Added is_forum to channels')
    } catch (e) { /* column exists */ }

    // Migration 9: Create topics table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_topics (
          id VARCHAR(50) PRIMARY KEY,
          channel_id VARCHAR(50) NOT NULL,
          thread_id BIGINT NOT NULL,
          name VARCHAR(255),
          icon_color VARCHAR(20),
          is_closed BOOLEAN DEFAULT false,
          messages_count INTEGER DEFAULT 0,
          last_message_at TIMESTAMP,
          last_sender_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(channel_id, thread_id)
        )
      `
      migrations.push('Created support_topics table')
    } catch (e) { /* table exists */ }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_messages_thread ON support_messages(channel_id, thread_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_topics_channel ON support_topics(channel_id)`
      migrations.push('Created topic indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 10: Add updated_at to channels
    try {
      await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`
      migrations.push('Added updated_at to channels')
    } catch (e) { /* column exists */ }

    // Migration 11: Add sender_photo to messages
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_photo_url TEXT`
      migrations.push('Added sender_photo_url to messages')
    } catch (e) { /* column exists */ }

    // Migration 12: Add reactions support
    try {
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'`
      migrations.push('Added reactions to messages')
    } catch (e) { /* column exists */ }

    // Migration 11: Create reactions table for detailed tracking
    try {
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
      migrations.push('Created support_reactions table')
    } catch (e) { /* table exists */ }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_reactions_message ON support_reactions(message_id)`
      migrations.push('Created reaction indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 13: Create conversations table for First Response Time tracking
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_conversations (
          id VARCHAR(64) PRIMARY KEY,
          channel_id VARCHAR(64) NOT NULL,
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMP,
          status VARCHAR(32) DEFAULT 'active',
          first_response_at TIMESTAMP,
          message_count INTEGER DEFAULT 0,
          agent_id VARCHAR(64),
          client_satisfaction INTEGER
        )
      `
      migrations.push('Created support_conversations table')
    } catch (e) { /* table exists */ }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_conversations_channel ON support_conversations(channel_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_conversations_status ON support_conversations(status)`
      migrations.push('Created conversation indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 14: Create agents table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_agents (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          username VARCHAR(255),
          telegram_id VARCHAR(64),
          role VARCHAR(32) DEFAULT 'agent',
          status VARCHAR(32) DEFAULT 'offline',
          avatar_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      migrations.push('Created support_agents table')
    } catch (e) { /* table exists */ }

    // Migration 15: Performance indexes for main queries
    try {
      // Composite index for messages by channel + date (most common query)
      await sql`CREATE INDEX IF NOT EXISTS idx_messages_channel_date ON support_messages(channel_id, created_at DESC)`
      // Index for channels sorting
      await sql`CREATE INDEX IF NOT EXISTS idx_channels_last_message ON support_channels(last_message_at DESC NULLS LAST) WHERE is_active = true`
      // Index for unread count
      await sql`CREATE INDEX IF NOT EXISTS idx_channels_unread ON support_channels(unread_count) WHERE unread_count > 0`
      // Add reply columns if missing
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT`
      await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(255)`
      migrations.push('Created performance indexes')
    } catch (e) { /* indexes exist */ }

    // Migration 16: Add agent profile fields (phone, position, department, email, password)
    try {
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS email VARCHAR(255)`
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS position VARCHAR(255)`
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS department VARCHAR(255)`
      await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`
      migrations.push('Added agent profile fields (email, phone, position, department, password_hash)')
    } catch (e) { /* columns exist */ }

    return json({
      success: true,
      migrations,
      message: `Applied ${migrations.length} migrations`
    })

  } catch (e: any) {
    return json({ error: 'Migration failed', details: e.message }, 500)
  }
}
