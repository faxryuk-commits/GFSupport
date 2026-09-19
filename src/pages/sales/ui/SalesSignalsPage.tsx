import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { TrendingDown, TrafficCone, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

/**
 * «Сигналы» — сводка проблем по клиентам из данных Delever.
 *
 * Открывается мгновенно: читает утренний снапшот, живой пересчёт — только
 * по кнопке. Вся информация на одной странице: строка раскрывается в
 * мини-пульс (спарклайн 12 недель, каналы, доставка) без ухода в карточку.
 */

interface Sig {
  accountId: string; name: string; lifecycle: string; ageDays: number
  done30: number; cancelPct: number; channels: number
  ownPct: number; medMin: number | null; weeks: number[]
  weeklyNorm?: number; weeklyNow?: number; dropPct?: number
  level?: 'red' | 'yellow'
}

function Sparkline({ weeks, width = 220 }: { weeks: number[]; width?: number }) {
  if (!weeks || weeks.length < 2) return <span className="text-[11px] text-gray-300">мало данных</span>
  const h = 40, pad = 2
  const max = Math.max(...weeks, 1)
  const pts = weeks.map((n, i) => {
    const x = pad + (i * (width - pad * 2)) / (weeks.length - 1)
    const y = h - pad - (n / max) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={h} role="img" aria-label="Заказы по неделям">
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** Разворот строки: мини-пульс на данных, которые уже пришли со снапшотом. */
function Details({ s }: { s: Sig }) {
  return (
    <div className="px-4 py-3 bg-gray-50/60 border-t border-gray-100 flex items-end gap-6 flex-wrap">
      <div className="min-w-[220px]">
        <div className="text-[11px] text-gray-400 mb-0.5">заказы по неделям</div>
        <Sparkline weeks={s.weeks} />
      </div>
      <div><div className="text-[11px] text-gray-400">заказов/30д</div>
        <div className="text-[15px] font-semibold text-gray-900">{s.done30.toLocaleString('ru-RU')}</div></div>
      <div><div className="text-[11px] text-gray-400">отмены</div>
        <div className={`text-[15px] font-semibold ${s.cancelPct > 40 ? 'text-red-600' : 'text-gray-900'}`}>{s.cancelPct}%</div></div>
      <div><div className="text-[11px] text-gray-400">свои каналы</div>
        <div className="text-[15px] font-semibold text-gray-900">{s.ownPct}%</div></div>
      <div><div className="text-[11px] text-gray-400">каналов</div>
        <div className="text-[15px] font-semibold text-gray-900">{s.channels}</div></div>
      {s.medMin !== null && (
        <div><div className="text-[11px] text-gray-400">доставка, мед.</div>
          <div className="text-[15px] font-semibold text-gray-900">{s.medMin} мин</div></div>
      )}
      <div><div className="text-[11px] text-gray-400">в платформе</div>
        <div className="text-[15px] font-semibold text-gray-900">{s.ageDays < 60 ? `${s.ageDays} дн` : `${Math.floor(s.ageDays / 30)} мес`}</div></div>
      <div className="flex-1 text-right">
        <Link to={`/sales/accounts/${s.accountId}`} className="text-[12.5px] text-blue-600 hover:underline">открыть карточку →</Link>
      </div>
    </div>
  )
}

export default function SalesSignalsPage() {
  const [data, setData] = useState<{ computedAt?: string; mapped: number; declines: Sig[]; launches: Sig[]; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = (fresh = false) => {
    setLoading(true)
    apiGet<any>(`/sales/signals${fresh ? '?fresh=1' : ''}`, false)
      .then(setData)
      .catch(e => setData({ mapped: 0, declines: [], launches: [], error: e?.message }))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(), [])

  const fmtTime = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const Row = ({ s, cols }: { s: Sig; cols: React.ReactNode }) => (
    <Fragment>
      <tr onClick={() => setOpen(open === s.accountId ? null : s.accountId)}
        className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer select-none">
        <td className="px-4 py-2 font-medium text-gray-900">
          <span className="inline-flex items-center gap-1.5">
            {open === s.accountId ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-300" />}
            {s.level && <span className={`inline-block w-2 h-2 rounded-full ${s.level === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} />}
            {s.name}
          </span>
        </td>
        {cols}
      </tr>
      {open === s.accountId && (
        <tr><td colSpan={5} className="p-0"><Details s={s} /></td></tr>
      )}
    </Fragment>
  )

  return (
    <div className="p-5 max-w-[1000px] space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">Сигналы</h1>
          <p className="text-[12.5px] text-gray-500">
            Данные заказов Delever по {data?.mapped ?? '…'} связанным брендам
            {data?.computedAt ? ` · снимок от ${fmtTime(data.computedAt)}` : ''}.
            Клик по строке раскрывает пульс бренда прямо здесь.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          title="Пересчитать по живым данным ClickHouse (несколько секунд)"
          className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600 disabled:opacity-60">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {loading ? 'Считаю…' : 'Пересчитать'}
        </button>
      </div>

      {data?.error && <div className="text-[12.5px] text-red-600">{data.error}</div>}
      {!data && <div className="text-[12.5px] text-gray-400">Открываю снимок…</div>}

      {data && (
        <>
          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
              <TrendingDown size={14} className="text-red-600" />
              <h2 className="text-[13.5px] font-semibold text-gray-900">Спад у зрелых</h2>
              <span className="text-[11px] text-gray-400">{data.declines.length} · последние 2 недели ниже 75% своей нормы</span>
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
                  <th className="py-1.5 font-medium pr-4 text-right">заказов/30д</th>
                </tr></thead>
                <tbody>
                  {data.declines.map(d => (
                    <Row key={d.accountId} s={d} cols={
                      <>
                        <td className="py-2 tabular-nums">{d.weeklyNorm}</td>
                        <td className="py-2 tabular-nums">{d.weeklyNow}</td>
                        <td className="py-2 font-semibold text-red-600">−{d.dropPct}%</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{d.done30.toLocaleString('ru-RU')}</td>
                      </>
                    } />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
              <TrafficCone size={14} className="text-amber-600" />
              <h2 className="text-[13.5px] font-semibold text-gray-900">Запуск под угрозой</h2>
              <span className="text-[11px] text-gray-400">{data.launches.length} · моложе 90 дней, без порогов активации</span>
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
                  <th className="py-1.5 font-medium pr-4 text-right">каналов</th>
                </tr></thead>
                <tbody>
                  {data.launches.map(l => (
                    <Row key={l.accountId} s={l} cols={
                      <>
                        <td className="py-2 tabular-nums">{l.ageDays}</td>
                        <td className={`py-2 tabular-nums ${l.done30 < 30 ? 'font-semibold text-red-600' : ''}`}>{l.done30}</td>
                        <td className={`py-2 tabular-nums ${l.cancelPct > 40 ? 'font-semibold text-red-600' : ''}`}>{l.cancelPct}%</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{l.channels}</td>
                      </>
                    } />
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
