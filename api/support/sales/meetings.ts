import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { readGoogleCalConfig, getAgentToken, hasAgentCalendar } from '../_lib/google-cal-config.js'
import { sendNotification } from '../_lib/notifications.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Встречи продаж поверх общего календаря.
 *
 * Встреча — это задача с kind='meeting', а не отдельная сущность: у задачи
 * уже есть исполнитель, срок и привязки к лиду, сделке и клиенту. Отдельная
 * таблица разошлась бы с задачей при первом переносе времени.
 *
 * Календари персональные: у каждого менеджера свой. Четверо могут вести
 * четыре встречи в одно время, каждый по своей ссылке Meet; запрещено только
 * двойное бронирование одного человека.
 *
 * Занятость берём из freeBusy его собственного календаря — тогда видно и то,
 * что заведено вне CRM: стоматолог, отпуск, чужое совещание. На общем ящике
 * это было невозможно, Google не мог сказать, кто именно занят.
 *
 * Событие живёт в календаре того, кто назначал, и при подхвате не переезжает:
 * коллега добавляется участником. Иначе клиенту пришли бы отмена и новое
 * приглашение с другой ссылкой Meet из-за нашей внутренней перестановки.
 *
 * GET                      ?from=&to=  встречи за период (полотно календаря)
 * GET  ?action=slots&date=&assignee= свободные слоты дня для конкретного менеджера
 * POST ?action=create      { dealId?, leadId?, startAt, durationMin?, title?, assigneeAgentId?, guestEmail?, guestName? }
 * POST ?action=reassign    { id, assigneeAgentId }  — подхватить чужую встречу
 * POST ?action=reschedule  { id, startAt, durationMin? }  — перенести на другое время
 * POST ?action=cancel      { id }
 */

/** Ташкент — UTC+5 круглый год, перехода на летнее время нет. */
const TZ = 5
const CAL_API = 'https://www.googleapis.com/calendar/v3'

/** «Стенные» часы Ташкента в настоящий UTC. */
function wallToUtc(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) + minutes * 60_000 - TZ * 3600_000)
}
function tkParts(d: Date) {
  const t = new Date(d.getTime() + TZ * 3600_000)
  return { dow: t.getUTCDay(), h: t.getUTCHours(), min: t.getUTCMinutes() }
}

