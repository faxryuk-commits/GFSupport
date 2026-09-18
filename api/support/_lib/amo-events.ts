import { amoGet, statusMap, stageKeyByStatusName, type AmoCreds } from './sales-amo.js'
import { salesId } from './sales-schema.js'

/**
 * Журнал событий Amo → наша «Активность».
 *
 * Пока команда Казахстана работает в Amo, её день виден только там: у нас
 * синк приносил сделки и этапы под именем «синхронизация с Amo», а звонки,
 * сообщения и закрытые задачи не приходили вовсе. Отчёт «Активность» по
 * Казахстану показывал «44 лида, 0 звонков, 0 этапов» при 500 событиях
 * в Amo у одного человека.
 *
 * Берём /api/v4/events и раскладываем по нашим таблицам под именем
 * сотрудника (AMO_USER_MAP) и с амовским временем:
 *   • lead_status_changed  → sales_deal_events (движение по воронке);
 *     запись синка о том же переходе не дублируется, а переписывается
 *     на человека и настоящее время;
 *   • outgoing_call / incoming_call → sales_touchpoints kind=call, длительность
 *     и номер — из примечания-звонка (один запрос на звонок);
 *   • outgoing_chat_message → sales_activities type=message;
 *   • task_completed → sales_tasks с done_at (текст задачи — из /tasks/{id}).
 * Всё остальное (теги, поля, привязки, системные задачи робота) — не работа
 * человека и не переносится. События без автора (created_by = 0) — это робот.
 *
 * Дедуп — внешними идентификаторами: amo_ev_<id>, amo_call_<note>, amo_task_<id>.
 */

type SQL = any

export interface EventsSummary {
  fetched: number; pages: number
  stages: number; calls: number; messages: number; tasks: number
  skipped: number; noDeal: number; unmapped: Record<string, number>
  oldest: number | null; newest: number | null
}

const empty = (): EventsSummary => ({
  fetched: 0, pages: 0, stages: 0, calls: 0, messages: 0, tasks: 0,
  skipped: 0, noDeal: 0, unmapped: {}, oldest: null, newest: null,
})

export async function ensureAmoEventsSchema(sql: SQL): Promise<void> {
  await sql`ALTER TABLE sales_deal_events ADD COLUMN IF NOT EXISTS external_id VARCHAR(60)`.catch(() => {})
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_deal_events_external
    ON sales_deal_events(external_id) WHERE external_id IS NOT NULL
  `.catch(() => {})
  await sql`ALTER TABLE sales_tasks ADD COLUMN IF NOT EXISTS external_id VARCHAR(60)`.catch(() => {})
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS sales_tasks_external
    ON sales_tasks(external_id) WHERE external_id IS NOT NULL
  `.catch(() => {})
}

/** Сотрудники по id пользователя Amo: имя нужно записям, id — привязкам. */
async function agentDirectory(sql: SQL, orgId: string): Promise<Map<number, { id: string; name: string }>> {
  const map = new Map<number, { id: string; name: string }>()
  const pairs = (process.env.AMO_USER_MAP || '').split(',').map(p => p.split(':')).filter(p => p[0] && p[1])
  if (!pairs.length) return map
  const ids = pairs.map(p => p[1].trim())
  const rows = await sql`
    SELECT id, name FROM support_agents WHERE org_id = ${orgId} AND id = ANY(${ids})
  ` as any[]
  const byId = new Map(rows.map((r: any) => [String(r.id), String(r.name)]))
  for (const [amo, agent] of pairs) {
    const name = byId.get(agent.trim())
    if (name) map.set(Number(amo.trim()), { id: agent.trim(), name })
  }
  return map
}

async function dealByAmoLead(sql: SQL, orgId: string, leadId: number) {
  const [d] = await sql`
    SELECT d.id, d.account_id, d.pipeline, d.stage_id FROM sales_deals d
    WHERE d.org_id = ${orgId} AND d.external_id = ${`amo_${leadId}`} LIMIT 1
  ` as any[]
  return d || null
}

/**
 * Один проход по окну времени [fromUnix, toUnix]. Amo отдаёт события от новых
 * к старым, по 100 на страницу; лимит страниц держит функцию в бюджете —
 * бэкфилл за две недели идёт несколькими вызовами.
 */
