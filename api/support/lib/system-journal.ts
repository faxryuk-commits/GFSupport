/**
 * Хроника системы: любое действие автомата оставляет видимый след.
 *
 * Правило продукта: если система или ИИ что-то сделали, человек должен уметь
 * увидеть — что, как и когда. Половина машинерии и так пишет следы в свои
 * таблицы (решения агента, инциденты, задачи, синк Amo); хроника собирает их
 * в одну ленту и даёт место для событий, у которых своей таблицы нет
 * (проходы учителя, отправка сверки, разметка тем).
 *
 * В system_events пишутся только СОБЫТИЯ — то, что произошло. Пустые проходы
 * кронов («проверил, ничего нет») не пишутся: хроника, где 700 строк «ничего»,
 * прячет 3 строки «что-то».
 */

const SCHEMA_KEY = 'system_events_schema'
const SCHEMA_VERSION = '2026-08-23.1'
let ensured = false

export async function ensureJournalSchema(sql: any): Promise<void> {
  if (ensured) return
  const [row] = await sql`SELECT value FROM support_platform_settings WHERE key = ${SCHEMA_KEY}`
  if (row?.value === SCHEMA_VERSION) { ensured = true; return }

  await sql`
    CREATE TABLE IF NOT EXISTS system_events (
      id BIGSERIAL PRIMARY KEY,
      actor VARCHAR(60) NOT NULL,
      action VARCHAR(60) NOT NULL,
      summary TEXT NOT NULL,
      ref VARCHAR(200),
      meta JSONB,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_system_events_at ON system_events(at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_system_events_actor ON system_events(actor, at DESC)`
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${SCHEMA_KEY}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  ensured = true
}

/** Записать событие. Тихая: хроника не должна ломать работу, которую описывает. */
export async function logEvent(sql: any, actor: string, action: string, summary: string,
  ref?: string | null, meta?: Record<string, unknown>): Promise<void> {
  try {
    await ensureJournalSchema(sql)
    await sql`
      INSERT INTO system_events (actor, action, summary, ref, meta)
      VALUES (${actor.slice(0, 60)}, ${action.slice(0, 60)}, ${summary.slice(0, 500)},
              ${ref ? ref.slice(0, 200) : null}, ${meta ? JSON.stringify(meta) : null}::jsonb)
    `
  } catch (e) {
    console.error('[journal] event lost:', actor, action, e)
  }
}

/**
 * Единая лента: события + следы, которые автоматика уже оставляет в своих
 * таблицах. Источники объединяются в SQL, чтобы не таскать четыре списка
 * на клиент и не сортировать их там.
 */
export async function fetchJournal(sql: any, orgId: string, limit = 120): Promise<any[]> {
  await ensureJournalSchema(sql)
  return sql`
    (
      SELECT at, actor, action, summary, ref FROM system_events
      ORDER BY at DESC LIMIT ${limit}
    )
    UNION ALL
    (
      SELECT d.created_at AS at, 'AI-агент' AS actor, d.action,
             COALESCE(d.channel_name, '') || ': «' || LEFT(COALESCE(d.incoming_message, ''), 70)
               || '» → ' || LEFT(COALESCE(d.reply_text, d.case_title, d.tag_agent_name, '—'), 90) AS summary,
             d.channel_id AS ref
      FROM support_agent_decisions d
      WHERE d.org_id = ${orgId}
      ORDER BY d.created_at DESC LIMIT ${limit}
    )
    UNION ALL
    (
      SELECT i.first_seen AS at, 'Сводка аварий' AS actor, 'инцидент открыт' AS action,
             i.system || ': ' || LEFT(COALESCE(i.title, i.kind), 90)
               || ' (' || COALESCE(i.source_ref, i.kind) || ')' AS summary,
             i.id AS ref
      FROM system_incidents i ORDER BY i.first_seen DESC LIMIT 40
    )
    UNION ALL
    (
      SELECT i.resolved_at AS at, 'Сводка аварий' AS actor, 'инцидент закрыт' AS action,
             i.system || ': ' || LEFT(COALESCE(i.title, i.kind), 90)
               || ' · повторов ' || i.count AS summary,
             i.id AS ref
      FROM system_incidents i WHERE i.resolved_at IS NOT NULL
      ORDER BY i.resolved_at DESC LIMIT 40
    )
    UNION ALL
    (
      SELECT w.confirmed_at AS at, 'Сверка задач' AS actor, 'подтверждена' AS action,
             COALESCE(w.client_name, '') || ' — ' || LEFT(COALESCE(w.title, ''), 80)
               || ' (' || COALESCE(w.owner_name, '') || ')' AS summary,
             w.id AS ref
      FROM work_items w
      WHERE w.org_id = ${orgId} AND w.confirmed_at IS NOT NULL
      ORDER BY w.confirmed_at DESC LIMIT 40
    )
    UNION ALL
    (
      SELECT g.created_at AS at, 'SLA-страж' AS actor, COALESCE(g.kind, 'алерт') AS action,
             COALESCE(g.channel_name, '') || ': ' || LEFT(COALESCE(g.reasoning, ''), 110) AS summary,
             NULL AS ref
      FROM support_ai_events g
      -- только события, не пульс: cycle/triage/detect — 50К строк «проверил, ничего»
      WHERE g.org_id = ${orgId} AND g.kind IN ('alert', 'solution_card', 'incident')
      ORDER BY g.created_at DESC LIMIT 40
    )
    UNION ALL
    (
      SELECT e.changed_at AS at, 'Синк Amo' AS actor, 'этап сделки' AS action,
             COALESCE(d2.title, e.deal_id) || ': ' || REPLACE(e.changed_by, 'синхронизация с Amo: ', '→ ') AS summary,
             e.deal_id AS ref
      FROM sales_deal_events e
      LEFT JOIN sales_deals d2 ON d2.id = e.deal_id
      WHERE e.org_id = ${orgId} AND e.changed_by LIKE 'синхронизация с Amo%'
      ORDER BY e.changed_at DESC LIMIT 40
    )
    ORDER BY at DESC
    LIMIT ${limit}
  `
}
