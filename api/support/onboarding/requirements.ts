import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureOnboardingSchema } from '../lib/onboarding-schema.js'

export const config = { runtime: 'edge' }

/**
 * Список требований к клиенту — из ТЗ проекта.
 *
 * Заявка на подключение знает, какие блоки выбраны; для каждого блока есть
 * то, что обязан предоставить клиент (доступы, меню, реквизиты). Раньше этот
 * список сотрудник каждый раз сочинял в группе по памяти — теперь система
 * собирает его из задач проекта, а сотрудник отправляет одной кнопкой.
 *
 * GET ?brandId= → { text, items } — текст готов к отправке в группу клиента.
 */

/** Категория блока → что нужно от клиента (шаблон; {opts} = выбранные поставщики) */
const NEEDS: Array<[RegExp, string]> = [
  [/^pos$/i, 'Доступы к POS ({opts}): адрес сервера/кабинета, логин и пароль администратора, API-ключ'],
  [/тип оплаты/i, 'Кабинеты платёжных систем ({opts}): доступы и ключи касс'],
  [/каналы продаж/i, 'Для каналов продаж ({opts}): логотип в хорошем качестве, фирменные цвета, желаемый домен'],
  [/курьер/i, 'Кабинеты курьерских сервисов ({opts}): доступы для интеграции'],
  [/смс/i, 'Аккаунт СМС-провайдера ({opts}): логин и ключ API, согласованное имя отправителя'],
  [/агрегатор/i, 'Доступы к кабинетам агрегаторов ({opts})'],
  [/телефония/i, 'Доступы к телефонии ({opts}): SIP-данные или кабинет'],
  [/фискал/i, 'Данные фискализации ({opts}): ключи фискального модуля'],
  [/аналитика и маркетинг/i, 'Доступы к аналитике ({opts}): контейнер/счётчик'],
  [/модули/i, 'По модулям ({opts}): контакты ответственных на вашей стороне'],
]

/** Блоки без опций, которые тоже требуют материалов от клиента */
const BASE_NEEDS: Array<[RegExp, string]> = [
  [/меню|категории и товары/i, 'Актуальное меню: названия, цены, описания и фото блюд'],
  [/филиал/i, 'Адреса филиалов, режим работы, телефоны точек'],
  [/геозон/i, 'Зоны доставки по каждому филиалу'],
  [/тарифы доставки/i, 'Тарифы доставки по зонам (стоимость, минимальный заказ)'],
  [/основные настройки/i, 'Реквизиты юрлица для договора и название бренда как в документах'],
]

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  await ensureOnboardingSchema(sql, orgId)

  const brandId = new URL(req.url).searchParams.get('brandId')
  if (!brandId) return json({ error: 'brandId is required' }, 400)

  const [brand] = await sql`
    SELECT b.id, b.name, p.name AS pos_name FROM onboarding_brands b
    LEFT JOIN onboarding_pos_systems p ON p.id = b.pos_id
    WHERE b.id = ${brandId} AND b.org_id = ${orgId} LIMIT 1
  ` as any[]
  if (!brand) return json({ error: 'brand not found' }, 404)

  // Живые задачи проекта (не «Не требуется»/«Отменено») с блоками и поставщиками
  const rows = await sql`
    SELECT tt.label AS step, c.label AS cat, o.label AS opt
    FROM onboarding_tasks t
    JOIN onboarding_task_types tt ON tt.id = t.task_type_id
    LEFT JOIN onboarding_option_categories c ON c.id = tt.option_category_id
    LEFT JOIN onboarding_options o ON o.id = t.option_id
    LEFT JOIN onboarding_statuses s ON s.id = t.status_id
    WHERE t.brand_id = ${brandId} AND t.org_id = ${orgId}
      AND COALESCE(s.kind, 'todo') NOT IN ('na', 'cancelled')
    ORDER BY tt.sort_order
  ` as any[]

  // Сгруппировать поставщиков по блоку
  const byCat = new Map<string, Set<string>>()
  const stepsSeen = new Set<string>()
  for (const r of rows) {
    stepsSeen.add(r.step)
    if (!r.cat) continue
    if (!byCat.has(r.cat)) byCat.set(r.cat, new Set())
    if (r.opt) byCat.get(r.cat)!.add(r.opt)
  }
  if (brand.pos_name) {
    if (!byCat.has('POS')) byCat.set('POS', new Set())
    byCat.get('POS')!.add(brand.pos_name)
  }

  const items: string[] = []
  for (const [cat, opts] of byCat) {
    const tpl = NEEDS.find(([re]) => re.test(cat))?.[1]
    if (!tpl) continue
    const list = [...opts].join(', ')
    if (tpl.includes('{opts}') && !list) continue
    items.push(tpl.replace('{opts}', list))
  }
  for (const [re, need] of BASE_NEEDS) {
    if ([...stepsSeen].some(s => re.test(s))) items.push(need)
  }

  const text = [
    `Здравствуйте! Мы начали подключение «${brand.name}» к Delever. 🚀`,
    '',
    'Чтобы запуститься быстрее, пришлите, пожалуйста, в эту группу:',
    ...items.map((x, i) => `${i + 1}. ${x}`),
    '',
    'Как только соберём всё по списку — сразу двигаемся дальше. Если по какому-то пункту нужны пояснения, пишите здесь, поможем.',
  ].join('\n')

  return json({ brand: { id: brand.id, name: brand.name }, items, text })
}
