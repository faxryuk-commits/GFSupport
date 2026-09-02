import type { NeonQueryFunction } from '@neondatabase/serverless'

type SQL = NeonQueryFunction<false, false>

/**
 * Аренда телефонных линий («hot seat» колл-центра).
 *
 * Добавочных на АТС три, людей — больше: сейлзы, поддержка, фаундер. Личная
 * привязка ext в профиле — для постоянных владельцев; всем остальным линия
 * выдаётся динамически на время работы софтфона. Кто какую линию держал —
 * журнал sales_pbx_seats: по нему синк атрибутирует звонок человеку, а не
 * добавочному. Логин и пароль АТС никому знать не нужно.
 *
 * Аренда живёт по TTL: фронт продлевает её раз в 45 секунд, закрытая вкладка
 * отпускает линию сама через две минуты. Владелец добавочного всегда в
 * приоритете: его личный ext ему и достаётся, а гостям сперва раздаются
 * линии офлайн-владельцев.
 */

export const SEAT_TTL_MIN = 2

export async function ensureSeatSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_pbx_seats (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      ext TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_pbx_seats_lookup
    ON sales_pbx_seats (org_id, ext, taken_at DESC)
  `
}

/**
 * Выдать линию агенту: личный короткий ext — сразу его; иначе свободная из
 * пула (сначала линии офлайн-владельцев). Повторный запрос продлевает уже
 * взятую линию, а не хватает новую.
 */
export async function allocateSeat(
  sql: SQL, orgId: string, agentId: string,
  pool: string[],
): Promise<{ ext: string; shared: boolean } | { error: string }> {
  await ensureSeatSchema(sql)

  const [meRow] = await sql`
    SELECT name, pbx_ext FROM support_agents WHERE id = ${agentId} LIMIT 1
  ` as any[]
  const myName = meRow?.name || agentId
  const ownExt = String(meRow?.pbx_ext || '').replace(/\D/g, '')

  const lease = async (ext: string) => {
    // Одна живая аренда на агента: прошлые закрываем
    await sql`
      UPDATE sales_pbx_seats SET released_at = NOW()
      WHERE org_id = ${orgId} AND agent_id = ${agentId} AND released_at IS NULL AND ext <> ${ext}
    `
    const [cur] = await sql`
      SELECT id FROM sales_pbx_seats
      WHERE org_id = ${orgId} AND agent_id = ${agentId} AND ext = ${ext} AND released_at IS NULL
      LIMIT 1
    ` as any[]
    if (cur) {
      await sql`UPDATE sales_pbx_seats SET renewed_at = NOW() WHERE id = ${cur.id}`
    } else {
      await sql`
        INSERT INTO sales_pbx_seats (id, org_id, ext, agent_id, agent_name)
        VALUES (${`seat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`},
                ${orgId}, ${ext}, ${agentId}, ${myName})
      `
    }
  }

  // Владелец получает свой добавочный всегда — даже если гость успел его
  // взять: гостя выкинет verto.punt. Гостевые аренды закрываем сразу, иначе
  // журнал держит две живые аренды на линию и путает атрибуцию звонков
  if (ownExt && ownExt.length <= 3 && pool.includes(ownExt)) {
    await sql`
      UPDATE sales_pbx_seats SET released_at = NOW()
      WHERE org_id = ${orgId} AND ext = ${ownExt} AND agent_id <> ${agentId} AND released_at IS NULL
    `
    await lease(ownExt)
    return { ext: ownExt, shared: false }
  }

  // Уже держит линию — продлеваем её же
  const [mine] = await sql`
    SELECT ext FROM sales_pbx_seats
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND released_at IS NULL
      AND renewed_at > NOW() - make_interval(mins => ${SEAT_TTL_MIN})
    LIMIT 1
  ` as any[]
  if (mine && pool.includes(mine.ext)) {
    await lease(mine.ext)
    return { ext: mine.ext, shared: true }
  }

  // Занятые сейчас линии: живые аренды других агентов
  const busy = await sql`
    SELECT DISTINCT ext FROM sales_pbx_seats
    WHERE org_id = ${orgId} AND released_at IS NULL
      AND renewed_at > NOW() - make_interval(mins => ${SEAT_TTL_MIN})
      AND agent_id <> ${agentId}
  ` as any[]
  const busySet = new Set(busy.map((b: any) => String(b.ext)))

  // Владельцы линий и их онлайн-статус: гостю сперва линию офлайн-владельца,
  // чтобы не сесть на добавочный, на котором человек прямо сейчас работает
  const owners = await sql`
    SELECT regexp_replace(COALESCE(pbx_ext, ''), ${'\\D'}, '', 'g') AS ext, status
    FROM support_agents
    WHERE org_id = ${orgId} AND merged_into IS NULL AND pbx_ext IS NOT NULL
  ` as any[]
  const ownerOnline = new Map<string, boolean>()
  for (const o of owners) {
    if (o.ext && o.ext.length <= 3) ownerOnline.set(o.ext, o.status === 'online')
  }

  // Линия онлайн-владельца гостю не выдаётся вовсе: владелец может звонить
  // с софтфона в любую секунду, и два человека на одной линии — это punt-война
  // и звонки, приписанные не тому. Гостям достаются линии офлайн-владельцев
  // и линии без владельца
  const free = pool.filter(e => !busySet.has(e) && !ownerOnline.get(e))
  if (!free.length) {
    return { error: 'Все линии заняты владельцами или коллегами — попробуйте, когда кто-то освободится' }
  }
  free.sort((a, b) => a.localeCompare(b))
  await lease(free[0])
  return { ext: free[0], shared: true }
}

/** Продление аренды: фронт дёргает раз в 45 секунд, пока софтфон подключён. */
export async function renewSeat(sql: SQL, orgId: string, agentId: string, ext: string): Promise<boolean> {
  const rows = await sql`
    UPDATE sales_pbx_seats SET renewed_at = NOW()
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND ext = ${ext} AND released_at IS NULL
    RETURNING id
  `.catch(() => [] as any[]) as any[]
  return rows.length > 0
}

/** Отпустить линию: софтфон отключился или человек снял галку ПК-режима. */
export async function releaseSeat(sql: SQL, orgId: string, agentId: string, ext?: string): Promise<void> {
  await sql`
    UPDATE sales_pbx_seats SET released_at = NOW()
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND released_at IS NULL
      AND (${ext || ''} = '' OR ext = ${ext || ''})
  `.catch(() => { /* журнал не критичен для завершения */ })
}
