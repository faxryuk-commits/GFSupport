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
let channelSourceEnsured = false

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
  }
}

/**
 * Идемпотентно добавляет колонку `source` в support_channels (telegram/whatsapp/...).
 * Нужна для per-source аналитики на /health, /sla-report, /category-flow.
 */
export async function ensureChannelSourceColumn(): Promise<void> {
  if (channelSourceEnsured) return
  const sql = getSQL()
  try {
    await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'telegram'`
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_org_source ON support_channels(org_id, source)`
    channelSourceEnsured = true
  } catch (e) {
    console.error('[ensureChannelSourceColumn]', e)
  }
}

let benchmarkTableEnsured = false

/**
 * Идемпотентно создаёт таблицу benchmark_targets + индексы.
 * Нужна для семантического слоя метрик и страницы /benchmarks.
 * На warm invocations — дешёвый no-op.
 */
export async function ensureBenchmarkTable(): Promise<void> {
  if (benchmarkTableEnsured) return
  const sql = getSQL()
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS benchmark_targets (
        id TEXT PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        metric_key VARCHAR(80) NOT NULL,
        scope_role VARCHAR(20),
        scope_market VARCHAR(20),
        scope_source VARCHAR(20),
        period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
        tier VARCHAR(20) NOT NULL,
        target_value DOUBLE PRECISION NOT NULL,
        source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
        sample_size INTEGER,
        computed_at TIMESTAMP,
        set_by VARCHAR(50),
        set_at TIMESTAMP DEFAULT NOW(),
        notes TEXT
      )
    `
    // Миграция со старой схемы: id мог быть VARCHAR(50), теперь должен быть TEXT,
    // потому что естественный ключ собирается из org+metric+scope+period+tier
    // и для длинных metric_key (sentiment_positive_rate, repeat_contact_rate)
    // легко выскакивает за 50 символов. Идемпотентно — no-op если уже TEXT.
    await sql`ALTER TABLE benchmark_targets ALTER COLUMN id TYPE TEXT`.catch(() => {})
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmark_scope ON benchmark_targets(
      org_id, metric_key, COALESCE(scope_role,''), COALESCE(scope_market,''), COALESCE(scope_source,''), period_type, tier
    )`
    await sql`CREATE INDEX IF NOT EXISTS idx_benchmark_org_metric ON benchmark_targets(org_id, metric_key)`
    benchmarkTableEnsured = true
  } catch (e) {
    console.error('[ensureBenchmarkTable]', e)
  }
}
