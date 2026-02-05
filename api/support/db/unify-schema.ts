import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })

export async function GET() {
  try {
    const sql = getSQL()
    const results: string[] = []

    // 1. Унификация типов ID (все VARCHAR(64))
    // Пропускаем - слишком рискованно менять типы на продакшене

    // 2. Добавление Foreign Keys (если не существуют)
    const fkDefinitions = [
      // messages -> channels
      {
        name: 'fk_messages_channel',
        table: 'support_messages',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // messages -> cases
      {
        name: 'fk_messages_case',
        table: 'support_messages',
        column: 'case_id',
        refTable: 'support_cases',
        refColumn: 'id',
        onDelete: 'SET NULL'
      },
      // cases -> channels (already exists as fk_case_channel)
      // case_activities -> cases
      {
        name: 'fk_case_activities_case',
        table: 'support_case_activities',
        column: 'case_id',
        refTable: 'support_cases',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // topics -> channels
      {
        name: 'fk_topics_channel',
        table: 'support_topics',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // conversations -> channels
      {
        name: 'fk_conversations_channel',
        table: 'support_conversations',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // reactions -> messages
      {
        name: 'fk_reactions_message',
        table: 'support_reactions',
        column: 'message_id',
        refTable: 'support_messages',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // commitments -> channels
      {
        name: 'fk_commitments_channel',
        table: 'support_commitments',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // reminders -> channels
      {
        name: 'fk_reminders_channel',
        table: 'support_reminders',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // solutions -> cases
      {
        name: 'fk_solutions_case',
        table: 'support_solutions',
        column: 'case_id',
        refTable: 'support_cases',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // dialogs -> channels
      {
        name: 'fk_dialogs_channel',
        table: 'support_dialogs',
        column: 'channel_id',
        refTable: 'support_channels',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
      // agent_activity -> agents
      {
        name: 'fk_agent_activity_agent',
        table: 'support_agent_activity',
        column: 'agent_id',
        refTable: 'support_agents',
        refColumn: 'id',
        onDelete: 'CASCADE'
      },
    ]

    for (const fk of fkDefinitions) {
      try {
        // Check if FK exists
        const exists = await sql`
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = ${fk.name}
          AND table_name = ${fk.table}
        `
        
        if (exists.length === 0) {
          // Add FK
          await sql.unsafe(`
            ALTER TABLE ${fk.table} 
            ADD CONSTRAINT ${fk.name} 
            FOREIGN KEY (${fk.column}) 
            REFERENCES ${fk.refTable}(${fk.refColumn})
            ON DELETE ${fk.onDelete}
          `)
          results.push(`Added FK: ${fk.name}`)
        } else {
          results.push(`FK exists: ${fk.name}`)
        }
      } catch (e: any) {
        // FK might fail if orphan data exists
        results.push(`FK ${fk.name} failed: ${e.message?.slice(0, 100)}`)
      }
    }

    // 3. Добавление недостающих индексов
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_messages_channel_date ON support_messages(channel_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_unread ON support_messages(channel_id, is_read) WHERE is_read = false',
      'CREATE INDEX IF NOT EXISTS idx_cases_status_active ON support_cases(status) WHERE status NOT IN (\'resolved\', \'closed\')',
      'CREATE INDEX IF NOT EXISTS idx_cases_assignee ON support_cases(assignee_id) WHERE assignee_id IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_channels_unread ON support_channels(unread_count) WHERE unread_count > 0',
      'CREATE INDEX IF NOT EXISTS idx_agent_activity_date ON support_agent_activity(agent_id, created_at DESC)',
    ]

    for (const idx of indexes) {
      try {
        await sql.unsafe(idx)
        results.push(`Index created: ${idx.match(/idx_\w+/)?.[0] || 'unknown'}`)
      } catch (e: any) {
        results.push(`Index exists or failed: ${e.message?.slice(0, 50)}`)
      }
    }

    // 4. Очистка orphan данных (опционально, закомментировано)
    /*
    await sql`DELETE FROM support_messages WHERE channel_id NOT IN (SELECT id FROM support_channels)`
    await sql`DELETE FROM support_case_activities WHERE case_id NOT IN (SELECT id FROM support_cases)`
    */

    return json({
      success: true,
      message: 'Schema unification completed',
      results,
      totalFKs: fkDefinitions.length,
      totalIndexes: indexes.length
    })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
