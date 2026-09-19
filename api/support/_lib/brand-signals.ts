import type { NeonQueryFunction } from '@neondatabase/serverless'
import { loadChConfig, chQuery, CH_DONE_STATUS } from './clickhouse.js'

type SQL = NeonQueryFunction<false, false>

/**
 * Сигналы по клиентам из аналитики Delever — общий расчёт для страницы
 * «Сигналы» и утреннего крона:
 *  — «спад»: зрелый бренд (90+ дней), последние 2 полные недели < 75%
 *    собственной медианы;
 *  — «запуск под угрозой»: моложе 90 дней без порогов активации
 *    (≥100 заказов/30д, отмены ≤40%). Пороги — из когортного анализа:
 *    старт ≥100 → выживаемость 64–75%, старт <30 → 32%.
 */
export interface DeclineSignal {
  accountId: string; name: string; lifecycle: string; ageDays: number
  ownerAgentId: string | null
  weeklyNorm: number; weeklyNow: number; dropPct: number
}
export interface LaunchSignal {
  accountId: string; name: string; lifecycle: string; ageDays: number
  ownerAgentId: string | null
  done30: number; cancelPct: number; channels: number; level: 'red' | 'yellow'
}

export async function computeBrandSignals(sql: SQL): Promise<
  { ok: true; mapped: number; declines: DeclineSignal[]; launches: LaunchSignal[] } | { ok: false; error: string }
> {
  const cfg = await loadChConfig(sql)
  if (!cfg) return { ok: false, error: 'ClickHouse не настроен' }

  // Один бренд = один аккаунт: автомэппинг по имени цепляет дубли лидов
  // («Eve» ×24) — без дедупа крон создал бы 24 задачи по одному бренду.
  // Приоритет: клиент > подтверждённая связка > свежая запись.
  const maps = await sql`
    SELECT DISTINCT ON (m.shipper_id)
           m.account_id, m.shipper_id, m.shipper_name, a.lifecycle, a.owner_agent_id
    FROM ch_brand_map m
    JOIN sales_accounts a ON a.id = m.account_id
    WHERE a.archived_at IS NULL
    ORDER BY m.shipper_id,
             (a.lifecycle = 'customer') DESC, m.confirmed DESC, a.created_at DESC`
  if (!maps.length) return { ok: true, mapped: 0, declines: [], launches: [] }

  const ids = (maps as any[]).map(m => `'${String(m.shipper_id).replace(/[^0-9a-f-]/gi, '')}'`).join(',')

  const [wk, agg] = await Promise.all([
    chQuery(cfg, `
      SELECT shipper_id, toStartOfWeek(created_at) w, count() n
      FROM order_v
      WHERE shipper_id IN (${ids}) AND status_id = ${CH_DONE_STATUS}
        AND created_at >= now() - INTERVAL 84 DAY
      GROUP BY shipper_id, w ORDER BY shipper_id, w`, 15000),
    chQuery(cfg, `
      SELECT shipper_id,
             min(created_at) f0,
             countIf(created_at >= now() - INTERVAL 30 DAY) total30,
             countIf(created_at >= now() - INTERVAL 30 DAY AND status_id = ${CH_DONE_STATUS}) done30,
             uniqExactIf(source, created_at >= now() - INTERVAL 30 DAY AND status_id = ${CH_DONE_STATUS}) channels
      FROM order_v
      WHERE shipper_id IN (${ids})
      GROUP BY shipper_id`, 15000),
  ])
  if (!wk.ok || !agg.ok) return { ok: false, error: wk.error || agg.error || 'ошибка ClickHouse' }

  const byShip: Record<string, any> = {}
  for (const m of maps as any[]) byShip[m.shipper_id] = m
  const weeks: Record<string, number[]> = {}
  for (const r of wk.data || []) (weeks[r.shipper_id] = weeks[r.shipper_id] || []).push(Number(r.n))

  const declines: DeclineSignal[] = []
  const launches: LaunchSignal[] = []
  for (const r of agg.data || []) {
    const m = byShip[r.shipper_id]
    if (!m || !r.f0) continue
    const ageDays = Math.floor((Date.now() - new Date(r.f0).getTime()) / 86400e3)
    const done30 = Number(r.done30), total30 = Number(r.total30)
    const cancelPct = total30 ? Math.round((1 - done30 / total30) * 100) : 0
    const base = {
      accountId: m.account_id, name: m.shipper_name, lifecycle: m.lifecycle,
      ownerAgentId: m.owner_agent_id || null, ageDays,
    }
    if (ageDays > 90) {
      const ws = weeks[r.shipper_id] || []
      if (ws.length >= 6) {
        const closed = ws.slice(0, -1)
        const recent = (closed[closed.length - 1] + closed[closed.length - 2]) / 2
        const sorted = closed.slice(0, -2).slice().sort((a, b) => a - b)
        const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
        if (med >= 20 && recent < med * 0.75) {
          declines.push({ ...base, weeklyNorm: med, weeklyNow: Math.round(recent), dropPct: Math.round((1 - recent / med) * 100) })
        }
      }
    } else if (done30 < 100 || cancelPct > 40) {
      launches.push({
        ...base, done30, cancelPct, channels: Number(r.channels || 0),
        level: done30 < 30 || cancelPct > 60 ? 'red' : 'yellow',
      })
    }
  }
  declines.sort((a, b) => b.dropPct - a.dropPct)
  launches.sort((a, b) => (a.level === b.level ? a.done30 - b.done30 : a.level === 'red' ? -1 : 1))
  return { ok: true, mapped: maps.length, declines, launches }
}
