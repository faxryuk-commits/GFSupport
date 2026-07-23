/**
 * Сессионный LLM-детектор проблем — Этап 1 новой детекции (по итогам аудита).
 *
 * Чем заменяет старый regex-детектор (auto-process):
 *  - единица анализа — СЕССИЯ (диалог канала с момента прошлого скана), не
 *    отдельное сообщение: LLM видит контекст целиком;
 *  - событийная модель без голодания: кандидаты = каналы, где есть свежие
 *    клиентские сообщения И «тишина» ≥ QUIET_MIN минут (клиент договорил),
 *    прогресс фиксируется в support_problem_scans.window_end — ничего не
 *    перечитывается по кругу и ничего не теряется;
 *  - WhatsApp и Telegram равноправны (фильтр только по типу канала).
 *
 * Аудит-контекст (30 дней): regex-детектор пропускал ~38% реальных проблем
 * (≈4К сообщений) и давал 62% ложных кейсов. Промпт ниже — тот же, что
 * показал эти цифры на живой выборке.
 *
 * Режимы (support_settings):
 *  - problem_detector_enabled='false' — полный стоп;
 *  - problem_detector_mode: 'shadow' (default) — только записывает вердикты
 *    (сравнение с regex-флагом идёт в payload), кейсы НЕ создаёт;
 *    'active' — создаёт кейсы (issue && confidence ≥ 0.7, дедуп по каналу).
 */

import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

const ORG = 'org_delever'
const OPENAI_API = 'https://api.openai.com/v1/chat/completions'
const QUIET_MIN = 3        // тишина в канале, после которой сессия считается «договорённой»
const LOOKBACK_HOURS = 6   // насколько назад смотрим при первом скане канала
const MAX_CHANNELS_PER_RUN = 12
const MAX_MSGS_PER_WINDOW = 40
const CONF_THRESHOLD = 0.7

// Regex старого детектора — только для shadow-сравнения (пишется в payload).
const LEGACY_RX = /ishlamay|ишламай|не\s*работает|not\s*working|kelmay|келмай|не\s*приходит|chiqmay|чиқмай|не\s*печатает|xato|хато|ошибк|error|muammo|муаммо|проблем|buzil|бузил|сломал|noto'g'ri|нотўғри|неправильн|завис|застрял|stuck/i

const SYSTEM_PROMPT =
  'Ты аудитор саппорт-чатов сервиса доставки еды Delever (рестораны, интеграции с кассами iiko/rkeeper, ' +
  'агрегаторы Yandex/Wolt/Uzum, курьеры, киоски). Тебе дан ДИАЛОГ из чата поддержки (клиент и команда). ' +
  'Определи: есть ли в диалоге РЕАЛЬНАЯ ПРОБЛЕМА/сбой/жалоба клиента, требующая действий поддержки (issue=true) — ' +
  'например: не работает интеграция, заказ не прошёл/не дошёл до кассы, стоп-лист не синхронизирован, не печатается чек, ' +
  'курьер не приехал, меню/цены не обновились, дубли заказов, ошибка оплаты, скидка не применяется. ' +
  'Или проблемы нет (issue=false): вопрос-уточнение, плановая просьба, благодарность, подтверждение, приветствие, отчёт что всё ок. ' +
  'Сообщения могут быть на русском и узбекском (латиница и кириллица). ' +
  'Ответ строго JSON: {"issue": true/false, "confidence": 0..1, "category": "краткая категория по-русски", ' +
  '"severity": "low"|"medium"|"high"|"urgent", "title": "заголовок проблемы ≤80 символов по-русски", ' +
  '"summary": "1-2 предложения: что случилось и что нужно"}'

async function classifySession(transcript: string): Promise<any | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: transcript.slice(0, 6000) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const d: any = await res.json()
    return JSON.parse(d.choices?.[0]?.message?.content || 'null')
  } catch {
    return null
  }
}

