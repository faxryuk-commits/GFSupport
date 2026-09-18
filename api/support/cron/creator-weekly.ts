import { getSQL, json, getOpenAIKey, getOrgBotToken } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { CREATOR_OWNER_ID, ensureCreatorSchema, generateOne } from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Еженедельная сборка выпуска «Креатора».
 *
 * Edge-функция не успевает три поста за один вызов (лимит 25 секунд),
 * поэтому крон тикает пятничным утром каждые 5 минут и дописывает по
 * одному посту, пока выпуск не соберётся: тик 1 → Delever, тик 2 →
 * Delever, тик 3 → GFSupport + личное сообщение владельцу в Telegram.
 * Идемпотентно: собранный выпуск последующие тики пропускают.
 */
const PLAN: Array<'delever' | 'gfsupport'> = ['delever', 'delever', 'gfsupport']

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied
  const sql = getSQL()
  await ensureCreatorSchema(sql)

  // Ключ выпуска — пятничная дата по Ташкенту
  const batchKey = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)
  const existing = await sql`SELECT id FROM creator_drafts WHERE batch_key = ${batchKey}`
  if (existing.length >= PLAN.length) return json({ ok: true, done: true, batchKey })

  const key = await getOpenAIKey()
  if (!key) return json({ error: 'нет ключа OpenAI' }, 500)

  const line = PLAN[existing.length]
  try {
    await generateOne(sql, key, line, batchKey)
  } catch (e: any) {
    // Следующий тик попробует снова — GitBook или модель могли моргнуть
    return json({ ok: false, error: e?.message || 'ошибка генерации', batchKey }, 200)
  }

  const isLast = existing.length + 1 >= PLAN.length
  if (isLast) await notifyOwner(sql, batchKey)
  return json({ ok: true, generated: line, count: existing.length + 1, notified: isLast })
}

/** Личное сообщение владельцу: выпуск готов, черновики ждут в «Креаторе». */
async function notifyOwner(sql: ReturnType<typeof getSQL>, batchKey: string): Promise<void> {
  try {
    const [owner] = await sql`
      SELECT telegram_id, org_id FROM support_agents WHERE id = ${CREATOR_OWNER_ID} LIMIT 1`
    const tgId = (owner as any)?.telegram_id
    if (!tgId) return
    const token = await getOrgBotToken((owner as any)?.org_id)
    if (!token) return
    const titles = await sql`
      SELECT title, line FROM creator_drafts WHERE batch_key = ${batchKey} ORDER BY created_at`
    const list = (titles as any[])
      .map(t => `• ${t.title}${t.line === 'gfsupport' ? ' (как мы строим)' : ''}`)
      .join('\n')
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId,
        text: `✍️ Креатор собрал выпуск ${batchKey} — три черновика ждут одобрения:\n\n${list}\n\nОткрой «Креатор», проверь русский текст и скопируй английский для LinkedIn.`,
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть Креатор', url: 'https://www.gfsupport.uz/creator' }]],
        },
      }),
    })
  } catch {
    // Уведомление — вежливость, не контракт: выпуск в любом случае в системе
  }
}
