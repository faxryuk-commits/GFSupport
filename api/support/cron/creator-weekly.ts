import { getSQL, json, getOpenAIKey } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import {
  ensureCreatorSchema, generateOne, planCycle, generateSeriesDraft, generateReaction,
  generateWeeklyAnalysis, sendOwnerTG, weekKeyOf, GOAL_LABEL, type CreatorLine, type CycleGoal,
} from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Ежедневный тик «Креатора» (утро, каждые 5 минут — edge не успевает больше
 * одного поста за вызов).
 *
 * Режим циклов: в понедельник без плана — предложить план недели (владелец
 * одобряет в UI); при одобренном цикле выпуск дня — ОДИН серийный пост,
 * который помнит предыдущие серии. Пока план не одобрен, серия не пишется.
 * Без цикла вовсе — старый рубрикатор на три поста.
 */
const FALLBACK_PLAN: CreatorLine[] = ['delever', 'delever_archive', 'gfsupport']

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied
  const sql = getSQL()
  await ensureCreatorSchema(sql)

  const batchKey = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)
  const weekKey = weekKeyOf()
  const key = await getOpenAIKey()
  if (!key) return json({ error: 'нет ключа OpenAI' }, 500)

  // Начатая арка дописывается до конца независимо от смены недели
  const [active] = await sql`
    SELECT * FROM creator_cycles WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1`
  const [cycle] = active
    ? [active]
    : await sql`
        SELECT * FROM creator_cycles WHERE week_key = ${weekKey}
        ORDER BY created_at DESC LIMIT 1`

  // Нет ни активной арки, ни плана на эту неделю: предложить цикл
  if (!cycle) {
    try {
      const c: any = await planCycle(sql, key, weekKey)
      const days = (Array.isArray(c.plan) ? c.plan : JSON.parse(c.plan))
        .map((d: any, i: number) => `${i + 1}. ${d.role}`).join('\n')
      await sendOwnerTG(sql,
        `🗓 Креатор предлагает цикл недели (цель: ${GOAL_LABEL[c.goal as CycleGoal]})\n\n«${c.theme}»\n${c.rationale}\n\n${days}\n\nОдобри план во вкладке «Циклы» — серия начнёт писаться со следующего утра. Не одобришь — буду писать обычные выпуски.`)
      return json({ ok: true, planned: c.id })
    } catch (e: any) {
      return json({ ok: false, error: e?.message || 'план не собрался' }, 200)
    }
  }

  // План предложен, но не одобрен: серию не пишем, работает старый режим
  if ((cycle as any).status === 'proposed') {
    return await fallbackBatch(sql, key, batchKey)
  }

  if ((cycle as any).status === 'approved') {
    const already = await sql`
      SELECT id FROM creator_drafts WHERE cycle_id = ${(cycle as any).id} AND batch_key = ${batchKey}`
    if (already.length) return await tryReaction(sql, key, batchKey)
    try {
      const row: any = await generateSeriesDraft(sql, key, cycle, batchKey)
      if (!row) {
        await sql`UPDATE creator_cycles SET status = 'done', updated_at = now() WHERE id = ${(cycle as any).id}`
        await sendOwnerTG(sql, `🏁 Арка «${(cycle as any).theme}» дописана — все посты серии в Креаторе.`)
        return json({ ok: true, cycleDone: true })
      }
      await sendOwnerTG(sql,
        `✍️ Пост дня из арки «${(cycle as any).theme}»: ${row.cycle_role}\n\n«${row.title}» ждёт одобрения.`)
      return json({ ok: true, series: row.id })
    } catch (e: any) {
      return json({ ok: false, error: e?.message || 'ошибка серии' }, 200)
    }
  }

  // Цикл завершён — до следующего понедельника обычные выпуски
  return await fallbackBatch(sql, key, batchKey)
}

/** Старый рубрикатор: три поста в день, по одному за тик. */
async function fallbackBatch(sql: ReturnType<typeof getSQL>, key: string, batchKey: string): Promise<Response> {
  const existing = await sql`
    SELECT id FROM creator_drafts WHERE batch_key = ${batchKey} AND cycle_id IS NULL AND line != 'reaction'`
  if (existing.length >= FALLBACK_PLAN.length) return await tryReaction(sql, key, batchKey)
  const line = FALLBACK_PLAN[existing.length]
  try {
    await generateOne(sql, key, line, batchKey)
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'ошибка генерации', batchKey }, 200)
  }
  const isLast = existing.length + 1 >= FALLBACK_PLAN.length
  if (isLast) {
    const titles = await sql`
      SELECT title, line FROM creator_drafts WHERE batch_key = ${batchKey} AND cycle_id IS NULL ORDER BY created_at`
    const list = (titles as any[]).map(t => `• ${t.title}`).join('\n')
    await sendOwnerTG(sql, `✍️ Креатор собрал выпуск ${batchKey} — три черновика ждут одобрения:\n\n${list}`)
  }
  return json({ ok: true, generated: line, notified: isLast })
}

/**
 * Рубрика «реакция»: после основного контента дня — одна попытка в сутки
 * (маркер в support_settings), пишется только если у брендов есть событие.
 */
async function tryReaction(sql: ReturnType<typeof getSQL>, key: string, batchKey: string): Promise<Response> {
  const [mark] = await sql`
    SELECT value FROM support_settings
    WHERE org_id = 'org_delever' AND key = 'creator_reaction_attempt' LIMIT 1`
  if ((mark as any)?.value === batchKey) {
    const w = await tryWeekly(sql, key, batchKey)
    if (w) return w
    return json({ ok: true, done: true, batchKey })
  }
  await sql`
    INSERT INTO support_settings (org_id, key, value)
    VALUES ('org_delever', 'creator_reaction_attempt', ${batchKey})
    ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`
  try {
    const row: any = await generateReaction(sql, key, batchKey)
    if (!row) return json({ ok: true, done: true, reaction: 'skip' })
    await sendOwnerTG(sql, `⚡ Реакция на событие рынка: «${row.title}» — черновик ждёт в Креаторе.`)
    return json({ ok: true, reaction: row.id })
  } catch (e: any) {
    return json({ ok: true, done: true, reaction: 'error', error: e?.message }, 200)
  }
}

/**
 * «Аналитика недели»: по воскресеньям, одна попытка (маркер по неделе) —
 * длинная статья из событий брендов и рынка за 7 дней.
 */
async function tryWeekly(sql: ReturnType<typeof getSQL>, key: string, batchKey: string): Promise<Response | null> {
  const isSunday = new Date(`${batchKey}T00:00:00Z`).getUTCDay() === 0
  if (!isSunday) return null
  const wk = weekKeyOf()
  const [mark] = await sql`
    SELECT value FROM support_settings
    WHERE org_id = 'org_delever' AND key = 'creator_weekly_analysis' LIMIT 1`
  if ((mark as any)?.value === wk) return null
  await sql`
    INSERT INTO support_settings (org_id, key, value)
    VALUES ('org_delever', 'creator_weekly_analysis', ${wk})
    ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`
  try {
    const row: any = await generateWeeklyAnalysis(sql, key, batchKey)
    if (!row) return json({ ok: true, weekly: 'skip' })
    await sendOwnerTG(sql, `📊 Аналитика недели готова: «${row.title}» — статья ждёт в Креаторе.`)
    return json({ ok: true, weekly: row.id })
  } catch (e: any) {
    return json({ ok: true, weekly: 'error', error: e?.message }, 200)
  }
}