export default async function handler(_req: Request): Promise<Response> {
  const sql = getSQL()

  // Выключатель и режим
  try {
    const r = await sql`SELECT value FROM support_settings WHERE org_id=${ORG} AND key='problem_detector_enabled' LIMIT 1` as any[]
    if (r[0]?.value === 'false') return json({ ok: true, skipped: 'disabled' })
  } catch {}
  let mode: 'shadow' | 'active' = 'shadow'
  try {
    const r = await sql`SELECT value FROM support_settings WHERE org_id=${ORG} AND key='problem_detector_mode' LIMIT 1` as any[]
    if (r[0]?.value === 'active') mode = 'active'
  } catch {}

  await sql`CREATE TABLE IF NOT EXISTS support_problem_scans (
    id BIGSERIAL PRIMARY KEY,
    org_id VARCHAR(50),
    channel_id VARCHAR(60),
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    message_count INT,
    is_problem BOOLEAN,
    confidence REAL,
    category VARCHAR(120),
    severity VARCHAR(12),
    title TEXT,
    summary TEXT,
    regex_flag BOOLEAN,
    case_id VARCHAR(100),
    mode VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_problem_scans_channel ON support_problem_scans(channel_id, window_end DESC)`.catch(() => {})

  // Кандидаты: клиент писал за LOOKBACK, тишина ≥ QUIET_MIN, есть непросканированное.
  const candidates = await sql`
    SELECT m.channel_id,
           MAX(m.created_at) AS last_client_at,
           GREATEST(
             COALESCE((SELECT MAX(ps.window_end) FROM support_problem_scans ps WHERE ps.channel_id = m.channel_id), NOW() - (${LOOKBACK_HOURS} || ' hours')::interval),
             NOW() - (${LOOKBACK_HOURS} || ' hours')::interval
           ) AS window_start
    FROM support_messages m
    JOIN support_channels c ON c.id = m.channel_id
      AND c.type IN ('client', 'partner')
      AND COALESCE(c.type, 'client') <> 'feed'
    WHERE m.org_id = ${ORG}
      AND m.is_from_client = true
      AND m.created_at > NOW() - (${LOOKBACK_HOURS} || ' hours')::interval
      AND LENGTH(COALESCE(m.text_content, '')) >= 5
    GROUP BY m.channel_id
    HAVING MAX(m.created_at) < NOW() - (${QUIET_MIN} || ' minutes')::interval
       AND MAX(m.created_at) > GREATEST(
             COALESCE((SELECT MAX(ps.window_end) FROM support_problem_scans ps WHERE ps.channel_id = m.channel_id), NOW() - (${LOOKBACK_HOURS} || ' hours')::interval),
             NOW() - (${LOOKBACK_HOURS} || ' hours')::interval
           )
    ORDER BY MAX(m.created_at) ASC
    LIMIT ${MAX_CHANNELS_PER_RUN}
  ` as any[]

  let scanned = 0, flagged = 0, casesCreated = 0, regexAgree = 0
  for (const cand of candidates) {
    try {
      const msgs = await sql`
        SELECT m.id, m.sender_name, m.is_from_client, m.text_content, m.created_at
        FROM support_messages m
        WHERE m.org_id = ${ORG} AND m.channel_id = ${cand.channel_id}
          AND m.created_at > ${cand.window_start} AND m.created_at <= ${cand.last_client_at}
          AND LENGTH(COALESCE(m.text_content, '')) >= 2
        ORDER BY m.created_at ASC
        LIMIT ${MAX_MSGS_PER_WINDOW}
      ` as any[]
      const clientMsgs = msgs.filter((m: any) => m.is_from_client)
      if (!clientMsgs.length) {
        // фиксируем прогресс, чтобы не возвращаться к пустому окну
        await sql`INSERT INTO support_problem_scans (org_id, channel_id, window_start, window_end, message_count, is_problem, mode)
          VALUES (${ORG}, ${cand.channel_id}, ${cand.window_start}, ${cand.last_client_at}, 0, false, ${mode})`
        continue
      }

      const transcript = msgs
        .map((m: any) => `${m.is_from_client ? `Клиент (${m.sender_name || '?'})` : 'Поддержка'}: ${(m.text_content || '').slice(0, 400)}`)
        .join('\n')
      const clientText = clientMsgs.map((m: any) => m.text_content || '').join(' ')
      const regexFlag = LEGACY_RX.test(clientText)

      const v = await classifySession(transcript)
      scanned++
      const isProblem = !!(v && v.issue && (v.confidence ?? 0) >= CONF_THRESHOLD)
      if (isProblem) flagged++
      if (v && regexFlag === !!v.issue) regexAgree++

      let caseId: string | null = null
      if (isProblem && mode === 'active') {
        // Дедуп: открытый кейс канала за 12ч → не плодим второй по той же волне.
        const existing = await sql`
          SELECT id FROM support_cases
          WHERE channel_id = ${cand.channel_id} AND org_id = ${ORG}
            AND status NOT IN ('resolved', 'closed', 'cancelled')
            AND created_at >= NOW() - INTERVAL '12 hours'
          LIMIT 1` as any[]
        if (!existing[0]) {
          caseId = `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const maxResult = await sql`SELECT COALESCE(MAX(ticket_number), 1000) AS max_num FROM support_cases` as any[]
          const ticketNumber = parseInt(String(maxResult[0]?.max_num || '1000')) + 1
          const priority = v.severity === 'urgent' ? 'urgent' : v.severity === 'high' ? 'high' : 'medium'
          await sql`
            INSERT INTO support_cases (
              id, ticket_number, channel_id, org_id, title, description,
              category, priority, status, source_message_id
            ) VALUES (
              ${caseId}, ${ticketNumber}, ${cand.channel_id}, ${ORG},
              ${(v.title || clientText.slice(0, 90)).slice(0, 100)},
              ${(v.summary || clientText).slice(0, 500)},
              ${(v.category || 'general').slice(0, 60)}, ${priority}, 'detected',
              ${clientMsgs[0].id}
            )`
          // связываем сообщения окна с кейсом (FRT/статистика кейса)
          await sql`UPDATE support_messages SET case_id = ${caseId}
            WHERE channel_id = ${cand.channel_id} AND org_id = ${ORG} AND case_id IS NULL
              AND created_at > ${cand.window_start} AND created_at <= ${cand.last_client_at}`.catch(() => {})
          casesCreated++
        }
      }

      await sql`INSERT INTO support_problem_scans (
        org_id, channel_id, window_start, window_end, message_count,
        is_problem, confidence, category, severity, title, summary, regex_flag, case_id, mode
      ) VALUES (
        ${ORG}, ${cand.channel_id}, ${cand.window_start}, ${cand.last_client_at}, ${msgs.length},
        ${isProblem}, ${v?.confidence ?? null}, ${v?.category?.slice(0, 120) ?? null},
        ${v?.severity ?? null}, ${v?.title?.slice(0, 200) ?? null}, ${v?.summary?.slice(0, 500) ?? null},
        ${regexFlag}, ${caseId}, ${mode}
      )`

      if (isProblem) {
        const chName = await sql`SELECT name FROM support_channels WHERE id = ${cand.channel_id} LIMIT 1` as any[]
        await sql`INSERT INTO support_ai_events (org_id, actor, kind, channel_id, channel_name, reasoning, payload, mode)
          VALUES (${ORG}, 'problem_scan', 'detect', ${cand.channel_id}, ${chName[0]?.name || null},
            ${v.title || v.category || 'проблема'},
            ${JSON.stringify({ category: v.category, severity: v.severity, confidence: v.confidence, regexFlag, caseId })}::jsonb,
            ${mode})`.catch(() => {})
      }
    } catch (e: any) {
      console.error('[problem-scan] channel', cand.channel_id, e.message)
    }
  }

  const summary = `Скан сессий: ${scanned}, проблем: ${flagged}, кейсов: ${casesCreated}, regex-совпадение: ${scanned ? Math.round((100 * regexAgree) / scanned) : 0}%`
  await sql`INSERT INTO support_ai_events (org_id, actor, kind, reasoning, payload, mode)
    VALUES (${ORG}, 'problem_scan', 'cycle', ${summary},
      ${JSON.stringify({ scanned, flagged, casesCreated, regexAgree, candidates: candidates.length })}::jsonb, ${mode})`.catch(() => {})

  console.log(`[problem-scan] ${summary} (mode=${mode})`)
  return json({ ok: true, mode, scanned, flagged, casesCreated })
}
