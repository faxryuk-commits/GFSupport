import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = { runtime: 'edge', regions: ['iad1'] }

const BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'https://gfsupport-production.up.railway.app'

interface Module {
  key: string
  name: string
  status: 'ok' | 'warn' | 'down' | 'idle'
  lastRunAt: string | null
  schedule: string
  summary: string
  mode?: string | null
}

export default async function handler(req: Request): Promise<Response> {
  const orgId = await getRequestOrgId(req)
  const sql = getSQL()
  const modules: Module[] = []

  // 1. WhatsApp-мост — живой /health
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(8000) })
    const h: any = res.ok ? await res.json() : null
    modules.push({
      key: 'wa_bridge', name: 'WhatsApp-мост',
      status: h?.ok ? 'ok' : 'down',
      lastRunAt: h?.lastConnectedAt || null,
      schedule: 'постоянно (онлайн)',
      summary: h?.ok
        ? `Подключён: ${h.phone || '—'} · получено ${h?.messageStats?.received ?? 0}, переслано ${h?.messageStats?.forwarded ?? 0}`
        : `Не подключён: ${h?.lastError || 'нет связи'}`,
    })
  } catch {
    modules.push({ key: 'wa_bridge', name: 'WhatsApp-мост', status: 'down', lastRunAt: null, schedule: 'постоянно', summary: 'Мост недоступен' })
  }

  // helper: последнее cycle-событие по актору
  async function lastCycle(actor: string) {
    try {
      const r = await sql`SELECT reasoning, payload, mode, created_at FROM support_ai_events WHERE org_id=${orgId} AND actor=${actor} AND kind='cycle' ORDER BY created_at DESC LIMIT 1` as any[]
      return r[0] || null
    } catch { return null }
  }
  const staleAfterMin = (lastAt: string | null, schedMin: number): 'ok' | 'warn' | 'idle' => {
    if (!lastAt) return 'idle'
    const ageMin = (Date.now() - new Date(lastAt).getTime()) / 60000
    return ageMin <= schedMin * 3 ? 'ok' : 'warn'
  }

  // 2. SLA-страж
  const slaC = await lastCycle('sla_guard')
  modules.push({
    key: 'sla_guard', name: 'SLA-страж',
    status: slaC ? staleAfterMin(slaC.created_at, 5) : 'idle',
    lastRunAt: slaC?.created_at || null, schedule: 'каждые 5 мин',
    summary: slaC?.reasoning || 'Ещё не запускался',
    mode: slaC?.mode || null,
  })

  // 3. Самообучение (детектор исхода)
  const learnC = await lastCycle('learning')
  modules.push({
    key: 'learning', name: 'Самообучение (исходы)',
    status: learnC ? staleAfterMin(learnC.created_at, 30) : 'idle',
    lastRunAt: learnC?.created_at || null, schedule: 'каждые 30 мин',
    summary: learnC?.reasoning || 'Ещё не запускался',
  })

  // 4. Таксономия-пересчёт
  try {
    const r = await sql`SELECT data, computed_at FROM support_analytics_snapshot WHERE org_id=${orgId} LIMIT 1` as any[]
    const s = r[0]
    modules.push({
      key: 'taxonomy', name: 'Таксономия (пересчёт)',
      status: s ? staleAfterMin(s.computed_at, 60 * 24 * 7) : 'idle',
      lastRunAt: s?.computed_at || null, schedule: 'еженедельно',
      summary: s ? `${s.data?.totalIssues ?? '?'} проблем, ${s.data?.channels ?? '?'} каналов` : 'Нет снимка',
    })
  } catch { modules.push({ key: 'taxonomy', name: 'Таксономия (пересчёт)', status: 'idle', lastRunAt: null, schedule: 'еженедельно', summary: 'Нет снимка' }) }

  // 5. AI-агент (событийный)
  try {
    const r = await sql`
      SELECT MAX(created_at) AS last, COUNT(*) FILTER (WHERE created_at > NOW()-INTERVAL '24 hours')::int AS d1,
        COUNT(*) FILTER (WHERE feedback='correct')::int AS ok_, COUNT(*) FILTER (WHERE feedback IN ('correct','wrong'))::int AS labeled
      FROM support_agent_decisions WHERE org_id=${orgId}` as any[]
    const a = r[0]
    const sr = a.labeled ? Math.round((100 * a.ok_) / a.labeled) : null
    modules.push({
      key: 'ai_agent', name: 'AI-агент',
      status: a.last ? (a.d1 > 0 ? 'ok' : 'idle') : 'idle',
      lastRunAt: a.last || null, schedule: 'по входящим сообщениям',
      summary: a.last ? `За 24ч решений: ${a.d1}${sr != null ? ` · success-rate ${sr}%` : ''}` : 'Нет решений',
    })
  } catch { modules.push({ key: 'ai_agent', name: 'AI-агент', status: 'idle', lastRunAt: null, schedule: 'по сообщениям', summary: 'Нет данных' }) }

  return json({ modules, fetchedAt: new Date().toISOString() })
}
