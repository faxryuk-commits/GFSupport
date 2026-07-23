/**
 * Ночной архиватор решённых кейсов.
 *
 * Модель: решённый кейс остаётся на активной доске (колонка «Решено») до конца
 * ташкентского дня. Этот крон переводит resolved-кейсы ПРОШЛЫХ дней в closed —
 * они уходят во вкладку «Архив».
 *
 * День считается по Asia/Tashkent (UTC+5, без DST); resolved_at хранится как
 * наивный UTC, поэтому обязателен двойной AT TIME ZONE.
 *
 * Расписание: 19:15 UTC = 00:15 Ташкент (vercel.json). Идемпотентен — повторный
 * запуск ничего не меняет. Кейсы без resolved_at страхуем по updated_at.
 *
 * Защита: Vercel cron (user-agent) или CRON_SECRET (как sla-guard).
 */
import { getSQL, json } from '../lib/db.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('Authorization') || ''
  if (!ua.includes('vercel-cron') && !(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  try {
    const archived = await sql`
      UPDATE support_cases
      SET status = 'closed', updated_at = NOW()
      WHERE status = 'resolved'
        AND COALESCE(resolved_at, updated_at, created_at) IS NOT NULL
        AND (COALESCE(resolved_at, updated_at, created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')
            < date_trunc('day', NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')
      RETURNING id, org_id
    ` as Array<{ id: string; org_id: string }>

    // История: одна запись на кейс (не критично — не роняем архивирование)
    if (archived.length > 0) {
      const ids = archived.map(a => a.id)
      await sql`
        INSERT INTO support_case_activities (id, case_id, type, title, from_status, to_status, org_id, created_at)
        SELECT 'act_arch_' || id || '_' || EXTRACT(EPOCH FROM NOW())::bigint,
               id, 'status_change', 'Авто-архив: решён в предыдущий день', 'resolved', 'closed', org_id, NOW()
        FROM support_cases WHERE id = ANY(${ids})
      `.catch(() => {})
    }

    console.log(`[archive-resolved] archived ${archived.length} cases`)
    return json({ ok: true, archived: archived.length })
  } catch (e: any) {
    console.error('[archive-resolved] error:', e?.message || e)
    return json({ error: 'archive_failed', detail: e?.message }, 500)
  }
}
