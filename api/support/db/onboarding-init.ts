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

  if (req.method === 'GET') {
    try {
      const tables = [
        'onboarding_templates', 'onboarding_template_stages',
        'onboarding_connections', 'onboarding_stages',
        'onboarding_tasks', 'onboarding_comments',
        'onboarding_notification_rules', 'onboarding_sla_rules'
      ]
      const stats: Record<string, any> = {}

      for (const table of tables) {
        try {
          const result = await sql`SELECT COUNT(*) as count FROM ${sql(table)}`
          stats[table] = { count: parseInt(result[0]?.count || '0'), exists: true }
        } catch {
          stats[table] = { exists: false }
        }
      }

      return json({ tables: stats })
    } catch (e: any) {
      return json({ error: e.message }, 500)
    }
  }

  if (req.method !== 'POST') {
    return json({ error: 'Use POST to initialize onboarding tables' }, 405)
  }

  try {
    const created: string[] = []

    // 1. Шаблоны подключений
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_templates (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        total_days INT DEFAULT 14,
        roles JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_templates')

    // 2. Этапы шаблона
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_template_stages (
        id VARCHAR(64) PRIMARY KEY,
        template_id VARCHAR(64) NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        planned_days INT DEFAULT 1,
        default_role VARCHAR(100),
        items JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_template_stages')

    await sql`CREATE INDEX IF NOT EXISTS idx_template_stages_template ON onboarding_template_stages(template_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_template_stages_order ON onboarding_template_stages(template_id, sort_order)`

    // 3. Подключения (основная сущность)
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_connections (
        id VARCHAR(64) PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        client_contact VARCHAR(255),
        client_phone VARCHAR(50),
        template_id VARCHAR(64) REFERENCES onboarding_templates(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'frozen', 'cancelled', 'launched')),
        pause_reason TEXT,
        manager_id VARCHAR(64),
        team JSONB DEFAULT '{}',
        current_stage_id VARCHAR(64),
        planned_deadline DATE,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        created_by VARCHAR(64),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_connections')

    await sql`CREATE INDEX IF NOT EXISTS idx_connections_status ON onboarding_connections(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_connections_manager ON onboarding_connections(manager_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_connections_created ON onboarding_connections(created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS idx_connections_deadline ON onboarding_connections(planned_deadline)`

    // 4. Этапы конкретного подключения
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_stages (
        id VARCHAR(64) PRIMARY KEY,
        connection_id VARCHAR(64) NOT NULL REFERENCES onboarding_connections(id) ON DELETE CASCADE,
        template_stage_id VARCHAR(64),
        name VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        planned_days INT DEFAULT 1,
        assigned_role VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_stages')

    await sql`CREATE INDEX IF NOT EXISTS idx_stages_connection ON onboarding_stages(connection_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_stages_status ON onboarding_stages(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_stages_order ON onboarding_stages(connection_id, sort_order)`

    // 5. Задачи (подпункты чек-листа)
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_tasks (
        id VARCHAR(64) PRIMARY KEY,
        stage_id VARCHAR(64) NOT NULL REFERENCES onboarding_stages(id) ON DELETE CASCADE,
        connection_id VARCHAR(64) NOT NULL REFERENCES onboarding_connections(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        assigned_role VARCHAR(100),
        assigned_agent_id VARCHAR(64),
        status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'waiting_client', 'waiting_partner', 'completed')),
        note TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_tasks')

    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_stage ON onboarding_tasks(stage_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_connection ON onboarding_tasks(connection_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON onboarding_tasks(assigned_agent_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON onboarding_tasks(status)`

    // 6. Комментарии
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_comments (
        id VARCHAR(64) PRIMARY KEY,
        connection_id VARCHAR(64) NOT NULL REFERENCES onboarding_connections(id) ON DELETE CASCADE,
        agent_id VARCHAR(64),
        text TEXT NOT NULL,
        is_system BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_comments')

    await sql`CREATE INDEX IF NOT EXISTS idx_comments_connection ON onboarding_comments(connection_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_comments_created ON onboarding_comments(connection_id, created_at DESC)`

    // 7. Правила уведомлений
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_notification_rules (
        id VARCHAR(64) PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        recipient_type VARCHAR(50) NOT NULL,
        channel VARCHAR(30) DEFAULT 'telegram',
        delay_days INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_notification_rules')

    // 8. Правила SLA и эскалации
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_sla_rules (
        id VARCHAR(64) PRIMARY KEY,
        trigger_type VARCHAR(100) NOT NULL,
        delay_days INT DEFAULT 0,
        action VARCHAR(100) NOT NULL,
        recipient_type VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    created.push('onboarding_sla_rules')

    // Дефолтные правила уведомлений
    const defaultNotifications = [
      { id: 'notif_task_assigned', event_type: 'task_assigned', recipient_type: 'assignee', channel: 'telegram', delay_days: 0 },
      { id: 'notif_stage_overdue', event_type: 'stage_overdue', recipient_type: 'assignee_and_manager', channel: 'telegram', delay_days: 0 },
      { id: 'notif_client_waiting', event_type: 'client_waiting', recipient_type: 'manager', channel: 'telegram', delay_days: 3 },
      { id: 'notif_client_remind', event_type: 'client_waiting', recipient_type: 'client', channel: 'telegram', delay_days: 2 },
      { id: 'notif_connection_overdue', event_type: 'connection_overdue', recipient_type: 'supervisor', channel: 'telegram', delay_days: 0 },
      { id: 'notif_task_completed', event_type: 'task_completed', recipient_type: 'manager', channel: 'telegram', delay_days: 0 },
      { id: 'notif_comment_mention', event_type: 'comment_mention', recipient_type: 'mentioned', channel: 'telegram', delay_days: 0 },
      { id: 'notif_weekly_report', event_type: 'weekly_report', recipient_type: 'supervisor', channel: 'telegram', delay_days: 0 },
    ]

    for (const n of defaultNotifications) {
      await sql`
        INSERT INTO onboarding_notification_rules (id, event_type, recipient_type, channel, delay_days)
        VALUES (${n.id}, ${n.event_type}, ${n.recipient_type}, ${n.channel}, ${n.delay_days})
        ON CONFLICT (id) DO NOTHING
      `
    }

    // Дефолтные правила SLA
    const defaultSLA = [
      { id: 'sla_stage_started', trigger_type: 'stage_started', delay_days: 0, action: 'notify_assignee', recipient_type: 'assignee' },
      { id: 'sla_before_deadline', trigger_type: 'before_stage_deadline', delay_days: 1, action: 'remind_assignee', recipient_type: 'assignee' },
      { id: 'sla_overdue_1d', trigger_type: 'stage_overdue', delay_days: 1, action: 'notify_manager', recipient_type: 'manager' },
      { id: 'sla_overdue_3d', trigger_type: 'stage_overdue', delay_days: 3, action: 'escalate_supervisor', recipient_type: 'supervisor' },
      { id: 'sla_overdue_7d', trigger_type: 'stage_overdue', delay_days: 7, action: 'auto_freeze', recipient_type: 'all_team' },
    ]

    for (const s of defaultSLA) {
      await sql`
        INSERT INTO onboarding_sla_rules (id, trigger_type, delay_days, action, recipient_type)
        VALUES (${s.id}, ${s.trigger_type}, ${s.delay_days}, ${s.action}, ${s.recipient_type})
        ON CONFLICT (id) DO NOTHING
      `
    }

    // Дефолтный шаблон «Полный пакет»
    const templateId = 'tpl_full_package'
    await sql`
      INSERT INTO onboarding_templates (id, name, description, total_days, roles)
      VALUES (
        ${templateId},
        'Полный пакет',
        'Полное подключение: все каналы, логистика, касса, платежи, обучение',
        14,
        ${JSON.stringify([
          { id: 'manager', name: 'Менеджер', color: '#3B82F6' },
          { id: 'setup', name: 'Настройка', color: '#10B981' },
          { id: 'integrations', name: 'Интеграции', color: '#8B5CF6' },
          { id: 'content', name: 'Контент', color: '#F59E0B' },
          { id: 'mobile', name: 'Мобильные', color: '#06B6D4' },
          { id: 'training', name: 'Обучение', color: '#EC4899' },
        ])}
      )
      ON CONFLICT (id) DO NOTHING
    `

    const stages = [
      {
        id: 'stpl_contract', name: 'Договор и доступы', sort_order: 1, planned_days: 1,
        default_role: 'manager', items: []
      },
      {
        id: 'stpl_channels', name: 'Каналы продаж', sort_order: 2, planned_days: 3,
        default_role: 'setup',
        items: [
          { name: 'Сайт', role: 'setup' },
          { name: 'Telegram-бот', role: 'setup' },
          { name: 'Приложение', role: 'mobile' },
          { name: 'QR-меню', role: 'setup' },
          { name: 'Киоск', role: 'setup' },
          { name: 'Колл-центр', role: 'setup' },
          { name: 'Агрегаторы', role: 'integrations' },
        ]
      },
      {
        id: 'stpl_logistics', name: 'Логистика и зоны', sort_order: 3, planned_days: 2,
        default_role: 'integrations',
        items: [
          { name: 'Курьерское приложение', role: 'integrations' },
          { name: 'Сторонние доставки', role: 'integrations' },
          { name: 'Карты', role: 'integrations' },
          { name: 'Зоны доставки', role: 'integrations' },
          { name: 'Условия доставки', role: 'integrations' },
        ]
      },
      {
        id: 'stpl_pos', name: 'Касса и меню', sort_order: 4, planned_days: 3,
        default_role: 'content',
        items: [
          { name: 'Касса подключена', role: 'integrations' },
          { name: 'Меню загружено', role: 'content' },
          { name: 'Стоп-листы', role: 'content' },
          { name: 'Контент проверен', role: 'content' },
        ]
      },
      {
        id: 'stpl_payments', name: 'Платежи', sort_order: 5, planned_days: 2,
        default_role: 'integrations',
        items: [
          { name: 'Онлайн-платежи', role: 'integrations' },
          { name: 'Эквайринг', role: 'integrations' },
        ]
      },
      {
        id: 'stpl_launch', name: 'Тест и запуск', sort_order: 6, planned_days: 1,
        default_role: 'training',
        items: []
      },
    ]

    for (const s of stages) {
      await sql`
        INSERT INTO onboarding_template_stages (id, template_id, name, sort_order, planned_days, default_role, items)
        VALUES (${s.id}, ${templateId}, ${s.name}, ${s.sort_order}, ${s.planned_days}, ${s.default_role}, ${JSON.stringify(s.items)})
        ON CONFLICT (id) DO NOTHING
      `
    }

    return json({
      success: true,
      message: 'Onboarding tables initialized',
      tables: created,
      notifications: defaultNotifications.length,
      sla_rules: defaultSLA.length,
      templates: 1
    })

  } catch (e: any) {
    return json({ error: 'Onboarding init failed', details: e.message }, 500)
  }
}
