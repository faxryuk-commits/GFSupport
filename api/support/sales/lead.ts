import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Карточка обращения: кто написал, откуда, что именно сказал.
 *
 * До неё в списке была строка с именем и обрезанным текстом — и на вопрос
 * «что это за заявка» приходилось идти в Amo или в чат. Здесь собрано всё,
 * что о человеке известно на момент первого касания: заполненные им поля
 * формы, переписка, если канал опознан, чем занимался ассистент и во что
 * обращение вылилось.
 *
 * Всё одной пачкой: дорога до базы стоит дороже самих запросов.
 */

/** Служебные ключи Amo и наши — в карточке они шум, а не информация. */
const RAW_SKIP = new Set([
  'id', 'account_id', 'group_id', 'created_by', 'updated_by', 'closed_at',
  'closest_task_at', 'is_deleted', 'custom_fields_values', '_links', '_embedded',
  'score', 'labor_cost', 'is_price_modified_by_robot', 'request_id',
  'created_at', 'updated_at', 'pipeline_id', 'status_id', 'responsible_user_id',
  // Служебные суммы Amo: их никто не заполнял, а в списке полей они выглядят
  // как ответ человека
  'price_with_minor_units', 'is_price_modified_by_robot', 'source_id',
])

/** Как Amo сама называет записи: это не данные человека, а её служебный ярлык. */
const SERVICE_VALUE = /^(Facebook|Instagram|instagram_business|WhatsApp|Telegram)\s*(№|#|:)|^Сделка\s*#|^Заявка (с|из)|^Без названия$/i

/** Человеческие подписи для того, что приходит из форм и ботов. */
const RAW_LABELS: Record<string, string> = {
  name: 'Имя', phone: 'Телефон', email: 'Почта', city: 'Город',
  company: 'Компания', comment: 'Комментарий', message: 'Сообщение',
  utm_source: 'UTM источник', utm_medium: 'UTM канал', utm_campaign: 'UTM кампания',
  utm_content: 'UTM объявление', utm_term: 'UTM ключ', click_id: 'Идентификатор клика',
  referrer: 'Откуда пришёл', page: 'Страница', form_name: 'Название формы',
  price: 'Сумма в Amo', pos: 'POS-система', orders_per_day: 'Заказов в день',
  points: 'Точек', aggregators: 'Агрегаторы', delivery_type: 'Тип доставки',
}

/**
 * Поля, которые человек заполнил сам, — из сырого ответа канала.
 *
 * Форма сайта кладёт их плоским объектом, Amo — в custom_fields_values,
 * «Неразобранное» — в _unsorted_meta. Разбираем все три вида, иначе часть
 * заявок выглядит пустыми, хотя данные пришли.
 */
function readableRaw(raw: any): Array<{ label: string; value: string }> {
  if (!raw || typeof raw !== 'object') return []
  const out: Array<{ label: string; value: string }> = []
  const seen = new Set<string>()
  const push = (key: string, value: any) => {
    if (value === null || value === undefined || value === '') return
    if (typeof value === 'object') return
    // Ноль в «сумме» — это не заполненное поле, а умолчание Amo
    if (key === 'price' && (value === 0 || value === '0')) return
    const text = String(value).slice(0, 500)
    // Служебное имя Amo — не заполненное поле, а как система назвала запись.
    // «Имя: Facebook №1608321444249697» в карточке выглядит данными, хотя это
    // ярлык самой Amo
    if (SERVICE_VALUE.test(text)) return
    // Одно и то же значение приходит и как имя, и как название формы, и как
    // страница — трижды одна строка читается как три разных факта
    if (seen.has(text)) return
    const label = RAW_LABELS[key] || key
    if (out.some(o => o.label === label)) return
    seen.add(text)
    out.push({ label, value: text })
  }

  for (const [k, v] of Object.entries(raw)) {
    if (RAW_SKIP.has(k) || k.startsWith('_')) continue
    push(k, v)
  }
  for (const f of raw.custom_fields_values || []) {
    const v = f?.values?.[0]?.value
    if (v !== undefined && v !== null && typeof v !== 'object') {
      out.push({ label: f.field_name || f.field_code || 'Поле', value: String(v).slice(0, 500) })
    }
  }
  const meta = raw._unsorted_meta
  if (meta) {
    push('form_name', meta.form_name)
    push('referrer', meta.referer || meta.referrer)
    push('page', meta.form_page)
  }
  // Ответы на вопросы лид-формы идут первыми и в том порядке, в каком человек
  // на них отвечал: Meta кладёт их в контакт, и это самое содержательное, что
  // о человеке известно до первого разговора
  const answers = (raw._contact_fields || [])
    .filter((f: any) => f?.value)
    .map((f: any) => ({ label: f.name, value: String(f.value).replace(/_/g, ' ').slice(0, 500) }))

  return [...answers, ...out].slice(0, 24)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const id = url.searchParams.get('id')
  if (!id) return json({ error: 'id is required' }, 400)

  const [leadRows, touchRows, assistantRows, dealRows] = await sql.transaction([
    sql`
      SELECT l.*, s.label AS source, s.key AS source_key,
             ag.name AS agent_name,
             a.id AS account_id, a.name AS account_name, a.city AS account_city,
             a.channel_id, a.instagram, a.telegram, a.website, a.inn
      FROM sales_leads l
      LEFT JOIN sales_sources s ON s.id = l.source_id
      LEFT JOIN support_agents ag ON ag.id = l.assigned_agent_id
      LEFT JOIN sales_accounts a ON a.id = l.account_id
      WHERE l.id = ${id} AND l.org_id = ${orgId}
      LIMIT 1
    `,
    sql`
      SELECT kind, channel, title, detail, url, identity, happened_at
      FROM sales_touchpoints
      WHERE org_id = ${orgId} AND lead_id = ${id}
      ORDER BY happened_at DESC LIMIT 30
    `,
    sql`
      SELECT action, channel, step, message, reply, status, error, created_at
      FROM sales_assistant_log
      WHERE org_id = ${orgId} AND lead_id = ${id}
      ORDER BY created_at DESC LIMIT 20
    `,
    sql`
      SELECT d.id, d.title, d.monthly_amount, d.currency, d.won_at, d.lost_at,
             d.created_at, s.label AS stage
      FROM sales_deals d
      LEFT JOIN sales_stages s ON s.id = d.stage_id
      WHERE d.org_id = ${orgId} AND d.source_lead_id = ${id}
      ORDER BY d.created_at DESC LIMIT 10
    `,
  ]) as any[]

  const lead = (leadRows as any[])[0]
  if (!lead) return json({ error: 'обращение не найдено' }, 404)

  // Переписка — только если канал опознан. Показываем начало разговора, а не
  // хвост: в карточке обращения важно первое сообщение человека, с которого
  // всё началось, и наш ответ на него
  const messages = lead.channel_id
    ? await sql`
        SELECT id, sender_name, is_from_client, text_content, content_type, created_at
        FROM support_messages
        WHERE channel_id = ${lead.channel_id}
        ORDER BY created_at ASC LIMIT 40
      `
    : []

  return json({
    lead,
    fields: readableRaw(lead.raw),
    touchpoints: touchRows,
    assistant: assistantRows,
    deals: dealRows,
    messages,
  })
}
