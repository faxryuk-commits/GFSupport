import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId, normPhone } from '../lib/sales-schema.js'
import { amoGet, fetchContacts, cf, sourceFromLead, marketByPipeline, fetchStatuses, stageKeyByStatusName, isAllowedPipeline, agentByAmoUser } from '../lib/sales-amo.js'

export const config = { runtime: 'edge' }

/**
 * Разовый перенос истории AmoCRM. Не крон: запускается руками, постранично,
 * с возможностью сначала посмотреть, что получится (dry=1).
 *
 * Что и зачем переносим — решение осознанное, а не «всё подряд»:
 *
 *   open — открытые сделки. Обязательно: иначе сейлз будет работать в двух
 *          системах и половина сделок останется в старой.
 *   won  — выигранные. Нужны не ради истории, а ради склейки: без них клиент,
 *          который завтра напишет в директ, заведётся как новый аккаунт, а
 *          допродажа не сядет на существующего.
 *   lost — проигранные с причиной и датой. Это топливо реактивации: без них
 *          механизм возврата начнёт работать с нуля, потеряв два года базы.
 *
 * Мусор не тянем: сделки без имени, без телефона и без суммы — это брошенные
 * карточки, они только испортят отчёты (в старой аналитике для их отсечки
 * пришлось заводить порог по цене).
 *
 * GET /api/support/sales/amo-backfill?mode=open&page=1&pages=4&dry=1
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const GARBAGE_MIN_PRICE = 500_000   // сум: ниже — брошенная карточка, а не сделка
// Перенос идёт постранично и в edge-функции: за один вызов успеваем немного,
// поэтому ответ всегда содержит ссылку next на продолжение
const TIME_BUDGET_MS = 14_000

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const ctx = await extractAgentContext(req)
  const auth = req.headers.get('authorization') || ''
  const byCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!ctx.isOrgAdmin && !ctx.isGlobalAdmin && !byCron) return json({ error: 'admin only' }, 403)

  const domain = process.env.AMO_DOMAIN
  const token = process.env.AMO_TOKEN
  if (!domain || !token) return json({ error: 'AMO_DOMAIN / AMO_TOKEN not set' }, 400)
  const creds = { domain, token }

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'open'
  const startPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pages = Math.min(10, Math.max(1, parseInt(url.searchParams.get('pages') || '2', 10)))
  const dry = url.searchParams.get('dry') === '1'

  const started = Date.now()
  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  const statuses = await fetchStatuses(creds)
  const stageRows = await sql`SELECT id, key FROM sales_stages WHERE org_id = ${ORG}`
  const stageIdByKey = new Map<string, string>(stageRows.map((s: any) => [s.key, s.id]))
  const reasonRows = await sql`SELECT id, code, label FROM sales_lost_reasons WHERE org_id = ${ORG}`

  const out = {
    mode, pagesScanned: 0, fetched: 0, imported: 0, alreadyThere: 0,
    garbageSkipped: 0, wrongMode: 0, errors: 0, lastPage: startPage - 1, hasMore: false,
    samples: [] as any[],
  }

  for (let page = startPage; page < startPage + pages; page++) {
    // Сортировка по последнему изменению: Amo по умолчанию отдаёт сделки от
    // самых старых, и открытые оказываются на двадцатой странице. Проверено на
    // боевых данных: первые 1300 сделок — сплошь закрытые.
    const data = await amoGet(creds,
      `/leads?with=contacts&limit=250&page=${page}&order[updated_at]=desc`)
    const batch: any[] = data?._embedded?.leads || []
    out.pagesScanned++
    out.lastPage = page
    out.fetched += batch.length
    if (!batch.length) break
    out.hasMore = batch.length === 250

    const ids = new Set<number>()
    for (const l of batch) for (const c of l._embedded?.contacts || []) if (c.id) ids.add(c.id)
    const contacts = await fetchContacts(creds, [...ids])

    for (const lead of batch) {
      if (Date.now() - started > TIME_BUDGET_MS) { out.hasMore = true; break }
      try {
        if (!isAllowedPipeline(lead.pipeline_id)) { out.wrongMode++; continue }
        const st = statuses.get(lead.status_id)
        const isWon = Boolean(st?.isWon)
        const isLost = Boolean(st?.isLost)
        const bucket = isWon ? 'won' : isLost ? 'lost' : 'open'
        if (mode !== 'all' && bucket !== mode) { out.wrongMode++; continue }

        const contact = (lead._embedded?.contacts || [])
          .map((c: any) => contacts.get(c.id))
          .find((c: any) => c?.phone)

        const rawName = cf(lead, 'Бренд') || lead.name || ''
        // Служебные имена Amo («Facebook №…», «Сделка #…») заменяем контактом
        const name = /^(facebook|instagram|сделка|автосделка|lead)\s*[#№]?/i.test(rawName)
          ? (contact?.name || rawName) : rawName
        const price = Number(lead.price || 0)
        // Брошенная карточка: ни имени клиента, ни телефона, ни внятной суммы
        const looksGarbage = (!name || /^(сделка|автосделка)/i.test(name))
          && !contact?.phone && price < GARBAGE_MIN_PRICE
        if (looksGarbage) { out.garbageSkipped++; continue }

        const [existing] = await sql`
          SELECT id FROM sales_deals WHERE org_id = ${ORG} AND external_id = ${`amo_${lead.id}`} LIMIT 1
        `
        if (existing) { out.alreadyThere++; continue }

        const stageKey = stageKeyByStatusName(st?.name || '', isWon, isLost)
        const phone = contact?.phone || null
        const phoneNorm = normPhone(phone)

        if (dry) {
          if (out.samples.length < 10) {
            out.samples.push({ id: lead.id, name, bucket, stage: stageKey, price, phone: phoneNorm ? '•••' + phoneNorm.slice(-4) : null })
          }
          out.imported++
          continue
        }

        // ─── Аккаунт: склейка по телефону, иначе новый ───────────────────────
        let accountId: string | null = null
        if (phoneNorm) {
          const [c] = await sql`
            SELECT account_id FROM sales_contacts WHERE org_id = ${ORG} AND phone_norm = ${phoneNorm} LIMIT 1
          `
          accountId = c?.account_id || null
        }
        if (!accountId) {
          accountId = salesId('acc')
          await sql`
            INSERT INTO sales_accounts (id, org_id, name, market_id, city, lifecycle, created_at)
            VALUES (${accountId}, ${ORG}, ${name || 'Без названия'},
                    ${marketByPipeline(lead.pipeline_id)}, ${cf(lead, 'Город') || null},
                    ${isWon ? 'customer' : 'lead'},
                    ${new Date((lead.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString()})
          `
          if (phone) {
            await sql`
              INSERT INTO sales_contacts (id, org_id, account_id, name, phone, phone_norm, is_primary)
              VALUES (${salesId('sct')}, ${ORG}, ${accountId}, ${contact?.name || null}, ${phone}, ${phoneNorm}, true)
            `
          }
        } else if (isWon) {
          await sql`UPDATE sales_accounts SET lifecycle = 'customer' WHERE id = ${accountId}`
        }

        // ─── Причина отказа по названию из Amo ───────────────────────────────
        let reasonId: string | null = null
        if (isLost) {
          const lossName = String((lead._embedded?.loss_reason?.[0]?.name) || '').toLowerCase()
          const found = reasonRows.find((r: any) => {
            const l = String(r.label).toLowerCase()
            return lossName && (l.includes(lossName.slice(0, 8)) || lossName.includes(l.slice(0, 8)))
          })
          reasonId = found?.id || reasonRows.find((r: any) => r.code === 'other')?.id || null
        }

        const closedAt = lead.closed_at ? new Date(lead.closed_at * 1000).toISOString() : null
        const dealId = salesId('sd')
        await sql`
          INSERT INTO sales_deals (id, org_id, account_id, stage_id, owner_agent_id, market_id,
                                   title, deal_type, external_id, city, points, orders_per_day, pos,
                                   tariff, monthly_amount, currency, stage_since,
                                   won_at, lost_at, lost_reason_id, created_at, updated_at)
          VALUES (${dealId}, ${ORG}, ${accountId}, ${stageIdByKey.get(stageKey) || ''},
                  ${agentByAmoUser(lead.responsible_user_id)},
                  ${marketByPipeline(lead.pipeline_id)}, ${name || 'Без названия'}, 'new',
                  ${`amo_${lead.id}`}, ${cf(lead, 'Город') || null},
                  ${parseInt(cf(lead, 'Кол филиалов') || cf(lead, 'Филиалов') || '0', 10) || null},
                  ${cf(lead, 'Заказы в день') || null}, ${cf(lead, 'POS') || null},
                  ${cf(lead, 'Тариф') || null}, ${price || null}, 'UZS',
                  ${new Date((lead.updated_at || lead.created_at) * 1000).toISOString()},
                  ${isWon ? closedAt : null}, ${isLost ? closedAt : null}, ${reasonId},
                  ${new Date((lead.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString()}, NOW())
        `
        // Одна запись в журнал, чтобы сделка не выглядела «без истории»
        await sql`
          INSERT INTO sales_deal_events (org_id, deal_id, old_stage_id, new_stage_id, changed_by, changed_at)
          VALUES (${ORG}, ${dealId}, NULL, ${stageIdByKey.get(stageKey) || ''}, 'перенос из AmoCRM',
                  ${new Date((lead.updated_at || lead.created_at) * 1000).toISOString()})
        `
        out.imported++
      } catch (e) {
        out.errors++
        console.error('[amo-backfill] lead failed:', lead?.id, e)
      }
    }
  }

  return json({
    ok: true, dry, ...out,
    next: out.hasMore
      ? `?mode=${mode}&page=${out.lastPage + 1}&pages=${pages}${dry ? '&dry=1' : ''}`
      : null,
  })
}
