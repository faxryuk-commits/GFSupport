import { useEffect, useRef, useState, type ReactNode } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis } from './kit'

/**
 * Пульс продаж: итоги периода и деньги.
 *
 * Когда-то здесь жили ещё воронка, источники, причины потерь и портфель
 * по сейлзам — потом появился «Поток» и ответил на те же вопросы точнее,
 * а страница отвечала на каждый по два-три раза разными цифрами. Теперь у
 * каждого вопроса одно место: итоги и деньги — здесь, путь от канала до
 * выигрыша — в потоке (он вставляется между ними через children), команда —
 * одной таблицей внизу страницы.
 *
 * Два разных «выиграно» на странице — обе правда, но по разным правилам:
 * здесь — сделки, закрытые в периоде, откуда бы ни пришли; в потоке —
 * обращения, созданные в периоде, и что с ними стало. Подписи это говорят.
 */

interface Pulse {
  period: { from: string; to: string; days: number }
  kpi: {
    won: number; lost: number; won_amt: string; cycle_med: number
    open: number; withAmount: number; weighted: number
    cash_n: number; cash_amt: string
    cash_n_new?: number; cash_amt_new?: string
  }
  potential: Array<{ key: string; label: string; prob: number; cnt: number; amt: string; weighted: number }>
  monthly: Array<{ mon: string; n: number; amt: string }>
  cashMonthly: Array<{ mon: string; n: number; amt: string; amt_new?: string }>
}

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

export function SalesPulse({ from, to, region, children }: {
  from: string; to: string; region: string | null
  /** Блок между итогами и деньгами — поток. */
  children?: ReactNode
}) {
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

  const maxPotAmt = Math.max(1, ...(d.potential || []).map(p => Number(p.amt)))
  const amountBlind = k.open > 0 && k.withAmount / k.open < 0.5

  // Деньги по месяцам: кеш — что реально пришло, MRR — что обещано подпиской
  // выигранных. Разрыв между ними — главное, ради чего они рядом
  const monthly = d.monthly || [], cashMonthly = d.cashMonthly || []
  const months = [...new Set([...monthly.map(m => m.mon), ...cashMonthly.map(m => m.mon)])].sort().slice(-12)
  const mrrBy = new Map(monthly.map(m => [m.mon, m]))
  const cashBy = new Map(cashMonthly.map(m => [m.mon, m]))
  const maxMoney = Math.max(1, ...months.map(m => Math.max(Number(mrrBy.get(m)?.amt || 0), Number(cashBy.get(m)?.amt || 0))))

  return (
    <div className="space-y-4">
      <Kpis items={[
        ['Выиграно', String(k.won), `закрыто в периоде · win rate ${winRate}% из ${closed}`],
        ['Получено денег', fmtMln(k.cash_amt_new ?? k.cash_amt),
          k.cash_amt_new !== undefined
            ? `${k.cash_n_new} оплат по сделкам периода · ещё ${fmtMln(Number(k.cash_amt) - Number(k.cash_amt_new))} по сделкам прошлых периодов`
            : `${k.cash_n} оплат за период · UZS`],
        ['Новый MRR', fmtMln(k.won_amt), 'подписка выигранных · UZS/мес'],
        ['Цикл сделки', k.cycle_med ? `${k.cycle_med} дн` : '—', 'медиана по выигрышам периода'],
        ['Открытый портфель', String(k.open), `сделок в работе · прогноз ≈${fmtMln(k.weighted)}/мес`],
      ]} />

      {children}

      <div className="grid lg:grid-cols-[3fr_2fr] gap-4 items-start">
        <Card title="Деньги по месяцам" sub="получено — оплаты, привязанные к сделкам: выигранным в этом месяце и раньше; подписки без сделки — в ПланФакте; новый MRR — подписка выигранных за месяц"
          right={<PeriodChip label="12 месяцев" />}>
          <div className="px-4 pt-3 pb-2">
            {months.length === 0 && <div className="text-[12.5px] text-gray-400 py-2">Выигрышей и оплат за год нет</div>}
            <div className="flex items-end gap-3 h-40">
              {months.map(m => {
                const cash = Number(cashBy.get(m)?.amt || 0), mrr = Number(mrrBy.get(m)?.amt || 0)
                const cashNew = cashBy.get(m)?.amt_new !== undefined ? Number(cashBy.get(m)?.amt_new) : cash
                const [y, mo] = m.split('-')
                return (
                  <div key={m} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                    title={`${MONTHS[Number(mo) - 1]} ${y}: получено ${fmtMln(cash)} (${cashBy.get(m)?.n || 0} оплат), из них по сделкам месяца ${fmtMln(cashNew)} · новый MRR ${fmtMln(mrr)} (${mrrBy.get(m)?.n || 0} выигр.)`}>
                    <div className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                      {cash ? fmtMln(cash).replace(' млн', '') : ''}{cash && mrr ? ' / ' : ''}{mrr ? fmtMln(mrr).replace(' млн', '') : ''}
                    </div>
                    <div className="w-full flex items-end justify-center gap-1 h-28">
                      <div className="w-[38%] flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${(cash / maxMoney) * 100}%` }}>
                        <div className="w-full bg-blue-200" style={{ height: `${cash ? ((cash - cashNew) / cash) * 100 : 0}%` }} />
                        <div className="w-full bg-blue-500 flex-1" />
                      </div>
                      <div className="w-[38%] bg-emerald-300 rounded-t" style={{ height: `${(mrr / maxMoney) * 100}%` }} />
                    </div>
                    <div className="text-[10.5px] text-gray-400">{MONTHS[Number(mo) - 1]}</div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-2 text-[11px] text-gray-500">
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 mr-1.5" />по сделкам месяца</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 mr-1.5" />по сделкам прошлых месяцев, млн UZS</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-300 mr-1.5" />новый MRR, млн UZS</span>
            </div>
          </div>
        </Card>

        <Card title="Потенциал по этапам"
          sub="открытые сделки · тёмное — взвешенно на вероятность"
          right={<PeriodChip label="сейчас" />}>
          <div className="px-4 py-3">
            {(d.potential || []).map(p => (
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
          <div className="text-[12.5px] text-amber-900">
            <b>Сумма указана только у {k.withAmount} из {k.open} открытых сделок</b> — взвешенный прогноз
            построен по этой части портфеля. Заполняйте «Подписку в месяц» после демо.
          </div>
        </div>
      )}
    </div>
  )
}
