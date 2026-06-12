/**
 * Cron: резолвер ошибок заказов. Превращает поток ошибок из фид-канала
 * (support_channels.type='feed', ингест в webhook/telegram.ts) в РЕШЕНИЯ:
 * диагноз + шаги + ответственный + кейс/инцидент, с автозакрытием.
 *
 * Логика (валидирована на реальном фиде):
 *   1. Парсим структурные посты: Ресторан / Сервис / Источник / Текст ошибки.
 *   2. Классифицируем тип (out_of_zone / order_create_fail / webhook / menu / ...).
 *   3. Кластеризуем за окно и смотрим РАЗБРОС:
 *        - сконцентрировано на 1 ресторане (≥60%) → это конфиг/мерчант → КЕЙС на ресторан;
 *        - размазано по многим → это инцидент платформы → ЭСКАЛАЦИЯ в инженерку.
 *   4. По playbook берём диагноз + шаги решения + ответственного.
 *   5. Дедуп: один открытый кейс на (ресторан, тип). Идемпотентный маркер в source_message_id.
 *   6. Автозакрытие: если по открытому кейсу-резолверу поток ошибок иссяк за окно — resolved.
 *
 * SHADOW/безопасность: клиенту НИЧЕГО не шлёт. Действия только ВНУТРЕННИЕ —
 * кейс в воронке + событие в Журнал (support_ai_events). Проактивное касание
 * мерчанта идёт ЧЕРНОВИКОМ в описании кейса, отправляет человек.
 * Выключатель: support_settings.error_resolver_enabled = 'false'.
 *
 * Защита эндпоинта: Vercel cron (user-agent) или CRON_SECRET. Расписание: каждые 30 минут.
 */
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

const ORG = process.env.ERROR_RESOLVER_ORG || 'org_delever'
const WINDOW_HOURS = 6          // окно анализа ошибок
const CONCENTRATION = 0.6       // доля одного ресторана → «сконцентрировано»
const MIN_CASE = 8              // мин. ошибок для кейса на ресторан
const MIN_INCIDENT = 12         // мин. ошибок для инцидента платформы
const RESOLVE_AFTER_QUIET = true // закрывать кейс, если поток иссяк

async function enabled(sql: any): Promise<boolean> {
  if (process.env.ERROR_RESOLVER_ENABLED === '0') return false
  try {
    const r = await sql`SELECT value FROM support_settings WHERE org_id=${ORG} AND key='error_resolver_enabled' LIMIT 1`
    const v = String(r[0]?.value ?? '').toLowerCase()
    return v === '' ? true : (v === 'true' || v === '1') // по умолчанию включён
  } catch { return true }
}

const field = (t: string, label: string): string | null => {
  const m = t.match(new RegExp(label + '\\s*:?\\s*([^\\n]+?)(?=\\s*(?:Ресторан|Сервис|Источник|Текст ошибки|$))', 'i'))
  return m ? m[1].trim() : null
}
const classify = (e: string | null): string => {
  if (!e) return 'unknown'
  const s = e.toLowerCase()
  if (/за пределами|зоны достав|местополож/.test(s)) return 'out_of_zone'
  if (/rpc error|create.?order|создании заказа/.test(s)) return 'order_create_fail'
  if (/вебхук|webhook|формат запроса/.test(s)) return 'webhook_format'
  if (/меню|menu|товар|product|блюд|стоп/.test(s)) return 'menu'
  return 'other'
}

