import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { acceptLead } from '../_lib/sales-intake.js'
import {
  ensureGoogleCalSchema, listConnectedAgents, getAgentToken,
} from '../_lib/google-cal-config.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Публичная бронь встречи с сайта.
 *
 * Клиент сам выбирает время, а система заводит лид и встречу и назначает
 * свободного менеджера. Смысл в том, чтобы горячий человек не ждал ответа
 * до утра: форма «мы перезвоним» теряет тех, кто готов говорить сейчас.
 *
 * Без авторизации, гейт — случайный public_token из настроек интеграции.
 * Наружу не уходит ничего внутреннего: ни имён менеджеров, ни их занятости,
 * ни того, сколько людей в команде. Только «это время можно взять».
 *
 * GET  ?token=&date=YYYY-MM-DD   свободные слоты дня
 * POST ?token=                   { name, phone, email?, comment?, startAt }
 */

const TZ = 5
const CAL_API = 'https://www.googleapis.com/calendar/v3'

function wallToUtc(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) + minutes * 60_000 - TZ * 3600_000)
}
const tkDow = (d: Date) => new Date(d.getTime() + TZ * 3600_000).getUTCDay()

/** Настройки брони по токену. Токен короче 12 знаков не рассматриваем. */
async function byToken(sql: any, token: string) {
  if (!token || token.length < 12) return null
  await ensureGoogleCalSchema(sql)
  const [row] = await sql`
    SELECT org_id, work_days, work_from, work_to, slot_minutes, public_booking
    FROM support_google_calendar WHERE public_token = ${token} LIMIT 1
  ` as any[]
  if (!row || !row.public_booking) return null
  return {
    orgId: row.org_id as string,
    workDays: String(row.work_days || '1,2,3,4,5,6').split(',').map(Number),
    workFrom: row.work_from ?? 10,
    workTo: row.work_to ?? 19,
    slotMinutes: row.slot_minutes ?? 60,
  }
}

/**
 * Кто из команды свободен в каждом слоте дня.
 *
 * Занятость берём из своей базы, а не из Google: публичная страница должна
 * открываться мгновенно, а опрос календарей всех менеджеров — это столько
 * запросов наружу, сколько людей в отделе. Календарь выбранного менеджера
 * проверяется потом, в момент брони.
 */
