import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureWorkSchema } from '../lib/work-items.js'

export const config = { runtime: 'edge' }

/**
 * Рабочее пространство сотрудника: всё, что касается лично меня, на одном
 * экране. Где меня упомянули и я не ответил, мои задачи, мои тикеты, кому я
 * пообещал, мои шаги онбординга.
 *
 * Смысл экрана — не отчётность, а разгрузка головы: сотрудник держит этот
 * список в памяти, и любая забытая позиция всплывает разговором «ну я же
 * просил». Здесь список держит система.
 *
 * Упоминания: своего telegram-username мы у агента не храним, но он есть в
 * каждом его сообщении (sender_username). Берём самый частый — и ищем
 * клиентские сообщения с «@username». Ответом считается любое сообщение
 * команды в канале после упоминания.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureWorkSchema(sql)

  const [me] = await sql`
    SELECT id, name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1
  ` as any[]
  if (!me) return json({ error: 'agent not found' }, 404)

  // Мой username в мессенджерах — из моих же исходящих сообщений
  const unameRows = await sql`
    SELECT sender_username, COUNT(*)::int c FROM support_messages
    WHERE is_from_client = false AND sender_name = ${me.name}
      AND sender_username IS NOT NULL AND sender_username <> ''
      AND created_at > NOW() - INTERVAL '60 days'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 3
  ` as any[]
  const usernames = (unameRows as any[]).map(r => String(r.sender_username).replace(/^@/, ''))
  const mentionPattern = usernames.length
    ? usernames.map(u => `%@${u}%`)
    : ['%@__нет_username__%']

  const [mentions, items, cases, commitments, onboarding] = await sql.transaction([
    // Упоминания за неделю; «без ответа» = после упоминания команда в канале молчит
    sql`
      SELECT m.id, m.text_content, m.sender_name, m.created_at,
             ch.id AS channel_id, ch.name AS channel_name,
             NOT EXISTS (
               SELECT 1 FROM support_messages t
               WHERE t.channel_id = m.channel_id AND t.is_from_client = false
                 AND t.created_at > m.created_at
             ) AS unanswered
      FROM support_messages m
      JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
      WHERE m.is_from_client = true
        AND m.created_at > NOW() - INTERVAL '7 days'
        AND m.text_content ILIKE ANY(${mentionPattern})
      ORDER BY m.created_at DESC LIMIT 25
    `,
    // Мои задачи из учёта работы
    sql`
      SELECT id, title, client_name, status, started_at, active_minutes, reopened_count
      FROM work_items
      WHERE org_id = ${orgId} AND owner_agent_id = ${ctx.agentId}
        AND status IN ('phantom', 'in_progress', 'awaiting_confirm')
      ORDER BY started_at DESC LIMIT 15
    `,
    // Мои тикеты
    sql`
      SELECT id, ticket_number, title, status, created_at,
             ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)::int AS hours_open
      FROM support_cases
      WHERE org_id = ${orgId} AND assigned_to = ${ctx.agentId}
        AND resolved_at IS NULL AND status NOT IN ('closed', 'cancelled')
      ORDER BY created_at LIMIT 15
    `,
    // Мои обещания: кому, что и когда истекает
    sql`
      SELECT sc.id, sc.commitment_text, sc.due_date, sc.status, sc.created_at,
             ch.name AS channel_name, ch.id AS channel_id
      FROM support_commitments sc
      LEFT JOIN support_channels ch ON ch.id = sc.channel_id
      WHERE sc.org_id = ${orgId} AND sc.agent_id = ${ctx.agentId}
        AND sc.status IN ('pending', 'overdue')
      ORDER BY sc.due_date NULLS LAST LIMIT 15
    `,
    // Мои шаги онбординга
    sql`
      SELECT t.id, tt.label AS step, b.name AS brand, s.label AS status, s.kind, t.status_since
      FROM onboarding_tasks t
      JOIN onboarding_task_types tt ON tt.id = t.task_type_id
      JOIN onboarding_brands b ON b.id = t.brand_id AND b.archived_at IS NULL
      JOIN onboarding_statuses s ON s.id = t.status_id
      WHERE t.org_id = ${orgId} AND t.assignee_id = ${ctx.agentId}
        AND s.kind IN ('todo', 'active', 'waiting')
      ORDER BY t.status_since LIMIT 15
    `,
  ]) as any[]

  // Итог недели — чтобы экран показывал не только долги, но и сделанное
  const [week] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM work_items WHERE org_id = ${orgId}
        AND owner_agent_id = ${ctx.agentId} AND status = 'confirmed'
        AND confirmed_at > NOW() - INTERVAL '7 days') AS confirmed_week,
      (SELECT COUNT(*)::int FROM support_cases WHERE org_id = ${orgId}
        AND assigned_to = ${ctx.agentId} AND resolved_at > NOW() - INTERVAL '7 days') AS cases_week,
      (SELECT COUNT(*)::int FROM support_commitments WHERE org_id = ${orgId}
        AND agent_id = ${ctx.agentId} AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '7 days') AS kept_week
  ` as any[]

  return json({
    me: { id: me.id, name: me.name, usernames },
    mentions,
    unansweredMentions: (mentions as any[]).filter(m => m.unanswered).length,
    workItems: items,
    cases,
    commitments,
    onboarding,
    week: week || {},
  })
}
