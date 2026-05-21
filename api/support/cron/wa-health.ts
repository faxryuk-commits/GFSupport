/**
 * Cron: проверяет WhatsApp bridge health и алертит в TG если down.
 *
 * Расписание: каждые 10 минут (см. vercel.json crons).
 *
 * Логика:
 *   1. GET https://gfsupport-production.up.railway.app/health
 *   2. Если ok=true → запоминаем last_ok_at в support_settings.
 *   3. Если ok=false → проверяем сколько лежит. Если > 30 мин и алерт ещё не слали
 *      за последний час → шлём в TG всем admin/manager.
 *
 * Сохраняемое состояние:
 *   wa_bridge_last_ok_at      — ISO, когда последний раз был ok
 *   wa_bridge_last_alert_at   — ISO, когда последний раз слали алерт (для антиспама)
 *
 * Защита: для cron нужен либо CRON_SECRET, либо запрос от Vercel cron infrastructure.
 */

import { getSQL, json, getOrgBotToken } from '../lib/db.js'

export const config = { runtime: 'edge' }

const WA_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'https://gfsupport-production.up.railway.app'
const DOWN_THRESHOLD_MINUTES = 30
const ALERT_COOLDOWN_MINUTES = 60

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null)

  // Vercel cron шлёт с заголовком user-agent 'vercel-cron'.
  // Также допускаем ручной вызов с CRON_SECRET.
  const ua = req.headers.get('user-agent') || ''
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = ua.includes('vercel-cron')
  const hasSecret = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!isVercelCron && !hasSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()

  // 1. Опросим bridge
  let health: any = null
  let fetchError: string | null = null
  try {
    const res = await fetch(`${WA_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(10_000) })
    health = await res.json().catch(() => ({ ok: false }))
  } catch (e: any) {
    fetchError = e?.message || 'fetch_failed'
  }

  const isOk = Boolean(health?.ok)
  const now = new Date()
  const nowIso = now.toISOString()

  // 2. Ensure settings table & read previous state
  await sql`
    CREATE TABLE IF NOT EXISTS support_settings (
      key VARCHAR(64) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(() => {})

  const settings = await sql`
    SELECT key, value FROM support_settings WHERE key IN ('wa_bridge_last_ok_at', 'wa_bridge_last_alert_at', 'wa_bridge_down_since')
  `
  const settingsMap: Record<string, string> = {}
  settings.forEach((s: any) => { settingsMap[s.key] = s.value })

  const lastOkAt = settingsMap['wa_bridge_last_ok_at'] ? new Date(settingsMap['wa_bridge_last_ok_at']) : null
  const lastAlertAt = settingsMap['wa_bridge_last_alert_at'] ? new Date(settingsMap['wa_bridge_last_alert_at']) : null
  const downSince = settingsMap['wa_bridge_down_since'] ? new Date(settingsMap['wa_bridge_down_since']) : null

  // 3. Update state
  if (isOk) {
    // Сервис в порядке. Очищаем downSince, обновляем last_ok_at.
    await upsertSetting(sql, 'wa_bridge_last_ok_at', nowIso)
    if (downSince) {
      const downtimeMin = Math.round((now.getTime() - downSince.getTime()) / 60000)
      console.log(`[WA Health] Recovered after ${downtimeMin} min downtime`)
      await sql`DELETE FROM support_settings WHERE key = 'wa_bridge_down_since'`.catch(() => {})
      // Recovery-уведомление если был длительный даун
      if (downtimeMin >= DOWN_THRESHOLD_MINUTES) {
        await alertAdmins(sql, `✅ WhatsApp bridge восстановлен после ${downtimeMin} мин даунтайма.\nТелефон: ${health.phone || '?'}`)
      }
    }
    return json({ ok: true, status: 'healthy', phone: health.phone })
  }

  // Сервис лежит. Фиксируем downSince если ещё не зафиксирован.
  if (!downSince) {
    await upsertSetting(sql, 'wa_bridge_down_since', nowIso)
    console.log('[WA Health] Down detected, marking timestamp')
    return json({ ok: false, status: 'just_went_down', willAlertAfterMin: DOWN_THRESHOLD_MINUTES })
  }

  const downtimeMin = (now.getTime() - downSince.getTime()) / 60000

  // Алерт только если down > порога И не слали алерт за последний час
  if (downtimeMin >= DOWN_THRESHOLD_MINUTES) {
    const sinceLastAlertMin = lastAlertAt ? (now.getTime() - lastAlertAt.getTime()) / 60000 : Infinity
    if (sinceLastAlertMin >= ALERT_COOLDOWN_MINUTES) {
      const lastErr = health?.lastError || fetchError || 'unknown'
      const recAttempts = health?.reconnectAttempts ?? '?'
      const lastDisco = health?.lastDisconnectedAt || '?'
      const message = `🚨 WhatsApp bridge down ${Math.round(downtimeMin)} мин\n\n` +
        `last error: ${lastErr}\n` +
        `reconnect attempts: ${recAttempts}\n` +
        `last disconnected: ${lastDisco}\n\n` +
        `Что делать: открыть Railway → gfsupport-production → логи → найти QR (или нажать Restart).`

      const sent = await alertAdmins(sql, message)
      await upsertSetting(sql, 'wa_bridge_last_alert_at', nowIso)
      return json({ ok: false, status: 'alerted', downtimeMin, recipients: sent })
    }
    return json({ ok: false, status: 'still_down_cooldown', downtimeMin, sinceLastAlertMin })
  }

  return json({ ok: false, status: 'down_below_threshold', downtimeMin })
}

async function upsertSetting(sql: any, key: string, value: string) {
  await sql`
    INSERT INTO support_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `
}

async function alertAdmins(sql: any, text: string): Promise<number> {
  // Найдём всех admin/manager с telegram_id во всех организациях
  const admins = await sql`
    SELECT DISTINCT a.org_id, a.telegram_id
    FROM support_agents a
    WHERE a.role IN ('admin', 'owner', 'manager')
      AND a.telegram_id IS NOT NULL
      AND a.is_active = true
  `.catch(() => [])

  let sentCount = 0
  for (const row of admins) {
    try {
      const botToken = await getOrgBotToken(row.org_id)
      if (!botToken) continue
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: row.telegram_id,
          text,
          parse_mode: 'Markdown',
        }),
      })
      if (res.ok) sentCount++
    } catch { /* ignore single failures */ }
  }
  return sentCount
}
