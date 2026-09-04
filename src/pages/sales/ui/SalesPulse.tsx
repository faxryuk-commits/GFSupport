import { useEffect, useRef, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis, money } from './kit'

/**
 * Пульс продаж — главный экран отчётов, собранный по согласованному макету:
 * KPI периода, воронка с долями источников, потенциал по этапам, тренд
 * выигрышей, источники, причины потерь и портфель по сейлзам.
 *
 * Целостность: закрытия, воронка, источники и причины считаются по выбранному
 * диапазону дат; потенциал и портфель — состояние на сейчас. У каждой карточки
 * — чип с её периодом, чтобы цифры не выглядели противоречащими друг другу.
 */

interface Pulse {
  period: { from: string; to: string; days: number }
  kpi: {
    won: number; lost: number; won_amt: string; cycle_med: number
    open: number; withAmount: number; weighted: number
  }
  reach: Array<{ stage: string; src: string; n: number }>
  potential: Array<{ key: string; label: string; prob: number; cnt: number; amt: string; weighted: number }>
  monthly: Array<{ mon: string; n: number; amt: string }>
  sources: Array<{ src: string; leads: number; converted: number }>
  losses: Array<{ reason: string; n: number }>
  portfolio: Array<{ name: string; cnt: number; amt: string; no_step: number }>
}

/** Порядок этапов воронки достижения — как на доске. */
const STAGE_ORDER: Array<[string, string]> = [
  ['qualified', 'Квалифицирован'], ['meeting', 'Демо назначено'], ['demo', 'Демо проведено'],
  ['kp', 'КП отправлено'], ['contract', 'Договор'], ['won', 'Выиграно'],
]

/** Цвета источников: фиксированные слоты, «История Amo» и «прочее» — серые. */
const SRC_COLORS: Record<string, string> = {
  'Meta лид-форма': '#2a78d6',
  'Заведён вручную': '#eb6834',
  'Исходящий холодный': '#1baf7a',
  'Сайт delever.io': '#eda100',
  'Instagram Direct': '#e87ba4',
  'Импорт базы': '#8b7ae0',
}
const SRC_MUTED = '#e5e9f0'