export async function importAmoEvents(
  sql: SQL, orgId: string, creds: AmoCreds,
  opts: { fromUnix: number; toUnix?: number; maxPages?: number },
): Promise<EventsSummary> {
  await ensureAmoEventsSchema(sql)
  const out = empty()
  const agents = await agentDirectory(sql, orgId)
  const statuses = await statusMap(creds)
  const stageCache = new Map<string, any>()
  const stageFor = async (pipeline: string, statusId: number) => {
    const st = statuses.get(statusId)
    if (!st) return null
    const key = stageKeyByStatusName(st.name, st.isWon, st.isLost)
    const ck = `${pipeline}/${key}`
    if (stageCache.has(ck)) return stageCache.get(ck)
    const [row] = await sql`
      SELECT id, key, kind FROM sales_stages
      WHERE org_id = ${orgId} AND pipeline = ${pipeline} AND key = ${key} LIMIT 1
    ` as any[]
    stageCache.set(ck, row || null)
    return row || null
  }

  const maxPages = opts.maxPages ?? 5
  const to = opts.toUnix ?? Math.floor(Date.now() / 1000)
  for (let page = 1; page <= maxPages; page++) {
    const data = await amoGet(creds,
      `/events?filter[created_at][from]=${opts.fromUnix}&filter[created_at][to]=${to}&limit=100&page=${page}`)
    const events: any[] = data?._embedded?.events || []
    if (!events.length) break
    out.pages++
    for (const e of events) {
      out.fetched++
      const ts = Number(e.created_at || 0)
      if (ts) {
        out.oldest = out.oldest === null ? ts : Math.min(out.oldest, ts)
        out.newest = out.newest === null ? ts : Math.max(out.newest, ts)
      }
      const type = String(e.type || '')
      const by = Number(e.created_by || 0)
      if (!by) { out.skipped++; continue }
      const who = agents.get(by)
      const at = new Date(ts * 1000).toISOString()
      try {
        if (type === 'lead_status_changed') {
          const deal = await dealByAmoLead(sql, orgId, Number(e.entity_id))
          if (!deal) { out.noDeal++; continue }
          const after = e.value_after?.[0]?.lead_status?.id
          const before = e.value_before?.[0]?.lead_status?.id
          const to = after ? await stageFor(deal.pipeline || 'sales', Number(after)) : null
          const from = before ? await stageFor(deal.pipeline || 'sales', Number(before)) : null
          if (!to) { out.skipped++; continue }
          const name = who?.name || `Amo #${by}`
          if (!who) out.unmapped[String(by)] = (out.unmapped[String(by)] || 0) + 1
          const extId = `amo_ev_${e.id}`
          // Синк уже записал этот же переход под своим именем и своим временем —
          // переписываем на человека, а не кладём вторую строку
          const fixed = await sql`
            UPDATE sales_deal_events
            SET changed_by = ${name}, changed_at = ${at}, external_id = ${extId},
                old_stage_id = COALESCE(${from?.id || null}, old_stage_id)
            WHERE deal_id = ${deal.id} AND new_stage_id = ${to.id} AND external_id IS NULL
              AND changed_by LIKE 'синхронизация с Amo%'
              AND changed_at BETWEEN ${at}::timestamptz - INTERVAL '3 days' AND ${at}::timestamptz + INTERVAL '3 days'
            RETURNING id
          ` as any[]
          if (!fixed.length) {
            await sql`
              INSERT INTO sales_deal_events (org_id, deal_id, old_stage_id, new_stage_id, changed_by, changed_at, external_id)
              VALUES (${orgId}, ${deal.id}, ${from?.id || null}, ${to.id}, ${name}, ${at}, ${extId})
              ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
            `
          }
          out.stages++
          continue
        }

        if (type === 'outgoing_call' || type === 'incoming_call') {
          if (!who) { out.unmapped[String(by)] = (out.unmapped[String(by)] || 0) + 1; out.skipped++; continue }
          const noteId = e.value_after?.[0]?.note?.id
          const identity = noteId ? `amo_call_${noteId}` : `amo_ev_${e.id}`
          const [dup] = await sql`
            SELECT id FROM sales_touchpoints WHERE org_id = ${orgId} AND identity = ${identity} LIMIT 1
          ` as any[]
          if (dup) { out.skipped++; continue }
          // Номер и длительность живут в примечании звонка — один запрос
          let phone = ''
          let dur = 0
          if (noteId && e.entity_type) {
            const note = await amoGet(creds, `/${e.entity_type}s/${e.entity_id}/notes/${noteId}`).catch(() => null)
            phone = String(note?.params?.phone || '').replace(/[^0-9+]/g, '')
            dur = Number(note?.params?.duration || 0)
          }
          const norm = phone.replace(/\D/g, '').slice(-9)
          const [link] = norm ? await sql`
            SELECT c.account_id,
                   (SELECT l.id FROM sales_leads l WHERE l.account_id = c.account_id ORDER BY l.created_at DESC LIMIT 1) AS lead_id
            FROM sales_contacts c WHERE c.org_id = ${orgId} AND c.phone_norm = ${norm} LIMIT 1
          ` as any[] : [null]
          const dir = type === 'incoming_call' ? 'Входящий' : 'Исходящий'
          const title = `${dir} звонок · ${dur > 0 ? `${dur} сек` : 'недозвон'}`
          // Третий сегмент — имя сотрудника: так «Активность» узнаёт автора
          const detail = `${phone || 'номер скрыт'} · Amo · ${who.name}`
          await sql`
            INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel, title, detail, identity, happened_at)
            VALUES (${`stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`}, ${orgId},
                    ${link?.account_id || null}, ${link?.lead_id || null}, 'call', 'phone',
                    ${title}, ${detail}, ${identity}, ${at})
          `
          out.calls++
          continue
        }

        if (type === 'outgoing_chat_message') {
          if (!who) { out.unmapped[String(by)] = (out.unmapped[String(by)] || 0) + 1; out.skipped++; continue }
          const deal = e.entity_type === 'lead' ? await dealByAmoLead(sql, orgId, Number(e.entity_id)) : null
          const origin = String(e.value_after?.[0]?.message?.origin || '').replace(/_business$/, '')
          await sql`
            INSERT INTO sales_activities (id, org_id, deal_id, account_id, agent_id, type, direction, result, text, message_id, happened_at)
            VALUES (${salesId('act')}, ${orgId}, ${deal?.id || null}, ${deal?.account_id || null}, ${who.id},
                    'message', 'out', 'из Amo', ${`Сообщение клиенту${origin ? ` · ${origin}` : ''}`},
                    ${`amo_ev_${e.id}`}, ${at})
            ON CONFLICT (org_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
          `
          out.messages++
          continue
        }

        if (type === 'task_completed') {
          if (!who) { out.unmapped[String(by)] = (out.unmapped[String(by)] || 0) + 1; out.skipped++; continue }
          const taskId = Number(e.entity_id)
          const extId = `amo_task_${taskId}`
          const [have] = await sql`SELECT id, done_at FROM sales_tasks WHERE external_id = ${extId} LIMIT 1` as any[]
          if (have) {
            if (!have.done_at) await sql`UPDATE sales_tasks SET done_at = ${at}, done_result = 'done' WHERE id = ${have.id}`
            out.tasks++
            continue
          }
          const task = await amoGet(creds, `/tasks/${taskId}`).catch(() => null)
          const text = String(task?.text || 'Задача из Amo').slice(0, 500)
          const deal = task?.entity_type === 'leads' && task?.entity_id
            ? await dealByAmoLead(sql, orgId, Number(task.entity_id)) : null
          await sql`
            INSERT INTO sales_tasks (id, org_id, deal_id, account_id, kind, title, due_at, done_at, done_result,
                                     assignee_agent_id, created_by_agent_id, auto, external_id, created_at)
            VALUES (${salesId('stk')}, ${orgId}, ${deal?.id || null}, ${deal?.account_id || null}, 'task', ${text},
                    ${at}, ${at}, 'done', ${who.id}, ${who.id}, false, ${extId}, ${at})
            ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
          `
          out.tasks++
          continue
        }

        out.skipped++
      } catch (err) {
        // Одно кривое событие не должно ронять проход: считаем и идём дальше
        out.skipped++
        console.error('[amo-events]', type, e.id, err instanceof Error ? err.message : err)
      }
    }
    if (!data?._links?.next) break
  }
  return out
}
