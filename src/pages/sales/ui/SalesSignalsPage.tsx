import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { TrendingDown, TrafficCone, RefreshCw } from 'lucide-react'

/**
 * «Сигналы» — сводка проблем по клиентам из живых данных Delever:
 * спады у зрелых брендов и запуски, не добравшие порогов активации.
 * Пороги выверены когортным анализом (см. brand-pulse).
 */

interface Decline {
  accountId: string; name: string; lifecycle: string; ageDays: number
  weeklyNorm: number; weeklyNow: number; dropPct: number
}
interface Launch {
  accountId: string; name: string; lifecycle: string; ageDays: number
  done30: number; cancelPct: number; channels: number; level: 'red' | 'yellow'
}

export default function SalesSignalsPage() {
  const [data, setData] = useState<{ mapped: number; declines: Decline[]; launches: Launch[]; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    apiGet<any>('/sales/signals', false)
      .then(setData)
      .catch(e => setData({ mapped: 0, declines: [], launches: [], error: e?.message }))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  return (
    <div className="p-5 max-w-[1000px] space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">Сигналы</h1>
          <p className="text-[12.5px] text-gray-500">
            Живые данные заказов из Delever по связанным клиентам ({data?.mapped ?? '…'} брендов).
            Спад — последние 2 недели ниже 75% собственной нормы; запуск под угрозой — новичок
            без 100 заказов за 30 дней или с отменами выше 40%.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600 disabled:opacity-60">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      {data?.error && <div className="text-[12.5px] text-red-600">{data.error}</div>}
      {!data && <div className="text-[12.5px] text-gray-400">Считаю по брендам…</div>}

      {data && (
        <>
          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
              <TrendingDown size={14} className="text-red-600" />
              <h2 className="text-[13.5px] font-semibold text-gray-900">Спад у зрелых</h2>
              <span className="text-[11px] text-gray-400">{data.declines.length}</span>
            </header>
            {data.declines.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-gray-400">Спадов нет — все зрелые бренды в своей норме.</p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[11px] text-gray-400">
                  <th className="px-4 py-1.5 font-medium">клиент</th>
                  <th className="py-1.5 font-medium">норма/нед</th>
                  <th className="py-1.5 font-medium">сейчас</th>
                  <th className="py-1.5 font-medium">спад</th>
                  <th className="py-1.5" />
                </tr></thead>
                <tbody>
                  {data.declines.map(d => (
                    <tr key={d.accountId} className="border-t border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-2 font-medium text-gray-900">{d.name}
                        <span className="ml-2 text-[10.5px] text-gray-400">{Math.floor(d.ageDays / 30)} мес в платформе</span></td>
                      <td className="py-2 tabular-nums">{d.weeklyNorm}</td>
                      <td className="py-2 tabular-nums">{d.weeklyNow}</td>
                      <td className="py-2 font-semibold text-red-600">−{d.dropPct}%</td>
                      <td className="py-2 pr-4 text-right">
                        <Link to={`/sales/accounts/${d.accountId}`} className="text-blue-600 hover:underline">карточка →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
              <TrafficCone size={14} className="text-amber-600" />
              <h2 className="text-[13.5px] font-semibold text-gray-900">Запуск под угрозой</h2>
              <span className="text-[11px] text-gray-400">{data.launches.length} · моложе 90 дней</span>
            </header>
            {data.launches.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-gray-400">Все новички идут по порогам активации.</p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[11px] text-gray-400">
                  <th className="px-4 py-1.5 font-medium">бренд</th>
                  <th className="py-1.5 font-medium">дней</th>
                  <th className="py-1.5 font-medium">заказов/30д</th>
                  <th className="py-1.5 font-medium">отмены</th>
                  <th className="py-1.5 font-medium">каналов</th>
                  <th className="py-1.5" />
                </tr></thead>
                <tbody>
                  {data.launches.map(l => (
                    <tr key={l.accountId} className="border-t border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-2 font-medium text-gray-900">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${l.level === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} />
                        {l.name}
                      </td>
                      <td className="py-2 tabular-nums">{l.ageDays}</td>
                      <td className={`py-2 tabular-nums ${l.done30 < 30 ? 'font-semibold text-red-600' : ''}`}>{l.done30}</td>
                      <td className={`py-2 tabular-nums ${l.cancelPct > 40 ? 'font-semibold text-red-600' : ''}`}>{l.cancelPct}%</td>
                      <td className="py-2 tabular-nums">{l.channels}</td>
                      <td className="py-2 pr-4 text-right">
                        <Link to={`/sales/accounts/${l.accountId}`} className="text-blue-600 hover:underline">карточка →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Пороги из когортного анализа: старт ≥100 заказов/30д → выживаемость 64–75%; старт &lt;30 → 32%.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
