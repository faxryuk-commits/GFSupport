import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'
import { fetchTeamFrtAggregate } from '../lib/team-frt-aggregate.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/workload?days=30
 *
 * Таблица загрузки сотрудников поддержки. ЧЕСТНЫЕ ПРОКСИ, а не «реальные часы»:
 *  - messages/chars     — объём переписки с клиентами (измерено точно)
 *  - casesTouched       — тикеты, в чей канал агент писал в окно жизни тикета
 *                         (m.case_id не заполняется — 0 покрытия, поэтому через канал)
 *  - activeDays         — календарные дни (Ташкент) хотя бы с одним сообщением
 *  - frtAvgMinutes      — средняя скорость первого ответа (reuse team-frt-aggregate)
 *  - appHours           — реконструкция из heartbeat-логов вкладки (45с тики):
 *                         сумма промежутков < 5 мин. Время с ОТКРЫТОЙ ВКЛАДКОЙ,
 *                         не «время на клиенте»: кто работает из Telegram (Фирдавс,
 *                         Насиба) здесь почти невидим — колонки читать ВМЕСТЕ.
 *
 * Дубли аккаунтов схлопываются по support_agents.merged_into (Migration 44).
 */

interface WorkloadRow {
  id: string | null
  name: string
  role: string | null
  messages: number
  chars: number
  mediaMessages: number
  channels: number
  activeDays: number
  casesTouched: number
  frtAvgMinutes: number | null
  frtResponses: number
  appHours: number | null
}

