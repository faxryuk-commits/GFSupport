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

/**
 * Нормализация: кириллица и узбекская латиница складываются в один латинский
 * вид. Без этого «menyu yangilash» не находил «меню янгилаш» — триграммы
 * не знают, что это одно слово в двух письменностях.
 */
const CYR: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'j','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'x','ц':'ts','ч':'ch','ш':'sh','щ':'sh','ъ':'','ы':'i','ь':'','э':'e','ю':'yu','я':'ya',
  'қ':'q','ғ':'g','ў':'o','ҳ':'h','ң':'n','ә':'a','ө':'o','ү':'u','ұ':'u','і':'i','һ':'h',
}
export function normText(s: string): string {
  return String(s || '').toLowerCase()
    .replace(/[ʻʼ'`’]/g, '')
    .split('').map(ch => CYR[ch] !== undefined ? CYR[ch] : ch).join('')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 400)
}

const SCHEMA_KEY = 'reply_examples_schema'
const SCHEMA_VERSION = '2026-08-23.2-norm'
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
  await sql`ALTER TABLE support_reply_examples ADD COLUMN IF NOT EXISTS norm_text TEXT`
  await sql`CREATE INDEX IF NOT EXISTS idx_reply_examples_norm
            ON support_reply_examples USING gin (norm_text gin_trgm_ops)`
  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${SCHEMA_KEY}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  ensured = true
}

/** Ближайшие примеры к вопросу клиента — поиск по нормализованному виду. */
export async function similarExamples(sql: any, query: string, limit = 3): Promise<any[]> {
  const q = normText(String(query || '').slice(0, 300))
  if (q.length < 6) return []
  await ensureReplyExamplesSchema(sql)
  // Порог % по умолчанию 0.3 — для коротких фраз на трёх языках это слишком
  // строго: «kassaga tushmayapti» против «zakaz tushyapti chek chikmayapti»
  // даёт 0.27 и релевантен. set_limit живёт в рамках сессии, поэтому оба
  // запроса идут одной транзакцией
  const [, rows] = await sql.transaction([
    sql`SELECT set_limit(0.16)`,
    sql`
      SELECT client_text, human_reply, human_sender, lang,
             similarity(norm_text, ${q}) AS sim
      FROM support_reply_examples
      WHERE norm_text % ${q}
      ORDER BY sim DESC
      LIMIT ${limit}
    `,
  ]) as any[]
  return rows
}

/** Пара «вопрос → ответ команды» в базу примеров. Идемпотентно по id. */
export async function addExample(sql: any, orgId: string, ex: {
  id: string; clientText: string; humanReply: string; sender?: string | null
  lang?: string | null; channel?: string | null; saidAt?: string | null; source?: string
}): Promise<boolean> {
  const rows = await sql`
    INSERT INTO support_reply_examples (id, org_id, client_text, human_reply, human_sender, lang, channel, said_at, source, norm_text)
    VALUES (${ex.id}, ${orgId}, ${ex.clientText.slice(0, 600)}, ${ex.humanReply.slice(0, 800)},
            ${ex.sender || null}, ${ex.lang || null}, ${(ex.channel || '').slice(0, 200)},
            ${ex.saidAt || null}, ${ex.source || 'teacher'}, ${normText(ex.clientText)})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  return rows.length > 0
}