async function busyRanges(token: string, from: Date, to: Date): Promise<Array<[number, number]>> {
  try {
    const r = await fetch(`${CAL_API}/freeBusy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }],
      }),
    })
    if (!r.ok) return []
    const j = await r.json() as any
    const busy = j?.calendars?.primary?.busy || []
    return busy.map((b: any) => [new Date(b.start).getTime(), new Date(b.end).getTime()])
  } catch { return [] }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const action = url.searchParams.get('action')
  const cfg = await readGoogleCalConfig(orgId)

  // ─── Свободные слоты дня ────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'slots') {
    const date = String(url.searchParams.get('date') || '')
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return json({ error: 'Нужна дата в виде YYYY-MM-DD' }, 400)

    const dayStart = wallToUtc(date, 0)
    const dayEnd = wallToUtc(date, 24 * 60)
    if (!cfg.workDays.includes(tkParts(dayStart).dow)) {
      return json({ date, slots: [], reason: 'выходной' })
    }

    // Занятость персональная: без исполнителя показываем свободным всё,
    // потому что занят может быть кто-то один, а провести встречу — другой
    const who = String(url.searchParams.get('assignee') || ctx.agentId || '')
    const taken = who
      ? await sql`
          SELECT due_at FROM sales_tasks
          WHERE org_id = ${orgId} AND kind = 'meeting' AND status <> 'cancelled'
            AND assignee_agent_id = ${who}
            AND due_at >= ${dayStart.toISOString()} AND due_at < ${dayEnd.toISOString()}
        ` as any[]
      : []
    const takenMs = new Set((taken as any[]).map(r => new Date(r.due_at).getTime()))

    // Кто ещё занят в этот час — показываем в подсказке, чтобы при выборе
    // времени было видно нагрузку команды, а не только своё расписание
    const load = await sql`
      SELECT due_at, COUNT(*)::int AS n FROM sales_tasks
      WHERE org_id = ${orgId} AND kind = 'meeting' AND status <> 'cancelled'
        AND due_at >= ${dayStart.toISOString()} AND due_at < ${dayEnd.toISOString()}
      GROUP BY due_at
    ` as any[]
    const loadMs = new Map((load as any[]).map(r => [new Date(r.due_at).getTime(), r.n]))

    // Личный календарь знает и то, что заведено вне CRM: без этого мы обещали бы
    // клиенту время, на котором у менеджера стоматолог
    const token = await getAgentToken(orgId, who || null)
    const busy = token ? await busyRanges(token, dayStart, dayEnd) : []

    const slots: Array<{ startAt: string; hhmm: string; free: boolean; busyCount: number }> = []
    const step = cfg.slotMinutes
    for (let min = cfg.workFrom * 60; min + step <= cfg.workTo * 60; min += step) {
      const start = wallToUtc(date, min)
      const ms = start.getTime()
      slots.push({
        startAt: start.toISOString(),
        hhmm: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
        // Прошедшее время недоступно: назначить встречу назад нельзя
        free: !takenMs.has(ms) && ms > Date.now()
          && !busy.some(([bs, be]) => ms < be && ms + step * 60_000 > bs),
        busyCount: loadMs.get(ms) || 0,
      })
    }
    return json({ date, slots, slotMinutes: step, assignee: who || null, googleReady: Boolean(token) })
  }

  // ─── Создание встречи ───────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'create') {
    const body = await req.json().catch(() => null) as any
    if (!body?.dealId && !body?.leadId) {
      return json({ error: 'Встреча должна быть к сделке или лиду' }, 400)
    }
    const start = new Date(String(body.startAt || ''))
    if (isNaN(start.getTime())) return json({ error: 'Неверное время встречи' }, 400)
    if (start.getTime() < Date.now()) return json({ error: 'Это время уже прошло' }, 400)

    const duration = [15, 30, 45, 60, 90, 120].includes(Number(body.durationMin))
      ? Number(body.durationMin) : cfg.slotMinutes
    const end = new Date(start.getTime() + duration * 60_000)

    const assignee = String(body.assigneeAgentId || ctx.agentId)

    // Двойное бронирование запрещено только одному человеку: коллеги в это же
    // время ведут свои встречи по своим ссылкам, и это нормальная работа отдела
    const [clash] = await sql`
      SELECT id FROM sales_tasks
      WHERE org_id = ${orgId} AND kind = 'meeting' AND status <> 'cancelled'
        AND due_at = ${start.toISOString()} AND assignee_agent_id = ${assignee} LIMIT 1
    ` as any[]
    if (clash) {
      return json({ error: 'slot_taken', message: 'У этого менеджера на это время уже есть встреча' }, 409)
    }

    // Аккаунт достаём из сделки или лида: по нему встреча видна в карточке
    // клиента, даже когда сделок у него несколько
    let accountId: string | null = null
    let clientName = String(body.title || '').trim()
    if (body.dealId) {
      const [d] = await sql`
        SELECT d.account_id, a.name FROM sales_deals d
        LEFT JOIN sales_accounts a ON a.id = d.account_id
        WHERE d.id = ${body.dealId} AND d.org_id = ${orgId} LIMIT 1
      ` as any[]
      accountId = d?.account_id || null
      if (!clientName) clientName = d?.name || ''
    } else if (body.leadId) {
      const [l] = await sql`
        SELECT account_id, name FROM sales_leads WHERE id = ${body.leadId} AND org_id = ${orgId} LIMIT 1
      ` as any[]
      accountId = l?.account_id || null
      if (!clientName) clientName = l?.name || ''
    }
    if (!clientName) clientName = 'Встреча'

    // Событие заводим в календаре исполнителя — у него оно и должно быть,
    // с уведомлением на телефоне. Если он не подключил календарь или Google
    // ответил отказом, встречу всё равно создаём: потерять её хуже, чем
    // остаться без ссылки Meet
    let googleEventId: string | null = null
    let meetUrl: string | null = null
    const token = await getAgentToken(orgId, assignee)
    if (token) {
      try {
        const guests = body.guestEmail ? [{ email: String(body.guestEmail) }] : undefined
        const r = await fetch(
          `${CAL_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: `Delever — ${clientName}`,
              description: [
                body.guestName ? `Контакт: ${body.guestName}` : '',
                body.guestEmail ? `Email: ${body.guestEmail}` : '',
                body.dealId ? `Сделка: ${body.dealId}` : '',
                'Встреча назначена из CRM',
              ].filter(Boolean).join('\n'),
              start: { dateTime: start.toISOString(), timeZone: 'Asia/Tashkent' },
              end: { dateTime: end.toISOString(), timeZone: 'Asia/Tashkent' },
              attendees: guests,
              conferenceData: {
                createRequest: {
                  requestId: `gfs-${start.getTime()}`,
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
      } catch { /* см. комментарий выше: встречу не теряем */ }
    }

    const id = salesId('stk')
    const title = `Встреча · ${clientName}`.slice(0, 500)
    await sql`
      INSERT INTO sales_tasks (id, org_id, deal_id, account_id, lead_id, kind, title,
                               due_at, assignee_agent_id, created_by_agent_id, auto,
                               google_event_id, meet_url, google_cal_agent_id)
      VALUES (${id}, ${orgId}, ${body.dealId || null}, ${accountId}, ${body.leadId || null},
              'meeting', ${title}, ${start.toISOString()}, ${assignee}, ${ctx.agentId}, false,
              ${googleEventId}, ${meetUrl}, ${googleEventId ? assignee : null})
    `

    // Сделка идёт дальше сама: назначенная встреча — это и есть «демо назначено»,
    // и заставлять двигать стадию руками значит терять её в отчётах
    if (body.dealId) {
      await sql`
        UPDATE sales_deals SET meeting_at = ${start.toISOString()}
        WHERE id = ${body.dealId} AND org_id = ${orgId}
      `
    }

    if (assignee !== ctx.agentId) {
      const [from] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1` as any[]
      await sendNotification({
        orgId, type: 'assignment', priority: 'medium',
        title: 'На вас назначена встреча',
        body: `${clientName}${from?.name ? ` — от ${from.name}` : ''}`,
        link: body.dealId ? `/sales/deals/${body.dealId}` : `/sales/leads/${body.leadId}`,
        targetAgentIds: [assignee],
      }).catch(() => {})
    }

    return json({ ok: true, id, meetUrl, googleEventId, startAt: start.toISOString() })
  }

  // ─── Подхватить чужую встречу ───────────────────────────────────────────────
  if (req.method === 'POST' && action === 'reassign') {
    const body = await req.json().catch(() => null) as any
    if (!body?.id || !body?.assigneeAgentId) return json({ error: 'Нужны встреча и исполнитель' }, 400)
    const next = String(body.assigneeAgentId)

    const [row] = await sql`
      SELECT google_event_id, google_cal_agent_id FROM sales_tasks
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting' LIMIT 1
    ` as any[]
    if (!row) return json({ error: 'Встреча не найдена' }, 404)

    // Событие остаётся в календаре автора, подхвативший добавляется участником.
    // Переносить его в чужой календарь пришлось бы через удаление и создание
    // заново — клиент получил бы отмену и новое приглашение с другой ссылкой
    // Meet из-за нашей внутренней перестановки
    const token = await getAgentToken(orgId, row.google_cal_agent_id)
    if (token && row.google_event_id) {
      try {
        const [who] = await sql`
          SELECT calendar_email FROM support_google_agent
          WHERE org_id = ${orgId} AND agent_id = ${next} LIMIT 1
        ` as any[]
        if (who?.calendar_email) {
          const cur = await fetch(
            `${CAL_API}/calendars/primary/events/${encodeURIComponent(row.google_event_id)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          )
          if (cur.ok) {
            const ev = await cur.json() as any
            const people: any[] = Array.isArray(ev.attendees) ? ev.attendees : []
            if (!people.some(a => a.email === who.calendar_email)) {
              people.push({ email: who.calendar_email })
              await fetch(
                `${CAL_API}/calendars/primary/events/${encodeURIComponent(row.google_event_id)}?sendUpdates=all`,
                {
                  method: 'PATCH',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ attendees: people }),
                },
              )
            }
          }
        }
      } catch { /* в CRM исполнителя меняем в любом случае */ }
    }

    await sql`
      UPDATE sales_tasks SET assignee_agent_id = ${next}
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting'
    `
    return json({ ok: true })
  }

  // ─── Перенос ────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'reschedule') {
    const body = await req.json().catch(() => null) as any
    if (!body?.id) return json({ error: 'Не указана встреча' }, 400)
    const start = new Date(String(body.startAt || ''))
    if (isNaN(start.getTime())) return json({ error: 'Неверное время' }, 400)
    if (start.getTime() < Date.now()) return json({ error: 'Это время уже прошло' }, 400)

    const [row] = await sql`
      SELECT google_event_id, google_cal_agent_id FROM sales_tasks
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting' LIMIT 1
    ` as any[]
    if (!row) return json({ error: 'Встреча не найдена' }, 404)

    // Занято — значит занято у этого же менеджера; у коллег своё расписание
    const [clash] = await sql`
      SELECT id FROM sales_tasks
      WHERE org_id = ${orgId} AND kind = 'meeting' AND status <> 'cancelled'
        AND due_at = ${start.toISOString()} AND id <> ${body.id}
        AND assignee_agent_id = (SELECT assignee_agent_id FROM sales_tasks WHERE id = ${body.id})
      LIMIT 1
    ` as any[]
    if (clash) return json({ error: 'slot_taken', message: 'Это время только что заняли — выберите другое' }, 409)

    const duration = [15, 30, 45, 60, 90, 120].includes(Number(body.durationMin))
      ? Number(body.durationMin) : cfg.slotMinutes
    const end = new Date(start.getTime() + duration * 60_000)

    // Событие патчим, а не пересоздаём: ссылка Meet и приглашение клиента
    // должны выжить, иначе перенос выглядит как отмена и новая встреча
    // Правим в том календаре, где событие лежит: исполнитель мог смениться
    const token = await getAgentToken(orgId, row.google_cal_agent_id)
    if (token && row.google_event_id) {
      try {
        await fetch(
          `${CAL_API}/calendars/primary/events/${encodeURIComponent(row.google_event_id)}?sendUpdates=all`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              start: { dateTime: start.toISOString(), timeZone: 'Asia/Tashkent' },
              end: { dateTime: end.toISOString(), timeZone: 'Asia/Tashkent' },
            }),
          },
        )
      } catch { /* в CRM переносим в любом случае */ }
    }

    await sql`
      UPDATE sales_tasks SET due_at = ${start.toISOString()}
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting'
    `
    // Сделка знает время встречи отдельно — иначе в карточке останется старое
    await sql`
      UPDATE sales_deals SET meeting_at = ${start.toISOString()}
      WHERE org_id = ${orgId} AND id = (
        SELECT deal_id FROM sales_tasks WHERE id = ${body.id} AND org_id = ${orgId}
      )
    `
    return json({ ok: true, startAt: start.toISOString() })
  }

  // ─── Отмена ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'cancel') {
    const body = await req.json().catch(() => null) as any
    if (!body?.id) return json({ error: 'Не указана встреча' }, 400)
    const [row] = await sql`
      SELECT google_event_id, google_cal_agent_id FROM sales_tasks
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting' LIMIT 1
    ` as any[]
    const token = await getAgentToken(orgId, row?.google_cal_agent_id)
    if (token && row?.google_event_id) {
      try {
        await fetch(`${CAL_API}/calendars/primary/events/${encodeURIComponent(row.google_event_id)}?sendUpdates=all`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      } catch { /* в CRM отменяем в любом случае */ }
    }
    await sql`
      UPDATE sales_tasks SET status = 'cancelled', status_at = NOW(), status_note = ${String(body.note || '').slice(0, 500) || null}
      WHERE id = ${body.id} AND org_id = ${orgId} AND kind = 'meeting'
    `
    return json({ ok: true })
  }

  // ─── Полотно календаря ──────────────────────────────────────────────────────
  const from = String(url.searchParams.get('from') || '')
  const to = String(url.searchParams.get('to') || '')
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)) {
    return json({ error: 'Нужен период from и to в виде YYYY-MM-DD' }, 400)
  }
  const rangeStart = wallToUtc(from, 0)
  const rangeEnd = wallToUtc(to, 24 * 60)

  // Один заход в базу вместо двух подряд: дорога до неё ≈190 мс, и признак
  // подключения незачем ждать отдельно от самих встреч
  const [rows, connected] = await Promise.all([
    sql`
    SELECT t.id, t.due_at, t.title, t.status, t.done_at, t.done_result,
           t.assignee_agent_id, t.meet_url, t.deal_id, t.lead_id, t.account_id,
           ag.name AS assignee_name,
           a.name  AS account_name,
           d.stage_id AS deal_stage
    FROM sales_tasks t
    LEFT JOIN support_agents ag ON ag.id = t.assignee_agent_id
    LEFT JOIN sales_accounts a  ON a.id = t.account_id
    LEFT JOIN sales_deals d     ON d.id = t.deal_id
    WHERE t.org_id = ${orgId} AND t.kind = 'meeting'
      AND t.due_at >= ${rangeStart.toISOString()} AND t.due_at < ${rangeEnd.toISOString()}
    ORDER BY t.due_at
  ` as Promise<any[]>,
    hasAgentCalendar(orgId, ctx.agentId),
  ])

  return json({
    from, to,
    slotMinutes: cfg.slotMinutes,
    workDays: cfg.workDays,
    workFrom: cfg.workFrom,
    workTo: cfg.workTo,
    googleConnected: connected,
    meetings: (rows as any[]).map(r => ({
      id: r.id,
      startAt: r.due_at,
      title: r.title,
      status: r.status,
      doneAt: r.done_at,
      doneResult: r.done_result,
      assigneeAgentId: r.assignee_agent_id,
      assigneeName: r.assignee_name,
      accountName: r.account_name,
      dealId: r.deal_id,
      leadId: r.lead_id,
      dealStage: r.deal_stage,
      meetUrl: r.meet_url,
    })),
  })
}
