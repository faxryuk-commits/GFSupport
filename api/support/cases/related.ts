/**
 * Похожие решённые кейсы для подсказки агенту.
 *
 * GET /api/support/cases/related?caseId=X[&limit=5]
 *
 * Возвращает до N решённых кейсов, похожих на текущий по:
 *  - Той же категории (с большим весом)
 *  - Похожему заголовку (ILIKE word match, простой text similarity)
 *  - Тому же каналу (любой clientchannel — часто проблема повторяется)
 *
 * Сортировка по композитному score. Все кейсы должны иметь resolution_notes
 * чтобы быть полезными — это главный фильтр.
 *
 * NB: позже можно заменить на pgvector / embeddings (support_embeddings уже есть в схеме).
 */

import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

// Стоп-слова на русском/узбекском/английском — игнорируем при поиске
const STOP_WORDS = new Set([
  'и','а','но','в','на','с','к','по','за','о','об','от','до','для','что','как','же','уж','еще',
  'или','то','чтобы','если','когда','так','этот','эта','это','при','без','же',
  'va','bilan','uchun','agar','lekin','ammo','yoki',
  'the','a','an','to','for','of','in','on','at','is','are','be','and','or','but',
])

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 10) // top 10 значимых слов
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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)
  const caseId = url.searchParams.get('caseId')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5'), 1), 20)

  if (!caseId) return json({ error: 'caseId required' }, 400)

  try {
    const [current] = await sql`
      SELECT id, title, description, category, channel_id, priority
      FROM support_cases
      WHERE id = ${caseId} AND org_id = ${orgId}
      LIMIT 1
    `
    if (!current) return json({ error: 'Case not found' }, 404)

    // Извлекаем ключевые слова из заголовка и описания
    const tokens = tokenize(`${current.title || ''} ${current.description || ''}`)
    const tokenPatterns = tokens.map(t => `%${t}%`)

    // Если нет токенов — fall back на категорию + канал
    if (tokens.length === 0) {
      const fallback = await sql`
        SELECT id, ticket_number, title, description, resolution_notes, category, priority, channel_id, resolved_at,
               EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0 AS resolved_in_minutes
        FROM support_cases
        WHERE org_id = ${orgId}
          AND id <> ${caseId}
          AND status IN ('resolved','closed')
          AND resolution_notes IS NOT NULL
          AND resolution_notes <> ''
          AND (category = ${current.category} OR channel_id = ${current.channel_id})
        ORDER BY resolved_at DESC NULLS LAST
        LIMIT ${limit}
      `
      return json({
        related: fallback.map(mapRelated),
        method: 'fallback_category_channel',
      })
    }

    // Кейсы с любым из токенов в title или description + бонус за категорию/канал/recurring.
    // Score: +1 за каждое совпавшее слово в title, +0.5 в description, +2 если та же категория,
    //        +1.5 если тот же канал, +3 если recurring (часто повторяется = проверенное решение).
    const candidates = await sql`
      SELECT c.id, c.ticket_number, c.title, c.description, c.resolution_notes,
             c.category, c.priority, c.channel_id, c.is_recurring, c.resolved_at,
             EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60.0 AS resolved_in_minutes,
             ch.name AS channel_name
      FROM support_cases c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id AND ch.org_id = ${orgId}
      WHERE c.org_id = ${orgId}
        AND c.id <> ${caseId}
        AND c.status IN ('resolved','closed')
        AND c.resolution_notes IS NOT NULL
        AND c.resolution_notes <> ''
        AND (
          c.title ILIKE ANY(${tokenPatterns})
          OR c.description ILIKE ANY(${tokenPatterns})
          OR c.category = ${current.category}
        )
      ORDER BY c.resolved_at DESC NULLS LAST
      LIMIT 50
    `

    // Скорим в JS (Postgres не очень удобен для подсчёта совпадений по массиву)
    const scored = candidates.map((r: any) => {
      const titleLower = (r.title || '').toLowerCase()
      const descLower = (r.description || '').toLowerCase()
      let score = 0
      let matchedTokens: string[] = []
      for (const t of tokens) {
        if (titleLower.includes(t)) { score += 1; matchedTokens.push(t) }
        if (descLower.includes(t)) score += 0.5
      }
      if (r.category === current.category) score += 2
      if (r.channel_id === current.channel_id) score += 1.5
      if (r.is_recurring) score += 3
      return { ...r, _score: score, _matched: matchedTokens }
    })

    scored.sort((a, b) => b._score - a._score)

    return json({
      related: scored.slice(0, limit).map((r) => ({
        ...mapRelated(r),
        score: +r._score.toFixed(1),
        matchedKeywords: r._matched,
        channelName: r.channel_name,
        isRecurring: r.is_recurring,
      })),
      method: 'keyword_score',
      tokens,
    })

  } catch (e: any) {
    console.error('Related cases error:', e)
    return json({ error: 'Failed to fetch related cases', detail: e?.message }, 500)
  }
}

function mapRelated(r: any) {
  return {
    id: r.id,
    ticketNumber: r.ticket_number,
    title: r.title,
    description: r.description,
    resolutionNotes: r.resolution_notes,
    category: r.category,
    priority: r.priority,
    resolvedAt: r.resolved_at,
    resolvedInMinutes: r.resolved_in_minutes != null ? Number(r.resolved_in_minutes) : null,
  }
}
