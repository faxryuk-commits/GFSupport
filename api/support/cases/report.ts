import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { CASE_TOPICS } from '../lib/case-topics.js'

export const config = { runtime: 'edge' }

/**
 * Отчёт по тикетам: сколько пришло, о чём, сколько решили, за какое время и кто.
 *
 * Раздел показывал текущую очередь — что горит сейчас. На вопрос «как мы
 * работали на прошлой неделе» ответа не было: ни объёма, ни тем, ни времени
 * решения, ни того, кто вытягивает поток.
 *
 * GET ?period=week|month|quarter|year|custom&from=&to=&market=
 *
 * Время решения показываем медианой и p90, а не средним: одна забытая на
 * неделю заявка сдвигает среднее так, что оно перестаёт описывать типичный
 * день. Среднее отдаём рядом — по расхождению с медианой видно, есть ли хвост.
 */

/**
 * Подписи тем. Основной справочник — продуктовый (case-topics), к нему
 * добавлены старые ярлыки категорий: тикеты, размеченные до классификатора,
 * не должны выпасть из отчёта безымянными.
 */
const TOPIC: Record<string, string> = {
  ...Object.fromEntries(CASE_TOPICS.map(t => [t.key, t.label])),
  billing: 'Оплата и тарифы',
  technical: 'Технические сбои',
  order: 'Заказы',
  order_error: 'Ошибки заказов',
  menu: 'Меню и товары',
  integration: 'Интеграции',
  delivery: 'Доставка',
  app: 'Приложение',
  onboarding: 'Подключение',
  feature_request: 'Просят доработку',
  complaint: 'Жалобы',
  question: 'Вопросы',
  general: 'Тема не определена',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const market = url.searchParams.get('market') || ''
  const period = url.searchParams.get('period') || 'week'
  const customFrom = url.searchParams.get('from') || ''
  const customTo = url.searchParams.get('to') || ''

  // Границы считаем в рабочей зоне: «эта неделя» у команды из разных стран
  // должна означать одни и те же дни, а не местный понедельник каждого
  const TZ = 'Asia/Tashkent'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(x => [x.type, x.value])) as Record<string, string>
  const y = +parts.year, mo = +parts.month, da = +parts.day
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd) - 5 * 3600_000)

  let from: Date, to: Date | null = null
  if (period === 'custom' && customFrom) {
    from = new Date(`${customFrom}T00:00:00+05:00`)
    to = customTo ? new Date(`${customTo}T23:59:59+05:00`) : null
  } else if (period === 'month') from = at(y, mo, 1)
  else if (period === 'quarter') from = at(y, Math.floor((mo - 1) / 3) * 3 + 1, 1)
  else if (period === 'year') from = at(y, 1, 1)
  else {
    const dow = (new Date(Date.UTC(y, mo - 1, da)).getUTCDay() + 6) % 7
    from = new Date(at(y, mo, da).getTime() - dow * 86400_000)
  }
  const fromIso = from.toISOString()
  const toIso = to ? to.toISOString() : new Date(Date.now() + 86400_000).toISOString()
  // Предыдущий отрезок той же длины — чтобы цифра читалась как «больше или
  // меньше обычного», а не висела в пустоте
  const prevFrom = new Date(from.getTime() - (new Date(toIso).getTime() - from.getTime())).toISOString()

  const [totals, prev, topics, people, weekly, unresolved] = await sql.transaction([
    sql`
      SELECT COUNT(*)::int created,
             COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int resolved,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY resolution_time_minutes) FILTER (WHERE resolution_time_minutes IS NOT NULL))::int median_min,
             ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
               ORDER BY resolution_time_minutes) FILTER (WHERE resolution_time_minutes IS NOT NULL))::int p90_min,
             ROUND(AVG(resolution_time_minutes))::int avg_min,
             ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60)
               ) FILTER (WHERE first_response_at IS NOT NULL)::int first_reply_min
      FROM support_cases
      WHERE org_id = ${orgId} AND created_at >= ${fromIso} AND created_at < ${toIso}
        AND (${market} = '' OR market_id = ${market})
    `,
    sql`
      SELECT COUNT(*)::int created,
             COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int resolved,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY resolution_time_minutes) FILTER (WHERE resolution_time_minutes IS NOT NULL))::int median_min
      FROM support_cases
      WHERE org_id = ${orgId} AND created_at >= ${prevFrom} AND created_at < ${fromIso}
        AND (${market} = '' OR market_id = ${market})
    `,
    sql`
      SELECT COALESCE(topic, NULLIF(category, ''), 'general') AS category,
             COUNT(*)::int created,
             COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int resolved,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY resolution_time_minutes) FILTER (WHERE resolution_time_minutes IS NOT NULL))::int median_min
      FROM support_cases
      WHERE org_id = ${orgId} AND created_at >= ${fromIso} AND created_at < ${toIso}
        AND (${market} = '' OR market_id = ${market})
      GROUP BY 1 ORDER BY 2 DESC
    `,
    sql`
      SELECT COALESCE(a.name, 'Никто не назначен') AS name,
             c.assigned_to IS NULL AS unassigned,
             COUNT(*)::int taken,
             COUNT(*) FILTER (WHERE c.resolved_at IS NOT NULL)::int resolved,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY c.resolution_time_minutes) FILTER (WHERE c.resolution_time_minutes IS NOT NULL))::int median_min
      FROM support_cases c
      LEFT JOIN support_agents a ON a.id = c.assigned_to
      WHERE c.org_id = ${orgId} AND c.created_at >= ${fromIso} AND c.created_at < ${toIso}
        AND (${market} = '' OR c.market_id = ${market})
      GROUP BY 1, 2 ORDER BY 3 DESC
    `,
    // Восемь недель фоном: одна неделя без соседних ничего не говорит
    sql`
      SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}), 'DD.MM') AS week,
             MIN(date_trunc('week', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})) AS week_start,
             COUNT(*)::int created,
             COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int resolved
      FROM support_cases
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '8 weeks'
        AND (${market} = '' OR market_id = ${market})
      GROUP BY 1 ORDER BY 2
    `,
    sql`
      SELECT id, ticket_number, title, status, created_at,
             ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)::int AS hours_open
      FROM support_cases
      WHERE org_id = ${orgId} AND resolved_at IS NULL
        AND status NOT IN ('closed', 'cancelled')
        AND (${market} = '' OR market_id = ${market})
      ORDER BY created_at LIMIT 20
    `,
  ]) as any[]

  return json({
    period: { key: period, from: fromIso, to: toIso },
    totals: (totals as any[])[0] || {},
    prev: (prev as any[])[0] || {},
    topics: (topics as any[]).map(t => ({
      ...t,
      label: TOPIC[t.category] || t.category,
      // Пустая и «general» — это не тема, а её отсутствие; смешивать их с
      // настоящими темами значит рисовать самый большой сегмент из ничего
      unknown: t.category === 'general',
    })),
    people,
    weekly,
    unresolved,
  })
}
