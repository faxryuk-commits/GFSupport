import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { RefreshCw, TrendingUp, TrendingDown, Clock3, Store, Banknote, CheckCheck } from 'lucide-react'

/**
 * «Картина бизнеса» — большой аналитический дашборд платформы Delever
 * по данным ClickHouse. Только владельцу (API отдаёт 403 остальным).
 * Все срезы по странам посчитаны заранее в снапшот — фильтр рынка
 * переключается мгновенно. Деньги показываются только внутри рынка:
 * валюты разные, суммы через границы не складываются.
 */

interface Kpi {
  done30: number; prev30: number; momPct: number | null; cancelPct: number
  brands30: number; brandsPrev30: number; newBrands30: number
  medMin: number | null; medDistKm: number | null
  avgCheck: number | null; medCheck: number | null; ontimePct: number | null
}
interface Mover { name: string; done30: number; prev30: number; chg: number }
interface Slice {
  kpi: Kpi
  weekly: Array<{ w: string; n: number }>
  channels: Array<{ m: string; agg: number; own: number; pickup: number; hall: number }>
  sources: Array<{ m: string; agg: number; admin: number; bot: number; kiosk: number; mobile: number; website: number; hall: number }>
  payments: Array<{ m: string; cash: number; card: number; online: number; other: number }>
  quality: Array<{ m: string; medMin: number; ontimePct: number }>
  hours: Array<{ h: string; n: number }>
  growers: Mover[]
  fallers: Mover[]
}
interface Market {
  iso: string; name: string; currency: string
  done30: number; prev30: number; momPct: number | null
  cancelPct: number; brands30: number; avgCheck: number | null
}
interface Dash { computedAt?: string; markets: Market[]; slices: Record<string, Slice>; error?: string }

