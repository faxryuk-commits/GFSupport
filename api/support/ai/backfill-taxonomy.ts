import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'
import { analyzeWithAI } from './analyze.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
  maxDuration: 60,
}

/**
 * GET  /api/support/ai/backfill-taxonomy?days=30
 *      → статистика: сколько всего, сколько с ai_domain, сколько ещё надо
 *
 * POST /api/support/ai/backfill-taxonomy
 *      body: { days?: number = 30, batchSize?: number = 25, force?: boolean = false }
 *      → проходит batchSize сообщений и проставляет ai_domain/ai_subcategory/ai_theme/ai_tags
 *      → force=true — переразмечает даже те, у которых ai_domain уже есть
 *
 * Возвращает { processed, updated, skipped, failed, remaining, elapsedMs }.
 * UI вызывает POST в цикле, пока remaining > 0.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const days = clamp(Number(url.searchParams.get('days') || 30), 1, 180)
    const fromDate = new Date(Date.now() - days * 86400000).toISOString()

    const [stats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ai_domain IS NOT NULL)::int as tagged,
        COUNT(*) FILTER (WHERE ai_domain IS NULL AND is_from_client = true AND LENGTH(COALESCE(text_content, transcript, '')) >= 5)::int as remaining
      FROM support_messages
      WHERE org_id = ${orgId}
        AND created_at >= ${fromDate}::timestamptz
    `
    return json({
      days,
      total: Number(stats?.total || 0),
      tagged: Number(stats?.tagged || 0),
      remaining: Number(stats?.remaining || 0),
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const started = Date.now()
  const body = await req.json().catch(() => ({})) as {
    days?: number
    batchSize?: number
    force?: boolean
  }

  const days = clamp(Number(body.days || 30), 1, 180)
  const batchSize = clamp(Number(body.batchSize || 25), 1, 50)
  const force = Boolean(body.force)

  const fromDate = new Date(Date.now() - days * 86400000).toISOString()

  // Берём только клиентские сообщения с непустым содержимым.
  // force=false — только те, где ai_domain ещё не проставлен.
  // Сортируем от новых к старым, чтобы быстрее обновить свежую аналитику.
  const rows = force
    ? await sql`
        SELECT id, COALESCE(text_content, transcript, '') as text
        FROM support_messages
        WHERE org_id = ${orgId}
          AND is_from_client = true
          AND created_at >= ${fromDate}::timestamptz
          AND LENGTH(COALESCE(text_content, transcript, '')) >= 5
        ORDER BY created_at DESC
        LIMIT ${batchSize}
      `
    : await sql`
        SELECT id, COALESCE(text_content, transcript, '') as text
        FROM support_messages
        WHERE org_id = ${orgId}
          AND is_from_client = true
          AND ai_domain IS NULL
          AND created_at >= ${fromDate}::timestamptz
          AND LENGTH(COALESCE(text_content, transcript, '')) >= 5
        ORDER BY created_at DESC
        LIMIT ${batchSize}
      `

  let processed = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  const errors: Array<{ id: string; error: string }> = []

  // Параллелим: в каждом батче analyzeWithAI ходит в OpenAI,
  // но в нашем gpt-4o-mini безопасно держать до 10 одновременных запросов.
  // При batchSize=25 разбиваем на группы по 10.
  const CONCURRENCY = 10
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      slice.map(async (r: any) => {
        processed++
        const text: string = String(r.text || '').trim()
        if (text.length < 5) {
          skipped++
          return
        }
        // Бюджет времени: если осталось < 3 сек — бросаем цикл
        if (Date.now() - started > 55_000) {
          skipped++
          return
        }
        try {
          const result = await analyzeWithAI(text)
          await sql`
            UPDATE support_messages SET
              ai_category = ${result.category},
              ai_sentiment = ${result.sentiment},
              ai_intent = ${result.intent},
              ai_urgency = ${result.urgency},
              is_problem = ${result.isProblem},
              ai_summary = ${result.summary},
              ai_extracted_entities = ${JSON.stringify(result.entities)},
              ai_domain = ${result.domain},
              ai_subcategory = ${result.subcategory},
              ai_theme = ${result.theme},
              ai_tags = ${result.tags as any}
            WHERE id = ${r.id} AND org_id = ${orgId}
          `
          updated++
        } catch (e: unknown) {
          failed++
          const msg = e instanceof Error ? e.message : String(e)
          errors.push({ id: r.id, error: msg.slice(0, 200) })
        }
      }),
    )
  }

  // Сколько ещё осталось в периоде
  const [remainingRow] = await sql`
    SELECT COUNT(*)::int as remaining
    FROM support_messages
    WHERE org_id = ${orgId}
      AND is_from_client = true
      AND ai_domain IS NULL
      AND created_at >= ${fromDate}::timestamptz
      AND LENGTH(COALESCE(text_content, transcript, '')) >= 5
  `

  return json({
    processed,
    updated,
    skipped,
    failed,
    remaining: Number(remainingRow?.remaining || 0),
    errors: errors.slice(0, 10),
    elapsedMs: Date.now() - started,
    days,
    batchSize,
    force,
  })
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}
