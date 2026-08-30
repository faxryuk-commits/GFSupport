import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Живая карта системы: последнее событие и счётчик дня по каждому узлу
 * топологии — одной пачкой (функции в Азии, база во Франкфурте: каждый
 * лишний заход ~190 мс, поэтому все запросы уезжают одной транзакцией).
 *
 * GET → { nodes: { <id>: { count, sub, last } }, kpi: {...} }
 * «Сегодня» — по Ташкенту; naive-UTC колонки сравниваются с UTC-строкой.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // начало ташкентского дня в naive-UTC (Ташкент = UTC+5, без переходов)
  const nowMs = Date.now()
  const tash = new Date(nowMs + 5 * 3600_000)
  const since = new Date(Date.UTC(tash.getUTCFullYear(), tash.getUTCMonth(), tash.getUTCDate()) - 5 * 3600_000)
    .toISOString().slice(0, 19)
  const hourAgo = new Date(nowMs - 3600_000).toISOString().slice(0, 19)
  // order_errors.msg_at распарсен из текста фида и хранится по Ташкенту —
  // для него «сегодня» отсчитывается от ташкентской полуночи как есть
  const sinceTash = new Date(Date.UTC(tash.getUTCFullYear(), tash.getUTCMonth(), tash.getUTCDate()))
    .toISOString().slice(0, 19)

  const [
    bySource, msgs, agent, incidents, feed, examples, sla, work, cases, amo, events,
  ] = await sql.transaction((tx: any) => [
    tx`SELECT c.source, COUNT(*)::int cnt, MAX(m.created_at) last
       FROM support_messages m JOIN support_channels c ON c.id = m.channel_id
       WHERE m.org_id = ${orgId} AND m.created_at >= ${since} GROUP BY c.source`,
    tx`SELECT COUNT(*)::int cnt,
              COUNT(*) FILTER (WHERE media_file_id IS NOT NULL OR media_url IS NOT NULL)::int media,
              COUNT(*) FILTER (WHERE is_from_client = false)::int team,
              COUNT(*) FILTER (WHERE created_at >= ${hourAgo})::int last_hour,
              MAX(created_at) last
       FROM support_messages WHERE org_id = ${orgId} AND created_at >= ${since}`,
    tx`SELECT COUNT(*)::int cnt, MAX(created_at) last,
              COUNT(*) FILTER (WHERE reasoning LIKE '[попугай подавлен]%')::int parrot,
              COUNT(*) FILTER (WHERE reasoning LIKE '[тег переключён%')::int tag_switch
       FROM support_agent_decisions WHERE org_id = ${orgId} AND created_at >= ${since}`,
    tx`SELECT COUNT(*) FILTER (WHERE first_seen >= ${since})::int cnt,
              COUNT(*) FILTER (WHERE resolved_at IS NULL)::int open,
              MAX(first_seen) last
       FROM system_incidents`,
    tx`SELECT COUNT(*)::int cnt, MAX(msg_at) last FROM order_errors WHERE msg_at >= ${sinceTash}`,
    tx`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE said_at >= ${since})::int cnt,
              MAX(created_at) last
       FROM support_reply_examples`,
    tx`SELECT COUNT(*) FILTER (WHERE kind = 'alert' AND created_at >= ${since})::int cnt,
              MAX(created_at) FILTER (WHERE kind IN ('alert', 'incident', 'solution_card')) last
       FROM support_ai_events WHERE org_id = ${orgId}`,
    tx`SELECT COUNT(*) FILTER (WHERE created_at >= ${since})::int cnt,
              COUNT(*) FILTER (WHERE confirmed_at >= ${since})::int confirmed,
              MAX(GREATEST(COALESCE(confirmed_at, created_at), created_at)) last
       FROM work_items WHERE org_id = ${orgId}`,
    tx`SELECT COUNT(*)::int cnt, MAX(created_at) last,
              COUNT(*) FILTER (WHERE priority IN ('critical', 'high'))::int crit
       FROM support_cases WHERE org_id = ${orgId} AND created_at >= ${since}`,
    tx`SELECT COUNT(*)::int cnt, MAX(changed_at) last FROM sales_deal_events
       WHERE org_id = ${orgId} AND changed_at >= ${since}`,
    tx`SELECT COUNT(*)::int cnt, MAX(at) last FROM system_events WHERE at >= ${since}`,
  ]) as any[]

  const src: Record<string, any> = {}
  for (const r of bySource as any[]) src[r.source] = r
  const m = (msgs as any[])[0] || {}, a = (agent as any[])[0] || {}, inc = (incidents as any[])[0] || {}
  const fd = (feed as any[])[0] || {}, ex = (examples as any[])[0] || {}, sl = (sla as any[])[0] || {}
  const wk = (work as any[])[0] || {}, cs = (cases as any[])[0] || {}, am = (amo as any[])[0] || {}
  const ev = (events as any[])[0] || {}

  const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')
  return json({
    kpi: {
      msgsHour: Number(m.last_hour || 0),
      decisions: Number(a.cnt || 0),
      incidentsOpen: Number(inc.open || 0),
      examples: Number(ex.total || 0),
    },
    nodes: {
      wa:        { count: fmt(src.whatsapp?.cnt), sub: 'сообщений сегодня', last: src.whatsapp?.last || null },
      tg:        { count: fmt(src.telegram?.cnt), sub: 'сообщений сегодня', last: src.telegram?.last || null },
      feed:      { count: fmt(fd.cnt), sub: 'строк сегодня', last: fd.last || null },
      amo:       { count: fmt(am.cnt), sub: 'изменений сегодня', last: am.last || null },
      ingest:    { count: fmt(m.cnt), sub: 'принято сегодня', last: m.last || null,
                   extra: [[fmt(m.media), 'медиа → Blob'], [fmt(m.team), 'ответов команды']] },
      agent:     { count: fmt(a.cnt), sub: 'решений сегодня', last: a.last || null,
                   extra: [[fmt(a.parrot), 'попугай подавлен'], [fmt(a.tag_switch), 'тег переключён']] },
      incidents: { count: fmt(inc.cnt), sub: 'инцидентов сегодня', last: inc.last || null,
                   open: Number(inc.open || 0) },
      teacher:   { count: '+' + fmt(ex.cnt), sub: 'пар сегодня', last: ex.last || null,
                   extra: [[fmt(ex.total), 'в базе'], ['≤2ч', 'фильтр ответа']] },
      sla:       { count: fmt(sl.cnt), sub: 'алертов сегодня', last: sl.last || null },
      work:      { count: `${fmt(wk.confirmed)}/${fmt(wk.cnt)}`, sub: 'подтверждено', last: wk.last || null },
      amosync:   { count: fmt(am.cnt), sub: 'сделок двинуто', last: am.last || null },
      db:        { count: fmt(m.cnt + Number(a.cnt || 0) + Number(ev.cnt || 0)), sub: 'записей сегодня', last: m.last || null },
      blob:      { count: fmt(m.media), sub: 'файлов сегодня', last: m.last || null },
      chats:     { count: fmt(m.team), sub: 'ответов команды', last: m.last || null },
      cases:     { count: fmt(cs.cnt), sub: 'кейсов сегодня', last: cs.last || null,
                   extra: [[fmt(cs.crit), 'важных'], ['—', '']] },
      chronicle: { count: fmt(Number(ev.cnt || 0) + Number(a.cnt || 0)), sub: 'событий сегодня', last: ev.last || a.last || null },
      analytics: { count: '7', sub: 'вкладок', last: null },
      tgbot:     { count: fmt(wk.confirmed), sub: 'подтверждений', last: wk.last || null },
    },
  })
}