const fmtN = (n: number) => n.toLocaleString('ru-RU')
const fmtMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
const fmtWeek = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
const flag = (iso: string) => iso.length === 2 && /^[A-Z]{2}$/.test(iso)
  ? String.fromCodePoint(...[...iso].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '🌍'
const RU_NAME: Record<string, string> = {
  UZ: 'Узбекистан', KZ: 'Казахстан', GE: 'Грузия', CY: 'Кипр', KG: 'Кыргызстан',
  AZ: 'Азербайджан', AE: 'ОАЭ', US: 'США', CZ: 'Чехия',
}

/** Линия с областью, подписями экстремумов и метками оси X. */
function AreaLine({ points, labels, color = '#2563eb', height = 150, suffix = '' }: {
  points: number[]; labels: string[]; color?: string; height?: number; suffix?: string
}) {
  if (points.length < 2) return <div className="text-[11px] text-gray-300">мало данных</div>
  const w = 640, h = height, padX = 6, padTop = 16, padBot = 18
  const max = Math.max(...points), min = Math.min(...points)
  const span = max - min || 1
  const x = (i: number) => padX + (i * (w - padX * 2)) / (points.length - 1)
  const y = (v: number) => padTop + (1 - (v - min) / span) * (h - padTop - padBot)
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${padX},${h - padBot} ${line} ${w - padX},${h - padBot}`
  const iMax = points.indexOf(max), iMin = points.indexOf(min)
  const step = Math.ceil(points.length / 7)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
      <polygon points={area} fill={color} opacity="0.07" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.5" fill={color} />
      <text x={Math.min(Math.max(x(iMax), 24), w - 24)} y={y(max) - 5} textAnchor="middle" fontSize="10" fill="#6b7280">{fmtN(max)}{suffix}</text>
      {iMin !== iMax && (
        <text x={Math.min(Math.max(x(iMin), 24), w - 24)} y={Math.min(y(min) + 12, h - padBot - 2)} textAnchor="middle" fontSize="10" fill="#9ca3af">{fmtN(min)}{suffix}</text>
      )}
      {labels.map((l, i) => (i % step === 0 || i === labels.length - 1) && (
        <text key={i} x={x(i)} y={h - 4} textAnchor="middle" fontSize="9.5" fill="#9ca3af">{l}</text>
      ))}
    </svg>
  )
}

interface Cat { key: string; label: string; color: string }

/** Стопки по месяцам: состав заказов по категориям + легенда. */
function StackedBars({ rows, cats }: { rows: Array<Record<string, any>>; cats: Cat[] }) {
  if (rows.length === 0) return null
  const w = 640, h = 170, padX = 8, padTop = 8, padBot = 18
  const bw = Math.min(48, ((w - padX * 2) / rows.length) * 0.62)
  const total = (r: any) => cats.reduce((s, c) => s + (Number(r[c.key]) || 0), 0)
  const max = Math.max(...rows.map(total), 1)
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {rows.map((r, i) => {
          const cx = padX + ((i + 0.5) * (w - padX * 2)) / rows.length
          let yTop = h - padBot
          return (
            <g key={r.m}>
              {cats.map(c => {
                const bh = ((Number(r[c.key]) || 0) / max) * (h - padTop - padBot)
                yTop -= bh
                return <rect key={c.key} x={cx - bw / 2} y={yTop} width={bw} height={bh} fill={c.color} rx="1" />
              })}
              <text x={cx} y={yTop - 4} textAnchor="middle" fontSize="9.5" fill="#6b7280">{fmtN(total(r))}</text>
              <text x={cx} y={h - 4} textAnchor="middle" fontSize="9.5" fill="#9ca3af">{fmtMonth(r.m)}</text>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-4 flex-wrap mt-1">
        {cats.map(c => (
          <span key={c.key} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} /> {c.label}
          </span>
        ))}
      </div>
    </>
  )
}

const CHANNEL_CATS: Cat[] = [
  { key: 'agg', label: 'агрегаторы', color: '#f59e0b' },
  { key: 'own', label: 'своя доставка', color: '#2563eb' },
  { key: 'pickup', label: 'самовывоз', color: '#10b981' },
  { key: 'hall', label: 'зал', color: '#9ca3af' },
]
const SOURCE_CATS: Cat[] = [
  { key: 'agg', label: 'агрегаторы', color: '#f59e0b' },
  { key: 'admin', label: 'админ-панель', color: '#94a3b8' },
  { key: 'bot', label: 'бот', color: '#2563eb' },
  { key: 'kiosk', label: 'киоск', color: '#8b5cf6' },
  { key: 'mobile', label: 'моб. приложения', color: '#10b981' },
  { key: 'website', label: 'сайт', color: '#06b6d4' },
  { key: 'hall', label: 'зал', color: '#9ca3af' },
]
const PAYMENT_CATS: Cat[] = [
  { key: 'cash', label: 'наличные', color: '#f59e0b' },
  { key: 'card', label: 'карта курьеру', color: '#2563eb' },
  { key: 'online', label: 'онлайн', color: '#10b981' },
  { key: 'other', label: 'прочее', color: '#9ca3af' },
]

/** Гистограмма нагрузки по часам суток (время платформы). */
function HourBars({ rows }: { rows: Slice['hours'] }) {
  const byHour = new Array(24).fill(0)
  for (const r of rows) byHour[Number(r.h)] = r.n
  const max = Math.max(...byHour, 1)
  const peak = byHour.indexOf(max)
  const w = 640, h = 120, padX = 6, padBot = 16
  const bw = ((w - padX * 2) / 24) * 0.7
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
      {byHour.map((n, hh) => {
        const cx = padX + ((hh + 0.5) * (w - padX * 2)) / 24
        const bh = (n / max) * (h - padBot - 14)
        return (
          <g key={hh}>
            <rect x={cx - bw / 2} y={h - padBot - bh} width={bw} height={bh}
              fill={hh === peak ? '#2563eb' : '#bfdbfe'} rx="1.5" />
            {hh % 3 === 0 && <text x={cx} y={h - 3} textAnchor="middle" fontSize="9.5" fill="#9ca3af">{hh}</text>}
            {hh === peak && <text x={cx} y={h - padBot - bh - 4} textAnchor="middle" fontSize="10" fill="#2563eb" fontWeight="600">{fmtN(n)}</text>}
          </g>
        )
      })}
    </svg>
  )
}

function Kpi({ icon, label, value, sub, subCls }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; subCls?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 min-w-[150px] flex-1">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">{icon} {label}</div>
      <div className="text-[22px] font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className={`text-[11.5px] ${subCls || 'text-gray-400'}`}>{sub}</div>}
    </div>
  )
}

function MoversTable({ rows, dir }: { rows: Mover[]; dir: 'up' | 'down' }) {
  if (rows.length === 0) return <p className="px-4 py-4 text-[12.5px] text-gray-400">Пока пусто.</p>
  return (
    <table className="w-full text-[12.5px]">
      <thead><tr className="text-left text-[11px] text-gray-400">
        <th className="px-4 py-1.5 font-medium">бренд</th>
        <th className="py-1.5 font-medium text-right">было/30д</th>
        <th className="py-1.5 font-medium text-right">стало/30д</th>
        <th className="py-1.5 pr-4 font-medium text-right">динамика</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name} className="border-t border-gray-100">
            <td className="px-4 py-1.5 font-medium text-gray-900">{r.name}</td>
            <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtN(r.prev30)}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtN(r.done30)}</td>
            <td className={`py-1.5 pr-4 text-right tabular-nums font-semibold ${dir === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
              {r.chg > 0 ? '+' : ''}{r.chg}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Section({ title, hint, right, children }: {
  title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <h2 className="text-[13.5px] font-semibold text-gray-900">{title}</h2>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  )
}

export default function BusinessDashPage() {
  const [d, setD] = useState<Dash | null>(null)
  const [loading, setLoading] = useState(false)
  const [market, setMarket] = useState('ALL')
  const [span, setSpan] = useState<'half' | 'year'>('half')

  const load = (fresh = false) => {
    setLoading(true)
    apiGet<Dash>(`/analytics/business${fresh ? '?fresh=1' : ''}`, false)
      .then(setD)
      .catch(e => setD({ markets: [], slices: {}, error: e?.message }))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(), [])

  const fmtTime = (iso?: string) => {
    if (!iso) return ''
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const s = d?.slices?.[market] || d?.slices?.ALL
  const k = s?.kpi
  const cur = d?.markets?.find(m => m.iso === market)?.currency || ''
  const brandsDelta = k ? k.brands30 - k.brandsPrev30 : 0
  const weekly = s ? (span === 'half' ? s.weekly.slice(-25) : s.weekly) : []
  const mName = (m: Market) => RU_NAME[m.iso] || m.name

  return (
    <div className="p-5 max-w-[1100px] space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">Картина бизнеса</h1>
          <p className="text-[12.5px] text-gray-500">
            Платформа Delever по данным ClickHouse
            {d?.computedAt ? ` · снимок от ${fmtTime(d.computedAt)}` : ''}. Только завершённые заказы.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          title="Пересчитать по живым данным ClickHouse (десяток секунд)"
          className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600 disabled:opacity-60">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {loading ? 'Считаю…' : 'Пересчитать'}
        </button>
      </div>

      {d?.error && <div className="text-[12.5px] text-red-600">{d.error}</div>}
      {!d && <div className="text-[12.5px] text-gray-400">Открываю снимок…</div>}

      {d && !d.error && s && k && (
        <>
          {/* Фильтр рынка: срезы уже в снапшоте, переключение мгновенное */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[{ iso: 'ALL' }, ...d.markets].map(m => (
              <button key={m.iso} onClick={() => setMarket(m.iso)}
                className={`text-[12.5px] px-3 py-1.5 rounded-full border transition-colors ${
                  market === m.iso
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'}`}>
                {m.iso === 'ALL' ? 'Все рынки' : `${flag(m.iso)} ${mName(m as Market)}`}
              </button>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <Kpi icon={<TrendingUp size={12} />} label="заказов / 30 дней" value={fmtN(k.done30)}
              sub={k.momPct !== null ? `${k.momPct > 0 ? '+' : ''}${k.momPct}% к прошлым 30 дням` : undefined}
              subCls={k.momPct !== null && k.momPct < 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'} />
            <Kpi icon={<Store size={12} />} label="активных брендов" value={fmtN(k.brands30)}
              sub={`${brandsDelta >= 0 ? '+' : ''}${brandsDelta} к прошлым 30 дням · новых ${k.newBrands30}`}
              subCls={brandsDelta < 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'} />
            <Kpi icon={<TrendingDown size={12} />} label="отмены" value={`${k.cancelPct}%`}
              sub="доля незавершённых за 30 дней" />
            {k.avgCheck !== null && (
              <Kpi icon={<Banknote size={12} />} label="средний чек" value={`${fmtN(k.avgCheck)} ${cur}`}
                sub={k.medCheck !== null ? `медиана ${fmtN(k.medCheck)} ${cur}` : undefined} />
            )}
            {k.medMin !== null && (
              <Kpi icon={<Clock3 size={12} />} label="доставка, медиана" value={`${k.medMin} мин`}
                sub={k.medDistKm !== null ? `плечо ${k.medDistKm} км (медиана)` : undefined} />
            )}
            {k.ontimePct !== null && (
              <Kpi icon={<CheckCheck size={12} />} label="доставлено вовремя" value={`${k.ontimePct}%`}
                sub="своя доставка, 30 дней" />
            )}
          </div>

          {market === 'ALL' && d.markets.length > 1 && (
            <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100">
                <h2 className="text-[13.5px] font-semibold text-gray-900">Рынки за 30 дней</h2>
              </header>
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[11px] text-gray-400">
                  <th className="px-4 py-1.5 font-medium">рынок</th>
                  <th className="py-1.5 font-medium text-right">заказов/30д</th>
                  <th className="py-1.5 font-medium text-right">динамика</th>
                  <th className="py-1.5 font-medium text-right">отмены</th>
                  <th className="py-1.5 font-medium text-right">брендов</th>
                  <th className="py-1.5 pr-4 font-medium text-right">средний чек</th>
                </tr></thead>
                <tbody>
                  {d.markets.map(m => (
                    <tr key={m.iso} onClick={() => setMarket(m.iso)}
                      className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer">
                      <td className="px-4 py-2 font-medium text-gray-900">{flag(m.iso)} {mName(m)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtN(m.done30)}</td>
                      <td className={`py-2 text-right tabular-nums font-semibold ${
                        (m.momPct ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {m.momPct !== null ? `${m.momPct > 0 ? '+' : ''}${m.momPct}%` : '—'}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${m.cancelPct > 30 ? 'text-red-600 font-semibold' : ''}`}>{m.cancelPct}%</td>
                      <td className="py-2 text-right tabular-nums">{fmtN(m.brands30)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{m.avgCheck !== null ? `${fmtN(m.avgCheck)} ${m.currency}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <Section title="Заказы по неделям" hint="только полные недели"
            right={
              <span className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                {(['half', 'year'] as const).map(v => (
                  <button key={v} onClick={() => setSpan(v)}
                    className={`text-[11.5px] px-2.5 py-1 ${span === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:text-gray-800'}`}>
                    {v === 'half' ? 'полгода' : 'год'}
                  </button>
                ))}
              </span>
            }>
            <AreaLine points={weekly.map(p => p.n)} labels={weekly.map(p => fmtWeek(p.w))} />
          </Section>

          <Section title="Каналы по месяцам" hint="как заказ доставляется · только полные месяцы">
            <StackedBars rows={s.channels} cats={CHANNEL_CATS} />
          </Section>

          <Section title="Источники по месяцам" hint="где заказ создан: агрегатор, бот, киоск, приложения…">
            <StackedBars rows={s.sources} cats={SOURCE_CATS} />
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Способы оплаты" hint="по месяцам">
              <StackedBars rows={s.payments} cats={PAYMENT_CATS} />
            </Section>
            <div className="space-y-4">
              <Section title="Скорость доставки" hint="медиана, минуты · своя доставка">
                <AreaLine points={s.quality.map(p => p.medMin)} labels={s.quality.map(p => fmtMonth(p.m))} color="#10b981" height={104} />
              </Section>
              <Section title="Доставлено вовремя" hint="% заказов своей доставки">
                <AreaLine points={s.quality.map(p => p.ontimePct)} labels={s.quality.map(p => fmtMonth(p.m))} color="#8b5cf6" height={104} suffix="%" />
              </Section>
            </div>
          </div>

          <Section title="Нагрузка по часам" hint="завершённые заказы за 30 дней, час создания (время платформы)">
            <HourBars rows={s.hours} />
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-600" />
                <h2 className="text-[13.5px] font-semibold text-gray-900">Растут быстрее всех</h2>
                <span className="text-[11px] text-gray-400">30 дней против прошлых 30, база от 100 заказов</span>
              </header>
              <MoversTable rows={s.growers} dir="up" />
            </section>
            <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
                <TrendingDown size={14} className="text-red-600" />
                <h2 className="text-[13.5px] font-semibold text-gray-900">Теряют быстрее всех</h2>
                <span className="text-[11px] text-gray-400">кандидаты в «Сигналы» и на звонок</span>
              </header>
              <MoversTable rows={s.fallers} dir="down" />
            </section>
          </div>
        </>
      )}
    </div>
  )
}
