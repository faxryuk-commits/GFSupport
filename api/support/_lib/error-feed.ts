/**
 * Индекс канала ошибок и сводка аварий.
 *
 * Канал Жамолиддина — 99 тысяч структурных сообщений «Ресторан / Сервис /
 * Источник / Текст ошибки», по полторы тысячи в день. Резолвер разбирал его
 * на лету при каждом проходе; для инструмента «судьба заказа» этого мало —
 * нужен индекс, где ошибка ищется по ресторану за миллисекунды.
 *
 * Разбор выполняется на стороне базы одним INSERT..SELECT с регулярками:
 * тащить тексты к себе, чтобы распарсить и вернуть обратно, — двойная дорога.
 *
 * Здесь же — сводка аварий (system_incidents): всплески одинаковых ошибок
 * из индекса плюс сообщения людей в партнёрских группах.
 */

const SCHEMA_KEY = 'error_feed_schema'
const SCHEMA_VERSION = '2026-08-23.1'
const CURSOR_KEY = 'error_feed_indexed_at'
let ensured = false

export async function ensureErrorFeedSchema(sql: any): Promise<void> {
  if (ensured) return
  const [row] = await sql`SELECT value FROM support_platform_settings WHERE key = ${SCHEMA_KEY}`
  if (row?.value === SCHEMA_VERSION) { ensured = true; return }

  await sql`
    CREATE TABLE IF NOT EXISTS order_errors (
      msg_id VARCHAR(64) PRIMARY KEY,
      restaurant VARCHAR(200),
      service VARCHAR(80),
      source VARCHAR(80),
      error_text TEXT,
      error_class VARCHAR(180),
      crm_id VARCHAR(80),
      error_at TIMESTAMPTZ,
      msg_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_order_errors_rest ON order_errors(restaurant, msg_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_order_errors_at ON order_errors(msg_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_order_errors_class ON order_errors(error_class, msg_at DESC)`

  await sql`
    CREATE TABLE IF NOT EXISTS system_incidents (
      id VARCHAR(64) PRIMARY KEY,
      kind VARCHAR(24) NOT NULL,            -- error_spike | partner_report
      system VARCHAR(120) NOT NULL,          -- iiko, wolt, yandex, integrator-api…
      title TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      first_seen TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL,
      count INT NOT NULL DEFAULT 1,
      sample TEXT,
      source_ref VARCHAR(200),
      confidence REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_system_incidents_open ON system_incidents(status, last_seen DESC)`

  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${SCHEMA_KEY}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  ensured = true
}

/**
 * Индексация новых сообщений фида. Идемпотентна: ключ — id сообщения.
 * Курсор двигается по created_at; повторная обработка того же окна безвредна.
 */