export default async function handler(req: Request) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const orgId = await getRequestOrgId(req)
  if (!orgId) return json({ error: 'Unauthorized' }, 401)

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30))

  const sql = getSQL()

  try {
    // Самодостаточность: колонка появляется в Migration 44, но эндпоинт не должен
    // падать, если задеплоился раньше прогона миграции
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS merged_into VARCHAR(50)`.catch(() => {})

    // Канонический агент для сообщения: LATERAL + LIMIT 1 с приоритетом матчей,
    // иначе OR-join даёт фанаут (sender матчится и по telegram_id одной строки,
    // и по имени другой — сообщение посчиталось бы дважды).
    const [agents, msgAgg, caseAgg, heartbeat, frt] = await Promise.all([
      sql`
        SELECT id, name, role, merged_into
        FROM support_agents
        WHERE org_id = ${orgId}
      `,
      sql`
        WITH team_msgs AS (
          SELECT m.id, m.channel_id, m.created_at, m.text_content, m.content_type,
                 ag.canonical_id
          FROM support_messages m
          LEFT JOIN LATERAL (
            SELECT COALESCE(ra.merged_into, ra.id) AS canonical_id
            FROM support_agents ra
            WHERE ra.org_id = ${orgId} AND (
              ra.telegram_id::text = m.sender_id::text
              OR ra.id::text = m.sender_id::text
              OR (m.sender_username IS NOT NULL AND LOWER(ra.username) = LOWER(m.sender_username))
              OR LOWER(ra.name) = LOWER(m.sender_name)
            )
            ORDER BY (ra.telegram_id::text = m.sender_id::text) DESC,
                     (ra.id::text = m.sender_id::text) DESC,
                     (LOWER(ra.username) = LOWER(COALESCE(m.sender_username, ''))) DESC
            LIMIT 1
          ) ag ON true
          WHERE m.org_id = ${orgId}
            AND m.created_at > NOW() - INTERVAL '1 day' * ${days}
            AND m.sender_role IN ('support', 'team', 'agent')
            AND m.is_from_client = false
        )
        SELECT
          canonical_id,
          COUNT(*)::int AS msgs,
          COALESCE(SUM(LENGTH(text_content)), 0)::int AS chars,
          COUNT(*) FILTER (WHERE content_type IS NOT NULL AND content_type <> 'text')::int AS media,
          COUNT(DISTINCT ((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date))::int AS active_days,
          COUNT(DISTINCT channel_id)::int AS channels
        FROM team_msgs
        GROUP BY canonical_id
      `,
      sql`
        SELECT ag.canonical_id, COUNT(DISTINCT c.id)::int AS cases
        FROM support_cases c
        JOIN support_messages m ON m.channel_id = c.channel_id
          AND m.org_id = ${orgId}
          AND m.sender_role IN ('support', 'team', 'agent')
          AND m.is_from_client = false
          AND m.created_at >= c.created_at
          AND m.created_at <= COALESCE(c.resolved_at, NOW()) + INTERVAL '1 hour'
        LEFT JOIN LATERAL (
          SELECT COALESCE(ra.merged_into, ra.id) AS canonical_id
          FROM support_agents ra
          WHERE ra.org_id = ${orgId} AND (
            ra.telegram_id::text = m.sender_id::text
            OR ra.id::text = m.sender_id::text
            OR (m.sender_username IS NOT NULL AND LOWER(ra.username) = LOWER(m.sender_username))
            OR LOWER(ra.name) = LOWER(m.sender_name)
          )
          ORDER BY (ra.telegram_id::text = m.sender_id::text) DESC,
                   (ra.id::text = m.sender_id::text) DESC,
                   (LOWER(ra.username) = LOWER(COALESCE(m.sender_username, ''))) DESC
          LIMIT 1
        ) ag ON true
        WHERE c.org_id = ${orgId}
          AND c.created_at > NOW() - INTERVAL '1 day' * ${days}
          AND ag.canonical_id IS NOT NULL
        GROUP BY ag.canonical_id
      `,
      sql`
        WITH beats AS (
          SELECT act.agent_id, act.activity_at,
                 LAG(act.activity_at) OVER (PARTITION BY act.agent_id ORDER BY act.activity_at) AS prev_at
          FROM support_agent_activity act
          JOIN support_agents a ON a.id = act.agent_id AND a.org_id = ${orgId}
          WHERE act.activity_at > NOW() - INTERVAL '1 day' * ${days}
        )
        SELECT agent_id,
               ROUND((SUM(
                 CASE WHEN prev_at IS NULL OR activity_at - prev_at > INTERVAL '5 minutes'
                      THEN 0
                      ELSE EXTRACT(EPOCH FROM (activity_at - prev_at)) END
               ) / 3600.0)::numeric, 1)::float AS hours
        FROM beats
        GROUP BY agent_id
      `,
      fetchTeamFrtAggregate(sql, {
        orgId,
        fromDateTime: new Date(Date.now() - days * 86400000).toISOString(),
        toDateTime: new Date().toISOString(),
        market: null,
        source: 'all',
      }).catch(() => ({ avgResponseMinutes: 0, agents: [] })),
    ])

    // Справочник агентов + канонизация
    const byId = new Map<string, { id: string; name: string; role: string | null; merged_into: string | null }>()
    for (const a of agents as any[]) byId.set(a.id, a)
    const canonical = (id: string | null | undefined): string | null => {
      if (!id) return null
      const a = byId.get(id)
      return a?.merged_into || a?.id || id
    }
    const nameToCanonical = new Map<string, string>()
    for (const a of agents as any[]) {
      nameToCanonical.set(String(a.name).toLowerCase(), a.merged_into || a.id)
    }

    const rows = new Map<string, WorkloadRow>()
    const rowFor = (id: string | null): WorkloadRow => {
      const key = id || '__unmatched__'
      let r = rows.get(key)
      if (!r) {
        const a = id ? byId.get(id) : null
        r = {
          id,
          name: a?.name || '— не сопоставлено',
          role: a?.role || null,
          messages: 0, chars: 0, mediaMessages: 0, channels: 0, activeDays: 0,
          casesTouched: 0, frtAvgMinutes: null, frtResponses: 0, appHours: null,
        }
        rows.set(key, r)
      }
      return r
    }

    for (const m of msgAgg as any[]) {
      const r = rowFor(canonical(m.canonical_id))
      r.messages += Number(m.msgs)
      r.chars += Number(m.chars)
      r.mediaMessages += Number(m.media)
      // При схлопывании дублей — максимум, а не сумма (дни/каналы могут пересекаться)
      r.activeDays = Math.max(r.activeDays, Number(m.active_days))
      r.channels = Math.max(r.channels, Number(m.channels))
    }
    for (const c of caseAgg as any[]) {
      const r = rowFor(canonical(c.canonical_id))
      r.casesTouched = Math.max(r.casesTouched, Number(c.cases))
    }
    for (const h of heartbeat as any[]) {
      const r = rowFor(canonical(h.agent_id))
      r.appHours = (r.appHours || 0) + Number(h.hours)
    }
    // FRT приходит по именам респондеров — маппим на канонические id;
    // при слиянии дублей усредняем взвешенно по числу ответов
    for (const f of frt.agents) {
      const cid = nameToCanonical.get(String(f.name).toLowerCase())
      if (!cid) continue
      const r = rowFor(cid)
      const total = r.frtResponses + f.totalResponses
      if (total > 0) {
        r.frtAvgMinutes = Math.round(
          (((r.frtAvgMinutes || 0) * r.frtResponses + f.avgMinutes * f.totalResponses) / total) * 10
        ) / 10
        r.frtResponses = total
      }
    }

    const result = [...rows.values()]
      .filter(r => r.messages > 0 || (r.appHours || 0) > 0.5 || r.casesTouched > 0)
      .sort((a, b) => b.messages - a.messages)

    return json({
      periodDays: days,
      teamAvgFrtMinutes: frt.avgResponseMinutes || null,
      agents: result,
      methodology: {
        appHours: 'Время с открытой вкладкой приложения (heartbeat каждые 45с, разрыв >5 мин = перерыв). НЕ включает работу из Telegram напрямую.',
        casesTouched: 'Тикеты, в чей канал агент писал в период жизни тикета (+1ч после решения).',
        messages: 'Сообщения, отправленные клиентам за период (Telegram + WhatsApp).',
      },
    })
  } catch (e: any) {
    console.error('workload error', e)
    return json({ error: 'Failed to compute workload' }, 500)
  }
}
