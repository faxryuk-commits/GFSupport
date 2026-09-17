import { pbxRecordUrl, type PbxConfig } from './pbx.js'
import {
  transcribeCall, digestCall, ensureCallDigestSchema, applyCallFacts,
} from './speech.js'

/**
 * Единая очередь разбора звонков.
 *
 * Один разговор — одна расшифровка и одна модель: сводка и итог для ленты,
 * следующий шаг, факты для квалификации и разбор тренера для «📝 разбор».
 * До 17.09.2026 это были два независимых конвейера с двумя очередями,
 * и каждый разговор оплачивался дважды — Chirp и модель на один файл.
 *
 * Откуда берутся звонки:
 *   • сами — состоявшиеся разговоры из журнала касаний (≥ 25 секунд,
 *     за неделю), у которых сводки ещё нет;
 *   • по клику — «📝 разбор» ставит строку со статусом pending: короткий
 *     звонок, старый звонок, повтор после неудачи.
 * Запись в АТС появляется с задержкой — до пяти попыток, между ними звонок
 * ждёт в очереди, а не падает в failed с первого раза.
 */

const MIN_TALK_SEC = 25
const MAX_ATTEMPTS = 5
const isUuid = (s: string) => /^[0-9a-f-]{20,60}$/i.test(s)

/** Поставить звонок в очередь по клику. Повторная постановка безвредна. */
export async function queueDigest(sql: any, orgId: string, uuid: string): Promise<void> {
  if (!isUuid(uuid)) return
  await ensureCallDigestSchema(sql)
  const [tp] = await sql`
    SELECT account_id, lead_id FROM sales_touchpoints
    WHERE org_id = ${orgId} AND kind = 'call' AND identity = ${uuid} LIMIT 1
  `.catch(() => [] as any[]) as any[]
  await sql`
    INSERT INTO sales_call_digests (call_uuid, org_id, account_id, lead_id, status, facts, filled)
    VALUES (${uuid}, ${orgId}, ${tp?.account_id || null}, ${tp?.lead_id || null}, 'pending', '{}'::jsonb, '[]'::jsonb)
    ON CONFLICT (call_uuid) DO UPDATE SET status = 'pending', error = NULL
  `.catch(() => {})
}

interface Job { uuid: string; accountId: string | null; leadId: string | null; attempts: number }

/** Длительность и язык — из касания: «Входящий звонок · 121 сек», «947001010 · внутр. 100». */
async function callMeta(sql: any, orgId: string, uuid: string): Promise<{ talkSec: number | null; languageCodes: string[] }> {
  const [tp] = await sql`
    SELECT title, detail FROM sales_touchpoints
    WHERE org_id = ${orgId} AND kind = 'call' AND identity = ${uuid} LIMIT 1
  `.catch(() => [] as any[]) as any[]
  const talkSec = Number((String(tp?.title || '').match(/([0-9]+) сек/) || [])[1]) || null
  // Казахские семёрки говорят по-русски и по-казахски, узбекские — по-узбекски и по-русски
  const clientDigits = String(tp?.detail || '').split('·')[0].replace(/[^0-9]/g, '')
  const languageCodes = clientDigits.startsWith('7') ? ['ru-RU', 'kk-KZ'] : ['uz-UZ', 'ru-RU']
  return { talkSec, languageCodes }
}

async function runOne(
  sql: any, orgId: string, cfg: PbxConfig, job: Job,
  out: { transcribed: number; digested: number; filled: number; waiting: number; failed: number },
): Promise<void> {
  const fail = async (error: string) => {
    out.failed++
    await sql`
      INSERT INTO sales_call_digests (call_uuid, org_id, account_id, lead_id, status, error, facts, filled, done_at)
      VALUES (${job.uuid}, ${orgId}, ${job.accountId}, ${job.leadId}, 'failed', ${error}, '{}'::jsonb, '[]'::jsonb, NOW())
      ON CONFLICT (call_uuid) DO UPDATE SET status = 'failed', error = ${error}, done_at = NOW()
    `.catch(() => {})
  }
  try {
    const recUrl = await pbxRecordUrl(cfg, job.uuid)
    if (!recUrl) {
      // Запись ещё едет: ждём в очереди, счётчик попыток вместо немедленного failed
      if (job.attempts + 1 >= MAX_ATTEMPTS) return fail('запись не найдена в АТС')
      out.waiting++
      await sql`
        INSERT INTO sales_call_digests (call_uuid, org_id, account_id, lead_id, status, attempts, error, facts, filled)
        VALUES (${job.uuid}, ${orgId}, ${job.accountId}, ${job.leadId}, 'pending', ${job.attempts + 1},
                'запись ещё не появилась в АТС', '{}'::jsonb, '[]'::jsonb)
        ON CONFLICT (call_uuid) DO UPDATE
          SET status = 'pending', attempts = ${job.attempts + 1}, error = 'запись ещё не появилась в АТС',
              created_at = NOW()
      `
      return
    }
    const meta = await callMeta(sql, orgId, job.uuid)
    const transcript = (await transcribeCall(recUrl, meta) || '').trim().slice(0, 20000)
    if (!transcript) return fail('пустая расшифровка')
    out.transcribed++
    const digest = await digestCall(orgId, transcript)
    if (!digest) return fail('разбор не удался')
    out.digested++

    // Со слов клиента — в пустые поля карточек: квалификация обращения и
    // открытые сделки клиента. Только пустое и только прозвучавшее
    let filled: string[] = []
    try {
      filled = await applyCallFacts(sql, orgId, { leadId: job.leadId, accountId: job.accountId }, digest.facts || {})
      if (filled.length) out.filled++
    } catch { /* факты — не повод терять сводку */ }

    await sql`
      INSERT INTO sales_call_digests (
        call_uuid, org_id, account_id, lead_id, transcript, summary, outcome, next_step, coach,
        facts, filled, status, error, applied_at, done_at
      ) VALUES (
        ${job.uuid}, ${orgId}, ${job.accountId}, ${job.leadId}, ${transcript},
        ${digest.summary}, ${digest.outcome}, ${digest.nextStep}, ${digest.coach || null},
        ${JSON.stringify(digest.facts || {})}, ${JSON.stringify(filled)}, 'done', NULL, NOW(), NOW()
      )
      ON CONFLICT (call_uuid) DO UPDATE SET
        account_id = COALESCE(sales_call_digests.account_id, EXCLUDED.account_id),
        lead_id = COALESCE(sales_call_digests.lead_id, EXCLUDED.lead_id),
        transcript = EXCLUDED.transcript, summary = EXCLUDED.summary, outcome = EXCLUDED.outcome,
        next_step = EXCLUDED.next_step, coach = EXCLUDED.coach, facts = EXCLUDED.facts,
        filled = EXCLUDED.filled, status = 'done', error = NULL, applied_at = NOW(), done_at = NOW()
    `
  } catch (e: any) {
    await fail(String(e?.message || e).slice(0, 300))
  }
}

