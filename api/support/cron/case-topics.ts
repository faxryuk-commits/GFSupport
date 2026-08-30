import { getSQL, json } from '../lib/db.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { classifyCases } from '../lib/case-topics.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Тема обращения — по тексту, пачкой, в фоне.
 *
 * Ставить тему в момент создания тикета нельзя: кейс рождается в вебхуке, где
 * лишняя секунда на поход к модели — это задержка приёма сообщений. Поэтому
 * разбираем следом, отдельным проходом: тема нужна для отчёта, а не для
 * реакции, и опоздание на пять минут ничего не стоит.
 *
 * Раз в 5 минут: до 40 обращений за проход — этого хватает на поток вчетверо
 * выше нынешнего, а расход на модели остаётся копеечным.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const BATCH = 20
const MAX_PER_RUN = 40

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return json({ ok: false, error: 'OPENAI_API_KEY not set' }, 200)

  const sql = getSQL()
  const out = { picked: 0, classified: 0, batches: 0, errors: 0 }

  try {
    const rows = await sql`
      SELECT id, title, LEFT(COALESCE(description, ''), 300) AS descr
      FROM support_cases
      WHERE org_id = ${ORG} AND topic IS NULL
      ORDER BY created_at DESC
      LIMIT ${MAX_PER_RUN}
    ` as any[]
    out.picked = rows.length
    if (!rows.length) return json({ ok: true, secured: cronSecured(), ...out })

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      try {
        const map = await classifyCases(
          chunk.map(r => ({ id: r.id, text: `${r.title}\n${r.descr}` })),
          apiKey,
        )
        out.batches++
        for (const [id, topic] of map) {
          await sql`
            UPDATE support_cases SET topic = ${topic}, updated_at = NOW()
            WHERE id = ${id} AND org_id = ${ORG}
          `
          out.classified++
        }
      } catch (e) {
        out.errors++
        console.error('[case-topics] batch failed:', e)
      }
    }
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'failed', ...out }, 200)
  }

  if (out.classified > 0) {
    await logEvent(sql, 'Темы тикетов', 'разметка', `определены темы у ${out.classified} обращений`)
  }
  return json({ ok: true, secured: cronSecured(), ...out })
}
