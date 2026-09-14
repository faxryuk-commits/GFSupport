/**
 * Ночной сбор расходов каналов привлечения (пока — Яндекс Директ через
 * Метрику). Подробности — в _lib/channel-costs.ts.
 *
 * Расписание: 04:40 UTC = 09:40 Ташкент. Берёт две недели назад, чтобы
 * досчитанный Метрикой расход за вчера-позавчера перезаписал вчерашние
 * цифры. Идемпотентен.
 */
import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { ensureChannelCostsSchema, syncYandexCosts } from '../_lib/channel-costs.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied
  const sql = getSQL()
  await ensureChannelCostsSchema(sql)
  const yandex = await syncYandexCosts(sql, ORG, 14)
  return json({ ok: !yandex.error, yandex })
}