/**
 * Проход очереди: сперва то, что просили руками или что ждёт записи, затем
 * свежие разговоры без сводки, затем старые сводки, чьи факты ещё не
 * разнесены по карточкам. Лимиты маленькие намеренно — расшифровка
 * длинного разговора занимает секунды, а время функции общее.
 */
export async function processCallDigests(
  sql: any, orgId: string, cfg: PbxConfig,
  limits = { pending: 3, fresh: 5, backfill: 5 },
): Promise<Record<string, number>> {
  await ensureCallDigestSchema(sql)
  const out = { processed: 0, transcribed: 0, digested: 0, filled: 0, waiting: 0, failed: 0, reapplied: 0 }

  const pending = await sql`
    SELECT call_uuid, account_id, lead_id, attempts FROM sales_call_digests
    WHERE org_id = ${orgId} AND status = 'pending'
    ORDER BY created_at ASC LIMIT ${limits.pending}
  ` as any[]
  for (const p of pending) {
    await runOne(sql, orgId, cfg, {
      uuid: p.call_uuid, accountId: p.account_id || null, leadId: p.lead_id || null, attempts: Number(p.attempts || 0),
    }, out)
    out.processed++
  }

  // Недозвоны расшифровывать нечего, а платить за гудки незачем: короче
  // 25 секунд обычно «алло, ошиблись»
  const fresh = await sql`
    SELECT t.identity AS uuid, t.account_id, t.lead_id
    FROM sales_touchpoints t
    LEFT JOIN sales_call_digests d ON d.call_uuid = t.identity
    WHERE t.org_id = ${orgId} AND t.kind = 'call' AND t.identity IS NOT NULL
      AND d.call_uuid IS NULL
      -- Разговор с коллегой не расшифровываем: это не продажа
      AND COALESCE(t.channel, '') <> 'internal'
      AND t.happened_at > NOW() - INTERVAL '7 days'
      AND (regexp_match(t.title, '([0-9]+) сек'))[1]::int >= ${MIN_TALK_SEC}
    ORDER BY t.happened_at DESC
    LIMIT ${limits.fresh}
  ` as any[]
  for (const r of fresh) {
    await runOne(sql, orgId, cfg, {
      uuid: r.uuid, accountId: r.account_id || null, leadId: r.lead_id || null, attempts: 0,
    }, out)
    out.processed++
  }

  // Сводки, разобранные до того, как факты стали разноситься по карточкам
  const stale = await sql`
    SELECT d.call_uuid, d.facts, d.filled, d.account_id, COALESCE(d.lead_id, t.lead_id) AS lead_id
    FROM sales_call_digests d
    LEFT JOIN sales_touchpoints t ON t.identity = d.call_uuid AND t.org_id = d.org_id
    WHERE d.org_id = ${orgId} AND d.applied_at IS NULL AND d.status = 'done'
      AND d.created_at > NOW() - INTERVAL '14 days' AND d.facts <> '{}'::jsonb
    ORDER BY d.created_at DESC LIMIT ${limits.backfill}
  ` as any[]
  for (const d of stale) {
    let filled: string[] = Array.isArray(d.filled) ? d.filled : []
    try {
      const more = await applyCallFacts(sql, orgId, { leadId: d.lead_id, accountId: d.account_id }, d.facts || {})
      filled = [...filled, ...more.filter(x => !filled.includes(x))]
      if (more.length) out.reapplied++
    } catch { /* следующий проход попробует снова */ }
    await sql`
      UPDATE sales_call_digests SET filled = ${JSON.stringify(filled)}, applied_at = NOW(),
        lead_id = COALESCE(lead_id, ${d.lead_id || null})
      WHERE call_uuid = ${d.call_uuid} AND org_id = ${orgId}
    `
  }
  return out
}
