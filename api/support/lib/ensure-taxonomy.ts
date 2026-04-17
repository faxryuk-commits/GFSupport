import { getSQL } from './db.js'

/**
 * Идемпотентно добавляет колонки/индексы таксономии в support_messages.
 * Используется в endpoint'ах, которые читают/пишут ai_domain/ai_subcategory/ai_theme/ai_tags,
 * чтобы не зависеть от ручного запуска /api/support/db/sync-schema.
 *
 * На warm invocations — дешёвый no-op (module-level флаг).
 * На cold start — 4 ALTER + 2 CREATE INDEX, все IF NOT EXISTS.
 */

let taxonomyColumnsEnsured = false

export async function ensureTaxonomyColumns(): Promise<void> {
  if (taxonomyColumnsEnsured) return
  const sql = getSQL()
  try {
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_domain VARCHAR(50)`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_subcategory VARCHAR(100)`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_theme VARCHAR(300)`
    await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS ai_tags TEXT[]`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_org_domain ON support_messages(org_id, ai_domain, created_at DESC) WHERE ai_domain IS NOT NULL`
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_org_subcategory ON support_messages(org_id, ai_subcategory, created_at DESC) WHERE ai_subcategory IS NOT NULL`
    taxonomyColumnsEnsured = true
  } catch (e) {
    console.error('[ensureTaxonomyColumns]', e)
    // Не зажигаем — endpoint упадёт с более понятной ошибкой дальше
  }
}
