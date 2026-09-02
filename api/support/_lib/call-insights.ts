import { ensureOnce, getOpenAIKey } from './db.js'
import { pbxRecordUrl, type PbxConfig } from './pbx.js'

/**
 * Транскрибация и разбор звонков.
 *
 * Каждый состоявшийся разговор автоматически расшифровывается (Whisper),
 * сжимается в саммари и получает разбор для сейлза: что сделал хорошо, где
 * недожал, что улучшить. Цель — не архив, а тренажёр: команда видит свои
 * ошибки в тот же день, а РОП — общую картину по скриптам.
 *
 * Обработка идёт фоном в кроне по одному-два звонка за проход: длинный
 * разговор не должен упираться в таймаут функции. Ручная кнопка ставит
 * звонок в ту же очередь.
 */

const MIN_TALK_SEC = 20   // короче — тесты и обрывы, жечь токены не на чем

export async function ensureInsightsSchema(sql: any): Promise<void> {
  await ensureOnce('call-insights', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_call_insights (
        call_uuid VARCHAR(60) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        talk_sec INT,
        lead_id VARCHAR(60),
        transcript TEXT,
        summary TEXT,
        coach TEXT,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        done_at TIMESTAMP
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS idx_call_insights_pending
      ON sales_call_insights(org_id, status, created_at)
    `
  })
}

const isUuid = (s: string) => /^[0-9a-f-]{32,40}$/i.test(s)

/** Поставить звонок в очередь; повторная постановка безвредна. */
export async function queueInsight(
  sql: any, orgId: string, uuid: string, talkSec: number, leadId?: string | null,
): Promise<void> {
  if (!isUuid(uuid) || talkSec < MIN_TALK_SEC) return
  await ensureInsightsSchema(sql)
  await sql`
    INSERT INTO sales_call_insights (call_uuid, org_id, status, talk_sec, lead_id)
    VALUES (${uuid}, ${orgId}, 'pending', ${talkSec}, ${leadId || null})
    ON CONFLICT (call_uuid) DO NOTHING
  `.catch(() => {})
}

/**
 * Обработать до `limit` звонков из очереди. Ошибка одного звонка не роняет
 * остальные: статус failed с причиной, ручной перезапуск ставит pending снова.
 */
export async function processPendingInsights(
  sql: any, orgId: string, cfg: PbxConfig, limit = 2,
): Promise<number> {
  await ensureInsightsSchema(sql)
  const rows = await sql`
    SELECT call_uuid, talk_sec FROM sales_call_insights
    WHERE org_id = ${orgId} AND status = 'pending'
    ORDER BY created_at ASC LIMIT ${limit}
  ` as any[]
  if (!rows.length) return 0
  const key = await getOpenAIKey(orgId)
  if (!key) return 0

  let done = 0
  for (const r of rows) {
    try {
      const url = await pbxRecordUrl(cfg, r.call_uuid)
      if (!url) throw new Error('запись не найдена в АТС')
      const audio = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!audio.ok) throw new Error(`запись не скачалась: ${audio.status}`)
      const blob = await audio.blob()

      // Whisper: узбекский и русский вперемешку он разбирает сам
      const form = new FormData()
      form.append('file', blob, 'call.mp3')
      form.append('model', 'whisper-1')
      form.append('response_format', 'text')
      const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      })
      if (!tr.ok) throw new Error(`whisper: ${tr.status} ${(await tr.text()).slice(0, 120)}`)
      const transcript = (await tr.text()).trim().slice(0, 20000)
      if (!transcript) throw new Error('пустая расшифровка')

      const chat = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content:
              'Ты — тренер отдела продаж Delever (платформа управления доставкой для ресторанов). '
              + 'По транскрипту телефонного разговора верни JSON с двумя полями:\n'
              + '"summary" — 2–4 коротких пункта по-русски: о чём договорились, возражения клиента, следующий шаг (каждый пункт с новой строки, через «— »).\n'
              + '"coach" — разбор для сейлза по-русски: одной строкой что сделал хорошо; затем чего не выяснил или где недожал '
              + '(касса, число точек, поток заказов, следующий шаг с датой, работа с возражением); затем один конкретный совет. Тоже пунктами через «— ».\n'
              + 'Разговор может быть на узбекском или русском — выводи всегда по-русски. '
              + 'Если это не разговор с клиентом (тест линии, ошиблись номером, обрыв) — в summary одна строка об этом, coach пустой.' },
            { role: 'user', content: transcript.slice(0, 12000) },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!chat.ok) throw new Error(`summary: ${chat.status}`)
      const cd: any = await chat.json()
      let summary = '', coach = ''
      try {
        const parsed = JSON.parse(cd.choices?.[0]?.message?.content || '{}')
        summary = String(parsed.summary || '').slice(0, 2000)
        coach = String(parsed.coach || '').slice(0, 2000)
      } catch { summary = String(cd.choices?.[0]?.message?.content || '').slice(0, 2000) }

      await sql`
        UPDATE sales_call_insights
        SET status = 'done', transcript = ${transcript}, summary = ${summary},
            coach = ${coach}, error = NULL, done_at = NOW()
        WHERE call_uuid = ${r.call_uuid}
      `
      done++
    } catch (e: any) {
      await sql`
        UPDATE sales_call_insights
        SET status = 'failed', error = ${String(e?.message || e).slice(0, 300)}, done_at = NOW()
        WHERE call_uuid = ${r.call_uuid}
      `.catch(() => {})
    }
  }
  return done
}
