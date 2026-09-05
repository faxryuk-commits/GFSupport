import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { readMetaConfig } from '../_lib/meta-config.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Здоровье маркетингового контура одним запросом — для страницы «Маркетинг».
 *
 * Пять звеньев цепочки «сайт → пиксель → CRM → петля → Meta», у каждого
 * три состояния: ok / warn / down. Идея экрана: не дашборд с графиками,
 * а светофор — открыл и за секунду понял, всё ли живо и где именно болит.
 */

type LinkStatus = 'ok' | 'warn' | 'down'
interface ChainLink {
  key: string
  title: string
  status: LinkStatus
  /** Одна строка сути: что происходит или что сломалось. */
  detail: string
  /** Мелкие строки-показатели под сутью. */
  facts: string[]
  /** ISO-время последнего признака жизни звена, если есть. */
  lastAt: string | null
}

const GRAPH = 'https://graph.facebook.com/v21.0'

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const cfg = await readMetaConfig(orgId)
  const links: ChainLink[] = []

  // ── 1. Пиксель: события за сутки из датасета ────────────────────────────────
  const pixel: ChainLink = {
    key: 'pixel', title: 'Сайт → Пиксель', status: 'down',
    detail: 'Пиксель не настроен', facts: [], lastAt: null,
  }
  if (cfg.datasetId && (cfg.capiToken || cfg.userToken)) {
    const token = cfg.capiToken || cfg.userToken
    const since = Math.floor(Date.now() / 1000) - 24 * 3600
    try {
      const r = await fetch(
        `${GRAPH}/${cfg.datasetId}/stats?aggregation=event&start_time=${since}&access_token=${token}`)
      const d: any = await r.json()
      if (d.error) {
        pixel.status = 'down'
        pixel.detail = `Meta не отвечает: ${String(d.error.message).slice(0, 80)}`
      } else {
        const counts: Record<string, number> = {}
        for (const bucket of d.data || []) {
          for (const e of bucket.data || []) counts[e.value] = (counts[e.value] || 0) + Number(e.count)
        }
        const total = Object.values(counts).reduce((s, n) => s + n, 0)
        pixel.status = total > 0 ? 'ok' : 'warn'
        pixel.detail = total > 0
          ? `За сутки: ${total} соб.`
          : 'За сутки событий нет — нет трафика или пиксель не грузится'
        pixel.facts = Object.entries(counts).map(([k, v]) => `${k}: ${v}`)
      }
    } catch (e) {
      pixel.status = 'down'
      pixel.detail = 'Graph API недоступен'
    }
  }
  links.push(pixel)

  // ── 2. Приём заявок: прямые каналы за 7 дней ────────────────────────────────
  const [intakeRow] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE l.raw->>'fb_event_id' IS NOT NULL)::int AS with_fb,
           MAX(l.created_at) AS last_at
    FROM sales_leads l
    JOIN sales_sources s ON s.id = l.source_id
    WHERE l.org_id = ${orgId} AND l.created_at > NOW() - INTERVAL '7 days'
      AND s.key IN ('site', 'meta_leadform', 'site_chat', 'telegram_bot')
  ` as any[]
  links.push({
    key: 'intake', title: 'Заявки → CRM',
    status: Number(intakeRow?.total) > 0 ? 'ok' : 'warn',
    detail: Number(intakeRow?.total) > 0
      ? `За неделю: ${intakeRow.total} заявок с прямых каналов`
      : 'За неделю ни одной заявки с сайта и форм',
    facts: Number(intakeRow?.total) > 0
      ? [`со сквозным fb_event_id: ${intakeRow.with_fb}`]
      : [],
    lastAt: intakeRow?.last_at || null,
  })

  // ── 3. Токен: право на датасет живо ─────────────────────────────────────────
  const tokenLink: ChainLink = {
    key: 'token', title: 'Доступ к Meta', status: 'down',
    detail: 'Токена нет — пройдите подключение', facts: [], lastAt: cfg.connectedAt,
  }
  if (cfg.datasetId && (cfg.capiToken || cfg.userToken)) {
    try {
      const r = await fetch(`${GRAPH}/${cfg.datasetId}?fields=id&access_token=${cfg.capiToken || cfg.userToken}`)
      const d: any = await r.json()
      if (d.error) {
        tokenLink.status = 'down'
        tokenLink.detail = `Токен не проходит: ${String(d.error.message).slice(0, 70)}`
      } else {
        tokenLink.status = 'ok'
        tokenLink.detail = cfg.capiToken ? 'Токен System User' : 'Токен подключения Facebook'
        if (cfg.tokenExpiresAt) {
          const days = Math.floor((new Date(cfg.tokenExpiresAt).getTime() - Date.now()) / 86400000)
          tokenLink.facts = [`истекает через ${days} дн`]
          if (days < 10) { tokenLink.status = 'warn'; tokenLink.detail = 'Токен скоро истечёт — переподключите' }
        }
      }
    } catch { tokenLink.detail = 'Graph API недоступен' }
  }
  links.push(tokenLink)

  // ── 4. Обратная петля: лог отправок ────────────────────────────────────────
  let loopFacts: string[] = []
  let loopStatus: LinkStatus = 'warn'
  let loopDetail = 'Событий ещё не было'
  let loopLast: string | null = null
  try {
    const rows = await sql`
      SELECT status, COUNT(*)::int AS n, MAX(sent_at) AS last_sent
      FROM sales_meta_events
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY status
    ` as any[]
    const by: Record<string, number> = {}
    for (const r of rows) { by[r.status] = r.n; if (r.status === 'sent') loopLast = r.last_sent }
    const errors = by.error || 0
    const sent = by.sent || 0
    if (errors > 0) {
      loopStatus = 'down'
      loopDetail = `Ошибки отправки: ${errors} — см. настройки Meta`
    } else if (sent > 0) {
      loopStatus = 'ok'
      loopDetail = `Отправлено в Meta за неделю: ${sent}`
    }
    loopFacts = [
      by.baseline ? `база: ${by.baseline}` : '',
      by.no_match ? `без ключа: ${by.no_match}` : '',
    ].filter(Boolean)
  } catch { /* таблица появится с первым прогоном */ }
  links.push({
    key: 'loop', title: 'CRM → Meta (петля)',
    status: loopStatus, detail: loopDetail, facts: loopFacts, lastAt: loopLast,
  })

  // ── 5. Крон петли: сердцебиение ────────────────────────────────────────────
  const [hb] = await sql`
    SELECT value FROM support_settings
    WHERE org_id = ${orgId} AND key = 'meta_feedback_heartbeat' LIMIT 1
  ` as any[]
  const hbAt = hb?.value ? new Date(hb.value) : null
  const hbAgeMin = hbAt ? Math.floor((Date.now() - hbAt.getTime()) / 60000) : null
  links.push({
    key: 'cron', title: 'Часовой прогон',
    status: hbAgeMin === null ? 'warn' : hbAgeMin < 130 ? 'ok' : 'down',
    detail: hbAgeMin === null
      ? 'Ещё ни разу не отработал'
      : hbAgeMin < 130
        ? 'Ходит по расписанию'
        : `Молчит ${Math.floor(hbAgeMin / 60)} ч — проверьте кроны Vercel`,
    facts: ['расписание: каждый час в :20'],
    lastAt: hbAt ? hbAt.toISOString() : null,
  })

  const worst: LinkStatus = links.some(l => l.status === 'down') ? 'down'
    : links.some(l => l.status === 'warn') ? 'warn' : 'ok'
  return json({ links, overall: worst, fetchedAt: new Date().toISOString() })
}
