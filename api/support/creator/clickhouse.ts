import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { CREATOR_OWNER_ID, ensureCreatorSchema } from '../_lib/creator.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Подключение к ClickHouse Delever для «Индекса рынка».
 *
 * Реквизиты живут в support_settings (creator_clickhouse, JSON), пароль
 * наружу не отдаётся никогда — только признак «задан». Запросы к базе —
 * ТОЛЬКО фиксированные (проверка связи, список таблиц, договорённые
 * агрегаты); произвольный SQL из UI не принимается принципиально.
 */
interface ChConfig { host: string; port: string; username: string; password: string; database: string }

async function loadCfg(sql: ReturnType<typeof getSQL>): Promise<ChConfig | null> {
  const [row] = await sql`
    SELECT value FROM support_settings
    WHERE org_id = 'org_delever' AND key = 'creator_clickhouse' LIMIT 1`
  if (!row) return null
  try { return JSON.parse((row as any).value) } catch { return null }
}

export async function chQuery(cfg: ChConfig, query: string, timeoutMs = 8000): Promise<{ ok: boolean; data?: any; error?: string }> {
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
    try { return { ok: true, data: JSON.parse(text) } } catch { return { ok: true, data: text.slice(0, 2000) } }
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'таймаут подключения' : (e?.message || 'сеть') }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (ctx.agentId !== CREATOR_OWNER_ID) return json({ error: 'forbidden' }, 403)
  await ensureCreatorSchema(sql)

  if (req.method === 'GET') {
    const cfg = await loadCfg(sql)
    if (!cfg) return json({ config: null })
    return json({
      config: {
        host: cfg.host, port: cfg.port, username: cfg.username,
        database: cfg.database || '', hasPassword: Boolean(cfg.password),
      },
    })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* пустое тело */ }

  if (body.action === 'save') {
    const prev = (await loadCfg(sql)) || { host: '', port: '', username: '', password: '', database: '' }
    const next: ChConfig = {
      host: String(body.host ?? prev.host).trim(),
      port: String(body.port ?? prev.port).trim(),
      username: String(body.username ?? prev.username).trim(),
      // Пустой пароль в форме означает «не менять сохранённый»
      password: body.password ? String(body.password) : prev.password,
      database: String(body.database ?? prev.database).trim(),
    }
    await sql`
      INSERT INTO support_settings (org_id, key, value)
      VALUES ('org_delever', 'creator_clickhouse', ${JSON.stringify(next)})
      ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`
    return json({ ok: true, hasPassword: Boolean(next.password) })
  }

  if (body.action === 'test') {
    const cfg = await loadCfg(sql)
    if (!cfg || !cfg.host || !cfg.password) return json({ error: 'заполни хост и пароль' }, 400)
    const ping = await chQuery(cfg, 'SELECT version() AS v')
    if (!ping.ok) return json({ ok: false, error: ping.error })
    const dbs = await chQuery(cfg, 'SHOW DATABASES')
    const tables = await chQuery(cfg, cfg.database
      ? `SHOW TABLES FROM ${cfg.database.replace(/[^A-Za-z0-9_]/g, '')}`
      : 'SELECT database, name FROM system.tables WHERE database NOT IN (\'system\', \'INFORMATION_SCHEMA\', \'information_schema\') ORDER BY database, name LIMIT 200')
    return json({
      ok: true,
      version: ping.data?.data?.[0]?.v || null,
      databases: dbs.ok ? (dbs.data?.data || []).map((r: any) => r.name) : [],
      tables: tables.ok ? (tables.data?.data || []) : [],
      tablesError: tables.ok ? null : tables.error,
    })
  }

  return json({ error: 'unknown action' }, 400)
}
