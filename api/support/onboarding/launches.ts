import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { ensureOnboardingSchema } from '../lib/onboarding-schema.js'

export const config = { runtime: 'edge' }

/**
 * Сколько брендов мы запустили — за неделю, месяц, квартал, год.
 *
 * В модуле было видно, кто сейчас подключается и где застрял, но не было
 * ответа на первый вопрос, который задают про онбординг: сколько запустили
 * и кого именно. Цифра без названий бесполезна — «за месяц три» ничего не
 * говорит, пока не видно, какие это три бренда и сколько каждый шёл.
 *
 * Запуск — это момент, когда финальный шаг чек-листа стал «Готово». Берём его
 * из журнала событий: он хранит переход, а не только текущее состояние.
 *
 * Периоды календарные и в рабочей зоне: «за неделю» — это текущая неделя
 * команды, а не последние 168 часов.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // Доска подключений — это список клиентов, кто их ведёт и что о них написано
  // в комментариях. Ручка отдавала всё это без токена любому, кто знает адрес
  // (найдено 22.08.2026)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureOnboardingSchema(sql, orgId)

  // Регион из шапки раздела: '' = все, бренды без региона видны всегда
  const market = (new URL(req.url).searchParams.get('market') || '').trim()
  const marketCond = `($2 = '' OR b.market_id IS NULL OR b.market_id = $2)`

  // Финальный шаг ищем по смыслу, а не по порядковому номеру: список шагов
  // редактируется, и новый шаг в конце не должен молча стать «запуском»
  const launchedCte = `
    WITH final_type AS (
      SELECT id FROM onboarding_task_types
      WHERE org_id = $1 AND is_active = true
        AND (label ILIKE '%запуск%' OR label ILIKE '%launch%')
      ORDER BY sort_order DESC LIMIT 1
    ),
    launched AS (
      SELECT b.id, b.name, b.started_at, b.tariff, b.owner_name,
             MIN(e.changed_at) AS launched_at
      FROM onboarding_task_events e
      JOIN onboarding_brands b ON b.id = e.brand_id AND b.org_id = $1
      JOIN onboarding_statuses s ON s.id = e.new_status_id AND s.kind = 'done'
      WHERE e.org_id = $1 AND e.task_type_id = (SELECT id FROM final_type)
        AND ${marketCond}
      GROUP BY b.id, b.name, b.started_at, b.tariff, b.owner_name
    )
  `

  const [rows, inProgress] = await sql.transaction([
    sql.query(`
      ${launchedCte}
      SELECT name, launched_at, started_at, tariff, owner_name,
             GREATEST(0, ROUND(EXTRACT(EPOCH FROM (launched_at - started_at)) / 86400))::int AS days
      FROM launched
      ORDER BY launched_at DESC
    `, [orgId, market]),
    sql.query(`
      SELECT b.name, b.started_at, b.owner_name,
             (SELECT COUNT(*) FILTER (WHERE st.kind = 'done')
                FROM onboarding_tasks t JOIN onboarding_statuses st ON st.id = t.status_id
               WHERE t.brand_id = b.id)::int AS done,
             (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.brand_id = b.id)::int AS total
      FROM onboarding_brands b
      WHERE b.org_id = $1 AND b.archived_at IS NULL
        AND ${marketCond}
        AND b.id NOT IN (
          SELECT e.brand_id FROM onboarding_task_events e
          JOIN onboarding_statuses s ON s.id = e.new_status_id AND s.kind = 'done'
          JOIN onboarding_task_types tt ON tt.id = e.task_type_id
          WHERE e.org_id = $1 AND (tt.label ILIKE '%запуск%' OR tt.label ILIKE '%launch%')
        )
      ORDER BY b.started_at
    `, [orgId, market]),
  ]) as any[]

  // Границы периодов считаем здесь, а не в SQL: так одна и та же дата запуска
  // попадает и в «месяц», и в «квартал», и в «год» без дублирования запросов
  const TZ = 'Asia/Tashkent'
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const p = Object.fromEntries(nowParts.map(x => [x.type, x.value])) as Record<string, string>
  const y = +p.year, m = +p.month, d = +p.day
  const startOfDay = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd) - 5 * 3600_000)   // рабочая зона UTC+5

  const today = startOfDay(y, m, d)
  // Неделя с понедельника
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  const weekStart = new Date(today.getTime() - dow * 86400_000)
  const monthStart = startOfDay(y, m, 1)
  const quarterStart = startOfDay(y, Math.floor((m - 1) / 3) * 3 + 1, 1)
  const yearStart = startOfDay(y, 1, 1)

  const list = (rows as any[]).map(r => ({
    name: r.name,
    launchedAt: r.launched_at,
    startedAt: r.started_at,
    days: r.days,
    tariff: r.tariff,
    owner: r.owner_name,
  }))
  const since = (from: Date) => list.filter(x => new Date(x.launchedAt) >= from)

  return json({
    periods: [
      { key: 'week', label: 'За неделю', from: weekStart, brands: since(weekStart) },
      { key: 'month', label: 'За месяц', from: monthStart, brands: since(monthStart) },
      { key: 'quarter', label: 'За квартал', from: quarterStart, brands: since(quarterStart) },
      { key: 'year', label: 'За год', from: yearStart, brands: since(yearStart) },
      { key: 'all', label: 'За всё время', from: null, brands: list },
    ],
    inProgress,
    // Среднее время подключения — по запущенным: сколько дней проходит от
    // старта до запуска. По нему видно, ускоряемся мы или нет
    avgDays: list.length
      ? Math.round(list.reduce((a, x) => a + (x.days || 0), 0) / list.length)
      : null,
  })
}