export async function indexFeed(sql: any, orgId: string, windowLimit = 3000) {
  const [cur] = await sql`SELECT value FROM support_platform_settings WHERE key = ${CURSOR_KEY}`
  const since = cur?.value || '1970-01-01'

  const rows = await sql`
    WITH feed AS (
      SELECT m.id, m.text_content, m.created_at
      FROM support_messages m
      JOIN support_channels ch ON ch.id = m.channel_id AND ch.org_id = ${orgId} AND ch.type = 'feed'
      WHERE m.created_at > ${since}::timestamptz AND m.text_content LIKE '%Ресторан:%'
      ORDER BY m.created_at
      LIMIT ${windowLimit}
    )
    INSERT INTO order_errors (msg_id, restaurant, service, source, error_text, error_class, crm_id, error_at, msg_at)
    SELECT id,
      LEFT(TRIM(substring(text_content FROM 'Ресторан:\s*([^\n]+)')), 200),
      LEFT(TRIM(substring(text_content FROM 'Сервис:\s*([^\n]+)')), 80),
      LEFT(LOWER(TRIM(substring(text_content FROM 'Источник:\s*([^\n]+)'))), 80),
      -- «Текст ошибки» до конца строки; первая буква бывает латинской O
      LEFT(TRIM(substring(text_content FROM '[ТT]екст ошибки:\s*([^\n]+)')), 500),
      -- класс: тот же текст без id, uuid и чисел — по нему считаются всплески
      LEFT(regexp_replace(LOWER(TRIM(substring(text_content FROM '[ТT]екст ошибки:\s*([^\n]+)'))),
        '[0-9a-f]{8,}|[0-9]+', '#', 'g'), 180),
      LEFT(TRIM(substring(text_content FROM '"crm_id":\s*"([^"]+)"')), 80),
      NULLIF(TRIM(substring(text_content FROM 'Время ошибки:\s*([0-9: -]+)')), '')::timestamptz,
      created_at
    FROM feed
    ON CONFLICT (msg_id) DO NOTHING
    RETURNING msg_id, msg_at
  `
  if (rows.length) {
    const maxAt = rows.reduce((a: string, r: any) => r.msg_at > a ? r.msg_at : a, rows[0].msg_at)
    await sql`
      INSERT INTO support_platform_settings (key, value, updated_at)
      VALUES (${CURSOR_KEY}, ${new Date(maxAt).toISOString()}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
  }
  return { indexed: rows.length }
}

/**
 * Всплески: один класс ошибки повторяется у нескольких ресторанов за короткое
 * окно — это системная авария, а не чей-то стоп-лист. Порог намеренно
 * консервативный: сводка, которая кричит по каждому чиху, перестаёт читаться.
 */
export async function detectSpikes(sql: any) {
  const spikes = await sql`
    SELECT source, error_class,
           COUNT(*)::int AS cnt,
           COUNT(DISTINCT restaurant)::int AS rests,
           MIN(msg_at) AS first_seen, MAX(msg_at) AS last_seen,
           MIN(error_text) AS sample
    FROM order_errors
    WHERE msg_at > NOW() - INTERVAL '15 minutes'
      AND error_class NOT ILIKE '%товар недоступен%'   -- стоп-лист — ожидаемое, не авария
    GROUP BY source, error_class
    HAVING COUNT(*) >= 8 AND COUNT(DISTINCT restaurant) >= 2
  `
  let opened = 0, updated = 0
  for (const s of spikes as any[]) {
    const sysName = s.source || 'platform'
    const [existing] = await sql`
      SELECT id FROM system_incidents
      WHERE status = 'open' AND kind = 'error_spike'
        AND system = ${sysName} AND title = ${s.error_class}
      LIMIT 1
    `
    if (existing) {
      await sql`
        UPDATE system_incidents SET last_seen = ${s.last_seen}, count = count + ${s.cnt}
        WHERE id = ${existing.id}
      `
      updated++
    } else {
      await sql`
        INSERT INTO system_incidents (id, kind, system, title, status, first_seen, last_seen, count, sample, source_ref)
        VALUES (${'inc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)},
                'error_spike', ${sysName}, ${s.error_class}, 'open',
                ${s.first_seen}, ${s.last_seen}, ${s.cnt}, ${s.sample}, ${'фид ошибок · ' + s.rests + ' ресторанов'})
      `
      opened++
    }
  }
  // Тишина полчаса — авария закончилась
  const closed = await sql`
    UPDATE system_incidents SET status = 'resolved', resolved_at = NOW()
    WHERE status = 'open' AND last_seen < NOW() - INTERVAL '30 minutes'
    RETURNING id
  `
  return { opened, updated, closed: closed.length }
}

/** Живые аварии — для промпта агента и бейджа в обзоре. */
export async function activeIncidents(sql: any): Promise<any[]> {
  return sql`
    SELECT system, kind, title, first_seen, last_seen, count, sample, source_ref
    FROM system_incidents WHERE status = 'open'
    ORDER BY last_seen DESC LIMIT 6
  `
}

/**
 * Судьба заказов ресторана: свежие ошибки по имени из названия канала.
 * Название группы «Kafishka & Delever» → пробуем токены как имя ресторана.
 */
export async function recentErrorsForChannel(sql: any, channelName: string, hours = 6): Promise<any[]> {
  const tokens = String(channelName || '')
    .split(/[-&x×|/]+/i)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !/delever|delivery|yandex|wolt|uzum|glovo|iiko|integration|telegram/i.test(t))
    .slice(0, 3)
  if (!tokens.length) return []
  for (const t of tokens) {
    const rows = await sql`
      SELECT restaurant, source, error_text, error_at, msg_at
      FROM order_errors
      WHERE restaurant ILIKE ${'%' + t + '%'} AND msg_at > NOW() - make_interval(hours => ${hours})
      ORDER BY msg_at DESC LIMIT 8
    `
    if (rows.length) return rows
  }
  return []
}
