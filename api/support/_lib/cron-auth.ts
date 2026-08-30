import { json } from './db.js'

/**
 * Кто имеет право запустить крон.
 *
 * Раньше каждый крон пускал любого, кто представился заголовком
 * `user-agent: vercel-cron` — а заголовок подставляется одной строкой в curl.
 * Восемь эндпоинтов, среди них те, что шлют рассылки и меняют статусы сделок,
 * стояли открытыми в интернет.
 *
 * Vercel сам шлёт `Authorization: Bearer $CRON_SECRET`, если переменная задана
 * в проекте. Поэтому правило такое: есть секрет — он и есть единственный вход,
 * подделанный user-agent больше не проходит. Секрета нет — работаем по старому
 * признаку, но говорим об этом в лог: молча выключить все кроны хуже, чем
 * прожить ещё день с открытой дверью.
 */
export function assertCron(req: Request): Response | null {
  const secret = (process.env.CRON_SECRET || '').trim()
  const auth = (req.headers.get('authorization') || '').trim()

  if (secret) {
    return auth === `Bearer ${secret}` ? null : json({ error: 'Unauthorized' }, 401)
  }

  const ua = req.headers.get('user-agent') || ''
  if (ua.includes('vercel-cron')) {
    console.warn('[cron] CRON_SECRET не задан: вход открыт по user-agent, задайте переменную')
    return null
  }
  return json({ error: 'Unauthorized' }, 401)
}

/** Задан ли секрет — чтобы крон мог честно сказать это в своём ответе. */
export const cronSecured = () => Boolean((process.env.CRON_SECRET || '').trim())