type Mode = { cause: string; fix: string[]; owner: string }
const PLAYBOOK: Record<string, { name: string; concentrated: Mode; spread: Mode }> = {
  out_of_zone: {
    name: 'Адрес вне зоны доставки',
    concentrated: { cause: 'Неверно настроена зона доставки (полигон) ресторана — реальные адреса отлетают как «вне зоны».', fix: ['Открыть зону доставки ресторана в админке Delever', 'Сверить полигон с фактической областью', 'Расширить/исправить границы', 'Подтвердить охват с рестораном'], owner: 'account/onboarding' },
    spread: { cause: 'Клиенты заказывают вне реальной зоны (норма) ИЛИ платформенная гео-ошибка.', fix: ['Если по многим разом — проверить геокодер/гео-сервис', 'Если точечно — поведение клиента, решения не требует'], owner: 'platform' },
  },
  order_create_fail: {
    name: 'Сбой создания заказа (integrator)',
    concentrated: { cause: 'Интеграция ресторана с кассой/агрегатором не принимает заказ (касса офлайн, токен, формат).', fix: ['Проверить статус интеграции ресторана', 'Касса онлайн? токен жив?', 'Тестовый заказ', 'При необходимости переподключить интеграцию'], owner: 'integration' },
    spread: { cause: 'Платформенный сбой агрегатора/интегратора — много ресторанов разом.', fix: ['Проверить здоровье integrator-api по источнику', 'Эскалация в инженерку — это инцидент', 'Уведомить затронутые рестораны'], owner: 'engineering' },
  },
  webhook_format: {
    name: 'Неверный вебхук/формат',
    concentrated: { cause: 'Касса/POS ресторана шлёт некорректный вебхук (версия, маппинг).', fix: ['Сверить формат вебхука с ожидаемым', 'Проверить версию интеграции POS', 'Связаться с вендором кассы'], owner: 'integration' },
    spread: { cause: 'Изменился контракт у источника/агрегатора.', fix: ['Проверить changelog источника', 'Поправить парсер вебхука'], owner: 'engineering' },
  },
  menu: {
    name: 'Меню/товар',
    concentrated: { cause: 'Расхождение меню касса↔Delever у ресторана.', fix: ['Запустить синхронизацию меню', 'Сверить цены/стоп-лист'], owner: 'support' },
    spread: { cause: 'Сбой сервиса синхронизации меню.', fix: ['Проверить сервис синка меню'], owner: 'engineering' },
  },
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null)
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  try {
    await sql`CREATE TABLE IF NOT EXISTS support_ai_events (
      id BIGSERIAL PRIMARY KEY, org_id VARCHAR(50), actor VARCHAR(30), kind VARCHAR(30),
      channel_id VARCHAR(60), channel_name VARCHAR(255), tier VARCHAR(20),
      reasoning TEXT, payload JSONB, mode VARCHAR(10), created_at TIMESTAMPTZ DEFAULT NOW()
    )` } catch {}

  const isOn = await enabled(sql)
  const stat = { enabled: isOn, errors: 0, clusters: 0, cases_created: 0, incidents: 0, resolved: 0 }

  // фид-канал
  const [feed] = await sql`SELECT id FROM support_channels WHERE org_id=${ORG} AND type='feed' ORDER BY last_message_at DESC NULLS LAST LIMIT 1` as any[]
  if (!feed) { return json({ ok: true, note: 'нет feed-канала', ...stat }) }

  // ошибки за окно
  const rows = await sql`
    SELECT text_content t FROM support_messages
    WHERE org_id=${ORG} AND channel_id=${feed.id} AND text_content IS NOT NULL
      AND created_at > NOW() - (${WINDOW_HOURS} || ' hours')::interval` as any[]
  stat.errors = rows.length

  // кластеризация: тип → { n, рестораны:{}, источники:{} }
  const byType: Record<string, { n: number; rest: Record<string, number>; src: Record<string, number> }> = {}
  for (const r of rows) {
    const t = String(r.t).replace(/\s+/g, ' ')
    const cl = classify(field(t, 'Текст ошибки'))
    const rest = field(t, 'Ресторан') || '?'
    const src = field(t, 'Источник') || '?'
    byType[cl] = byType[cl] || { n: 0, rest: {}, src: {} }
    byType[cl].n++; byType[cl].rest[rest] = (byType[cl].rest[rest] || 0) + 1; byType[cl].src[src] = (byType[cl].src[src] || 0) + 1
  }

  for (const [cl, d] of Object.entries(byType)) {
    const pb = PLAYBOOK[cl]
    stat.clusters++
    const restE = Object.entries(d.rest).sort((a, b) => b[1] - a[1])
    const topRest = restE[0]
    const share = topRest ? topRest[1] / d.n : 0
    const concentrated = share >= CONCENTRATION && d.n >= 5
    const mode = pb ? (concentrated ? pb.concentrated : pb.spread) : null
    const name = pb?.name || `Новый тип: ${cl}`

    // карточка решения в Журнал (всегда — полная прозрачность)
    const cardReason = pb
      ? `${name}: ${d.n} ошибок, ${concentrated ? `сконцентрировано на ${topRest[0]} (${Math.round(share * 100)}%)` : `размазано по ${restE.length} ресторанам`}. ${mode!.cause}`
      : `${name}: ${d.n} ошибок — нет playbook, нужен ручной разбор`
    try {
      await sql`INSERT INTO support_ai_events (org_id, actor, kind, channel_id, reasoning, payload, mode)
        VALUES (${ORG}, 'error_resolver', 'solution_card', ${feed.id}, ${cardReason},
        ${JSON.stringify({ type: cl, count: d.n, concentrated, topRestaurant: topRest?.[0], share: Math.round(share * 100), fix: mode?.fix, owner: mode?.owner })}::jsonb, ${isOn ? 'live' : 'shadow'})`
    } catch {}

    if (!isOn || !pb) continue

    // СКОНЦЕНТРИРОВАНО → кейс на ресторан (дедуп идемпотентным маркером)
    if (concentrated && d.n >= MIN_CASE) {
      const marker = `error_resolver~${cl}~${topRest[0]}`.slice(0, 80)
      const [open] = await sql`SELECT id FROM support_cases WHERE org_id=${ORG} AND source_message_id=${marker} AND status NOT IN ('resolved','closed') LIMIT 1` as any[]
      if (!open) {
        const caseId = `case_err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const priority = d.n >= 30 ? 'urgent' : d.n >= 15 ? 'high' : 'medium'
        const desc = `Авто-резолвер: ${name} — ${d.n} ошибок за ${WINDOW_HOURS}ч, ${Math.round(share * 100)}% у «${topRest[0]}».\n\n` +
          `ДИАГНОЗ: ${mode!.cause}\n\nРЕШЕНИЕ:\n${mode!.fix.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n` +
          `ОТВЕТСТВЕННЫЙ: ${mode!.owner}\n\nЧЕРНОВИК КАСАНИЯ МЕРЧАНТУ (отправляет человек): «Здравствуйте! Заметили, что у вас часть заказов отклоняется (${name.toLowerCase()}). Уже разбираемся — проверим настройки с вашей стороны.»`
        try {
          await sql`INSERT INTO support_cases (id, channel_id, org_id, title, description, category, priority, status, source_message_id, created_at)
            VALUES (${caseId}, ${feed.id}, ${ORG}, ${`${topRest[0]}: ${name} (${d.n})`}, ${desc}, ${'order_error'}, ${priority}, 'detected', ${marker}, NOW())`
          stat.cases_created++
        } catch (e: any) { console.error('[error-resolver] case fail', e?.message) }
      }
    }

    // РАЗМАЗАНО + много → инцидент (событие в Журнал; рассылку в инженерку оставляем человеку)
    if (!concentrated && d.n >= MIN_INCIDENT) {
      try {
        await sql`INSERT INTO support_ai_events (org_id, actor, kind, channel_id, tier, reasoning, payload, mode)
          VALUES (${ORG}, 'error_resolver', 'incident', ${feed.id}, 'high', ${`ИНЦИДЕНТ: ${name} — ${d.n} ошибок по ${restE.length} ресторанам за ${WINDOW_HOURS}ч → эскалация (${mode!.owner})`},
          ${JSON.stringify({ type: cl, count: d.n, restaurants: restE.length, sources: d.src })}::jsonb, ${isOn ? 'live' : 'shadow'})`
        stat.incidents++
      } catch {}
    }
  }

  // АВТОЗАКРЫТИЕ: открытые кейсы-резолверы, по которым поток иссяк
  if (isOn && RESOLVE_AFTER_QUIET) {
    const openCases = await sql`SELECT id, source_message_id, created_at FROM support_cases
      WHERE org_id=${ORG} AND source_message_id LIKE 'error_resolver~%' AND status NOT IN ('resolved','closed')` as any[]
    for (const oc of openCases) {
      const parts = String(oc.source_message_id).split('~')
      if (parts.length < 3) continue
      const cl = parts[1]; const rest = parts.slice(2).join('~')
      const stillActive = byType[cl]?.rest[rest] || 0
      const ageMin = (Date.now() - new Date(oc.created_at).getTime()) / 60000
      // закрываем, если за окно ноль ошибок этого типа у ресторана и кейсу > 30 мин
      if (stillActive === 0 && ageMin > 30) {
        try {
          await sql`UPDATE support_cases SET status='resolved', resolved_at=NOW(),
            resolution_time_minutes=${Math.floor(ageMin)} WHERE id=${oc.id} AND org_id=${ORG}`
          stat.resolved++
        } catch {}
      }
    }
  }

  // heartbeat цикла
  try {
    await sql`INSERT INTO support_ai_events (org_id, actor, kind, channel_id, reasoning, payload, mode)
      VALUES (${ORG}, 'error_resolver', 'cycle', ${feed.id},
      ${`Цикл: ${stat.errors} ошибок, ${stat.clusters} кластеров, ${stat.cases_created} кейсов, ${stat.incidents} инцидентов, ${stat.resolved} закрыто`},
      ${JSON.stringify(stat)}::jsonb, ${isOn ? 'live' : 'shadow'})`
  } catch {}

  console.log(`[error-resolver] ${JSON.stringify(stat)}`)
  return json({ ok: true, ...stat })
}
