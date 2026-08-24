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
import { assertCron } from '../lib/cron-auth.js'
import { autoAssignChannelMarkets, autoAssignSalesRegions } from '../lib/region-detect.js'

export const config = { runtime: 'edge' }

const ORG = process.env.SALES_ORG || 'org_delever'

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

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

    // Попутная ночная уборка: новые каналы без региона получают его по
    // сигналам переписки (язык, инструменты, страна в названии). Ошибка
    // распределения не должна ронять архивирование
    // Ночная уборка личного пространства:
    // 1) уведомления старше недели никто уже не прочитает — гасим;
    // 2) обещание, просроченное дольше 3 дней, не выполнят «по напоминанию» —
    //    это шум, а не долг: истекает и уходит из «Требует меня»
    try {
      await sql`UPDATE support_notifications SET is_read = true, read_at = NOW()
        WHERE is_read = false AND created_at < NOW() - INTERVAL '7 days'`
      await sql`UPDATE support_commitments SET status = 'expired'
        WHERE status = 'overdue' AND due_date < NOW() - INTERVAL '3 days'`
    } catch {}

    let regionsAssigned = 0
    try {
      regionsAssigned = await autoAssignChannelMarkets(sql, ORG)
      regionsAssigned += await autoAssignSalesRegions(sql, ORG)
    } catch (e: any) {
      console.error('[archive-resolved] region assign failed:', e?.message)
    }

    console.log(`[archive-resolved] archived ${archived.length} cases, regions ${regionsAssigned}`)
    return json({ ok: true, archived: archived.length, regionsAssigned })
  } catch (e: any) {
    console.error('[archive-resolved] error:', e?.message || e)
    return json({ error: 'archive_failed', detail: e?.message }, 500)
  }
}
