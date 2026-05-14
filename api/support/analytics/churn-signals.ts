/**
 * Drill-down: какие именно сообщения клиента содержат churn-сигналы.
 *
 * GET /api/support/analytics/churn-signals?channelId=<id>&period=<period>
 *
 * Используется при клике на бейдж «⚠ N» в таблице Customer Health.
 * Возвращает список сообщений клиента из указанного канала за период,
 * у которых хотя бы один матч в CHURN_PATTERNS, с разметкой —
 * какие именно фразы сработали + severity + category.
 *
 * Стратегия: SQL pre-filter по CHURN_SQL_KEYWORDS (быстро отсечь
 * заведомо нерелевантные сообщения), затем в JS прогон через полный
 * detectChurnSignals() для точной классификации.
 */

import { getRequestOrgId } from '../lib/org.js'
import { json } from '../lib/db.js'
import { getSQL } from '../lib/db.js'
import { CHURN_SQL_KEYWORDS, detectChurnSignals } from '../lib/churn-signals.js'
import type { ChurnSignalMatch } from '../lib/churn-signals.js'
import { parsePeriodParam, resolvePeriod } from './metrics/index.js'

export const config = {
  runtime: 'edge',
}

interface MessageRow {
  id: string
  channel_id: string
  created_at: string
  sender_name: string | null
  text_content: string | null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  if (!channelId) return json({ error: 'Missing channelId' }, 400)

  const orgId = await getRequestOrgId(req)
  const period = resolvePeriod(parsePeriodParam(url.searchParams.get('period')))
  const fromISO = period.from.toISOString()
  const toISO = period.to.toISOString()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)

  try {
    const sql = getSQL()
    const rows = (await sql`
      SELECT
        id,
        channel_id,
        created_at,
        sender_name,
        text_content
      FROM support_messages
      WHERE org_id = ${orgId}
        AND channel_id = ${channelId}
        AND is_from_client = true
        AND created_at >= ${fromISO}::timestamptz
        AND created_at <= ${toISO}::timestamptz
        AND text_content IS NOT NULL
        AND text_content ~* ANY(${CHURN_SQL_KEYWORDS}::text[])
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as MessageRow[]

    // Прогоняем через полный detectChurnSignals() для разметки фраз и severity.
    // Раньше тут был filter() который выкидывал сообщения без JS-матча — но это
    // ломало консистентность: customerHealth count и drill-down count расходились,
    // если SQL-паттерны были шире JS-паттернов. Теперь показываем ВСЕ SQL-матчи
    // (даже если JS не классифицировал конкретную фразу) — пользователь увидит
    // тот же набор сообщений, что был посчитан в bagde на /analytics?tab=diagnosis.
    const enriched = rows.map((r) => {
      const matches = detectChurnSignals(r.text_content)
      return {
        messageId: r.id,
        channelId: r.channel_id,
        createdAt: r.created_at,
        senderName: r.sender_name,
        text: r.text_content?.slice(0, 1000) ?? '',
        matches,
        maxSeverity:
          matches.length === 0
            ? ('low' as ChurnSignalMatch['severity'])
            : matches.reduce<ChurnSignalMatch['severity']>((acc, m) => {
                if (m.severity === 'high') return 'high'
                if (m.severity === 'medium' && acc !== 'high') return 'medium'
                return acc
              }, 'low'),
      }
    })

    return json(
      {
        channelId,
        period: {
          from: fromISO,
          to: toISO,
          label: period.label,
        },
        total: enriched.length,
        rows: enriched,
      },
      200,
      30,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[churn-signals]', msg, e instanceof Error ? e.stack : undefined)
    return json({ error: msg, where: 'churn-signals' }, 500)
  }
}
