import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { acceptLead } from '../lib/sales-intake.js'
import { amoGet, fetchContacts, leadPayload, isAllowedPipeline,
         fetchNotes, parseNotes, statusMap, applyAmoStage, readAmoMode } from '../lib/sales-amo.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge' }

/**
 * Мост AmoCRM → приёмник лидов. Переходное решение на время, пока лид-формы
 * Meta приходят через Amo: своё приложение ждёт проверки, а лиды нужны сегодня.
 *
 * Раз в минуту забираем изменившиеся сделки по курсору updated_at и то, что
 * лежит в «Неразобранном» — заявки лид-форм падают именно туда, и про этот
 * отдельный раздел API легко забыть.
 *
 * Историю переносит отдельная разовая ручка sales/amo-backfill: у крона задача
 * держать поток, а не тянуть архив.
 *
 * Ограничение переходного периода: через Amo не доезжают ad_id и campaign_id,
 * приходит только тег формы. Разбивка по кампаниям появится со своим приёмником
 * Meta — для команды при переключении не изменится ничего, вход один.
 *
 * Режим моста (настройка sales_amo_mode, читается на каждом проходе):
 *   full        лиды приезжают, этапы Amo переносятся к нам и затирают правки
 *   leads_only  приезжают только новые лиды, наши записи мост не трогает
 *   off         мост молчит
 * Переключается из интерфейса — день перехода команды на свою CRM не должен
 * требовать выкладки, а откат тем более.
 *
 * Переменные: AMO_DOMAIN, AMO_TOKEN, AMO_PIPELINE_MARKETS, SALES_ORG, CRON_SECRET.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const CURSOR_KEY = 'sales_amo_cursor'
// Бюджеты на один вызов. Edge-функция живёт ~25 секунд, а на каждый лид
// приходится несколько запросов к базе — без ограничения первый же запуск
// с суточным окном упирается в таймаут (проверено на проде 13.08.2026).
const MAX_PAGES = 2
const MAX_LEADS_PER_RUN = 60
// Выборка из Amo обязана уложиться в свой бюджет: раньше её ничто не
// ограничивало, и проход умирал по таймауту ещё до записи курсора —
// синхронизация вставала намертво (найдено на проде 15.08.2026)
const FETCH_BUDGET_MS = 10_000
const TIME_BUDGET_MS = 18_000
const SCHEMA_BUDGET_MS = 8_000
const FIRST_RUN_WINDOW_H = 24  // первый запуск не тянет архив, для этого есть backfill

/**
 * Закрыта ли сделка в Amo. 142 и 143 — системные статусы «успешно реализовано»
 * и «закрыто и не реализовано», они одинаковы во всех воронках аккаунта.
 * Свои закрывающие статусы можно дописать переменными: в боевых воронках
 * оплата живёт отдельными названиями вроде «Оплачено».
 */
function closedKind(statusId: number | undefined): 'won' | 'lost' | null {
  if (!statusId) return null
  const extra = (s: string) => (process.env[s] || '').split(',').map(x => Number(x.trim())).filter(Boolean)
  if (statusId === 143 || extra('AMO_LOST_STATUSES').includes(statusId)) return 'lost'
  if (statusId === 142 || extra('AMO_WON_STATUSES').includes(statusId)) return 'won'
  return null
}

