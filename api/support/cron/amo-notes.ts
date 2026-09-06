import { getSQL, json } from '../_lib/db.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { amoGet, agentByAmoUser } from '../_lib/sales-amo.js'
import { assertCron } from '../_lib/cron-auth.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * История примечаний из Amo — в ленту сделки.
 *
 * Синк переносил сделки и этапы, а примечания менеджеров оставались в Amo:
 * «мошинаси ддп побкобди кейно алокага чикаркан ози» — единственный след
 * разговора, и он жил в системе, из которой уходим. Без него карточка у нас
 * начиналась с чистого листа, и сейлз шёл в Amo «посмотреть, что было».
 *
 * Идём по сделкам с external_id из Amo, новые — первыми: их история нужна
 * сейчас. Каждая сделка обрабатывается один раз, отметка — в
 * sales_amo_notes_state; повторный запуск ничего не дублирует (message_id).
 * Пачками по 25: Amo отдаёт примечания одним запросом на сделку, а функция
 * живёт 25 секунд.
 *
 * GET ?limit=   (крон раз в 3 минуты; вручную — с секретом крона)
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const PER_RUN = 25
const TIME_BUDGET_MS = 17_000

let stateReady = false
async function ensureState(sql: any): Promise<void> {
  if (stateReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS sales_amo_notes_state (
      deal_id VARCHAR(50) PRIMARY KEY,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes INT NOT NULL DEFAULT 0
    )
  `
  stateReady = true
}

/** Что из примечания Amo попадает в ленту и в каком виде. */
function toActivity(n: any): { type: string; direction: string | null; result: string; text: string } | null {
  const p = n?.params || {}
  const kind = String(n?.note_type || '')
  if (kind === 'call_in' || kind === 'call_out') {
    const dur = Number(p.duration || 0)
    const who = p.phone ? ` ${p.phone}` : ''
    const res = dur > 0 ? `разговор ${dur} сек` : 'без ответа'
    return {
      type: 'call', direction: kind === 'call_in' ? 'in' : 'out', result: 'из Amo',
      text: `${kind === 'call_in' ? 'Входящий' : 'Исходящий'} звонок${who} · ${res}`,
    }
  }
  if (kind === 'attachment') {
    return { type: 'note', direction: null, result: 'из Amo', text: `Файл: ${p.file_name || p.original_name || 'вложение'}` }
  }
  const text = String(p.text || p.message || '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  // Служебные записи Amo (смена ответственного и т.п.) — тоже история,
  // но их и так видно в событиях; берём только то, что писал человек
  if (kind === 'service_message' || kind === 'extended_service_message') return null
  return { type: 'note', direction: null, result: 'из Amo', text: text.slice(0, 2000) }
}

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const domain = process.env.AMO_DOMAIN
  const token = process.env.AMO_TOKEN
  if (!domain || !token) return json({ ok: false, error: 'AMO_DOMAIN / AMO_TOKEN не заданы' })
  const creds = { domain, token }

  const url = new URL(req.url)
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || String(PER_RUN), 10)))
  const started = Date.now()
  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)
  await ensureState(sql)

  const deals = await sql`
    SELECT d.id, d.account_id, d.external_id
    FROM sales_deals d
    LEFT JOIN sales_amo_notes_state s ON s.deal_id = d.id
    WHERE d.org_id = ${ORG} AND d.external_id LIKE 'amo_%' AND s.deal_id IS NULL
    ORDER BY COALESCE(d.updated_at, d.created_at) DESC
    LIMIT ${limit}
  ` as any[]

  const out = { deals: 0, notes: 0, skipped: 0, errors: 0, left: 0 }
  for (const d of deals) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const amoId = Number(String(d.external_id).slice(4))
    if (!amoId) { out.skipped++; continue }

    let notes: any[] = []
    try {
      const data = await amoGet(creds, `/leads/${amoId}/notes?limit=250`)
      notes = data?._embedded?.notes || []
    } catch {
      // Сделку удалили в Amo или лимит — вернёмся к ней в следующий проход
      out.errors++
      continue
    }

    const queries: any[] = []
    for (const n of notes) {
      const a = toActivity(n)
      if (!a) continue
      const mid = `amo_note_${n.id}`
      const at = new Date(Number(n.created_at || 0) * 1000 || Date.now()).toISOString()
      queries.push(sql`
        INSERT INTO sales_activities (id, org_id, deal_id, account_id, type, direction,
                                      result, text, message_id, agent_id, happened_at)
        SELECT ${salesId('sa')}, ${ORG}, ${d.id}, ${d.account_id || null}, ${a.type}, ${a.direction},
               ${a.result}, ${a.text}, ${mid}, ${agentByAmoUser(n.created_by)}, ${at}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM sales_activities WHERE org_id = ${ORG} AND message_id = ${mid})
      `)
    }
    queries.push(sql`
      INSERT INTO sales_amo_notes_state (deal_id, notes) VALUES (${d.id}, ${queries.length})
      ON CONFLICT (deal_id) DO UPDATE SET imported_at = NOW(), notes = EXCLUDED.notes
    `)
    // Одной поездкой на сделку: примечаний бывает по полсотни
    await sql.transaction(queries)
    out.deals++
    out.notes += queries.length - 1
  }

  const [rest] = await sql`
    SELECT COUNT(*)::int AS n FROM sales_deals d
    LEFT JOIN sales_amo_notes_state s ON s.deal_id = d.id
    WHERE d.org_id = ${ORG} AND d.external_id LIKE 'amo_%' AND s.deal_id IS NULL
  ` as any[]
  out.left = rest?.n || 0
  return json({ ok: true, ms: Date.now() - started, ...out })
}