const fmtMln = (v: any) => {
  const n = Number(v || 0)
  if (!n) return '—'
  return `${(n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function PeriodChip({ label }: { label: string }) {
  return (
    <span className="text-[10px] text-gray-400 border border-gray-200 rounded-md px-2 py-0.5 whitespace-nowrap">
      {label}
    </span>
  )
}

function HBar({ label, width, color, value }: {
  label: string; width: number; color: string; value: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-2.5 items-center py-1">
      <span className="text-[11.5px] text-gray-500 text-right truncate">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-[15px] rounded-r flex-none" style={{ width: `${Math.max(2, width)}%`, background: color, minWidth: 2 }} />
        <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap flex-none">{value}</span>
      </div>
    </div>
  )
}

export function SalesPulse({ from, to, region }: { from: string; to: string; region: string | null }) {
  const [d, setD] = useState<Pulse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const my = ++reqRef.current
    apiGet<Pulse>(`/sales/reports?action=pulse&from=${from}&to=${to}&region=${region || 'all'}`, false)
      .then(r => { if (my === reqRef.current) { setD(r); setError(null) } })
      .catch(e => setError(e?.message || 'Не удалось загрузить пульс'))
  }, [from, to, region])

  if (error) return <div className="text-[12.5px] text-red-600 py-3">{error}</div>
  if (!d) return <div className="text-[12.5px] text-gray-400 py-6 text-center">Считаю пульс продаж…</div>

  const k = d.kpi
  const closed = k.won + k.lost
  const winRate = closed ? Math.round((k.won / closed) * 100) : 0
  const periodLabel = `${d.period.from} — ${d.period.to}`

  // Воронка достижения: суммы по этапам + стек источников
  const byStage = new Map<string, Array<{ src: string; n: number }>>()
  for (const r of d.reach) {
    if (!byStage.has(r.stage)) byStage.set(r.stage, [])
    byStage.get(r.stage)!.push({ src: r.src, n: r.n })
  }
  const stages = STAGE_ORDER
    .map(([key, label]) => {
      const parts = (byStage.get(key) || []).sort((a, b) => b.n - a.n)
      return { key, label, total: parts.reduce((s, p) => s + p.n, 0), parts }
    })
    .filter(s => s.total > 0)
  const topReach = Math.max(1, ...stages.map(s => s.total))

  const maxPotAmt = Math.max(1, ...d.potential.map(p => Number(p.amt)))
  const maxMonthly = Math.max(1, ...d.monthly.map(m => m.n))
  const maxSrc = Math.max(1, ...d.sources.map(s => s.leads))
  const maxLoss = Math.max(1, ...d.losses.map(l => l.n))
  const maxPort = Math.max(1, ...d.portfolio.map(p => p.cnt))
  const amountBlind = k.open > 0 && k.withAmount / k.open < 0.5

  const srcColor = (name: string) => SRC_COLORS[name] || SRC_MUTED

  const legendSrcs = [...new Set(d.reach.map(r => r.src))]
    .filter(s2 => SRC_COLORS[s2])
    .slice(0, 6)

  return (
    <div className="space-y-4">
      <Kpis items={[
        ['Выиграно', String(k.won), `+${fmtMln(k.won_amt)} UZS подписки · ${periodLabel}`],
        ['Win rate', `${winRate}%`, `${k.won} из ${closed} закрытых за период`],
        ['Цикл сделки', k.cycle_med ? `${k.cycle_med} дн` : '—', 'медиана по выигрышам периода'],
        ['Открытый портфель', String(k.open), 'сделок в работе сейчас'],
        ['Взвешенный прогноз', `≈${fmtMln(k.weighted)}`, `UZS/мес · по ${k.withAmount} сделкам с суммой`],
      ]} />

      <div className="grid lg:grid-cols-[3fr_2fr] gap-4 items-start">
        <Card title="Воронка: где теряем"
          sub="сделки, достигшие этапа · цвет — источник лида"
          right={<PeriodChip label={periodLabel} />}>
          <div className="px-4 py-3">
            <div className="flex gap-3 flex-wrap mb-2.5 text-[10.5px] text-gray-500">
              {legendSrcs.map(s2 => (
                <span key={s2} className="inline-flex items-center gap-1.5">
                  <i className="w-2 h-2 rounded-sm inline-block" style={{ background: srcColor(s2) }} />
                  {s2}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-sm inline-block border border-gray-200" style={{ background: SRC_MUTED }} />
                прочее / история Amo
              </span>
            </div>
            {stages.length === 0 && <div className="text-[12.5px] text-gray-400 py-2">Движения за период нет</div>}
            {stages.map((s2, i) => {
              const prev = i > 0 ? stages[i - 1].total : s2.total
              const conv = prev ? Math.round((s2.total / prev) * 100) : 100
              return (
                <div key={s2.key} className="grid grid-cols-[118px_34px_1fr_52px] gap-2.5 items-center py-[5px]">
                  <span className="text-[12px] text-gray-500 text-right">{s2.label}</span>
                  <span className="text-[12.5px] font-bold text-right tabular-nums">{s2.total}</span>
                  <div className="h-[22px] flex items-stretch gap-[2px]"
                    style={{ width: `${Math.max(4, (s2.total / topReach) * 100)}%` }}>
                    {s2.parts.map((p, j) => (
                      <div key={p.src}
                        title={`${p.src}: ${p.n}`}
                        className={j === 0 ? 'rounded-l' : ''}
                        style={{
                          width: `${(p.n / s2.total) * 100}%`, minWidth: 3,
                          background: srcColor(p.src),
                          borderRadius: j === s2.parts.length - 1 ? '0 4px 4px 0' : undefined,
                        }} />
                    ))}
                  </div>
                  <span className="text-[11.5px] text-gray-500 tabular-nums">{i > 0 ? `${conv}%` : ''}</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Потенциал по этапам"
          sub="открытые сделки · тёмное — взвешенно на вероятность"
          right={<PeriodChip label="сейчас" />}>
          <div className="px-4 py-3">
            {d.potential.map(p => (
              <div key={p.key} className="grid grid-cols-[118px_1fr_120px] gap-2.5 items-center py-1.5">
                <span className="text-[12px] text-gray-500 text-right">{p.label}</span>
                <div className="h-[16px] bg-gray-100 rounded relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-blue-400 rounded-l"
                    style={{ width: `${(Number(p.amt) / maxPotAmt) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-blue-700 rounded-l"
                    style={{ width: `${(p.weighted / maxPotAmt) * 100}%` }} />
                </div>
                <span className="text-[11.5px] text-gray-500 text-right tabular-nums">
                  {p.cnt} сд · {fmtMln(p.amt)}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-baseline mt-2.5 pt-2.5 border-t border-gray-100">
              <span className="text-[11px] text-gray-400">Взвешенный прогноз подписки</span>
              <b className="text-[16px] tabular-nums">≈{fmtMln(k.weighted)} UZS/мес</b>
            </div>
          </div>
        </Card>
      </div>

      {amountBlind && (
        <div className="flex gap-2.5 items-start bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <span className="flex-none w-5 h-5 rounded-full bg-amber-500 text-white text-[12px] font-bold flex items-center justify-center">!</span>
          <div className="text-[12.5px] text-gray-700">
            <b>Сумма указана только у {k.withAmount} из {k.open} открытых сделок</b> — взвешенный
            прогноз построен по этой части портфеля. Заполняйте «Подписку в месяц» после демо.
          </div>
        </div>
      )}

      <Card title="Выигрыши по месяцам" sub="количество и новая подписка UZS"
        right={<PeriodChip label="12 месяцев" />}>
        <div className="px-4 pt-4 pb-3 flex items-end gap-3 h-[150px]">
          {d.monthly.map(m => {
            const mi = Number(m.mon.slice(5)) - 1
            return (
              <div key={m.mon} className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0">
                <span className="text-[10.5px] text-gray-600 tabular-nums whitespace-nowrap">
                  <b>{m.n}</b>{Number(m.amt) > 0 ? ` · ${fmtMln(m.amt)}` : ''}
                </span>
                <div className="w-[70%] rounded-t bg-blue-500"
                  style={{ height: m.n ? `${Math.max(6, (m.n / maxMonthly) * 100)}%` : 2, opacity: m.n ? 1 : 0.2 }} />
                <span className="text-[10.5px] text-gray-400">{MONTHS[mi] || m.mon}</span>
              </div>
            )
          })}
          {!d.monthly.length && <div className="text-[12.5px] text-gray-400 m-auto">Выигрышей за год нет</div>}
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Card title="Источники: доли и отдача" sub="лиды → конверсия в сделку"
          right={<PeriodChip label={periodLabel} />}>
          <div className="px-4 py-3">
            {d.sources.map(s2 => {
              const conv = s2.leads ? Math.round((s2.converted / s2.leads) * 100) : 0
              return (
                <HBar key={s2.src} label={s2.src} width={(s2.leads / maxSrc) * 55}
                  color={srcColor(s2.src) === SRC_MUTED ? '#94a3b8' : srcColor(s2.src)}
                  value={<><b className="text-gray-900">{s2.leads}</b>
                    <span className={conv >= 25 ? 'text-emerald-600 font-semibold' : conv < 10 ? 'text-amber-600 font-semibold' : 'text-gray-400'}> → {conv}%</span></>} />
              )
            })}
          </div>
        </Card>

        <Card title="Почему проигрываем" sub="причины отказов"
          right={<PeriodChip label={periodLabel} />}>
          <div className="px-4 py-3">
            {d.losses.map(l => {
              const vague = /друго|без причины/i.test(l.reason)
              return (
                <HBar key={l.reason} label={l.reason} width={(l.n / maxLoss) * 55}
                  color={vague ? '#eda100' : '#3f83d4'}
                  value={<b className="text-gray-900">{l.n}</b>} />
              )
            })}
            {!d.losses.length && <div className="text-[12.5px] text-gray-400 py-2">Потерь за период нет</div>}
          </div>
        </Card>

        <Card title="Портфель по сейлзам" sub="открытые сделки · у кого что висит"
          right={<PeriodChip label="сейчас" />}>
          <div className="px-4 py-3">
            {d.portfolio.map(p => (
              <HBar key={p.name} label={p.name} width={(p.cnt / maxPort) * 55} color="#3f83d4"
                value={<>
                  <b className="text-gray-900">{p.cnt}</b>
                  {Number(p.amt) > 0 && <span className="text-gray-400"> · {fmtMln(p.amt)}</span>}
                  {p.no_step > 0 && <span className="text-amber-600"> · {p.no_step} без шага</span>}
                </>} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
