import type { NeonQueryFunction } from '@neondatabase/serverless'

let ensured = false

/** Ручные корректировки FRT: исключение ack-сообщений или фактическое время ответа. */
export async function ensureFrtOverridesTable(sql: NeonQueryFunction<false, false>) {
  if (ensured) return
  await sql`
    CREATE TABLE IF NOT EXISTS support_frt_overrides (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      message_id VARCHAR(50) NOT NULL,
      channel_id VARCHAR(50) NOT NULL,
      override_type VARCHAR(20) NOT NULL,
      frt_minutes INT,
      note TEXT,
      created_by VARCHAR(50),
      created_by_name VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, message_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_frt_overrides_org_msg ON support_frt_overrides(org_id, message_id)`
  ensured = true
}

export type FrtOverrideType = 'exclude' | 'manual'

export interface FrtOverrideRow {
  id: string
  org_id: string
  message_id: string
  channel_id: string
  override_type: FrtOverrideType
  frt_minutes: number | null
  note: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}
