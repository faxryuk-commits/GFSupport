import type { NeonQueryFunction } from '@neondatabase/serverless'

type SQL = NeonQueryFunction<false, false>

/**
 * Общий read-only клиент ClickHouse Delever (аналитическая реплика).
 *
 * Реквизиты — support_settings key `creator_clickhouse` (владелец вводит в UI
 * Креатора). Запросы к базе — ТОЛЬКО зашитые в код агрегаты: произвольный
 * SQL от пользователей сюда не попадает никогда. Персональные данные конечных
 * покупателей (телефоны, адреса) не читаем — только агрегаты по брендам.
 */
export interface ChConfig { host: string; port: string; username: string; password: string; database: string }

export async function loadChConfig(sql: SQL): Promise<ChConfig | null> {
  const [row] = await sql`
    SELECT value FROM support_settings
    WHERE org_id = 'org_delever' AND key = 'creator_clickhouse' LIMIT 1`
  if (!row) return null
  try {
    const cfg = JSON.parse((row as any).value)
    return cfg?.host && cfg?.password ? cfg : null
  } catch {
    return null
  }
}

export async function chQuery(
  cfg: ChConfig,
  query: string,
  timeoutMs = 8000,
): Promise<{ ok: boolean; data?: any[]; error?: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const url = `http://${cfg.host}:${cfg.port}/?default_format=JSON${cfg.database ? `&database=${encodeURIComponent(cfg.database)}` : ''}`
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'X-ClickHouse-User': cfg.username,
        'X-ClickHouse-Key': cfg.password,
        'Content-Type': 'text/plain',
      },
      body: query,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: text.slice(0, 400) }
    try { return { ok: true, data: JSON.parse(text).data } } catch { return { ok: false, error: 'не-JSON ответ' } }
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'таймаут подключения' : (e?.message || 'сеть') }
  } finally {
    clearTimeout(timer)
  }
}

/** Статус «завершён» в order_v (выверено 19.09.2026 по признакам finished/delivered). */
export const CH_DONE_STATUS = "'e665273d-5415-4243-a329-aee410e39465'"
