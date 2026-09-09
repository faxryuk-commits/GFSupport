import { next } from '@vercel/edge'
import { neon } from '@neondatabase/serverless'

/**
 * Общий заслон перед всеми обработчиками API.
 *
 * Зачем он появился: из 250 обработчиков вход проверяли примерно две пятых.
 * Остальные либо считали авторизацией наличие строки «Bearer », либо
 * не проверяли ничего. На проде это означало, что список сотрудников,
 * каналы, настройки и переписка отдавались без учётной записи вообще, а
 * `POST /agents` заводил администратора кому угодно из интернета.
 *
 * Чинить это по одному файлу — значит месяц жить с дырой и всё равно
 * что-то пропустить. Поэтому проверка личности вынесена сюда: сюда запрос
 * приходит раньше, чем в обработчик, и без опознанного сотрудника дальше
 * не проходит. Обработчики свои проверки сохраняют — это второй рубеж.
 *
 * Открытыми остаются только те адреса, куда по смыслу ходят без входа:
 * вебхуки (у них своя подпись), публичные страницы клиента по токену,
 * приём заявок с сайта (свой секрет), картинки и сама форма входа.
 */

export const config = { matcher: '/api/support/:path*' }

/**
 * Расписания из vercel.json. Часть живёт вне папки cron/, и у четырёх из них
 * своей защиты не было вовсе — их мог запустить кто угодно снаружи: автоответы
 * клиентам, разбор сообщений через платный ИИ, рассылка. Vercel зовёт их
 * с CRON_SECRET в заголовке, поэтому проверяем секрет здесь, разом для всех.
 */
const CRON_PATHS = new Set([
  '/api/support/analytics/benchmarks-cron',
  '/api/support/analytics/daily-report',
  '/api/support/autoresponder/check',
  '/api/support/broadcast/worker',
  '/api/support/broadcast/worker-sweep',
  '/api/support/commitments/scan',
  '/api/support/learning/outcome-scan',
  '/api/support/learning/scan',
  '/api/support/messages/auto-process',
])

/** Ходят без входа по смыслу. Проверка личности там своя или не нужна. */
const PUBLIC = [
  '/api/support/public/',
  '/api/support/webhook/',
  '/api/support/auth/',
  '/api/support/media/',
  '/api/support/agents/login',
  // Регистрация по приглашению: человек ещё не сотрудник, входить ему нечем.
  // Обработчик сам требует живой неиспользованный токен приглашения и берёт
  // роль из него, а не из тела запроса — завести себе администратора нельзя
  '/api/support/agents/register',
  '/api/support/admin/sa-login',
  '/api/support/sales/doc-public',
  '/api/support/sales/click',
  '/api/support/sales/intake',
  '/api/support/broadcast/track',
]

/**
 * Закрыто, хотя лежит внутри публичного раздела: отдаёт ссылку на файл
 * вместе с токеном бота, а картинками в теге <img> не является.
 */
const PROTECTED_INSIDE_PUBLIC = ['/api/support/media/convert']

/** Только руководителю: правка схемы базы и смена чужих паролей. */
const ADMIN_ONLY = [
  '/api/support/db/',
  '/api/support/agents/set-password',
  '/api/support/webhook/setup',
]

const TOKEN_PREFIX = 'gfs_'
const CACHE_TTL = 30_000
const cache = new Map<string, { row: AgentRow | null; ts: number }>()

type AgentRow = { id: string; role: string | null; permissions: unknown; org_id: string | null }

const deny = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
  },
})

const b64url = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function resolve(token: string): Promise<AgentRow | null> {
  const hit = cache.get(token)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.row

  const url = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!url) return null
  const sql = neon(url)
  let row: AgentRow | null = null
  try {
    if (token.startsWith(TOKEN_PREFIX)) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      const hash = b64url(new Uint8Array(digest))
      const rows = await sql`
        SELECT a.id, a.role, a.permissions, a.org_id
        FROM support_sessions s JOIN support_agents a ON a.id = s.agent_id
        WHERE s.token_hash = ${hash} AND s.revoked_at IS NULL AND s.expires_at > NOW()
          AND COALESCE(a.is_active, true)
        LIMIT 1
      ` as any[]
      row = rows[0] || null
    } else if (token.startsWith('agent')
      && String(process.env.LEGACY_AGENT_TOKENS || 'on').toLowerCase() !== 'off') {
      const rows = await sql`
        SELECT id, role, permissions, org_id FROM support_agents
        WHERE id = ${token} AND COALESCE(is_active, true) LIMIT 1
      ` as any[]
      row = rows[0] || null
    }
  } catch {
    // База не ответила — считаем гостем: пускать «на всякий случай» нельзя
    return null
  }
  if (cache.size > 1000) cache.clear()
  cache.set(token, { row, ts: Date.now() })
  return row
}

export default async function middleware(req: Request) {
  const { pathname, searchParams } = new URL(req.url)

  // Предварительный запрос браузера про CORS — пропускаем как есть
  if (req.method === 'OPTIONS') return next()

  // Расписания: пропуск только по секрету, который Vercel кладёт в заголовок
  if (pathname.startsWith('/api/support/cron/') || CRON_PATHS.has(pathname)) {
    const secret = (process.env.CRON_SECRET || '').trim()
    if (!secret) return next()
    const given = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    return given === secret ? next() : deny(401, 'unauthorized')
  }

  const admin = ADMIN_ONLY.some(p => pathname.startsWith(p))

  // Приглашение по ссылке: человек ещё не сотрудник, учётной записи нет
  const invite = pathname.startsWith('/api/support/invites')
    && req.method === 'GET' && searchParams.get('token')

  const guarded = PROTECTED_INSIDE_PUBLIC.some(p => pathname.startsWith(p))
  if (!admin && !guarded && (invite || PUBLIC.some(p => pathname.startsWith(p)))) return next()

  const header = req.headers.get('Authorization') || ''
  const token = header.replace('Bearer ', '').trim()
  if (!token) return deny(401, 'unauthorized')

  const row = await resolve(token)
  if (!row?.id) return deny(401, 'unauthorized')

  if (admin) {
    const perms = Array.isArray(row.permissions) ? row.permissions : []
    const isAdmin = row.role === 'admin' || row.role === 'org_admin'
      || perms.includes('superadmin') || perms.includes('global_admin')
    if (!isAdmin) return deny(403, 'forbidden')
  }

  return next()
}
