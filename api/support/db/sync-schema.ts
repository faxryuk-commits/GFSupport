import { neon } from '@neondatabase/serverless'

// Safe schema sync - only adds missing columns/indexes, never deletes
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
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const sql = getSQL()
  const synced: string[] = []
  const errors: string[] = []

  try {
    // ============ PREREQUISITE TABLES ============
    // These are referenced by FK constraints in support_channels/cases
    try {
      await sql`CREATE TABLE IF NOT EXISTS crm_companies (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: crm_companies (stub)')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS crm_managers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: crm_managers (stub)')
    } catch (e) { /* exists */ }

    // ============ CORE TABLES ============
    try {
      await sql`CREATE TABLE IF NOT EXISTS support_agents (
        id VARCHAR(50) PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'agent',
        is_active BOOLEAN DEFAULT true,
        is_online BOOLEAN DEFAULT false,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_active_at TIMESTAMP
      )`
      synced.push('TABLE: support_agents')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS support_channels (
        id VARCHAR(50) PRIMARY KEY,
        telegram_chat_id BIGINT UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(20) DEFAULT 'client',
        company_id VARCHAR(50),
        lead_id VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        members_count INTEGER DEFAULT 0,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP
      )`
      synced.push('TABLE: support_channels')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS support_messages (
        id VARCHAR(100) PRIMARY KEY,
        channel_id VARCHAR(50),
        telegram_message_id BIGINT,
        sender_id VARCHAR(100),
        sender_name VARCHAR(255),
        text_content TEXT,
        media_type VARCHAR(20),
        media_url TEXT,
        is_from_client BOOLEAN DEFAULT true,
        ai_category VARCHAR(100),
        ai_sentiment VARCHAR(20),
        ai_intent VARCHAR(100),
        ai_urgency INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: support_messages')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS support_cases (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(50),
        company_id VARCHAR(50),
        lead_id VARCHAR(50),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(30) DEFAULT 'detected',
        category VARCHAR(100),
        priority VARCHAR(20) DEFAULT 'medium',
        assigned_to VARCHAR(50),
        first_response_at TIMESTAMP,
        resolved_at TIMESTAMP,
        resolution_time_minutes INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: support_cases')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS support_automations (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB DEFAULT '{}',
        action_type VARCHAR(50) NOT NULL,
        action_config JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        execution_count INTEGER DEFAULT 0,
        last_executed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: support_automations')
    } catch (e) { /* exists */ }

    try {
      await sql`CREATE TABLE IF NOT EXISTS support_commitments (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(50),
        message_id VARCHAR(100),
        promised_by VARCHAR(255),
        commitment_text TEXT,
        due_date TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )`
      synced.push('TABLE: support_commitments')
    } catch (e) { /* exists */ }

    // ============ MESSAGES TABLE ============
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_role VARCHAR(20) DEFAULT 'client'`; synced.push('messages.sender_role') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`; synced.push('messages.is_read') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`; synced.push('messages.read_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS manager_id VARCHAR(50)`; synced.push('messages.manager_id') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thread_id BIGINT`; synced.push('messages.thread_id') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thread_name VARCHAR(255)`; synced.push('messages.thread_name') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_photo_url TEXT`; synced.push('messages.sender_photo_url') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'`; synced.push('messages.reactions') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT`; synced.push('messages.reply_to_text') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(255)`; synced.push('messages.reply_to_sender') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS forwarded_from TEXT`; synced.push('messages.forwarded_from') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sentiment_score DECIMAL(3,2)`; synced.push('messages.sentiment_score') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sentiment_change VARCHAR(20)`; synced.push('messages.sentiment_change') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS auto_reply_candidate BOOLEAN DEFAULT false`; synced.push('messages.auto_reply_candidate') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS response_time_ms INTEGER`; synced.push('messages.response_time_ms') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`; synced.push('messages.thumbnail_url') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_name TEXT`; synced.push('messages.file_name') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_size BIGINT`; synced.push('messages.file_size') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS mime_type TEXT`; synced.push('messages.mime_type') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_username VARCHAR(255)`; synced.push('messages.sender_username') } catch (e) { /* exists */ }

    // ============ CHANNELS TABLE ============
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_client_message_at TIMESTAMP`; synced.push('channels.last_client_message_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_team_message_at TIMESTAMP`; synced.push('channels.last_team_message_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN DEFAULT false`; synced.push('channels.awaiting_reply') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0`; synced.push('channels.unread_count') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_sender_name VARCHAR(255)`; synced.push('channels.last_sender_name') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_message_preview TEXT`; synced.push('channels.last_message_preview') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS is_forum BOOLEAN DEFAULT false`; synced.push('channels.is_forum') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`; synced.push('channels.updated_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS photo_url TEXT`; synced.push('channels.photo_url') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS sla_category VARCHAR(30) DEFAULT 'client'`; synced.push('channels.sla_category') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS client_avg_response_ms INTEGER`; synced.push('channels.client_avg_response_ms') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS client_response_count INTEGER DEFAULT 0`; synced.push('channels.client_response_count') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS last_agent_message_at TIMESTAMP`; synced.push('channels.last_agent_message_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS response_comparison JSONB DEFAULT '{}'`; synced.push('channels.response_comparison') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'telegram'`; synced.push('channels.source') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS external_chat_id VARCHAR(100)`; synced.push('channels.external_chat_id') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_channels ALTER COLUMN telegram_chat_id DROP NOT NULL`; synced.push('channels.telegram_chat_id nullable') } catch (e) { /* already nullable */ }

    // ============ CASES TABLE ============
    try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS ticket_number INTEGER`; synced.push('cases.ticket_number') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(64)`; synced.push('cases.source_message_id') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255)`; synced.push('cases.reporter_name') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255)`; synced.push('cases.updated_by') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`; synced.push('cases.created_by') } catch (e) { /* exists */ }

    // ============ AGENTS TABLE ============
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS username VARCHAR(255)`; synced.push('agents.username') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS email VARCHAR(255)`; synced.push('agents.email') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`; synced.push('agents.phone') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS position VARCHAR(255)`; synced.push('agents.position') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS department VARCHAR(255)`; synced.push('agents.department') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`; synced.push('agents.password_hash') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'offline'`; synced.push('agents.status') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS avatar_url TEXT`; synced.push('agents.avatar_url') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb`; synced.push('agents.permissions') } catch (e) { /* exists */ }

    // ============ COMMITMENTS TABLE ============
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS promised_by VARCHAR(255)`; synced.push('commitments.promised_by') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS sender_role VARCHAR(30)`; synced.push('commitments.sender_role') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS is_vague BOOLEAN DEFAULT false`; synced.push('commitments.is_vague') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ`; synced.push('commitments.reminder_at') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false`; synced.push('commitments.reminder_sent') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS case_id VARCHAR(100)`; synced.push('commitments.case_id') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`; synced.push('commitments.priority') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS notes TEXT`; synced.push('commitments.notes') } catch (e) { /* exists */ }
    try { await sql`ALTER TABLE support_commitments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`; synced.push('commitments.updated_at') } catch (e) { /* exists */ }

    // ============ CREATE MISSING TABLES ============
    
    // Topics table
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
      synced.push('TABLE: support_topics')
    } catch (e) { /* exists */ }

    // Conversations table
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
      synced.push('TABLE: support_conversations')
    } catch (e) { /* exists */ }

    // Reactions table
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
      synced.push('TABLE: support_reactions')
    } catch (e) { /* exists */ }

    // Solutions table
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
      synced.push('TABLE: support_solutions')
    } catch (e) { /* exists */ }

    // Agent sessions table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS support_agent_sessions (
          id VARCHAR(64) PRIMARY KEY,
          agent_id VARCHAR(64) NOT NULL,
          started_at TIMESTAMP DEFAULT NOW(),
          ended_at TIMESTAMP,
          is_active BOOLEAN DEFAULT true
        )
      `
      synced.push('TABLE: support_agent_sessions')
    } catch (e) { /* exists */ }

    // ============ CREATE INDEXES ============
    try { await sql`CREATE INDEX IF NOT EXISTS idx_messages_sender_role ON support_messages(sender_role)`; synced.push('INDEX: idx_messages_sender_role') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_messages_channel_date ON support_messages(channel_id, created_at DESC)`; synced.push('INDEX: idx_messages_channel_date') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_channels_awaiting ON support_channels(awaiting_reply) WHERE awaiting_reply = true`; synced.push('INDEX: idx_channels_awaiting') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_channels_unread ON support_channels(unread_count) WHERE unread_count > 0`; synced.push('INDEX: idx_channels_unread') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_commitments_status ON support_commitments(status)`; synced.push('INDEX: idx_commitments_status') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_commitments_due_date ON support_commitments(due_date)`; synced.push('INDEX: idx_commitments_due_date') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_messages_response_time ON support_messages(response_time_ms) WHERE response_time_ms IS NOT NULL`; synced.push('INDEX: idx_messages_response_time') } catch (e) { /* exists */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_conversations_channel ON support_conversations(channel_id)`; synced.push('INDEX: idx_conversations_channel') } catch (e) { /* exists */ }

    // ============ CREATE SEQUENCES ============
    try { await sql`CREATE SEQUENCE IF NOT EXISTS support_case_ticket_seq START WITH 1000`; synced.push('SEQUENCE: support_case_ticket_seq') } catch (e) { /* exists */ }

    return json({
      success: true,
      message: `Schema sync completed`,
      synced: synced.length,
      details: synced,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (e: any) {
    return json({ 
      error: 'Schema sync failed', 
      details: e.message,
      partial: synced,
    }, 500)
  }
}
