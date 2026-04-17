import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET /api/support/analytics/health-drilldown
 * Примеры сообщений/каналов по срезу Health-страницы.
 *
 * Query params:
 *   - kind: topic | intent | content_type | language (required)
 *   - value: значение среза (required)
 *   - period: 7d | 30d | 90d (default 7d)
 *   - market: опциональный фильтр
 *   - limit: default 20, max 50
 */
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

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const url = new URL(req.url)

  const kind = (url.searchParams.get('kind') || '').toLowerCase()
  const value = (url.searchParams.get('value') || '').toLowerCase()
  const period = url.searchParams.get('period') || '7d'
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7
  const limit = Math.min(50, Math.max(5, parseInt(url.searchParams.get('limit') || '20', 10)))

  if (!kind || !value) {
    return json({ error: 'kind and value are required' }, 400)
  }
  if (!['topic', 'intent', 'content_type', 'language'].includes(kind)) {
    return json({ error: 'invalid kind' }, 400)
  }

  const now = new Date()
  const fromDate = new Date(now.getTime() - days * 86400000).toISOString()
  const toDate = now.toISOString()

  try {
    let rows: any[] = []
    if (kind === 'topic') {
      rows = await sql`
        SELECT m.id, m.channel_id, ch.name as channel_name, m.sender_name, m.content_type,
               m.text_content, m.transcript, m.transcript_language, m.ai_sentiment,
               m.ai_intent, m.ai_urgency, m.ai_summary, m.created_at
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND LOWER(m.ai_category) = ${value}
          AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        ORDER BY COALESCE(m.ai_urgency, 0) DESC, m.created_at DESC
        LIMIT ${limit}
      `
    } else if (kind === 'intent') {
      rows = await sql`
        SELECT m.id, m.channel_id, ch.name as channel_name, m.sender_name, m.content_type,
               m.text_content, m.transcript, m.transcript_language, m.ai_sentiment,
               m.ai_category, m.ai_urgency, m.ai_summary, m.created_at
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND LOWER(m.ai_intent) = ${value}
          AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        ORDER BY COALESCE(m.ai_urgency, 0) DESC, m.created_at DESC
        LIMIT ${limit}
      `
    } else if (kind === 'content_type') {
      rows = await sql`
        SELECT m.id, m.channel_id, ch.name as channel_name, m.sender_name, m.content_type,
               m.text_content, m.transcript, m.transcript_language, m.ai_sentiment,
               m.ai_category, m.ai_intent, m.ai_urgency, m.ai_summary, m.created_at
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND LOWER(COALESCE(NULLIF(m.content_type, ''), 'text')) = ${value}
          AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `
    } else if (kind === 'language') {
      rows = await sql`
        SELECT m.id, m.channel_id, ch.name as channel_name, m.sender_name, m.content_type,
               m.text_content, m.transcript, m.transcript_language, m.ai_sentiment,
               m.ai_category, m.ai_intent, m.ai_urgency, m.ai_summary, m.created_at
        FROM support_messages m
        LEFT JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId}
        WHERE m.org_id = ${orgId}
          AND m.is_from_client = true
          AND LOWER(m.transcript_language) = ${value}
          AND m.created_at >= ${fromDate}::timestamptz AND m.created_at < ${toDate}::timestamptz
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `
    }

    const items = rows.map((r: any) => ({
      id: r.id,
      channelId: r.channel_id,
      channelName: r.channel_name || '—',
      senderName: r.sender_name || 'Клиент',
      contentType: r.content_type || 'text',
      text: r.text_content || '',
      transcript: r.transcript || '',
      transcriptLanguage: r.transcript_language || null,
      aiSummary: r.ai_summary || null,
      aiCategory: r.ai_category || null,
      aiIntent: r.ai_intent || null,
      aiSentiment: r.ai_sentiment || null,
      aiUrgency: r.ai_urgency != null ? parseInt(r.ai_urgency) : 0,
      createdAt: r.created_at,
    }))

    // Уникальные каналы из примеров — для быстрых переходов
    const byChannel = new Map<string, { id: string; name: string; count: number }>()
    for (const it of items) {
      if (!it.channelId) continue
      const prev = byChannel.get(it.channelId)
      if (prev) prev.count += 1
      else byChannel.set(it.channelId, { id: it.channelId, name: it.channelName, count: 1 })
    }
    const channels = Array.from(byChannel.values()).sort((a, b) => b.count - a.count).slice(0, 10)

    return json({ kind, value, period, items, channels, total: items.length }, 200, 60)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[health-drilldown]', msg)
    return json({ error: msg }, 500)
  }
}
