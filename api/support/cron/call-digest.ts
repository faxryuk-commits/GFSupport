import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { readPbxConfig, pbxRecordUrl } from '../_lib/pbx.js'
import {
  transcribeCall, digestCall, ensureCallDigestSchema, hasSpeechKey, applyCallFacts,
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
    SELECT t.identity AS uuid, t.account_id, t.lead_id, t.title, t.happened_at
    FROM sales_touchpoints t
    LEFT JOIN sales_call_digests d ON d.call_uuid = t.identity
    WHERE t.org_id = ${ORG} AND t.kind = 'call' AND t.identity IS NOT NULL
      AND d.call_uuid IS NULL
      AND t.happened_at > NOW() - INTERVAL '7 days'
      AND (regexp_match(t.title, '([0-9]+) сек'))[1]::int >= 25
    ORDER BY t.happened_at DESC
    LIMIT 5
  ` as any[]

  const cfg = await readPbxConfig(sql, ORG)
  if (!cfg) return json({ ok: true, skipped: 'АТС не настроена' })

  const out = { processed: 0, transcribed: 0, digested: 0, noRecord: 0, filled: 0 }

  // Без новых разговоров проход не пустой: ниже доприменяются старые сводки
  for (const r of rows) {
    let transcript: string | null = null
    let digest: Awaited<ReturnType<typeof digestCall>> = null
    try {
      const recUrl = await pbxRecordUrl(cfg, r.uuid)
      if (!recUrl) { out.noRecord++ } else {
        // Длительность из title — чтобы длинная запись нарезалась под лимит API
        const talkSec = Number((r.title.match(/([0-9]+) сек/) || [])[1]) || null
        transcript = await transcribeCall(recUrl, { talkSec })
        if (transcript) {
          out.transcribed++
          digest = await digestCall(ORG, transcript)
          if (digest) out.digested++
        }
      }
    } catch { /* один плохой звонок не должен ронять проход */ }

    // Со слов клиента — в пустые поля карточек: квалификация обращения и
    // открытые сделки клиента. Сейлз спрашивает «сколько точек, какая касса,
    // с агрегаторами работаете?», ответ звучит вслух, а поле оставалось
    // пустым: 93% карточек без квалификации именно поэтому. Раньше отсюда
    // заполнялись только агрегаторы сделки, обращение не трогалось вовсе —
    // «0 из 8» при разобранном разговоре. Заполняется только пустое и только
    // прозвучавшее: догадки промпт запрещает, форму поля проверяет код
    let filled: string[] = []
    try {
      filled = await applyCallFacts(sql, ORG, { leadId: r.lead_id, accountId: r.account_id }, digest?.facts || {})
      if (filled.length) out.filled++
    } catch { /* факты — не повод терять сводку */ }

    // Пишем всегда — даже пустой результат, чтобы не пытаться снова и снова
    await sql`
      INSERT INTO sales_call_digests (
        call_uuid, org_id, account_id, lead_id, transcript, summary, outcome, next_step, facts, filled, applied_at
      ) VALUES (
        ${r.uuid}, ${ORG}, ${r.account_id || null}, ${r.lead_id || null}, ${transcript},
        ${digest?.summary || null}, ${digest?.outcome || null},
        ${digest?.nextStep || null}, ${JSON.stringify(digest?.facts || {})},
        ${JSON.stringify(filled)}, NOW()
      )
      ON CONFLICT (call_uuid) DO NOTHING
    `
    out.processed++
  }

  // Старые сводки, разобранные до того, как факты стали разноситься по
  // карточкам: доприменяем по пять за проход, чтобы уже разобранные
  // разговоры не остались с пустой квалификацией
  const stale = await sql`
    SELECT d.call_uuid, d.facts, d.filled, d.account_id, COALESCE(d.lead_id, t.lead_id) AS lead_id
    FROM sales_call_digests d
    LEFT JOIN sales_touchpoints t ON t.identity = d.call_uuid AND t.org_id = d.org_id
    WHERE d.org_id = ${ORG} AND d.applied_at IS NULL
      AND d.created_at > NOW() - INTERVAL '14 days' AND d.facts <> '{}'::jsonb
    ORDER BY d.created_at DESC LIMIT 5
  ` as any[]
  let reapplied = 0
  for (const d of stale) {
    let filled: string[] = Array.isArray(d.filled) ? d.filled : []
    try {
      const more = await applyCallFacts(sql, ORG, { leadId: d.lead_id, accountId: d.account_id }, d.facts || {})
      filled = [...filled, ...more.filter(x => !filled.includes(x))]
      if (more.length) reapplied++
    } catch { /* следующий проход попробует снова */ }
    await sql`
      UPDATE sales_call_digests SET filled = ${JSON.stringify(filled)}, applied_at = NOW(),
        lead_id = COALESCE(lead_id, ${d.lead_id || null})
      WHERE call_uuid = ${d.call_uuid} AND org_id = ${ORG}
    `
  }

  return json({ ok: true, ...out, reapplied })
}