async function freeBySlot(sql: any, orgId: string, agentIds: string[], dayStart: Date, dayEnd: Date) {
  const rows = await sql`
    SELECT assignee_agent_id, due_at FROM sales_tasks
    WHERE org_id = ${orgId} AND kind = 'meeting' AND status <> 'cancelled'
      AND due_at >= ${dayStart.toISOString()} AND due_at < ${dayEnd.toISOString()}
  ` as any[]
  const busy = new Map<number, Set<string>>()
  const load = new Map<string, number>()
  for (const r of rows) {
    const ms = new Date(r.due_at).getTime()
    if (!busy.has(ms)) busy.set(ms, new Set())
    busy.get(ms)!.add(r.assignee_agent_id)
    load.set(r.assignee_agent_id, (load.get(r.assignee_agent_id) || 0) + 1)
  }
  return {
    freeAt: (ms: number) => agentIds.filter(id => !busy.get(ms)?.has(id)),
    // Ставим на наименее загруженного: иначе первый в списке соберёт весь день
    leastBusy: (ids: string[]) => ids.slice().sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0))[0],
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const cfg = await byToken(sql, (url.searchParams.get('token') || '').trim())
  if (!cfg) return json({ error: 'not found' }, 404)

  const agents = (await listConnectedAgents(cfg.orgId)).map(a => a.agentId)

  // ─── Свободные слоты ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const date = String(url.searchParams.get('date') || '')
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return json({ error: 'bad date' }, 400)

    const dayStart = wallToUtc(date, 0)
    const dayEnd = wallToUtc(date, 24 * 60)
    if (!cfg.workDays.includes(tkDow(dayStart))) return json({ date, slots: [] })
    if (!agents.length) return json({ date, slots: [] })

    const { freeAt } = await freeBySlot(sql, cfg.orgId, agents, dayStart, dayEnd)
    // Ближайший час не предлагаем: менеджеру нужно время увидеть бронь
    const notBefore = Date.now() + 60 * 60_000

    const slots: Array<{ startAt: string; hhmm: string }> = []
    for (let min = cfg.workFrom * 60; min + cfg.slotMinutes <= cfg.workTo * 60; min += cfg.slotMinutes) {
      const start = wallToUtc(date, min)
      const ms = start.getTime()
      if (ms < notBefore) continue
      // Наружу отдаём только сам факт «время доступно»: сколько человек
      // свободно и кто именно — внутреннее дело
      if (!freeAt(ms).length) continue
      slots.push({
        startAt: start.toISOString(),
        hhmm: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
      })
    }
    return json({ date, slots, slotMinutes: cfg.slotMinutes })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // ─── Бронь ──────────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => null) as any
  const name = String(body?.name || '').trim().slice(0, 150)
  const phone = String(body?.phone || '').trim().slice(0, 32)
  const email = String(body?.email || '').trim().slice(0, 150)
  const comment = String(body?.comment || '').trim().slice(0, 1000)
  const start = new Date(String(body?.startAt || ''))

  if (!name || !phone) return json({ error: 'Укажите имя и телефон' }, 400)
  if (isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return json({ error: 'Выберите время' }, 400)
  }
  if (!agents.length) return json({ error: 'Бронь временно недоступна' }, 503)

  await ensureSalesSchema(sql, cfg.orgId)

  const dayStart = new Date(start.getTime() - 12 * 3600_000)
  const dayEnd = new Date(start.getTime() + 12 * 3600_000)
  const { freeAt, leastBusy } = await freeBySlot(sql, cfg.orgId, agents, dayStart, dayEnd)
  const free = freeAt(start.getTime())
  if (!free.length) return json({ error: 'Это время только что заняли — выберите другое' }, 409)
  const assignee = leastBusy(free)

  // Лид заводим общим путём: там дедуп по телефону, скоринг и SLA. Своя
  // вставка означала бы вторую правду о том, как выглядит входящая заявка
  const lead = await acceptLead(sql, cfg.orgId, {
    source: 'site',
    lead_kind: 'form',
    name,
    phone,
    contact_name: name,
    text: [comment, email ? `Email: ${email}` : ''].filter(Boolean).join('\n') || null,
    landing_url: String(body?.landingUrl || '') || null,
    utm_source: String(body?.utmSource || '') || null,
    utm_medium: String(body?.utmMedium || '') || null,
    utm_campaign: String(body?.utmCampaign || '') || null,
    raw: { booking: true, startAt: start.toISOString(), email },
  })

  const end = new Date(start.getTime() + cfg.slotMinutes * 60_000)

  // Событие в календаре назначенного менеджера — у него оно и должно быть
  let googleEventId: string | null = null
  let meetUrl: string | null = null
  const token = await getAgentToken(cfg.orgId, assignee)
  if (token) {
    try {
      const r = await fetch(
        `${CAL_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: `Delever — ${name}`,
            description: [
              `Заявка с сайта`, `Имя: ${name}`, `Телефон: ${phone}`,
              email ? `Email: ${email}` : '', comment ? `Комментарий: ${comment}` : '',
            ].filter(Boolean).join('\n'),
            start: { dateTime: start.toISOString(), timeZone: 'Asia/Tashkent' },
            end: { dateTime: end.toISOString(), timeZone: 'Asia/Tashkent' },
            attendees: email ? [{ email }] : undefined,
            conferenceData: {
              createRequest: {
                requestId: `pub-${start.getTime()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }),
        },
      )
      if (r.ok) {
        const ev = await r.json() as any
        googleEventId = ev?.id || null
        meetUrl = ev?.hangoutLink || ev?.conferenceData?.entryPoints?.[0]?.uri || null
      }
    } catch { /* встречу не теряем: она нужна в CRM даже без ссылки */ }
  }

  await sql`
    INSERT INTO sales_tasks (id, org_id, lead_id, kind, title, due_at,
                             assignee_agent_id, auto, google_event_id, meet_url, google_cal_agent_id)
    VALUES (${salesId('stk')}, ${cfg.orgId}, ${lead.lead_id || null}, 'meeting',
            ${`Встреча · ${name}`.slice(0, 500)}, ${start.toISOString()},
            ${assignee}, false, ${googleEventId}, ${meetUrl}, ${googleEventId ? assignee : null})
  `

  // Наружу — только то, что касается самого клиента
  return json({ ok: true, startAt: start.toISOString(), meetUrl })
}
