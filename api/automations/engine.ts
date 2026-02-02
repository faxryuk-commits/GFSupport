import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Типы триггеров
export type TriggerType = 
  | 'lead_stage_change'
  | 'message_received'
  | 'message_problem_detected'
  | 'media_received'
  | 'escalation_detected'
  | 'case_status_change'

// Типы действий
export type ActionType =
  | 'create_task'
  | 'create_case'
  | 'send_notification'
  | 'assign_manager'
  | 'escalate'
  | 'transcribe_and_analyze'

interface AutomationContext {
  trigger: TriggerType
  data: any
  sql: any
}

// Выполнение действия create_task
async function executeCreateTask(ctx: AutomationContext, config: any): Promise<any> {
  const { data, sql } = ctx
  
  // Формируем заголовок из шаблона
  let title = config.title_template || 'Новая задача'
  title = title
    .replace('{company}', data.company || data.companyName || '')
    .replace('{lead}', data.name || data.leadName || '')
    .replace('{stage}', data.stage || data.toStage || '')

  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  
  // Вычисляем дедлайн
  let dueAt = null
  if (config.due_days) {
    const due = new Date()
    due.setDate(due.getDate() + config.due_days)
    dueAt = due.toISOString()
  }

  await sql`
    INSERT INTO crm_tasks (
      id, lead_id, type, title, description, priority, status, due_at
    ) VALUES (
      ${taskId},
      ${data.leadId || null},
      ${config.task_type || 'follow_up'},
      ${title},
      ${config.description || ''},
      ${config.priority || 'medium'},
      'pending',
      ${dueAt}
    )
  `

  return { taskId, title }
}

// Выполнение действия create_case
async function executeCreateCase(ctx: AutomationContext, config: any): Promise<any> {
  const { data, sql } = ctx
  
  const caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  
  await sql`
    INSERT INTO support_cases (
      id, channel_id, company_id, lead_id, title, description,
      category, priority, status
    ) VALUES (
      ${caseId},
      ${data.channelId || null},
      ${data.companyId || null},
      ${data.leadId || null},
      ${data.title || 'Новый кейс'},
      ${data.description || ''},
      ${data.category || 'general'},
      ${config.priority || 'medium'},
      'detected'
    )
  `

  return { caseId }
}

// Выполнение действия send_notification
async function executeSendNotification(ctx: AutomationContext, config: any): Promise<any> {
  const { data } = ctx
  
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = config.chat_id || process.env.TELEGRAM_SALES_GROUP_ID || process.env.TELEGRAM_CHAT_ID
  
  if (!token || !chatId) {
    return { sent: false, reason: 'No Telegram config' }
  }

  let text = config.message_template || '{event}'
  text = text
    .replace('{company}', data.company || data.companyName || 'N/A')
    .replace('{lead}', data.name || data.leadName || 'N/A')
    .replace('{stage}', data.stage || data.toStage || 'N/A')
    .replace('{event}', data.event || 'Событие')

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    })
    return { sent: true }
  } catch (e) {
    return { sent: false, error: String(e) }
  }
}

// Выполнение действия escalate
async function executeEscalate(ctx: AutomationContext, config: any): Promise<any> {
  const { data, sql } = ctx
  
  const results: any = {}

  // Повышаем приоритет кейса
  if (config.increase_priority && data.caseId) {
    await sql`
      UPDATE support_cases SET
        priority = CASE 
          WHEN priority = 'low' THEN 'medium'
          WHEN priority = 'medium' THEN 'high'
          WHEN priority = 'high' THEN 'urgent'
          ELSE priority
        END,
        updated_at = NOW()
      WHERE id = ${data.caseId}
    `
    results.priorityIncreased = true
  }

  // Уведомляем менеджера
  if (config.notify_manager) {
    // TODO: send notification
    results.managerNotified = true
  }

  return results
}

// Главная функция выполнения автоматизации
export async function executeAutomation(
  automationId: string,
  trigger: TriggerType,
  data: any
): Promise<{ success: boolean; results: any }> {
  const sql = getSQL()
  
  // Получаем автоматизацию
  const autoResult = await sql`
    SELECT * FROM support_automations 
    WHERE id = ${automationId} AND is_active = true
  `
  
  if (!autoResult || autoResult.length === 0) {
    return { success: false, results: { error: 'Automation not found or inactive' } }
  }

  const automation = autoResult[0]
  const actionType = automation.action_type as ActionType
  const actionConfig = automation.action_config || {}
  
  const ctx: AutomationContext = { trigger, data, sql }
  
  let results: any = {}

  try {
    switch (actionType) {
      case 'create_task':
        results = await executeCreateTask(ctx, actionConfig)
        break
      case 'create_case':
        results = await executeCreateCase(ctx, actionConfig)
        break
      case 'send_notification':
        results = await executeSendNotification(ctx, actionConfig)
        break
      case 'escalate':
        results = await executeEscalate(ctx, actionConfig)
        break
      default:
        results = { error: `Unknown action type: ${actionType}` }
    }

    // Обновляем счётчик выполнений
    await sql`
      UPDATE support_automations SET
        executions_count = executions_count + 1,
        last_executed_at = NOW()
      WHERE id = ${automationId}
    `

    return { success: true, results }

  } catch (e: any) {
    return { success: false, results: { error: e.message } }
  }
}

// Найти и выполнить все подходящие автоматизации для триггера
export async function processAutomations(
  trigger: TriggerType,
  data: any
): Promise<{ executed: number; results: any[] }> {
  const sql = getSQL()
  
  // Находим все активные автоматизации для этого триггера
  const automations = await sql`
    SELECT * FROM support_automations 
    WHERE trigger_type = ${trigger} AND is_active = true
    ORDER BY priority DESC
  `

  const results: any[] = []
  let executed = 0

  for (const auto of automations) {
    const triggerConfig = auto.trigger_config || {}
    
    // Проверяем условия триггера
    let shouldExecute = true
    
    if (trigger === 'lead_stage_change') {
      if (triggerConfig.to_stage && data.toStage !== triggerConfig.to_stage) {
        shouldExecute = false
      }
      if (triggerConfig.from_stage && data.fromStage !== triggerConfig.from_stage) {
        shouldExecute = false
      }
    }
    
    if (trigger === 'message_problem_detected') {
      if (triggerConfig.min_urgency && (data.urgency || 0) < triggerConfig.min_urgency) {
        shouldExecute = false
      }
    }

    if (trigger === 'media_received') {
      if (triggerConfig.types && !triggerConfig.types.includes(data.contentType)) {
        shouldExecute = false
      }
      if (triggerConfig.min_duration && (data.duration || 0) < triggerConfig.min_duration) {
        shouldExecute = false
      }
    }

    if (shouldExecute) {
      const result = await executeAutomation(auto.id, trigger, data)
      results.push({ automationId: auto.id, name: auto.name, ...result })
      if (result.success) executed++
    }
  }

  return { executed, results }
}
