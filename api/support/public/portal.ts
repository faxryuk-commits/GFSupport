import { getSQL, json, corsHeaders } from '../_lib/db.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Клиентский статус-портал — публичная страница по токену из группы.
 *
 * Клиент перестаёт спрашивать «ну что там?»: страница показывает прогресс
 * подключения, что мы ждём от него (со ссылками на инструкции базы знаний)
 * и статусы всех его запросов из переписки. Обновляется само — данные те же,
 * что в матрице и кейсах.
 *
 * Без авторизации, гейт — случайный portal_token бренда. Наружу уходит только
 * клиентское: ни имён сотрудников, ни внутренних заметок.
 */

/** Категория блока → что просим у клиента (текст для страницы) */
const ASKS: Array<[RegExp, string, string]> = [
  [/^pos$/i, 'Доступ к {opts}', 'Адрес сервера или кабинета, логин и пароль администратора, API-ключ'],
  [/тип оплаты/i, 'Кабинеты оплат: {opts}', 'Доступы и ключи касс для онлайн-оплаты'],
  [/каналы продаж/i, 'Материалы для каналов: {opts}', 'Логотип в хорошем качестве, фирменные цвета, желаемый домен'],
  [/курьер/i, 'Кабинеты курьерских сервисов: {opts}', 'Доступы для интеграции доставки'],
  [/смс/i, 'Аккаунт СМС: {opts}', 'Логин, ключ API и согласованное имя отправителя'],
  [/агрегатор/i, 'Кабинеты агрегаторов: {opts}', 'Доступы для интеграции витрин'],
  [/телефония/i, 'Доступы телефонии: {opts}', 'SIP-данные или кабинет провайдера'],
  [/фискал/i, 'Данные фискализации: {opts}', 'Ключи фискального модуля'],
]
const BASE_ASKS: Array<[RegExp, string, string]> = [
  [/меню|категории и товары/i, 'Меню с ценами и фото', 'Названия, описания, цены и фото блюд — таблицей или выгрузкой из POS'],
  [/филиал/i, 'Адреса филиалов', 'Точки, режим работы, телефоны'],
  [/геозон/i, 'Зоны доставки', 'Зоны по каждому филиалу'],
  [/тарифы доставки/i, 'Тарифы доставки', 'Стоимость и минимальный заказ по зонам'],
  [/основные настройки/i, 'Реквизиты юрлица', 'Для договора — как в документах'],
]

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const token = (new URL(req.url).searchParams.get('token') || '').trim()
  if (!token || token.length < 12) return json({ error: 'not found' }, 404)

  const [brand] = await sql`
    SELECT b.id, b.org_id, b.name, b.tariff, b.launch_due, b.channel_id, b.started_at,
           p.name AS pos_name
    FROM onboarding_brands b
    LEFT JOIN onboarding_pos_systems p ON p.id = b.pos_id
    WHERE b.portal_token = ${token} LIMIT 1
  ` as any[]
  if (!brand) return json({ error: 'not found' }, 404)

  const [tasks, cases] = await sql.transaction([
    sql`
      SELECT tt.label AS step, tt.sort_order, tt.group_label, tt.guide_url AS tt_guide,
             c.label AS cat, o.label AS opt, o.guide_url AS opt_guide,
             COALESCE(s.kind, 'todo') AS kind, t.waiting_on, t.status_since
      FROM onboarding_tasks t
      JOIN onboarding_task_types tt ON tt.id = t.task_type_id
      LEFT JOIN onboarding_option_categories c ON c.id = tt.option_category_id
      LEFT JOIN onboarding_options o ON o.id = t.option_id
      LEFT JOIN onboarding_statuses s ON s.id = t.status_id
      WHERE t.brand_id = ${brand.id} AND t.org_id = ${brand.org_id}
      ORDER BY tt.sort_order
    `,
    sql`
      SELECT title, status, created_at, resolved_at FROM support_cases
      WHERE org_id = ${brand.org_id} AND channel_id = ${brand.channel_id}
        AND (resolved_at IS NULL OR resolved_at > NOW() - INTERVAL '14 days')
        AND status NOT IN ('cancelled')
      ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT 12
    `,
  ]) as any[]

  const live = (tasks as any[]).filter((t: any) => !['na', 'cancelled'].includes(t.kind))
  const done = live.filter((t: any) => t.kind === 'done').length

  // «Что нужно от вас»: блоки с поставщиками + базовые материалы, со статусом
  const byCat = new Map<string, any[]>()
  for (const t of live) if (t.cat) {
    if (!byCat.has(t.cat)) byCat.set(t.cat, [])
    byCat.get(t.cat)!.push(t)
  }
  const needs: any[] = []
  const days = (since: any) => {
    const s = String(since)
    const t = new Date(s.includes('Z') || s.includes('+') ? s : s + 'Z').getTime()
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : 0
  }
  for (const [cat, rows] of byCat) {
    const tpl = ASKS.find(([re]) => re.test(cat))
    if (!tpl) continue
    const opts = [...new Set(rows.map((r: any) => r.opt).filter(Boolean))]
    if (tpl[1].includes('{opts}') && !opts.length && !/^pos$/i.test(cat)) continue
    const allDone = rows.every((r: any) => r.kind === 'done')
    const waiting = rows.find((r: any) => r.kind === 'waiting' && r.waiting_on === 'client')
    needs.push({
      title: tpl[1].replace('{opts}', opts.join(', ') || brand.pos_name || ''),
      desc: tpl[2],
      guide: rows.find((r: any) => r.opt_guide)?.opt_guide || rows.find((r: any) => r.tt_guide)?.tt_guide || null,
      state: allDone ? 'done' : waiting ? 'waiting' : 'progress',
      waitDays: waiting ? days(waiting.status_since) : 0,
    })
  }
  const stepsSeen = [...new Set(live.map((t: any) => t.step))]
  for (const [re, title, desc] of BASE_ASKS) {
    const rows = live.filter((t: any) => re.test(t.step))
    if (!rows.length) continue
    const allDone = rows.every((r: any) => r.kind === 'done')
    const waiting = rows.find((r: any) => r.kind === 'waiting' && r.waiting_on === 'client')
    needs.push({
      title, desc,
      guide: rows.find((r: any) => r.tt_guide)?.tt_guide || null,
      state: allDone ? 'done' : waiting ? 'waiting' : 'progress',
      waitDays: waiting ? days(waiting.status_since) : 0,
    })
  }

  // Этапы «что делаем мы»: блоки запуска по group_label (или первые слова шага)
  const groups: { label: string; state: string }[] = []
  for (const t of live) {
    const label = t.group_label || t.step
    let g = groups.find(x => x.label === label)
    if (!g) { g = { label, state: 'todo' }; groups.push(g) }
    if (t.kind !== 'done' && g.state !== 'now') g.state = ['active', 'waiting'].includes(t.kind) ? 'now' : g.state
  }
  for (const g of groups) {
    const rows = live.filter((t: any) => (t.group_label || t.step) === g.label)
    if (rows.every((r: any) => r.kind === 'done')) g.state = 'done'
  }

  // Запросы клиента из переписки — только клиентское
  const requests = (cases as any[]).map((c: any) => ({
    title: c.title,
    state: c.resolved_at || c.status === 'resolved' || c.status === 'closed' ? 'done'
      : c.status === 'waiting' ? 'waiting' : 'progress',
    at: c.resolved_at || c.created_at,
  }))

  return json({
    brand: {
      name: brand.name, tariff: brand.tariff, launchDue: brand.launch_due,
      pos: brand.pos_name,
    },
    progress: { done, total: live.length },
    needs,
    groups: groups.slice(0, 8),
    requests,
  })
}
