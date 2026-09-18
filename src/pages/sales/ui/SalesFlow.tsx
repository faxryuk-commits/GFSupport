import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis, Seg, Skeleton, moneyList } from './kit'

/**
 * Поток: от канала до выигрыша.
 *
 * Река по когорте обращений периода: слева каналы, дальше ступени сделки.
 * Ширина ленты — число обращений, цвет — канал и тянется до конца, так что
 * видно, какой канал доходит до денег. Потеря на ступени — часть столбика,
 * от которой не идёт лента дальше: штрих — проиграно здесь, бледное — стоит
 * на ступени сейчас. Классический Sankey с лентами «в проигрыш» тут не
 * годится: на первом шаге теряется половина, и серые ленты перечеркнули бы
 * всю картинку.
 *
 * Считается на сервере (reports?action=flow, _lib/sales-flow.ts). Фильтры
 * потока живут в адресе страницы (flow_*), как в воронке.
 */

const STAGES = ['Обращения', 'Квалифицирован', 'Демо', 'КП отправлено', 'Договор', 'Выиграно']
/** Та же палитра, что у блока источников в отчётах: один канал — один цвет. */
const SRC_COLORS: Record<string, string> = {
  meta_leadform: '#2a78d6', manual: '#eb6834', outbound: '#1baf7a',
  site: '#eda100', instagram_direct: '#e87ba4', import: '#8b7ae0',
}
const OTHER = '#94a3b8'
const colorOf = (key: string) => SRC_COLORS[key] || OTHER

interface Channel {
  key: string; id: string | null; label: string; junk: number; wait: number; won: number
  lost: number[]; open: number[]; wonAmounts: Record<string, number>; wonMedianDays: number | null
}
interface FlowData {
  channels: Channel[]
  reasons: Array<{ stage: number; reason: string; n: number }>
  reps: Array<{ name: string; agentId: string | null; deals: number; won: number }>
}
interface Stage { total: number; fwd: number; open: number; lost: number }
interface Row { key: string; label: string; color: string; st: Stage[]; leads: number; deals: number; won: number; ch: Channel }

const fmt = (n: number) => n.toLocaleString('ru-RU')
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—')

function prepare(channels: Channel[]): Row[] {
  return channels.map(c => {
    const reach = [0, 0, 0, 0, 0, c.won]
    for (let k = 4; k >= 1; k--) reach[k] = reach[k + 1] + c.lost[k] + c.open[k]
    const deals = reach[1]
    const leads = deals + c.junk + c.wait
    const st: Stage[] = [{ total: leads, fwd: deals, open: c.wait, lost: c.junk }]
    for (let k = 1; k <= 4; k++) st.push({ total: reach[k], fwd: reach[k + 1], open: c.open[k], lost: c.lost[k] })
    st.push({ total: c.won, fwd: 0, open: 0, lost: 0 })
    return { key: c.key, label: c.label, color: colorOf(c.key), st, leads, deals, won: c.won, ch: c }
  }).filter(r => r.leads > 0).sort((a, b) => b.leads - a.leads)
}

function readUrl(): { start: 'leads' | 'deals'; exclude: string[]; owner: string } {
  const p = new URLSearchParams(window.location.search)
  const ex = p.get('flow_exclude')
  return {
    start: p.get('flow_start') === 'deals' ? 'deals' : 'leads',
    // По умолчанию без импорта базы: 479 холодных строк давят всё остальное
    exclude: ex == null ? ['import'] : ex.split(',').filter(Boolean),
    owner: p.get('flow_owner') || '',
  }
}
function writeUrl(v: { start: string; exclude: string[]; owner: string }) {
  const p = new URLSearchParams(window.location.search)
  v.start === 'deals' ? p.set('flow_start', 'deals') : p.delete('flow_start')
  p.set('flow_exclude', v.exclude.join(','))
  v.owner ? p.set('flow_owner', v.owner) : p.delete('flow_owner')
  window.history.replaceState(null, '', `${window.location.pathname}?${p}`)
}

