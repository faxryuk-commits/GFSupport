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
  const sql = getSQL()

  // GET ?status=true — проверка статуса таблиц
  if (req.method === 'GET' && url.searchParams.get('status') === 'true') {
    try {
      const tables = ['support_channels', 'support_cases', 'support_messages', 'support_automations']
      const stats: Record<string, any> = {}
      
      const tableQueries: Record<string, () => Promise<unknown[]>> = {
        support_channels: () => sql`SELECT COUNT(*) as count FROM support_channels`,
        support_cases: () => sql`SELECT COUNT(*) as count FROM support_cases`,
        support_messages: () => sql`SELECT COUNT(*) as count FROM support_messages`,
        support_automations: () => sql`SELECT COUNT(*) as count FROM support_automations`,
      }
      for (const table of tables) {
        try {
          const result = await tableQueries[table]()
          const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? []
          stats[table] = { count: parseInt((rows[0] as { count?: string })?.count || '0'), exists: true }
        } catch (e: any) {
          stats[table] = { exists: false, error: e.message?.slice(0, 100) }
        }
      }
      
      return json({ tables: stats })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method !== 'POST') {
    return json({ error: 'Use POST to initialize tables' }, 405)
  }

  try {
    const created: string[] = []

    // 1. Support Channels (Telegram группы)
    await sql`
      CREATE TABLE IF NOT EXISTS support_channels (
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
        last_message_at TIMESTAMP,
        CONSTRAINT fk_channel_company FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL
      )
    `
    created.push('support_channels')

    // Индексы для channels
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_telegram ON support_channels(telegram_chat_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_company ON support_channels(company_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_type ON support_channels(type)`

    // 2. Support Cases (Кейсы поддержки)
    await sql`
      CREATE TABLE IF NOT EXISTS support_cases (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(50),
        company_id VARCHAR(50),
        lead_id VARCHAR(50),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(30) DEFAULT 'detected',
        category VARCHAR(100),
        subcategory VARCHAR(100),
        root_cause VARCHAR(255),
        priority VARCHAR(20) DEFAULT 'medium',
        severity VARCHAR(20) DEFAULT 'normal',
        assigned_to VARCHAR(50),
        first_response_at TIMESTAMP,
        resolved_at TIMESTAMP,
        resolution_time_minutes INTEGER,
        resolution_notes TEXT,
        impact_mrr DECIMAL(10,2) DEFAULT 0,
        churn_risk_score INTEGER DEFAULT 0,
        is_recurring BOOLEAN DEFAULT false,
        related_case_id VARCHAR(50),
        tags TEXT[],
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT fk_case_channel FOREIGN KEY (channel_id) REFERENCES support_channels(id) ON DELETE SET NULL,
        CONSTRAINT fk_case_company FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL,
        CONSTRAINT fk_case_assignee FOREIGN KEY (assigned_to) REFERENCES crm_managers(id) ON DELETE SET NULL
      )
    `
    created.push('support_cases')

    // Индексы для cases
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_status ON support_cases(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_channel ON support_cases(channel_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_company ON support_cases(company_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_assigned ON support_cases(assigned_to)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_priority ON support_cases(priority)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cases_created ON support_cases(created_at DESC)`

    // 3. Support Messages (Сообщения из групп)
    await sql`
      CREATE TABLE IF NOT EXISTS support_messages (
        id VARCHAR(50) PRIMARY KEY,
        channel_id VARCHAR(50) NOT NULL,
        case_id VARCHAR(50),
        telegram_message_id BIGINT,
        sender_id BIGINT,
        sender_name VARCHAR(255),
        sender_username VARCHAR(100),
        is_from_client BOOLEAN DEFAULT true,
        content_type VARCHAR(30) DEFAULT 'text',
        text_content TEXT,
        media_url VARCHAR(500),
        media_file_id VARCHAR(255),
        transcript TEXT,
        transcript_language VARCHAR(10),
        ai_summary TEXT,
        ai_category VARCHAR(100),
        ai_sentiment VARCHAR(20),
        ai_intent VARCHAR(100),
        ai_urgency INTEGER DEFAULT 0,
        ai_extracted_entities JSONB DEFAULT '{}',
        is_problem BOOLEAN DEFAULT false,
        is_processed BOOLEAN DEFAULT false,
        reply_to_message_id BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        CONSTRAINT fk_message_channel FOREIGN KEY (channel_id) REFERENCES support_channels(id) ON DELETE CASCADE,
        CONSTRAINT fk_message_case FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE SET NULL
      )
    `
    created.push('support_messages')

    // Индексы для messages
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_channel ON support_messages(channel_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_case ON support_messages(case_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_telegram ON support_messages(telegram_message_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON support_messages(created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_problem ON support_messages(is_problem) WHERE is_problem = true`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_content_type ON support_messages(content_type)`

    // 4. Support Automations (Правила автоматизации)
    await sql`
      CREATE TABLE IF NOT EXISTS support_automations (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB NOT NULL DEFAULT '{}',
        action_type VARCHAR(50) NOT NULL,
        action_config JSONB NOT NULL DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 0,
        executions_count INTEGER DEFAULT 0,
        last_executed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('support_automations')

    // 5. Support Case Activities (История действий по кейсу)
    await sql`
      CREATE TABLE IF NOT EXISTS support_case_activities (
        id VARCHAR(50) PRIMARY KEY,
        case_id VARCHAR(50) NOT NULL,
        manager_id VARCHAR(50),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        description TEXT,
        from_status VARCHAR(30),
        to_status VARCHAR(30),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT fk_activity_case FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE,
        CONSTRAINT fk_activity_manager FOREIGN KEY (manager_id) REFERENCES crm_managers(id) ON DELETE SET NULL
      )
    `
    created.push('support_case_activities')

    // 6. Support Invites (Приглашения для регистрации сотрудников)
    await sql`
      CREATE TABLE IF NOT EXISTS support_invites (
        id VARCHAR(50) PRIMARY KEY,
        token VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255),
        role VARCHAR(20) DEFAULT 'agent',
        created_by VARCHAR(50),
        used_at TIMESTAMP,
        used_by VARCHAR(50),
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('support_invites')

    // Создаём дефолтные автоматизации
    const defaultAutomations = [
      {
        id: 'auto_won_onboarding',
        name: 'Won Lead → Onboarding Task',
        description: 'Создаёт задачу на онбординг когда лид переходит в статус "won"',
        trigger_type: 'lead_stage_change',
        trigger_config: { to_stage: 'won' },
        action_type: 'create_task',
        action_config: { 
          title_template: 'Онбординг: {company}',
          task_type: 'onboarding',
          priority: 'high',
          due_days: 1
        }
      },
      {
        id: 'auto_problem_case',
        name: 'Problem Message → Support Case',
        description: 'Создаёт кейс поддержки при обнаружении проблемы в сообщении',
        trigger_type: 'message_problem_detected',
        trigger_config: { min_urgency: 3 },
        action_type: 'create_case',
        action_config: {
          auto_assign: true,
          notify_channel: true
        }
      },
      {
        id: 'auto_voice_transcript',
        name: 'Voice/Video → Transcript + Summary',
        description: 'Транскрибирует голосовые и видео, создаёт резюме',
        trigger_type: 'media_received',
        trigger_config: { types: ['voice', 'video_note', 'video'], min_duration: 5 },
        action_type: 'transcribe_and_analyze',
        action_config: {
          create_case_if_problem: true
        }
      },
      {
        id: 'auto_escalation',
        name: 'Escalation Alert',
        description: 'Эскалация при повторном обращении или негативе',
        trigger_type: 'escalation_detected',
        trigger_config: { repeat_hours: 48, negative_sentiment: true },
        action_type: 'escalate',
        action_config: {
          increase_priority: true,
          notify_manager: true
        }
      }
    ]

    for (const auto of defaultAutomations) {
      await sql`
        INSERT INTO support_automations (id, name, description, trigger_type, trigger_config, action_type, action_config)
        VALUES (${auto.id}, ${auto.name}, ${auto.description}, ${auto.trigger_type}, ${JSON.stringify(auto.trigger_config)}, ${auto.action_type}, ${JSON.stringify(auto.action_config)})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          trigger_config = EXCLUDED.trigger_config,
          action_config = EXCLUDED.action_config,
          updated_at = NOW()
      `
    }

    return json({
      success: true,
      message: 'Support tables initialized',
      tables: created,
      automations: defaultAutomations.length
    })

  } catch (e: any) {
    return json({ error: 'Init failed', details: e.message }, 500)
  }
}
