import { neon } from '@neondatabase/serverless'
import { getRequestOrgId } from '../lib/org.js'

export const config = {
  runtime: 'edge',
  maxDuration: 300,
  regions: ['iad1'],
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// GitBook base URL
const GITBOOK_BASE = 'https://delever.gitbook.io/delever'

// All documentation pages to parse
const DOC_PAGES = [
  { path: '/user-guide/admin-panel/avtorizaciya', category: 'Авторизация' },
  { path: '/user-guide/admin-panel/dashboard', category: 'Дашбоард' },
  { path: '/user-guide/admin-panel/dashboard/zakazy', category: 'Заказы' },
  { path: '/user-guide/admin-panel/dashboard/clients', category: 'Клиенты' },
  { path: '/user-guide/admin-panel/dashboard/products', category: 'Продукты' },
  { path: '/user-guide/admin-panel/dashboard/employees', category: 'Сотрудники' },
  { path: '/user-guide/admin-panel/orders', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/bronirovaniya', category: 'Бронирования' },
  { path: '/user-guide/admin-panel/orders/sendinvoice', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/trackcourier', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/create', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/additionally', category: 'Заказы' },
  { path: '/user-guide/admin-panel/clients', category: 'Клиенты' },
  { path: '/user-guide/admin-panel/clients/clients', category: 'Клиенты' },
  { path: '/user-guide/admin-panel/personal', category: 'Персонал' },
  { path: '/user-guide/admin-panel/personal/operator', category: 'Персонал' },
  { path: '/user-guide/admin-panel/personal/couriers', category: 'Курьеры' },
  { path: '/user-guide/admin-panel/personal/courier-type', category: 'Курьеры' },
  { path: '/user-guide/admin-panel/personal/courier-fare', category: 'Курьеры' },
  { path: '/user-guide/admin-panel/personal/courier-attendance', category: 'Курьеры' },
  { path: '/user-guide/admin-panel/personal/courier-bonus-penalty', category: 'Курьеры' },
  { path: '/user-guide/admin-panel/catalog', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/menu', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/goods', category: 'Товары' },
  { path: '/user-guide/admin-panel/catalog/goods/main', category: 'Товары' },
  { path: '/user-guide/admin-panel/catalog/goods/modifier', category: 'Модификаторы' },
  { path: '/user-guide/admin-panel/catalog/goods/simple', category: 'Товары' },
  { path: '/user-guide/admin-panel/catalog/goods/combo', category: 'Комбо' },
  { path: '/user-guide/admin-panel/catalog/goods/variable', category: 'Товары' },
  { path: '/user-guide/admin-panel/catalog/recommended_products', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/category', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/attributes', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/ingredients', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/brands', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/recipes', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/tags', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/abcxyz', category: 'Аналитика' },
  { path: '/user-guide/admin-panel/catalog/department', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/price-changer', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/forecasting', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/product-to-order', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/product-comment', category: 'Каталог' },
  { path: '/user-guide/admin-panel/marketing', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/stocks', category: 'Акции' },
  { path: '/user-guide/admin-panel/marketing/sms-sending', category: 'СМС Рассылка' },
  { path: '/user-guide/admin-panel/marketing/notification-to-apps', category: 'Уведомления' },
  { path: '/user-guide/admin-panel/marketing/popup', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/banners', category: 'Баннеры' },
  { path: '/user-guide/admin-panel/marketing/stories', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/telegram-post', category: 'Telegram' },
  { path: '/user-guide/admin-panel/marketing/news', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/gallery', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/vacancies', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/trigery', category: 'Триггеры' },
  { path: '/user-guide/admin-panel/marketing/trigery/aktivnost-klientov', category: 'Триггеры' },
  { path: '/user-guide/admin-panel/marketing/referaly', category: 'Рефералы' },
  { path: '/user-guide/admin-panel/kitchen', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/kitchen_orders', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/buffer', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/vdu', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/product-sales', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/distribution', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/kod-vydachi-zakaza', category: 'Кухня' },
  { path: '/user-guide/admin-panel/settings', category: 'Настройки' },
  { path: '/user-guide/admin-panel/settings/fares', category: 'Тарифы' },
  { path: '/user-guide/admin-panel/settings/integrations', category: 'Интеграции' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh', category: 'Каналы продаж' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/content-settings', category: 'Каналы продаж' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/bot-settings', category: 'Настройки бота' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/nastroiki-saita', category: 'Настройки сайта' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/kiosk', category: 'Киоск' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/nastroiki-mobilnogo-prilozheniya', category: 'Мобильное приложение' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/nastroiki-qr-zal', category: 'QR-зал' },
  { path: '/user-guide/admin-panel/settings/integrations/kanaly-prodazh/nastroiki-sozdaniya-zakazov-v-admin-paneli', category: 'Заказы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy', category: 'POS системы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/iiko', category: 'IIKO' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/jowi', category: 'Jowi' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/rkeeper', category: 'RKeeper' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/poster', category: 'Poster' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/paloma-365', category: 'Paloma' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/neon-alisa', category: 'Neon Alisa' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/yaros', category: 'Yaros' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/clopos', category: 'Clopos' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/alipos', category: 'Alipos' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov', category: 'Агрегаторы' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/wolt', category: 'Wolt' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/uzum-tezkor', category: 'UzumTezkor' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/yandex-eats', category: 'Яндекс Еда' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/express24', category: 'Express24' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/chocofood', category: 'Chocofood' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/foody', category: 'Foody' },
  { path: '/user-guide/admin-panel/settings/integrations/sluzhby-dostavki', category: 'Доставка' },
  { path: '/user-guide/admin-panel/settings/integrations/sluzhby-dostavki/wolt-drive', category: 'Wolt Drive' },
  { path: '/user-guide/admin-panel/settings/integrations/sluzhby-dostavki/noor', category: 'Noor' },
  { path: '/user-guide/admin-panel/settings/integrations/sluzhby-dostavki/yandex-delivery', category: 'Яндекс Доставка' },
  { path: '/user-guide/admin-panel/settings/integrations/sluzhby-dostavki/d-courier', category: 'D-courier' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy', category: 'Платежи' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/kaspi', category: 'Kaspi' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/payme', category: 'Payme' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/click', category: 'Click' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/uzum', category: 'Uzum' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/epay', category: 'Epay' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/tiptop-pay', category: 'TipTop Pay' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/atmos', category: 'Atmos' },
  { path: '/user-guide/admin-panel/settings/integrations/sms-provaidery/sms', category: 'СМС' },
  { path: '/user-guide/admin-panel/settings/aggregator', category: 'Агрегатор' },
  { path: '/user-guide/admin-panel/settings/user-roles', category: 'Роли и доступ' },
  { path: '/user-guide/admin-panel/settings/company', category: 'Компания' },
  { path: '/user-guide/admin-panel/settings/reviews', category: 'Отзывы' },
  { path: '/user-guide/admin-panel/settings/cancel-reasons', category: 'Причины отмены' },
  { path: '/user-guide/admin-panel/settings/completion-reasons', category: 'Причины завершения' },
  { path: '/user-guide/admin-panel/settings/balance', category: 'Баланс' },
  { path: '/user-guide/admin-panel/settings/discounts', category: 'Скидки' },
  { path: '/user-guide/admin-panel/settings/sms-template', category: 'SMS шаблон' },
  { path: '/user-guide/admin-panel/settings/order-type', category: 'Типы заказов' },
  { path: '/user-guide/admin-panel/settings/payment-type', category: 'Типы оплаты' },
  { path: '/user-guide/admin-panel/account', category: 'Личный кабинет' },
]

// Extract text content from HTML
function extractText(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text.slice(0, 10000) // Limit content size
}

// Extract title from HTML
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) {
    return titleMatch[1].replace(' | Delever', '').trim()
  }
  return 'Untitled'
}

// Generate keywords
function generateKeywords(text: string, category: string): string[] {
  const keywords = new Set<string>()
  keywords.add(category.toLowerCase())
  
  const importantWords = [
    'заказ', 'клиент', 'курьер', 'меню', 'товар', 'продукт',
    'оплата', 'доставка', 'интеграция', 'iiko', 'rkeeper', 'poster',
    'wolt', 'яндекс', 'payme', 'click', 'uzum', 'бот', 'telegram',
    'акция', 'скидка', 'кухня', 'настройка', 'авторизация'
  ]
  
  const lowerText = text.toLowerCase()
  for (const word of importantWords) {
    if (lowerText.includes(word)) {
      keywords.add(word)
    }
  }
  
  return Array.from(keywords).slice(0, 15)
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const batchSize = Math.min(parseInt(url.searchParams.get('batch') || '10'), 15)
  const pagesToSync = DOC_PAGES.slice(offset, offset + batchSize)

  if (pagesToSync.length === 0) {
    const stats = await sql`SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories FROM support_docs WHERE org_id = ${orgId}`
    return json({ success: true, synced: 0, total: Number(stats[0]?.total || 0), done: true, message: 'Все страницы синхронизированы' })
  }

  try {
    try { await sql`ALTER TABLE support_docs ADD COLUMN IF NOT EXISTS org_id VARCHAR(50)` } catch {}
    await sql`
      CREATE TABLE IF NOT EXISTS support_docs (
        id SERIAL PRIMARY KEY,
        org_id VARCHAR(50),
        title TEXT NOT NULL,
        content TEXT,
        url TEXT UNIQUE NOT NULL,
        path TEXT,
        category TEXT,
        keywords TEXT[],
        content_hash TEXT,
        synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `

    let synced = 0
    const errors: string[] = []

    async function syncPage(page: { path: string; category: string }) {
      const pageUrl = `${GITBOOK_BASE}${page.path}`
      try {
        const response = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Delever-Support-Bot/1.0', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) { errors.push(`${page.path}: HTTP ${response.status}`); return }
        const html = await response.text()
        const title = extractTitle(html)
        const content = extractText(html)
        const keywords = generateKeywords(content, page.category)
        await sql`
          INSERT INTO support_docs (title, content, url, path, category, keywords, synced_at, org_id)
          VALUES (${title}, ${content}, ${pageUrl}, ${page.path}, ${page.category}, ${keywords}, NOW(), ${orgId})
          ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, category = EXCLUDED.category, keywords = EXCLUDED.keywords, synced_at = NOW()
        `
        synced++
      } catch (e: any) { errors.push(`${page.path}: ${e.message}`) }
    }

    const batches = []
    for (let i = 0; i < pagesToSync.length; i += 3) {
      batches.push(pagesToSync.slice(i, i + 3))
    }
    for (const batch of batches) {
      await Promise.all(batch.map(syncPage))
    }

    const stats = await sql`SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories FROM support_docs WHERE org_id = ${orgId}`
    const nextOffset = offset + batchSize
    const hasMore = nextOffset < DOC_PAGES.length

    return json({
      success: true,
      synced,
      batch: `${offset + 1}-${offset + pagesToSync.length} из ${DOC_PAGES.length}`,
      total: Number(stats[0]?.total || 0),
      categories: Number(stats[0]?.categories || 0),
      hasMore,
      nextUrl: hasMore ? `/api/support/docs/sync?offset=${nextOffset}&batch=${batchSize}` : null,
      errors: errors.length > 0 ? errors : undefined,
    })
    
  } catch (error: any) {
    console.error('[Docs Sync Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
