/**
 * База примеров: как живая команда отвечала на похожие вопросы.
 *
 * Наполняется тройками «вопрос клиента → ответ сотрудника», очищенными от
 * рассылок и поздних ответов. Поиск — триграммный (pg_trgm): для коротких
 * сообщений поддержки на трёх языках он работает лучше, чем кажется, и не
 * требует ни эмбеддингов, ни отдельного хранилища.
 *
 * Это «немедленная» половина самообучения: новый ответ сотрудника попадает
 * сюда в тот же час и уже влияет на следующие черновики — задолго до всякого
 * дообучения модели.
 */

const SCHEMA_KEY = 'reply_examples_schema'
const SCHEMA_VERSION = '2026-08-23.1'
let ensured = false

export async function ensureReplyExamplesSchema(sql: any): Promise<void> {
  if (ensured) return
  const [row] = await sql`SELECT value FROM support_platform_settings WHERE key = ${SCHEMA_KEY}`
  if (row?.value === SCHEMA_VERSION) { ensured = true; return }

  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`
  await sql`
    CREATE TABLE IF NOT EXISTS support_reply_examples (
      id VARCHAR(64) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      client_text TEXT NOT NULL,
      human_reply TEXT NOT NULL,
      human_sender VARCHAR(120),
      lang VARCHAR(8),
      channel VARCHAR(200),
      said_at TIMESTAMPTZ,
      source VARCHAR(20) NOT NULL DEFAULT 'triples',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_reply_examples_trgm
            ON support_reply_examples USING gin (client_text gin_trgm_ops)`
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${SCHEMA_KEY}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  ensured = true
}

/** Ближайшие примеры к вопросу клиента. Порог отсекает случайные совпадения. */
export async function similarExamples(sql: any, query: string, limit = 3): Promise<any[]> {
  const q = String(query || '').slice(0, 300)
  if (q.length < 8) return []
  await ensureReplyExamplesSchema(sql)
  return sql`
    SELECT client_text, human_reply, human_sender, lang,
           similarity(client_text, ${q}) AS sim
    FROM support_reply_examples
    WHERE client_text % ${q}
    ORDER BY sim DESC
    LIMIT ${limit}
  `
}
