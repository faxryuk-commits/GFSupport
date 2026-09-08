import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { readPbxConfig, pbxRecordUrl } from '../_lib/pbx.js'
import {
  transcribeCall, digestCall, ensureCallDigestSchema, hasSpeechKey,
} from '../_lib/speech.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = 'org_delever'

/**
 * Разбор записей звонков: расшифровка Chirp → сводка разговора в ленту.
 *
 * До этого лента показывала «Исходящий звонок · 84 сек» — через неделю по
 * такой записи невозможно вспомнить, о чём говорили, а сейлзы пишут заметки
 * в лучшем случае словом «недозвон». Теперь у каждого разговора есть суть
 * и предложенный следующий шаг.
 *
 * По пять звонков за проход: расшифровка занимает секунды, но лимит времени
 * у функции общий, а срочности никакой — за сутки крон разберёт всё.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  if (!hasSpeechKey()) {
    return json({ ok: true, skipped: 'GOOGLE_SPEECH_KEY не задан' })
  }

  const sql = getSQL()
  await ensureCallDigestSchema(sql)

  // Берём только разговоры: недозвоны расшифровывать нечего, а платить
  // за гудки незачем. Порог 25 секунд — короче обычно «алло, ошиблись»
  const rows = await sql`
    SELECT t.identity AS uuid, t.account_id, t.title, t.happened_at
    FROM sales_touchpoints t
    LEFT JOIN sales_call_digests d ON d.call_uuid = t.identity
    WHERE t.org_id = ${ORG} AND t.kind = 'call' AND t.identity IS NOT NULL
      AND d.call_uuid IS NULL
      AND t.happened_at > NOW() - INTERVAL '7 days'
      AND (regexp_match(t.title, '([0-9]+) сек'))[1]::int >= 25
    ORDER BY t.happened_at DESC
    LIMIT 5
  ` as any[]

  if (!rows.length) return json({ ok: true, processed: 0 })

  const cfg = await readPbxConfig(sql, ORG)
  if (!cfg) return json({ ok: true, skipped: 'АТС не настроена' })

  const out = { processed: 0, transcribed: 0, digested: 0, noRecord: 0, filled: 0 }

  for (const r of rows) {
    let transcript: string | null = null
    let digest: Awaited<ReturnType<typeof digestCall>> = null
    try {
      const recUrl = await pbxRecordUrl(cfg, r.uuid)
      if (!recUrl) { out.noRecord++ } else {
        transcript = await transcribeCall(recUrl)
        if (transcript) {
          out.transcribed++
          digest = await digestCall(ORG, transcript)
          if (digest) out.digested++
        }
      }
    } catch { /* один плохой звонок не должен ронять проход */ }

    // Со слов клиента — в пустые поля сделки. Агрегаторы сейлз спрашивает
    // на каждом звонке, ответ звучит вслух, а поле остаётся пустым: 93%
    // карточек без квалификации именно поэтому. Заполняем только пустое
    // и только то, что прозвучало — догадки промпт запрещает
    const filled: string[] = []
    const said = (digest?.facts || {}) as Record<string, any>
    if (r.account_id && said.aggregators) {
      const value = String(said.aggregators).slice(0, 200)
      const done = await sql`
        UPDATE sales_deals SET aggregators = ${value}, updated_at = NOW()
        WHERE org_id = ${ORG} AND account_id = ${r.account_id}
          AND (aggregators IS NULL OR aggregators = '')
          AND won_at IS NULL AND lost_at IS NULL
        RETURNING id
      ` as any[]
      if (done.length) { filled.push(`агрегаторы: ${value}`); out.filled += done.length }
    }

    // Пишем всегда — даже пустой результат, чтобы не пытаться снова и снова
    await sql`
      INSERT INTO sales_call_digests (
        call_uuid, org_id, account_id, transcript, summary, outcome, next_step, facts, filled
      ) VALUES (
        ${r.uuid}, ${ORG}, ${r.account_id || null}, ${transcript},
        ${digest?.summary || null}, ${digest?.outcome || null},
        ${digest?.nextStep || null}, ${JSON.stringify(digest?.facts || {})},
        ${JSON.stringify(filled)}
      )
      ON CONFLICT (call_uuid) DO NOTHING
    `
    out.processed++
  }

  return json({ ok: true, ...out })
}
