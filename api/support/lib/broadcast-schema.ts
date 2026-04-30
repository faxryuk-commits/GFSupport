import { getSQL } from './db.js'

/**
 * Идемпотентная миграция всех таблиц для рассылок.
 *
 * Архитектура:
 *   support_broadcast_scheduled  — одна строка = одна рассылка-кампания
 *     state machine: draft → queued → running → completed | partial | failed | cancelled
 *
 *   support_broadcast_recipients — одна строка = одна доставка одному каналу
 *     state machine: queued → sending → delivered | failed | skipped
 *     UNIQUE (broadcast_id, channel_id) — физическая защита от дублей
 *
 *   support_broadcasts           — legacy архив (на чтение для старых рассылок)
 *
 *   support_broadcast_clicks     — клики по trackable-ссылкам
 *
 * Миграция выполняется один раз на инстансе (in-memory флаг), а CREATE/ALTER
 * сами по себе идемпотентны (IF NOT EXISTS), так что повторный вызов безопасен.
 */

let ensured = false

export async function ensureBroadcastSchema(): Promise<void> {
  if (ensured) return
  const sql = getSQL()

  // ---- support_broadcast_scheduled (кампании) ----
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcast_scheduled (
      id VARCHAR(60) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL DEFAULT 'org_delever',
      message_text TEXT NOT NULL,
      message_type VARCHAR(30) DEFAULT 'announcement',
      notification_type VARCHAR(30) DEFAULT 'announcement',
      filter_type VARCHAR(30) DEFAULT 'all',
      selected_channels TEXT[],
      scheduled_at TIMESTAMPTZ NOT NULL,
      timezone VARCHAR(50) DEFAULT 'Asia/Tashkent',
      status VARCHAR(20) DEFAULT 'queued',
      sender_type VARCHAR(20) DEFAULT 'ai',
      sender_id VARCHAR(64),
      sender_name VARCHAR(255),
      media_url TEXT,
      media_type VARCHAR(30),
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_worker_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      broadcast_id VARCHAR(60),
      error_message TEXT,
      recipients_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      queued_count INTEGER NOT NULL DEFAULT 0,
      viewed_count INTEGER DEFAULT 0,
      reaction_count INTEGER DEFAULT 0
    )
  `

  // Доращиваем недостающие колонки на существующих окружениях.
  // Каждый ALTER идёт отдельным statement, потому что Neon serverless
  // template-tag не разрешает динамические идентификаторы.
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ` } catch {}
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ` } catch {}
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS last_worker_at TIMESTAMPTZ` } catch {}
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0` } catch {}
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS queued_count INTEGER NOT NULL DEFAULT 0` } catch {}
  try { await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS media_type VARCHAR(30)` } catch {}

  // ---- support_broadcast_recipients (получатели) ----
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcast_recipients (
      id VARCHAR(80) PRIMARY KEY,
      broadcast_id VARCHAR(60) NOT NULL,
      org_id VARCHAR(50) NOT NULL,
      channel_id VARCHAR(50) NOT NULL,
      telegram_chat_id BIGINT,
      channel_name VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      retry_after_at TIMESTAMPTZ,
      error_code VARCHAR(40),
      error_message TEXT,
      telegram_message_id BIGINT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_broadcast_recipient_channel
    ON support_broadcast_recipients (broadcast_id, channel_id)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_queue
    ON support_broadcast_recipients (org_id, status, retry_after_at)
    WHERE status IN ('queued', 'sending')
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
    ON support_broadcast_recipients (broadcast_id, status)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_org_error
    ON support_broadcast_recipients (org_id, error_code, updated_at DESC)
    WHERE error_code IS NOT NULL
  `

  // ---- support_broadcasts (legacy архив) ----
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcasts (
      id VARCHAR(60) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL DEFAULT 'org_delever',
      message_type VARCHAR(30),
      message_text TEXT,
      filter_type VARCHAR(30),
      sender_name VARCHAR(255),
      channels_count INTEGER DEFAULT 0,
      successful_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      clicks_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // ---- support_broadcast_clicks ----
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcast_clicks (
      id SERIAL PRIMARY KEY,
      org_id VARCHAR(50) DEFAULT 'org_delever',
      broadcast_id VARCHAR(60),
      link_id VARCHAR(50),
      target_url TEXT,
      user_agent TEXT,
      ip_hash VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  ensured = true
}

export type RecipientStatus = 'queued' | 'sending' | 'delivered' | 'failed' | 'skipped'
export type CampaignStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type ErrorCode =
  | 'user_blocked'
  | 'bot_kicked'
  | 'chat_not_found'
  | 'chat_upgraded'
  | 'chat_dead'
  | 'user_dead'
  | 'bad_request'
  | 'rate_limit'
  | 'transient'
  | 'transient_exhausted'
  | 'no_token'
  | 'unknown'
