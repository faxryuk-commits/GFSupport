import { getSQL, json } from '../_lib/db.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { assertCron } from '../_lib/cron-auth.js'
import {
  readCapiCreds, ensureCapiSchema, collectDealEvents,
  sendCapiEvents, markBaseline, requeueErrors,
} from '../_lib/meta-capi.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/**
 * Cron: обратная петля качества лидов в Meta. Раз в час.
 *
 * Что делает: находит сделки, по которым случились факты (квалификация,
 * встреча, оплата), и сообщает о них в Conversions API — чтобы реклама
 * училась на клиентах, а не на заполнивших форму. Подробности и принцип
 * «факт, а не мнение» — в _lib/meta-capi.ts.
 *
 * Включение: задать META_DATASET_ID и META_CAPI_TOKEN в env. Пока их нет,
 * крон честно отвечает not_configured и ничего не делает — код может жить
 * в проде до появления доступов.
 *
 * Первый прогон с пустым логом помечает все уже случившиеся факты как
 * baseline и НЕ отправляет их: события задним числом с сегодняшней меткой
 * времени научили бы алгоритм ерунде. Петля отдаёт только то, что
 * произошло после включения.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const creds = readCapiCreds()
  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)
  await ensureCapiSchema(sql)

  // Ошибки прошлых прогонов возвращаем в очередь до отбора кандидатов.
  const requeued = await requeueErrors(sql, ORG)
  const events = await collectDealEvents(sql, ORG)

  if (!creds) {
    return json({
      ok: true, skipped: 'not_configured', pending: events.length,
      hint: 'задайте META_DATASET_ID и META_CAPI_TOKEN',
    })
  }

  // Пустой лог = петля только что включена: фиксируем базовую линию.
  const [{ n }] = (await sql`
    SELECT COUNT(*)::int AS n FROM sales_meta_events WHERE org_id = ${ORG}
  `) as any[]
  if (Number(n) === 0 && events.length > 0) {
    const marked = await markBaseline(sql, ORG, events)
    return json({ ok: true, baseline: marked, sent: 0 })
  }

  const result = await sendCapiEvents(sql, ORG, creds, events)
  return json({
    ok: !result.error,
    candidates: events.length,
    sent: result.sent,
    noMatch: result.noMatch,
    requeued,
    error: result.error,
  })
}
