import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema, salesId, normPhone } from '../lib/sales-schema.js'
import { amoGet, fetchContacts, cf, sourceFromLead, marketByPipeline, fetchStatuses, stageKeyByStatusName, isAllowedPipeline, agentByAmoUser, pipelineForMarket } from '../lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

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
const TIME_BUDGET_MS = 18_000

/** Обрезка под длину колонки: в Amo поля свободные, у нас — VARCHAR. */
const cut = (v: any, n: number): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, n) : null
}

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
  // Этап ищем внутри воронки региона: ключи одинаковые, строки разные
  const stageRows = await sql`SELECT id, key, pipeline FROM sales_stages WHERE org_id = ${ORG}`
  const stageIdByKey = new Map<string, string>(
    stageRows.map((s: any) => [`${s.pipeline || 'sales'}|${s.key}`, s.id]))
  const reasonRows = await sql`SELECT id, code, label FROM sales_lost_reasons WHERE org_id = ${ORG}`

  const out = {
    mode, pagesScanned: 0, fetched: 0, imported: 0, alreadyThere: 0,
    garbageSkipped: 0, wrongMode: 0, errors: 0, lastPage: startPage - 1, hasMore: false,
    interrupted: false,
    samples: [] as any[],
  }

  for (let page = startPage; page < startPage + pages; page++) {
    // Сортировка по последнему изменению: Amo по умолчанию отдаёт сделки от
    // самых старых, и открытые оказываются на двадцатой странице. Проверено на
    // боевых данных: первые 1300 сделок — сплошь закрытые.
    const data = await amoGet(creds,
      `/leads?with=contacts,loss_reason&limit=250&page=${page}&order[updated_at]=desc`)
    const batch: any[] = data?._embedded?.leads || []
    out.pagesScanned++
    out.lastPage = page
    out.fetched += batch.length
    if (!batch.length) break
    out.hasMore = batch.length === 250

    const ids = new Set<number>()
    for (const l of batch) for (const c of l._embedded?.contacts || []) if (c.id) ids.add(c.id)
    const contacts = await fetchContacts(creds, [...ids])

    // ─── Пакетная обработка страницы ────────────────────────────────────────
    // Раньше каждая сделка писалась пятью отдельными запросами (поиск аккаунта,
    // вставка аккаунта, контакта, сделки, события) — 8-10 сделок за вызов.
    // Для трёх тысяч сделок это часы. Теперь страница пишется четырьмя
    // запросами независимо от числа строк.
    type Cand = {
      lead: any; name: string; phone: string | null; phoneNorm: string | null
      contactName: string | null; isWon: boolean; isLost: boolean; stageKey: string
      reasonId: string | null; closedAt: string | null
    }
    const cands: Cand[] = []

    for (const lead of batch) {
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
        const name = /^(facebook|instagram|сделка|автосделка|lead)\s*[#№]?/i.test(rawName)
          ? (contact?.name || rawName) : rawName
        const price = Number(lead.price || 0)
        const looksGarbage = (!name || /^(сделка|автосделка)/i.test(name))
          && !contact?.phone && price < GARBAGE_MIN_PRICE
        if (looksGarbage) { out.garbageSkipped++; continue }

        let reasonId: string | null = null
        if (isLost) {
          // В Amo причина живёт в двух местах: системное поле loss_reason и
          // свой список «Причины отказа». Берём первое непустое
          const lossName = String(
            (lead._embedded?.loss_reason?.[0]?.name) || cf(lead, 'Причины отказа') || ''
          ).toLowerCase()
          const byCode = (code: string) => reasonRows.find((r: any) => r.code === code)?.id || null
          reasonId =
            /не отвеч|не подн|недоступ|тишин/.test(lossName) ? byCode('no_response') :
            /дорог|бюджет|цена|qimmat/.test(lossName) ? byCode('too_expensive') :
            /конкурент|выбрал друг/.test(lossName) ? byCode('competitor') :
            /не сейчас|позже|занят|отлож/.test(lossName) ? byCode('bad_timing') :
            /не наш|не подход|не целев|мелк/.test(lossName) ? byCode('not_icp') :
            /сво(я|и) разработ|сами|внутрен/.test(lossName) ? byCode('internal_solution') :
            /лпр|руководител|не дошли/.test(lossName) ? byCode('no_dm_access') :
            /функци|не хватает|возможност/.test(lossName) ? byCode('feature_gap') :
            byCode('other')
        }

        cands.push({
          lead, name: name || 'Без названия',
          phone: contact?.phone || null,
          phoneNorm: normPhone(contact?.phone || null),
          contactName: contact?.name || null,
          isWon, isLost,
          stageKey: stageKeyByStatusName(st?.name || '', isWon, isLost),
          reasonId,
          closedAt: lead.closed_at ? new Date(lead.closed_at * 1000).toISOString() : null,
        })
      } catch (e) {
        out.errors++
      }
    }

    if (!cands.length) continue

    // 1. Что уже перенесено
    const extIds = cands.map(c => `amo_${c.lead.id}`)
    const known = await sql.query(
      `SELECT external_id FROM sales_deals WHERE org_id = $1 AND external_id = ANY($2)`,
      [ORG, extIds],
    ) as any[]
    const knownSet = new Set(known.map(r => r.external_id))
    const fresh = cands.filter(c => !knownSet.has(`amo_${c.lead.id}`))
    out.alreadyThere += cands.length - fresh.length
    if (!fresh.length) continue

    if (dry) {
      out.imported += fresh.length
      for (const c of fresh.slice(0, Math.max(0, 10 - out.samples.length))) {
        out.samples.push({ id: c.lead.id, name: c.name, bucket: c.isWon ? 'won' : c.isLost ? 'lost' : 'open',
          stage: c.stageKey, price: Number(c.lead.price || 0) })
      }
      continue
    }

    // 2. Существующие аккаунты по телефону — одним запросом
    const phones = [...new Set(fresh.map(c => c.phoneNorm).filter(Boolean))] as string[]
    const accByPhone = new Map<string, string>()
    if (phones.length) {
      const rows = await sql.query(
        `SELECT phone_norm, account_id FROM sales_contacts WHERE org_id = $1 AND phone_norm = ANY($2)`,
        [ORG, phones],
      ) as any[]
      for (const r of rows) if (r.phone_norm && !accByPhone.has(r.phone_norm)) accByPhone.set(r.phone_norm, r.account_id)
    }

    // 3. Новые аккаунты и контакты — пачкой, с учётом склейки внутри страницы
    const newAccounts: any[] = []
    const newContacts: any[] = []
    for (const c of fresh) {
      let accountId = c.phoneNorm ? accByPhone.get(c.phoneNorm) : undefined
      if (!accountId) {
        accountId = salesId('acc')
        if (c.phoneNorm) accByPhone.set(c.phoneNorm, accountId)
        newAccounts.push([accountId, ORG, cut(c.name, 255) || 'Без названия', marketByPipeline(c.lead.pipeline_id),
          cut(cf(c.lead, 'Город'), 100), c.isWon ? 'customer' : 'lead',
          new Date((c.lead.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString()])
        if (c.phone) {
          newContacts.push([salesId('sct'), ORG, accountId, cut(c.contactName, 255),
            cut(c.phone, 50), cut(c.phoneNorm, 20)])
        }
      }
      ;(c as any).accountId = accountId
    }

    // Пакетная вставка с подстраховкой: если пачка упала (например, значение
    // не влезло в колонку), не теряем всю страницу, а пишем построчно и
    // пропускаем только сбойные строки
    const bulk = async (table: string, cols: string[], rows: any[][]) => {
      if (!rows.length) return
      const insert = async (chunk: any[][]) => {
        const params: any[] = []
        const values = chunk.map(r => `(${r.map(v => { params.push(v); return `$${params.length}` }).join(',')})`)
        await sql.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params)
      }
      try {
        await insert(rows)
      } catch (e) {
        console.error(`[amo-backfill] пачка ${table} упала, пишу построчно:`, e)
        for (const r of rows) {
          try { await insert([r]) } catch { out.errors++ }
        }
      }
    }

    await bulk('sales_accounts', ['id','org_id','name','market_id','city','lifecycle','created_at'], newAccounts)
    await bulk('sales_contacts', ['id','org_id','account_id','name','phone','phone_norm'],
      newContacts.map(r => [...r]))

    // 4. Сделки и журнал — тоже пачкой
    const dealRows: any[][] = []
    const eventRows: any[][] = []
    for (const c of fresh as any[]) {
      const dealId = salesId('sd')
      const market = marketByPipeline(c.lead.pipeline_id)
      const pipeline = pipelineForMarket(market)
      const stageId = stageIdByKey.get(`${pipeline}|${c.stageKey}`)
        || stageIdByKey.get(`sales|${c.stageKey}`) || ''
      const since = new Date((c.lead.updated_at || c.lead.created_at) * 1000).toISOString()
      dealRows.push([dealId, ORG, c.accountId, stageId, agentByAmoUser(c.lead.responsible_user_id),
        market, cut(c.name, 255) || 'Без названия', 'new', `amo_${c.lead.id}`,
        cut(cf(c.lead, 'Город'), 100),
        parseInt(cf(c.lead, 'Кол филиалов') || cf(c.lead, 'Филиалов') || '0', 10) || null,
        cut(cf(c.lead, 'Заказы в день'), 50), cut(cf(c.lead, 'POS'), 100), cut(cf(c.lead, 'Тариф'), 50),
        Number(c.lead.price || 0) || null, 'UZS', since,
        c.isWon ? c.closedAt : null, c.isLost ? c.closedAt : null, c.reasonId,
        new Date((c.lead.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        pipeline])
      eventRows.push([ORG, dealId, stageId, 'перенос из AmoCRM', since])
    }
    await bulk('sales_deals',
      ['id','org_id','account_id','stage_id','owner_agent_id','market_id','title','deal_type',
       'external_id','city','points','orders_per_day','pos','tariff','monthly_amount','currency',
       'stage_since','won_at','lost_at','lost_reason_id','created_at','pipeline'], dealRows)
    await bulk('sales_deal_events', ['org_id','deal_id','new_stage_id','changed_by','changed_at'], eventRows)
    out.imported += dealRows.length
  }

  // Страница обрабатывается целиком, поэтому продолжаем со следующей
  const resumePage = out.lastPage + 1
  return json({
    ok: true, dry, ...out, resumePage,
    next: out.hasMore
      ? `?mode=${mode}&page=${resumePage}&pages=${pages}${dry ? '&dry=1' : ''}`
      : null,
  })
}
