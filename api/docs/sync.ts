import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
  maxDuration: 60,
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
  // Админ панель - Основные
  { path: '/user-guide/admin-panel/avtorizaciya', category: 'Авторизация' },
  { path: '/user-guide/admin-panel/dashboard', category: 'Дашбоард' },
  
  // Заказы
  { path: '/user-guide/admin-panel/orders', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/bronirovaniya', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/sendinvoice', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/trackcourier', category: 'Заказы' },
  { path: '/user-guide/admin-panel/orders/create', category: 'Заказы' },
  
  // Клиенты
  { path: '/user-guide/admin-panel/clients', category: 'Клиенты' },
  
  // Персонал
  { path: '/user-guide/admin-panel/personal', category: 'Персонал' },
  { path: '/user-guide/admin-panel/personal/operator', category: 'Персонал' },
  { path: '/user-guide/admin-panel/personal/couriers', category: 'Персонал' },
  
  // Каталог
  { path: '/user-guide/admin-panel/catalog', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/menu', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/goods', category: 'Каталог' },
  { path: '/user-guide/admin-panel/catalog/category', category: 'Каталог' },
  
  // Маркетинг
  { path: '/user-guide/admin-panel/marketing', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/stocks', category: 'Маркетинг' },
  { path: '/user-guide/admin-panel/marketing/banners', category: 'Маркетинг' },
  
  // Кухня
  { path: '/user-guide/admin-panel/kitchen', category: 'Кухня' },
  { path: '/user-guide/admin-panel/kitchen/kitchen_orders', category: 'Кухня' },
  
  // Настройки
  { path: '/user-guide/admin-panel/settings', category: 'Настройки' },
  { path: '/user-guide/admin-panel/settings/fares', category: 'Настройки' },
  
  // Интеграции - POS системы
  { path: '/user-guide/admin-panel/settings/integrations', category: 'Интеграции' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy', category: 'POS системы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/iiko', category: 'POS системы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/rkeeper', category: 'POS системы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/poster', category: 'POS системы' },
  { path: '/user-guide/admin-panel/settings/integrations/pos-sistemy/jowi', category: 'POS системы' },
  
  // Интеграции - Агрегаторы
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov', category: 'Агрегаторы' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/wolt', category: 'Агрегаторы' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/yandex-eats', category: 'Агрегаторы' },
  { path: '/user-guide/admin-panel/settings/integrations/agregatory-zakazov/express24', category: 'Агрегаторы' },
  
  // Интеграции - Платежи
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy', category: 'Платежи' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/payme', category: 'Платежи' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/click', category: 'Платежи' },
  { path: '/user-guide/admin-panel/settings/integrations/platyozhnye-sistemy/uzum', category: 'Платежи' },
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const pageLimit = Math.min(parseInt(url.searchParams.get('limit') || '50'), DOC_PAGES.length)
  const pagesToSync = DOC_PAGES.slice(0, pageLimit)
  
  try {
    // Create table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS support_docs (
        id SERIAL PRIMARY KEY,
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
    
    // Process pages sequentially to avoid rate limiting
    for (const page of pagesToSync) {
      try {
        const pageUrl = `${GITBOOK_BASE}${page.path}`
        
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Delever-Support-Bot/1.0',
            'Accept': 'text/html',
          },
        })
        
        if (!response.ok) {
          errors.push(`${page.path}: HTTP ${response.status}`)
          continue
        }
        
        const html = await response.text()
        const title = extractTitle(html)
        const content = extractText(html)
        const keywords = generateKeywords(content, page.category)
        
        await sql`
          INSERT INTO support_docs (title, content, url, path, category, keywords, synced_at)
          VALUES (${title}, ${content}, ${pageUrl}, ${page.path}, ${page.category}, ${keywords}, NOW())
          ON CONFLICT (url) DO UPDATE SET
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            category = EXCLUDED.category,
            keywords = EXCLUDED.keywords,
            synced_at = NOW()
        `
        
        synced++
      } catch (e: any) {
        errors.push(`${page.path}: ${e.message}`)
      }
    }
    
    // Get stats
    const stats = await sql`
      SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories
      FROM support_docs
    `
    
    return json({
      success: true,
      synced,
      total: Number(stats[0]?.total || 0),
      categories: Number(stats[0]?.categories || 0),
      errors: errors.length > 0 ? errors : undefined,
    })
    
  } catch (error: any) {
    console.error('[Docs Sync Error]', error)
    return json({ success: false, error: error.message }, 500)
  }
}