export function SalesFlow({ from, to, region }: { from: string; to: string; region: string }) {
  const navigate = useNavigate()
  const init = useMemo(readUrl, [])
  const [start, setStart] = useState<'leads' | 'deals'>(init.start)
  const [exclude, setExclude] = useState<string[]>(init.exclude)
  const [owner, setOwner] = useState(init.owner)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [data, setData] = useState<FlowData | null>(null)
  const [allChannels, setAllChannels] = useState<Array<{ key: string; label: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null)

  useEffect(() => { writeUrl({ start, exclude, owner }) }, [start, exclude, owner])

  useEffect(() => {
    const q = `from=${from}&to=${to}&region=${region || 'all'}&exclude=${encodeURIComponent(exclude.join(','))}&owner=${owner}`
    apiGet<FlowData>(`/sales/reports?action=flow&${q}`, false)
      .then(d => {
        setData(d); setError(null)
        // Список каналов для фишек — из полного набора, чтобы выключенный
        // канал не пропадал из панели вместе с данными
        setAllChannels(prev => {
          const known = new Map(prev.map(c => [c.key, c]))
          for (const c of d.channels) known.set(c.key, { key: c.key, label: c.label })
          return [...known.values()]
        })
      })
      .catch(e => setError(e?.message || 'Не удалось загрузить поток'))
  }, [from, to, region, exclude, owner])

  // Полный список каналов один раз — без исключений, чтобы фишки были все
  useEffect(() => {
    apiGet<FlowData>(`/sales/reports?action=flow&from=${from}&to=${to}&region=${region || 'all'}&exclude=`, false)
      .then(d => setAllChannels(d.channels.map(c => ({ key: c.key, label: c.label }))))
      .catch(() => {})
  }, [from, to, region])

  const rows = useMemo(() => (data ? prepare(data.channels) : []), [data])
  const first = start === 'deals' ? 1 : 0

  const layout = useMemo(() => {
    const W = 1160, H = 480, top = 46, bot = 28, colW = 28, gap = 3, chGap = 6
    const cols = STAGES.length - first
    const x = (i: number) => 200 + i * ((W - 200 - 70) / (cols - 1))
    const maxTot = rows.reduce((s, r) => s + r.st[first].total, 0) || 1
    const usable = H - top - bot - (rows.length - 1) * chGap
    const k = usable / maxTot
    const pos: Array<Record<string, { y0: number; y1: number; fy1: number }>> = []
    const columns: Array<{ s: number; x: number; tot: number; lost: number; open: number; next: number }> = []
    for (let s = first; s < STAGES.length; s++) {
      const tot = rows.reduce((a, r) => a + r.st[s].total, 0)
      const hgt = tot * k + (rows.length - 1) * gap
      let y = top + (H - top - bot - hgt) / 2
      pos[s] = {}
      for (const r of rows) {
        const h = r.st[s].total * k
        pos[s][r.key] = { y0: y, y1: y + h, fy1: y + r.st[s].fwd * k }
        y += h + (h > 0 ? gap : 0)
      }
      columns.push({
        s, x: x(s - first), tot,
        lost: rows.reduce((a, r) => a + r.st[s].lost, 0),
        open: rows.reduce((a, r) => a + r.st[s].open, 0),
        next: s < 5 ? rows.reduce((a, r) => a + r.st[s + 1].total, 0) : 0,
      })
    }
    return { W, H, top, colW, k, pos, columns, x, maxTot }
  }, [rows, first])

  const T = useMemo(() => rows.reduce((a, r) => {
    a.l += r.leads; a.d += r.deals; a.w += r.won
    a.s2 += r.st[2].total; a.s3 += r.st[3].total; a.s4 += r.st[4].total; a.junk += r.st[0].lost
    return a
  }, { l: 0, d: 0, w: 0, s2: 0, s3: 0, s4: 0, junk: 0 }), [rows])

  const toggleSel = (key: string) => setSel(s => (s === key ? null : key))
  const dimOf = (key: string, base: number) => (sel && sel !== key ? base * 0.15 : base)

  const activeChips = [
    start === 'deals' ? 'старт: только сделки' : null,
    exclude.length ? `без: ${exclude.map(k => allChannels.find(c => c.key === k)?.label || k).join(', ')}` : null,
    owner ? `сейлз: ${owner === 'none' ? 'ничьи' : (data?.reps.find(r => r.agentId === owner)?.name || '…')}` : null,
  ].filter(Boolean) as string[]

  if (error && !data) return <div className="text-[12.5px] text-red-600">{error}</div>
  if (!data) return <Skeleton rows={4} />

  const reasonsByStage = [1, 2, 3, 4].map(k => ({ k, rs: data.reasons.filter(r => r.stage === k) }))
    .filter(x => x.rs.length)
  const otherShare = (() => {
    const all = data.reasons.reduce((a, r) => a + r.n, 0)
    const other = data.reasons.filter(r => r.reason === 'Другое' || r.reason === '(без причины)').reduce((a, r) => a + r.n, 0)
    return { all, other }
  })()

  return (
    <div className="space-y-4">
      {/* Фильтры потока: как в воронке — кнопка, фишки активных, счётчики */}
      <div className="px-1 py-0.5 flex items-center gap-2 flex-wrap relative">
        <button onClick={() => setOpen(o => !o)}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border ${
            activeChips.length ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-600'}`}>
          Фильтры потока{activeChips.length ? ` · ${activeChips.length}` : ''} {open ? '▴' : '▾'}
        </button>
        {activeChips.map(a => (
          <span key={a} className="text-[11.5px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">{a}</span>
        ))}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums">обращений <b className="text-gray-900 font-semibold">{fmt(T.l)}</b></span>
          <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums">сделок <b className="text-gray-900 font-semibold">{fmt(T.d)}</b></span>
          <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 tabular-nums">выиграно <b className="font-semibold">{fmt(T.w)}</b></span>
        </div>
        {open && (
          <div className="absolute left-0 top-full mt-1.5 z-30 w-[min(760px,calc(100vw-3rem))] bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[11px] text-gray-400 w-16 flex-none">Старт</span>
              <Seg value={start} onChange={v => setStart(v)}
                items={[{ key: 'leads', label: 'От обращений' }, { key: 'deals', label: 'Только сделки' }]} />
              <span className="text-[11px] text-gray-400 ml-2">с первого обращения или с момента, когда оно стало сделкой</span>
            </div>
            <div className="flex gap-2 flex-wrap items-start">
              <span className="text-[11px] text-gray-400 w-16 flex-none pt-1">Каналы</span>
              <div className="flex gap-1.5 flex-wrap">
                {allChannels.map(c => {
                  const off = exclude.includes(c.key)
                  return (
                    <button key={c.key}
                      onClick={() => setExclude(ex => off ? ex.filter(k => k !== c.key) : [...ex, c.key])}
                      className={`text-[11.5px] px-2 py-0.5 rounded-lg border inline-flex items-center gap-1.5 ${
                        off ? 'border-gray-200 bg-gray-50 text-gray-400 line-through' : 'border-gray-200 bg-white text-gray-700'}`}>
                      <i className="w-2 h-2 rounded-sm inline-block" style={{ background: colorOf(c.key) }} />
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[11px] text-gray-400 w-16 flex-none">Сейлз</span>
              <select value={owner} onChange={e => setOwner(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
                <option value="">Все сейлзы</option>
                <option value="none">Ничей — без владельца</option>
                {data.reps.filter(r => r.agentId).map(r => <option key={r.agentId!} value={r.agentId!}>{r.name}</option>)}
              </select>
            </div>
            <div className="pt-2.5 border-t border-gray-100 flex items-center gap-2">
              <span className="text-[11.5px] text-gray-400 flex-1">Фильтры живут в адресе страницы — ссылку можно отправить коллеге</span>
              <button onClick={() => { setStart('leads'); setExclude([]); setOwner(''); setSel(null) }}
                className="text-[12px] text-gray-500 hover:text-gray-800">Сбросить</button>
              <button onClick={() => setOpen(false)}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-gray-900 text-white font-semibold">Готово</button>
            </div>
          </div>
        )}
      </div>

      <Kpis items={[
        ['Обращений', fmt(T.l), `${fmt(T.junk)} в отказ до сделки · ${pct(T.junk, T.l)}`],
        ['В работу', fmt(T.d), `${pct(T.d, T.l)} обращений стали сделкой`],
        ['Демо', fmt(T.s2), `${pct(T.s2, T.d)} сделок дошли до демо`],
        ['Договор', fmt(T.s4), `${pct(T.s4, T.d)} сделок`],
        ['Выиграно', fmt(T.w), `${pct(T.w, T.l)} обращений · ${pct(T.w, T.d)} сделок`],
      ]} />

      <Card title="Поток: от канала до выигрыша"
        sub="ширина — обращения, цвет — канал · клик по ленте или строке подсвечивает путь канала"
        right={
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-2.5 rounded-sm bg-blue-500" />прошли дальше</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-2.5 rounded-sm bg-blue-500 opacity-35" />стоят на этапе</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-2.5 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg,#3b82f6 0 2px,#fff 2px 4px)' }} />проиграно / отказ здесь</span>
          </div>
        }>
        <div className="px-4 pt-2 pb-1 relative" onMouseLeave={() => setTip(null)}>
          {rows.length === 0 ? (
            <div className="text-[12.5px] text-gray-400 py-6">За период обращений не было</div>
          ) : (
            <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="w-full h-auto block">
              <defs>
                <pattern id="flow-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2.2" height="5" fill="white" opacity=".85" />
                </pattern>
              </defs>
              {/* ленты */}
              {layout.columns.slice(0, -1).map(col => rows.map(r => {
                const a = layout.pos[col.s][r.key], b = layout.pos[col.s + 1][r.key]
                if (!a || !b || a.fy1 - a.y0 <= 0) return null
                const x0 = col.x + layout.colW, x1 = layout.x(col.s + 1 - first), cx = (x0 + x1) / 2
                const st = r.st[col.s]
                return (
                  <path key={`${col.s}-${r.key}`} className="cursor-pointer"
                    d={`M${x0},${a.y0} C${cx},${a.y0} ${cx},${b.y0} ${x1},${b.y0} L${x1},${b.y1} C${cx},${b.y1} ${cx},${a.fy1} ${x0},${a.fy1} Z`}
                    fill={r.color} opacity={dimOf(r.key, 0.5)}
                    onClick={() => toggleSel(r.key)}
                    onMouseMove={e => setTip({ x: e.clientX, y: e.clientY,
                      html: `<b>${r.label}</b>: ${STAGES[col.s]} → ${STAGES[col.s + 1]}<br>${fmt(st.fwd)} из ${fmt(st.total)} (${pct(st.fwd, st.total)})` })} />
                )
              }))}
              {/* столбики */}
              {layout.columns.map(col => rows.map(r => {
                const p = layout.pos[col.s][r.key]; const t = r.st[col.s]
                if (!p || p.y1 - p.y0 <= 0) return null
                const fwd = t.fwd * layout.k, op = t.open * layout.k, lo = t.lost * layout.k
                return (
                  <g key={`${col.s}-${r.key}`} className="cursor-pointer" opacity={dimOf(r.key, 1)}
                    onClick={() => toggleSel(r.key)}
                    onMouseMove={e => setTip({ x: e.clientX, y: e.clientY,
                      html: `<b>${r.label}</b> · ${STAGES[col.s]}: ${fmt(t.total)}${col.s < 5
                        ? `<br>дальше ${fmt(t.fwd)} (${pct(t.fwd, t.total)}) · стоят ${fmt(t.open)} · ${col.s ? 'проиграно' : 'отказ'} ${fmt(t.lost)}` : ''}` })}>
                    <rect x={col.x} y={p.y0} width={layout.colW} height={Math.max(fwd, 0.5)} fill={r.color} />
                    {op > 0 && <rect x={col.x} y={p.y0 + fwd} width={layout.colW} height={op} fill={r.color} opacity=".35" />}
                    {lo > 0 && <>
                      <rect x={col.x} y={p.y0 + fwd + op} width={layout.colW} height={lo} fill={r.color} opacity=".75" />
                      <rect x={col.x} y={p.y0 + fwd + op} width={layout.colW} height={lo} fill="url(#flow-hatch)" />
                    </>}
                  </g>
                )
              }))}
              {/* подписи колонок */}
              {layout.columns.map((col, i) => {
                const cx = col.x + layout.colW / 2
                return (
                  <g key={col.s}>
                    <text x={cx} y={16} textAnchor="middle" fontSize="12" fontWeight="600" fill="#111827">{STAGES[col.s]}</text>
                    <text x={cx} y={32} textAnchor="middle" fontSize="11.5" fill="#6b7280">
                      {fmt(col.tot)}{i > 0 ? ` · ${pct(col.tot, layout.maxTot)}` : ''}
                    </text>
                    {col.s < 5 && (
                      <text x={(col.x + layout.colW + layout.x(col.s + 1 - first)) / 2} y={layout.top - 6}
                        textAnchor="middle" fontSize="10.5" fill="#9ca3af">→ {pct(col.next, col.tot)}</text>
                    )}
                    {col.s < 5 && (col.lost || col.open) ? (
                      <text x={cx} y={layout.H - 8} textAnchor="middle" fontSize="10.5" fill="#6b7280">
                        {col.lost ? <tspan fill="#b91c1c">−{fmt(col.lost)} {col.s === 0 ? 'отказ' : 'проиграно'}</tspan> : null}
                        {col.lost && col.open ? ' · ' : ''}
                        {col.open ? `${fmt(col.open)} стоят` : ''}
                      </text>
                    ) : null}
                  </g>
                )
              })}
              {/* подписи каналов слева */}
              {rows.map(r => {
                const p = layout.pos[first][r.key]
                if (!p || p.y1 - p.y0 < 9) return null
                return (
                  <text key={r.key} x={layout.x(0) - 8} y={(p.y0 + p.y1) / 2 + 4} textAnchor="end" fontSize="11"
                    fill="#374151" opacity={sel && sel !== r.key ? 0.3 : 1} className="cursor-pointer"
                    onClick={() => toggleSel(r.key)}>
                    {r.label} <tspan fill="#9ca3af">{fmt(r.st[first].total)}</tspan>
                  </text>
                )
              })}
            </svg>
          )}
          {tip && (
            <div className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[11.5px] px-2.5 py-1.5 rounded-lg whitespace-nowrap"
              style={{ left: tip.x + 12, top: tip.y + 12 }} dangerouslySetInnerHTML={{ __html: tip.html }} />
          )}
        </div>
        {sel && (
          <div className="px-4 py-2 border-t border-gray-100 text-[12px] text-gray-500 flex items-center gap-3">
            <span>Подсвечен <b className="text-gray-800">{rows.find(r => r.key === sel)?.label}</b></span>
            {rows.find(r => r.key === sel)?.ch.id && (
              <button onClick={() => navigate(`/sales/funnel?src=${encodeURIComponent(rows.find(r => r.key === sel)!.ch.id!)}`)}
                className="text-blue-600 hover:underline">открыть в воронке →</button>
            )}
            <button onClick={() => setSel(null)} className="ml-auto hover:text-gray-800">снять подсветку</button>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        <div className="xl:col-span-3">
          <Card title="Конверсия по каналам" sub="доля от обращений канала · подписка выигранных · медиана дней до выигрыша">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-gray-500 bg-gray-50/80">
                    <th className="text-left font-semibold px-4 py-2">Канал</th>
                    <th className="text-right font-semibold px-4 py-2">Обращ.</th>
                    <th className="text-right font-semibold px-4 py-2">В работу</th>
                    <th className="text-right font-semibold px-4 py-2">Демо</th>
                    <th className="text-right font-semibold px-4 py-2">КП</th>
                    <th className="text-right font-semibold px-4 py-2">Договор</th>
                    <th className="text-right font-semibold px-4 py-2">Выиграно</th>
                    <th className="text-right font-semibold px-4 py-2">Подписка</th>
                    <th className="text-right font-semibold px-4 py-2">До выигрыша</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const cell = (n: number) => (
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(n)}<span className="block text-[11px] text-gray-400">{pct(n, r.leads)}</span></td>
                    )
                    const amounts = Object.keys(r.ch.wonAmounts).length ? moneyList(r.ch.wonAmounts, '—') : '—'
                    return (
                      <tr key={r.key} onClick={() => toggleSel(r.key)}
                        className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${sel === r.key ? 'bg-gray-50' : ''}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-[-1px]" style={{ background: r.color }} />
                          <span className="font-semibold text-gray-900">{r.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.leads)}</td>
                        {cell(r.st[1].total)}{cell(r.st[2].total)}{cell(r.st[3].total)}{cell(r.st[4].total)}
                        <td className="px-4 py-2.5 text-right tabular-nums"><b>{r.won}</b><span className="block text-[11px] text-gray-400">{pct(r.won, r.leads)}</span></td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{amounts}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.ch.wonMedianDays != null ? `${Math.max(0, r.ch.wonMedianDays)} дн` : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-t border-gray-200 bg-gray-50/60 font-semibold">
                    <td className="px-4 py-2.5">Итого</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(T.l)}</td>
                    {[T.d, T.s2, T.s3, T.s4].map((n, i) => (
                      <td key={i} className="px-4 py-2.5 text-right tabular-nums">{fmt(n)}<span className="block text-[11px] text-gray-400 font-normal">{pct(n, T.l)}</span></td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums">{T.w}<span className="block text-[11px] text-gray-400 font-normal">{pct(T.w, T.l)}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {moneyList(rows.reduce((acc, r) => { for (const [c, v] of Object.entries(r.ch.wonAmounts)) acc[c] = (acc[c] || 0) + v; return acc }, {} as Record<string, number>), '—')}
                    </td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">
              Выигранная сделка считается прошедшей все ступени. Повторное обращение клиента к его сделке считается по судьбе этой сделки, новой карточки у него нет.
            </div>
          </Card>
        </div>
        <div className="xl:col-span-2">
          <Card title="Почему теряем на каждой ступени" sub="причины проигрыша сделок когорты">
            <div className="px-4 py-3 space-y-3 text-[12.5px]">
              {reasonsByStage.length === 0 && <div className="text-gray-400">Проигрышей за период нет</div>}
              {reasonsByStage.map(({ k, rs }) => {
                const tot = rs.reduce((a, x) => a + x.n, 0), max = Math.max(...rs.map(x => x.n))
                return (
                  <div key={k}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-semibold text-gray-900">На «{STAGES[k]}»</span>
                      <span className="text-[11px] text-red-700 tabular-nums">−{tot}</span>
                    </div>
                    {rs.slice(0, 4).map(x => (
                      <div key={x.reason} className="flex items-center gap-2 text-[12px]">
                        <span className={`w-44 truncate text-gray-600 ${x.reason === 'Другое' || x.reason === '(без причины)' ? 'italic' : ''}`}>{x.reason}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-red-400" style={{ width: `${(100 * x.n) / max}%` }} /></div>
                        <span className="w-6 text-right tabular-nums text-gray-500">{x.n}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
              {otherShare.all > 0 && otherShare.other / otherShare.all >= 0.4 && (
                <p className="text-[11px] text-gray-400 pt-1">
                  «Другое» и без причины — {otherShare.other} из {otherShare.all}: почти половина потерь без внятной причины. Стоит сузить список причин под ступень.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Кто ведёт поток" sub="сделки из обращений периода по владельцам">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-gray-500 bg-gray-50/80">
                <th className="text-left font-semibold px-4 py-2">Сейлз</th>
                <th className="text-right font-semibold px-4 py-2">Сделок</th>
                <th className="text-right font-semibold px-4 py-2">Выиграно</th>
                <th className="text-left font-semibold px-4 py-2 w-[40%]">Доля побед</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.map(r => (
                <tr key={r.agentId || 'none'} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-semibold text-gray-900">{r.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.deals}</td>
                  <td className="px-4 py-2 text-right tabular-nums"><b>{r.won}</b></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${r.deals ? Math.round((100 * r.won) / r.deals) : 0}%` }} /></div>
                      <span className="text-[11px] text-gray-500 tabular-nums w-8">{pct(r.won, r.deals)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