/** Двигаем курсор только вперёд: назад он не должен уезжать ни при какой ошибке. */
async function saveCursor(sql: any, maxUpdated: number, since: number) {
  if (!(maxUpdated > since)) return
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${CURSOR_KEY}, ${String(maxUpdated)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${String(maxUpdated)}, updated_at = NOW()
  `
}

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const domain = process.env.AMO_DOMAIN
  const token = process.env.AMO_TOKEN
  if (!domain || !token) return json({ ok: false, error: 'AMO_DOMAIN / AMO_TOKEN not set' }, 200)
  const creds = { domain, token }

  const started = Date.now()
  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  // Первый запуск создаёт 19 таблиц с индексами и сидами. Если это заняло
  // заметное время — на синхронизацию в этом вызове уже не идём, её подхватит
  // следующая минута. Иначе функция гарантированно упрётся в лимит.
  if (Date.now() - started > SCHEMA_BUDGET_MS) {
    return json({ ok: true, schema: 'initialized', note: 'синхронизация начнётся со следующего прохода' })
  }

  // Режим переключается из интерфейса и читается на каждом проходе: день
  // перехода на свою CRM не должен требовать выкладки, а откат — тем более
  const mode = await readAmoMode(sql)
  if (mode === 'off') {
    await sql`
      INSERT INTO support_platform_settings (key, value, updated_at)
      VALUES (${'sales_amo_last_run'}, ${JSON.stringify({ mode, note: 'мост выключен' })}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
    return json({ ok: true, mode, note: 'мост выключен из настроек' })
  }

  const [cursorRow] = await sql`
    SELECT value FROM support_platform_settings WHERE key = ${CURSOR_KEY}
  `
  const since = cursorRow?.value
    ? parseInt(cursorRow.value, 10)
    : Math.floor(Date.now() / 1000) - FIRST_RUN_WINDOW_H * 3600

  const out = { fetched: 0, created: 0, deduped: 0, skipped: 0, closed: 0, notes: 0, staged: 0, errors: 0, deferred: 0 }
  let maxUpdated = since

  try {
    // ─── 1. Сделки, изменившиеся с прошлого прохода ───────────────────────────
    const leads: any[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      // Порядок по возрастанию времени изменения: курсор двигается строго
      // по обработанным сделкам, поэтому прерванный проход дочитывается со
      // следующего вызова без пропусков
      const data = await amoGet(creds,
        `/leads?filter[updated_at][from]=${since}&with=contacts&limit=250&page=${page}&order[updated_at]=asc`)
      const batch = data?._embedded?.leads || []
      leads.push(...batch)
      if (batch.length < 250) break
      if (Date.now() - started > FETCH_BUDGET_MS) break
    }

    // ─── 2. «Неразобранное»: заявки лид-форм лежат отдельно от сделок ─────────
    // Внимание: у неразобранной заявки вложенная сделка приходит пустой —
    // только id и ссылки. Воронка, форма и время лежат на верхнем уровне
    // элемента, а имя и телефон — в контакте. Без этого все заявки с форм
    // отсеивались проверкой воронки (обнаружено на проде 13.08.2026).
    const unsorted = await amoGet(creds, `/leads/unsorted?limit=100`)
    const items = unsorted?._embedded?.unsorted || []

    // Заявка живёт в «Неразобранном», пока её не разберут в Amo, поэтому один
    // и тот же список приезжает каждую минуту. Раньше мы честно догружали
    // карточку каждой — по запросу на заявку, три десятка запросов на проход,
    // и весь бюджет вызова уходил на пересборку того, что уже лежит в базе.
    // Спрашиваем базу один раз и знакомые заявки не трогаем: если такую
    // разберут в Amo, она приедет обычной сделкой по курсору и обновится там.
    const ids = items.map((u: any) => u._embedded?.leads?.[0]?.id).filter(Boolean)
    const knownRows = ids.length
      ? await sql`
          SELECT external_id FROM sales_leads
          WHERE org_id = ${ORG} AND external_id = ANY(${ids.map((id: number) => `amo_${id}`)})
        ` as any[]
      : []
    const known = new Set(knownRows.map(r => r.external_id))

    for (const u of items) {
      const lead = u._embedded?.leads?.[0]
      if (!lead) continue
      if (known.has(`amo_${lead.id}`)) { out.deduped++; continue }
      lead._unsorted_meta = u.metadata || null
      lead.pipeline_id = lead.pipeline_id || u.pipeline_id
      // Воронку проверяем здесь, а не в общем цикле: заявка из чужой воронки
      // в базу не попадёт, значит знакомой никогда не станет — и мы вечно
      // догружали её карточку каждую минуту, чтобы тут же выбросить.
      // Двадцать таких заявок съедали всю выборку (проверено 15.08.2026)
      if (!isAllowedPipeline(lead.pipeline_id)) { out.skipped++; continue }
      lead.name = lead.name || u.metadata?.form_name || u.source_name || null
      lead.created_at = lead.created_at || u.created_at
      lead._embedded = { ...(lead._embedded || {}), contacts: u._embedded?.contacts || [] }
      // У «Неразобранного» вложенная сделка почти пустая: ни бренда, ни города,
      // ни направления. Из-за этого лид назывался «Заявка с рекламной формы», а
      // поля пустовали. Догружаем карточку целиком — это один запрос на лид,
      // и он окупается: сейлз видит, кто обратился, не открывая Amo
      if (lead.id && !lead.custom_fields_values) {
        // Бюджет вышел — откладываем до следующей минуты. Записать заявку без
        // карточки хуже, чем не записать: в базу ляжет «Заявка без названия»
        // без телефона, а следующий проход уже сочтёт её знакомой и не вернётся
        if (Date.now() - started > FETCH_BUDGET_MS) { out.deferred++; continue }
        try {
          const full = await amoGet(creds, `/leads/${lead.id}`)
          if (full?.id) {
            lead.custom_fields_values = full.custom_fields_values
            // Имя из полной карточки берём только вместо пустого: у Amo это
            // «Сделка #30194251», а у нас уже может лежать имя профиля из директа
            lead.name = lead.name || full.name
            lead.price = full.price ?? lead.price
            lead.status_id = full.status_id ?? lead.status_id
            lead.responsible_user_id = full.responsible_user_id ?? lead.responsible_user_id
          }
        } catch {
          // Не догрузилось — тоже откладываем: заявка останется в
          // «Неразобранном» и приедет целой на следующем проходе
          out.errors++
          continue
        }
      }
      leads.push(lead)
    }

    out.fetched = leads.length

    const contactIds = new Set<number>()
    for (const l of leads) for (const c of l._embedded?.contacts || []) if (c.id) contactIds.add(c.id)
    const contacts = await fetchContacts(creds, [...contactIds])

    // ─── Примечания: там прячется содержимое заявки ───────────────────────────
    // Заявка с лид-формы Meta приезжает почти пустой — в полях только бренд,
    // а телефон и ответы на вопросы формы Amo кладёт отдельным примечанием.
    // Из-за этого в карточке стояло «телефон не оставил» у человека, который
    // его оставил: на проде так было у трети свежих заявок.
    //
    // Читаем примечания только там, где нам не хватает телефона: это запрос
    // на лид, и тянуть их для всех подряд значит вернуть ту же проблему с
    // бюджетом, из-за которой синхронизация уже вставала.
    const needNotes = leads.filter(l => {
      if (!l.id) return false
      const linked = (l._embedded?.contacts || []).map((c: any) => contacts.get(c.id)).filter(Boolean)
      return !linked.some((c: any) => c?.phone)
    })
    const knownPhones = needNotes.length
      ? await sql`
          SELECT external_id FROM sales_leads
          WHERE org_id = ${ORG} AND phone IS NOT NULL
            AND external_id = ANY(${needNotes.map((l: any) => `amo_${l.id}`)})
        ` as any[]
      : []
    const settled = new Set(knownPhones.map(r => r.external_id))

    for (const lead of needNotes) {
      if (settled.has(`amo_${lead.id}`)) continue
      if (Date.now() - started > FETCH_BUDGET_MS + 4_000) { out.deferred++; break }
      try {
        const parsed = parseNotes(await fetchNotes(creds, lead.id))
        if (parsed.phone) { lead._note_phone = parsed.phone; out.notes++ }
        if (parsed.text) lead._note_text = parsed.text
      } catch {
        // Примечания — дополнение, а не условие: без них лид всё равно нужен
      }
    }

    // В Amo лид и сделка — одна запись, поэтому изменившиеся статусы уже лежат
    // в выборке: остаётся применить их к нашим сделкам. Без этого сделка,
    // закрытая утром в Amo, висела у нас открытой и портила и доску, и деньги
    const statuses = mode === 'full' ? await statusMap(creds) : new Map()

    // В режиме «только лиды» уже заведённые записи не трогаем вовсе: их ведёт
    // команда у нас, и любое касание из Amo было бы затиранием живой работы —
    // включая безобидное на вид уточнение названия
    const ours = new Set<string>()
    if (mode === 'leads_only') {
      const extIds = leads.map((l: any) => l?.id).filter(Boolean).map((id: number) => `amo_${id}`)
      const rows = extIds.length
        ? await sql`
            SELECT external_id FROM sales_leads
            WHERE org_id = ${ORG} AND external_id = ANY(${extIds})
          ` as any[]
        : []
      for (const r of rows) ours.add(r.external_id)
    }

    // ─── 3. В приёмник — тем же путём, что сайт и Instagram ───────────────────
    let processed = 0
    for (const lead of leads) {
      if (processed >= MAX_LEADS_PER_RUN || Date.now() - started > TIME_BUDGET_MS) {
        out.deferred = leads.length - processed
        break
      }
      processed++
      try {
        if (lead.updated_at && lead.updated_at > maxUpdated) maxUpdated = lead.updated_at
        // В аккаунте девять воронок: Instagram comments и Onboarding в CRM продаж не нужны
        if (!isAllowedPipeline(lead.pipeline_id)) { out.skipped++; continue }
        if (mode === 'leads_only' && ours.has(`amo_${lead.id}`)) { out.deduped++; continue }
        // Телефон нужен для склейки, но он есть не всегда: у обращений из
        // Instagram и Telegram его нет вовсе, а имя контакта — единственное,
        // что о человеке известно. Раньше мы искали контакт строго с телефоном
        // и без него теряли имя: лид назывался «Заявка без названия», хотя в
        // Amo рядом лежит «ZaydAslam» (найдено на проде 15.08.2026)
        const linked = (lead._embedded?.contacts || [])
          .map((c: any) => contacts.get(c.id))
          .filter(Boolean)
        const contact = linked.find((c: any) => c?.phone) || linked[0]

        // Телефон из примечания равноценен телефону из контакта: по нему
        // склеиваются аккаунты и по нему звонят
        const payload = leadPayload(lead, contact)
        if (!payload.phone && lead._note_phone) payload.phone = lead._note_phone
        if (!payload.text && lead._note_text) payload.text = lead._note_text

        const res = await acceptLead(sql, ORG, payload)
        if (!res.ok) { out.skipped++; continue }
        if (res.deduped) out.deduped++
        else out.created++

        // Сделка, закрытая в Amo, не должна вставать к сейлзу как живое
        // обращение: он потратит касание на то, что уже решено. Закрытую
        // сразу отправляем к своим — не реализованную в отказ, выигранную
        // в конверсию; на доске такие не показываются
        // Перенос этапа делаем до разбора лида: сделка важнее, она про деньги.
        // В режиме «только лиды» этап и закрытие остаются за нами — ровно этим
        // режим и отличается: Amo больше не двигает нашу воронку
        const moved = mode === 'full' ? await applyAmoStage(sql, ORG, lead, statuses) : null
        if (moved) out.staged++

        const closed = mode === 'full' ? closedKind(lead.status_id) : null
        if (closed && res.lead_id) {
          await sql`
            UPDATE sales_leads
            SET status = ${closed === 'lost' ? 'junk' : 'converted'},
                archived_at = COALESCE(archived_at, NOW()),
                updated_at = NOW()
            WHERE id = ${res.lead_id} AND org_id = ${ORG} AND status <> ${closed === 'lost' ? 'junk' : 'converted'}
          `
          out.closed++
        }
      } catch (e) {
        out.errors++
        console.error('[amo-sync] lead failed:', lead?.id, e)
      }
    }

    await saveCursor(sql, maxUpdated, since)
  } catch (e: any) {
    console.error('[amo-sync] failed:', e)
    // Курсор сохраняем и после сбоя: обработанное обработано, а начинать
    // каждый раз с того же места — это и есть вставшая синхронизация
    await saveCursor(sql, maxUpdated, since).catch(() => {})
    return json({ ok: false, error: e?.message || 'sync failed', cursor: maxUpdated, ...out }, 200)
  }

  if (out.created > 0 || out.staged > 0) {
    await logEvent(sql, 'Синк Amo', 'проход',
      [out.created ? `новых лидов: ${out.created}` : '',
       out.staged ? `этапов перенесено: ${out.staged}` : '',
       out.closed ? `закрыто: ${out.closed}` : ''].filter(Boolean).join(' · '))
  }

  // Отметка живости: курсор стоит на месте, когда в Amo просто ничего не
  // менялось, и по нему не отличить тишину от вставшего крона
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${'sales_amo_last_run'}, ${JSON.stringify({ mode, ...out, ms: Date.now() - started })}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `

  return json({ ok: true, mode, secured: cronSecured(), since, cursor: maxUpdated, ms: Date.now() - started, ...out })
}
