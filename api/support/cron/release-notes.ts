import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { getBotToken, tgSend } from '../_lib/sales-bot.js'
import { LATEST } from '../_lib/release-notes.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = process.env.SALES_ORG || 'org_delever'

/**
 * Рассылка заметок о выпуске.
 *
 * Деплой сам по себе молчалив: исправления выходили по несколько раз в день,
 * а команда не понимала, решаются ли её проблемы. Крон раз в десять минут
 * сравнивает версию, зашитую в сборку, с последней разосланной — и если
 * появилась новая, отправляет её сейлзам: в систему (колокольчик) и личным
 * сообщением через платформенного бота. Один выпуск — одна рассылка.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  const [row] = await sql`
    SELECT value FROM support_settings WHERE org_id = ${ORG} AND key = 'release_notes_announced' LIMIT 1
  ` as any[]
  if (!LATEST || row?.value === LATEST.version) return json({ ok: true, announced: row?.value || null, fresh: false })

  // Кому: отдел продаж и руководители. telegram_id есть у тех, кто
  // регистрировался через бота — остальным только в систему
  const people = await sql`
    SELECT id, name, telegram_id FROM support_agents
    WHERE org_id = ${ORG} AND is_active = true AND merged_into IS NULL
      AND (department IN ('sales', 'sale')
           OR role IN ('cco', 'kam', 'sales', 'sale', 'sdr', 'admin', 'owner', 'manager', 'team_lead'))
  ` as any[]

  const lines = LATEST.items.map(it => {
    const mark = it.kind === 'fix' ? '✅' : it.kind === 'new' ? '✨' : '🔁'
    return `${mark} ${it.text}${it.where ? `\n   <i>${it.where}</i>` : ''}`
  })
  const text = `📦 <b>Обновление CRM · ${LATEST.date}</b>\n<b>${LATEST.title}</b>\n\n${lines.join('\n\n')}\n\nПолный список — в меню «Что нового».`
  const body = LATEST.items.map(it => `${it.kind === 'fix' ? '✅' : it.kind === 'new' ? '✨' : '🔁'} ${it.text}`).join('\n')

  const token = await getBotToken(sql)
  let tg = 0
  let inApp = 0
  for (const p of people) {
    // В систему — всем; дедуп по заголовку на случай повторного прогона
    const [dup] = await sql`
      SELECT id FROM support_notifications
      WHERE org_id = ${ORG} AND agent_id = ${p.id} AND type = 'release' AND title = ${`Обновление: ${LATEST.title}`}
      LIMIT 1
    ` as any[]
    if (!dup) {
      await sql`
        INSERT INTO support_notifications (id, org_id, agent_id, type, title, body, priority, link, created_at)
        VALUES (${`ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`}, ${ORG}, ${p.id}, 'release',
                ${`Обновление: ${LATEST.title}`}, ${body.slice(0, 2000)}, 'low', '/whats-new', NOW())
      `
      inApp++
    }
    if (token && p.telegram_id) {
      try { if (await tgSend(token, p.telegram_id, text)) tg++ } catch { /* один не получил — остальным не мешает */ }
    }
  }

  await sql`
    INSERT INTO support_settings (org_id, key, value, updated_at)
    VALUES (${ORG}, 'release_notes_announced', ${LATEST.version}, NOW())
    ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  return json({ ok: true, fresh: true, version: LATEST.version, people: people.length, inApp, tg })
}
