import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Chip, PageShell, Skeleton } from './kit'

/**
 * KPI-мотивация продаж по согласованному макету: «Мой KPI» для менеджера,
 * свод и настройки для РОПа, история закрытых месяцев.
 *
 * Формула: зарплата = фикс + бюджет × % дисциплины
 *   + 10% поступлений до личного плана + 15% превышения − корректировки.
 * Поступления — только отмеченные оплаты (вручную или из ПланФакта).
 */

const fmt = (n: any) => (Number(n) || 0).toLocaleString('ru-RU')

function monthNow(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}
function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number)
  const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  return `${names[mm - 1]} ${y}`
}
function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

const Bar = ({ pct, tone = 'blue', mark80 }: { pct: number; tone?: string; mark80?: boolean }) => (
  <div className="relative flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden min-w-[60px]">
    <div
      className={`absolute inset-y-0 left-0 rounded-full ${
        tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'green' ? 'bg-emerald-500' : 'bg-blue-500'
      }`}
      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
    />
    {mark80 && <div className="absolute -top-0.5 -bottom-0.5 w-px bg-gray-500" style={{ left: '80%' }} />}
  </div>
)

const toneOf = (pct: number) => (pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red')

/* ─────────────────────────── Мой KPI ─────────────────────────── */

function MyKpi({ month }: { month: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    apiGet<any>(`/sales/kpi?action=my&month=${month}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }, [month])

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>
  if (!data) return <Skeleton rows={4} />
  const me = data.me
  if (!me) {
    return (
      <Card title="Мой KPI" sub="персональный расчёт">
        <div className="p-6 text-sm text-gray-500">
          На {monthLabel(month)} вам не задан план — попросите руководителя добавить вас
          в шаблон месяца (вкладка «Настройки»).
        </div>
      </Card>
    )
  }

  if (me.isRop) {
    return (
      <Card title={`${me.name} · РОП`} sub={`${monthLabel(month)} · премия ${me.percent}% от поступлений отдела`}>
        <div className="p-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <div className="text-[28px] font-bold tabular-nums text-gray-900">{fmt(me.total)}</div>
            <div className="text-[11px] text-gray-400 uppercase">прогноз зарплаты, сум</div>
          </div>
          <div className="text-[13px] text-gray-600">фикс <b className="tabular-nums">{fmt(me.fix)}</b></div>
          <div className="text-[13px] text-gray-600">премия <b className="tabular-nums">{fmt(me.commission)}</b></div>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card title={`${me.name}`} sub={`${monthLabel(month)}, на ${data.todayIso?.slice(8)} число${data.closed ? ' · месяц закрыт' : ''}`}>
        <div className="p-4 flex flex-wrap items-baseline gap-x-7 gap-y-2">
          <div>
            <div className="text-[28px] font-bold tabular-nums text-gray-900">{fmt(me.total)}</div>
            <div className="text-[11px] text-gray-400 uppercase">{data.closed ? 'выплачено, сум' : 'прогноз зарплаты, сум'}</div>
          </div>
          <div className="text-[13px] text-gray-600">фикс <b className="tabular-nums">{fmt(me.fix)}</b></div>
          <div className="text-[13px] text-gray-600">
            дисциплина <b className="tabular-nums">{me.disciplinePct}%</b> → <b className="tabular-nums">{fmt(me.kpiMoney)}</b>
          </div>
          <div className="text-[13px] text-gray-600">комиссия <b className="tabular-nums">{fmt(me.commission)}</b></div>
          {me.adjustments > 0 && (
            <div className="text-[13px] text-red-600">корректировки <b className="tabular-nums">−{fmt(me.adjustments)}</b></div>
          )}
        </div>
      </Card>

      <Card title={`Дисциплина — ${me.disciplinePct}%`}
        sub="процент — к норме на сегодняшний день · перевыполнение денег не добавляет">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-gray-200">
          {(me.scales || []).map((s: any) => (
            <div key={s.key} className="bg-white px-4 py-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</div>
              <div className={`text-[22px] font-bold tabular-nums ${
                s.pct >= 80 ? 'text-emerald-600' : s.pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{s.pct}%</div>
              <div className="flex items-center gap-2 mt-1">
                <Bar pct={s.key === 'calls' ? (s.target ? s.done / s.target * 100 : 0) : (s.target ? s.done / s.target * 100 : 0)} tone={toneOf(s.pct)} />
                <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">{s.done} / {s.target} {s.unit}</span>
              </div>
              {s.key === 'calls' && s.today && (
                <div className="text-[11px] text-gray-400 mt-1">
                  сегодня: {s.today.n} звонков, средняя {Math.floor(s.today.avgSec / 60)}:{String(s.today.avgSec % 60).padStart(2, '0')}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="План и комиссия" sub="считаются только отмеченные поступления денег">
        <div className="p-4">
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <span className="text-[22px] font-bold tabular-nums text-gray-900">{fmt(me.paid)}</span>
            <span className="text-[12px] text-gray-400">из {fmt(me.plan)} · {me.planPct}% плана</span>
            {me.plan > 0 && (
              me.belowPace80
                ? <Chip tone="red">темп {me.pace}% · ниже планки</Chip>
                : <Chip tone="green">темп {me.pace}%</Chip>
            )}
          </div>
          <div className="flex items-center"><Bar pct={me.planPct} mark80 /></div>
          <div className="text-[10.5px] text-gray-400 mt-1">┃ 80% — планка отдела</div>
        </div>
        {data.myPayments?.length > 0 && (
          <div className="border-t border-gray-100 divide-y divide-gray-50">
            {data.myPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2 text-[12.5px]">
                <span className="text-gray-600 truncate mr-3">
                  <span className="text-gray-400 tabular-nums mr-2">{p.paidAt?.slice(5)}</span>
                  {p.dealTitle || p.note || 'Поступление'}
                </span>
                <span className="font-semibold text-emerald-600 tabular-nums">+{fmt(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

/* ─────────────────────────── Свод ─────────────────────────── */

function TeamKpi({ month, onNeedSetup }: { month: string; onNeedSetup: () => void }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [adjOpen, setAdjOpen] = useState(false)
  const [adjAgent, setAdjAgent] = useState('')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    apiGet<any>(`/sales/kpi?action=team&month=${month}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Нет доступа'))
  }, [month])
  useEffect(() => { setData(null); load() }, [load])

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>
  if (!data) return <Skeleton rows={5} />

  const goals = data.goals || {}
  const regionName: Record<string, string> = { uz: 'Узбекистан', kz: 'Казахстан', az: 'Азербайджан' }

  const saveAdj = async () => {
    if (busy) return
    setBusy(true)
    try {
      await apiPost('/sales/kpi', {
        action: 'adjust', month,
        agentId: adjAgent, amount: Number(adjAmount.replace(/\s/g, '')), reason: adjReason.trim(),
      })
      setAdjOpen(false); setAdjAgent(''); setAdjAmount(''); setAdjReason('')
      load()
    } catch (e: any) { alert(e?.message || 'Не удалось сохранить') } finally { setBusy(false) }
  }

  const closeMonth = async () => {
    if (!confirm(`Закрыть ${monthLabel(month)}? Цифры заморозятся и уедут в историю — пересчёта больше не будет.`)) return
    try { await apiPost('/sales/kpi', { action: 'close', month }); load() }
    catch (e: any) { alert(e?.message || 'Не удалось закрыть месяц') }
  }

  if (!data.templateExists && !data.closed) {
    return (
      <Card title="Свод команды" sub={monthLabel(month)}>
        <div className="p-6 text-sm text-gray-500">
          На этот месяц ещё нет шаблона мотивации.{' '}
          <button onClick={onNeedSetup} className="text-blue-600 font-medium hover:underline">
            Настроить →
          </button>
        </div>
      </Card>
    )
  }

  const tiles = [
    { label: 'Команда целиком', ...goals.team },
    ...(goals.enterprise?.plan > 0 ? [{ label: 'Энтерпрайс', ...goals.enterprise }] : []),
    ...(goals.regions || []).filter((r: any) => r.plan > 0).map((r: any) => ({
      label: regionName[r.region] || r.region, plan: r.plan, paid: r.paid, pace: r.pace,
    })),
  ].filter(t => t.plan > 0 || t.paid > 0)

  return (
    <>
      {data.closed && (
        <div className="px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-[12.5px] text-gray-600">
          Месяц закрыт{data.closedAt ? ` ${new Date(data.closedAt).toLocaleDateString('ru-RU')}` : ''} — цифры заморожены.
        </div>
      )}

      {(tiles.length > 0 || goals.subscription?.paid > 0) && (
        <Card title="Выполнение планов" sub={`${monthLabel(month)} · только поступившие деньги · темп — против нормы на сегодня`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200">
            {goals.subscription?.paid > 0 && (
              <div className="bg-white px-4 py-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">Подписка · старая база</div>
                <div className="text-[20px] font-bold tabular-nums text-gray-900">{fmt(goals.subscription.paid)}</div>
                <div className="text-[11px] text-gray-400 mt-1 tabular-nums">{goals.subscription.count} платежей</div>
                <div className="mt-1"><Chip tone="gray">вне комиссии</Chip></div>
              </div>
            )}
            {tiles.map((t: any) => (
              <div key={t.label} className="bg-white px-4 py-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">{t.label}</div>
                <div className="text-[20px] font-bold tabular-nums text-gray-900">{fmt(t.paid)}</div>
                <div className="flex items-center gap-2 mt-1">
                  <Bar pct={t.plan ? t.paid / t.plan * 100 : 0} />
                  <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">из {fmt(t.plan)}</span>
                </div>
                <div className="mt-1">
                  {t.pace >= 100 ? <Chip tone="green">темп {t.pace}%</Chip>
                    : t.pace >= 80 ? <Chip tone="blue">темп {t.pace}%</Chip>
                    : <Chip tone="red">темп {t.pace}%</Chip>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Поступления по менеджерам" sub="красный флаг — темп к личному плану ниже 80% · сигнал для разговора, деньги не режет">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Менеджер</th>
                <th className="px-3 py-2 text-right">Личный план</th>
                <th className="px-3 py-2 text-right">Поступило</th>
                <th className="px-3 py-2 w-[30%]">Выполнение</th>
                <th className="px-3 py-2">Темп</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data.people || []).map((p: any) => (
                <tr key={p.agentId}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(p.plan)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(p.paid)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Bar pct={p.planPct} mark80 tone={p.belowPace80 ? 'red' : 'blue'} />
                      <span className="tabular-nums text-gray-500 text-[11px]">{p.planPct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.plan > 0 && (p.belowPace80
                      ? <Chip tone="red">{p.pace}% · ниже планки</Chip>
                      : <Chip tone={p.pace >= 100 ? 'green' : 'blue'}>{p.pace}%</Chip>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={data.closed ? 'Зарплата · закрытый месяц' : 'Зарплата к выплате · прогноз'}
        sub="фикс + дисциплина + комиссия − корректировки"
        right={!data.closed ? (
          <button onClick={closeMonth}
            className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5">
            Закрыть месяц
          </button>
        ) : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Сотрудник</th>
                <th className="px-3 py-2 text-right">Фикс</th>
                <th className="px-3 py-2 text-right">Дисциплина</th>
                <th className="px-3 py-2 text-right">Комиссия</th>
                <th className="px-3 py-2 text-right">Корректировки</th>
                <th className="px-3 py-2 text-right">К выплате</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data.people || []).map((p: any) => (
                <tr key={p.agentId}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(p.fix)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className={p.disciplinePct >= 80 ? 'text-emerald-600' : p.disciplinePct >= 50 ? 'text-amber-600' : 'text-red-600'}>
                      {p.disciplinePct}%
                    </span>{' '}· {fmt(p.kpiMoney)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(p.commission)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                    {p.adjustments > 0 ? `−${fmt(p.adjustments)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">{fmt(p.total)}</td>
                </tr>
              ))}
              {data.rop && (
                <tr className="bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    {data.rop.name} <span className="text-gray-400 font-normal">· РОП</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(data.rop.fix)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400 text-[11px]">без KPI-блока</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmt(data.rop.commission)} <span className="text-gray-400 text-[10.5px]">{data.rop.percent}%</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">—</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">{fmt(data.rop.total)}</td>
                </tr>
              )}
              {data.fund && (
                <tr className="border-t border-gray-200 text-gray-600 font-semibold">
                  <td className="px-4 py-2.5">Фонд отдела</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(data.fund.fix)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(data.fund.kpi)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(data.fund.commission)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                    {data.fund.adjustments > 0 ? `−${fmt(data.fund.adjustments)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{fmt(data.fund.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Корректировки" sub="депремирование вносится руками · причина обязательна и видна сотруднику"
        right={!data.closed ? (
          <button onClick={() => setAdjOpen(v => !v)}
            className="text-[12px] font-semibold text-blue-600 hover:text-blue-700">
            + корректировка
          </button>
        ) : undefined}>
        {adjOpen && (
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2 items-center bg-gray-50/50">
            <select value={adjAgent} onChange={e => setAdjAgent(e.target.value)}
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="">Сотрудник…</option>
              {(data.people || []).map((p: any) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
            </select>
            <input value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="Сумма"
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 w-28 tabular-nums" />
            <input value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Причина (обязательно)"
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[160px]" />
            <button onClick={saveAdj} disabled={busy || !adjAgent || !adjReason.trim() || !Number(adjAmount.replace(/\s/g, ''))}
              className="text-[12px] font-semibold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
              Удержать
            </button>
          </div>
        )}
        {(data.adjustments || []).length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-gray-400">За месяц корректировок нет.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(data.adjustments || []).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-2 text-[12.5px]">
                <span className="text-gray-600">
                  <span className="text-gray-400 tabular-nums mr-2">
                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''}
                  </span>
                  <b>{a.name}</b> — {a.reason}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-red-600 tabular-nums">−{fmt(a.amount)}</span>
                  {!data.closed && (
                    <button onClick={async () => { await apiPost('/sales/kpi', { action: 'unadjust', id: a.id }); load() }}
                      className="text-gray-300 hover:text-red-500" title="Убрать">✕</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

/* ─────────────────────────── Настройки ─────────────────────────── */

function KpiSettings({ month }: { month: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Локальная правка: сохраняем одним нажатием, как в макете
  const [budget, setBudget] = useState('')
  const [metrics, setMetrics] = useState<any[]>([])
  const [commBelow, setCommBelow] = useState('10')
  const [commAbove, setCommAbove] = useState('15')
  const [plans, setPlans] = useState<any[]>([])
  const [ropAgentId, setRopAgentId] = useState('')
  const [ropFix, setRopFix] = useState('')
  const [ropPercent, setRopPercent] = useState('4')
  const [teamPlan, setTeamPlan] = useState('')
  const [enterprisePlan, setEnterprisePlan] = useState('')
  const [regionPlans, setRegionPlans] = useState<Record<string, string>>({})

  useEffect(() => {
    setData(null)
    apiGet<any>(`/sales/kpi?action=template&month=${month}`, false)
      .then(d => {
        setData(d); setError(null)
        const t = d.template
        setBudget(String(t.budget))
        setMetrics(t.metrics.map((m: any) => ({ ...m })))
        setCommBelow(String(t.commissionBelow)); setCommAbove(String(t.commissionAbove))
        setRopAgentId(t.ropAgentId || ''); setRopFix(String(t.ropFix || '')); setRopPercent(String(t.ropPercent))
        setTeamPlan(String(t.teamPlan || '')); setEnterprisePlan(String(t.enterprisePlan || ''))
        setRegionPlans(Object.fromEntries(Object.entries(t.regionPlans || {}).map(([k, v]) => [k, String(v)])))
        // Планы: существующие + весь ростер продаж без плана нулями
        const have = new Map((d.plans || []).map((p: any) => [p.agentId, p]))
        const roster = (d.roster || []).map((r: any) => have.get(r.id) || ({ agentId: r.id, name: r.name, fix: 0, plan: 0 }))
        for (const p of d.plans || []) if (!roster.some((x: any) => x.agentId === p.agentId)) roster.push(p)
        setPlans(roster)
      })
      .catch(e => setError(e?.message || 'Нет доступа'))
  }, [month])

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>
  if (!data) return <Skeleton rows={5} />
  if (!data.canEdit) return <div className="p-6 text-sm text-gray-500">Настройки мотивации доступны только руководителю.</div>

  const closed = data.template.status === 'closed'
  const num = (s: string) => Number(String(s).replace(/\s/g, '')) || 0
  const weightSum = metrics.reduce((s, m) => s + Number(m.weight || 0), 0)

  const save = async () => {
    if (saving) return
    setSaving(true); setSaved(false)
    try {
      await apiPost('/sales/kpi', {
        action: 'template', month,
        budget: num(budget), metrics,
        commissionBelow: Number(commBelow), commissionAbove: Number(commAbove),
        ropAgentId: ropAgentId || null, ropFix: num(ropFix), ropPercent: Number(ropPercent),
        teamPlan: num(teamPlan), enterprisePlan: num(enterprisePlan),
        regionPlans: Object.fromEntries(Object.entries(regionPlans).map(([k, v]) => [k, num(v)])),
        plans: plans.filter(p => num(String(p.fix)) > 0 || num(String(p.plan)) > 0)
          .map(p => ({ agentId: p.agentId, fix: num(String(p.fix)), plan: num(String(p.plan)) })),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) { alert(e?.message || 'Не удалось сохранить') } finally { setSaving(false) }
  }

  const inp = 'text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 tabular-nums text-right w-32'

  return (
    <>
      {closed && (
        <div className="px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-[12.5px] text-gray-600">
          Месяц закрыт — правила заморожены, изменения не принимаются.
        </div>
      )}

      <Card title="Дисциплинарный блок" sub="платится пропорционально выполнению · каждая шкала с капом 100%">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-[12.5px]">
          Бюджет на менеджера:
          <input className={inp} value={budget} onChange={e => setBudget(e.target.value)} disabled={closed} />
          <span className="text-gray-400">сум/мес</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Показатель</th>
                <th className="px-3 py-2 text-right">Норма</th>
                <th className="px-3 py-2 text-right">Вес, %</th>
                <th className="px-3 py-2 text-right">Деньги</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {metrics.map((m, i) => (
                <tr key={m.key}>
                  <td className="px-4 py-2">
                    {m.label}
                    {m.key === 'calls' && (
                      <span className="text-gray-400 text-[11px]"> · зачёт дня: ≥ нормы звонков со средней ≥
                        <input className="mx-1 w-10 border border-gray-200 rounded px-1 text-right tabular-nums"
                          value={m.minAvgMin ?? 5} disabled={closed}
                          onChange={e => setMetrics(ms => ms.map((x, j) => j === i ? { ...x, minAvgMin: Number(e.target.value) || 0 } : x))} />
                        мин</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input className="w-16 border border-gray-200 rounded px-1.5 py-1 text-right tabular-nums"
                      value={m.norm} disabled={closed}
                      onChange={e => setMetrics(ms => ms.map((x, j) => j === i ? { ...x, norm: Number(e.target.value) || 0 } : x))} />
                    <span className="text-gray-400 text-[11px] ml-1">{m.key === 'calls' ? 'в день' : 'в месяц'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input className="w-16 border border-gray-200 rounded px-1.5 py-1 text-right tabular-nums"
                      value={m.weight} disabled={closed}
                      onChange={e => setMetrics(ms => ms.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) || 0 } : x))} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {fmt(Math.round(num(budget) * Number(m.weight || 0) / 100))}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-gray-600">
                <td className="px-4 py-2" colSpan={2}>Сумма весов</td>
                <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(weightSum - 100) > 0.5 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {weightSum}% {Math.abs(weightSum - 100) > 0.5 ? '≠ 100' : '✓'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(num(budget))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Комиссия" sub="база — фактически поступившие деньги: отметка «оплата пришла» на сделке или ПланФакт">
        <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px] items-center">
          <label className="flex items-center gap-2">До личного плана
            <input className="w-14 border border-gray-200 rounded px-1.5 py-1 text-right tabular-nums"
              value={commBelow} onChange={e => setCommBelow(e.target.value)} disabled={closed} />%</label>
          <label className="flex items-center gap-2">Сверх плана <span className="text-gray-400">(только превышение)</span>
            <input className="w-14 border border-gray-200 rounded px-1.5 py-1 text-right tabular-nums"
              value={commAbove} onChange={e => setCommAbove(e.target.value)} disabled={closed} />%</label>
        </div>
      </Card>

      <Card title="Оклады и личные планы" sub="сейлзы подтягиваются из команды автоматически · план и оклад — по уровню менеджера">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Менеджер</th>
                <th className="px-3 py-2 text-right">Фикс (оклад)</th>
                <th className="px-3 py-2 text-right">План поступлений</th>
                <th className="px-3 py-2 text-right">Комиссия при 100%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {plans.map((p, i) => (
                <tr key={p.agentId} className={num(String(p.fix)) === 0 && num(String(p.plan)) === 0 ? 'opacity-60' : ''}>
                  <td className="px-4 py-2 font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-right">
                    <input className={inp} value={p.fix || ''} placeholder="0" disabled={closed}
                      onChange={e => setPlans(ps => ps.map((x, j) => j === i ? { ...x, fix: e.target.value } : x))} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input className={inp} value={p.plan || ''} placeholder="0" disabled={closed}
                      onChange={e => setPlans(ps => ps.map((x, j) => j === i ? { ...x, plan: e.target.value } : x))} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {fmt(Math.round(num(String(p.plan)) * Number(commBelow) / 100))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          Менеджер без оклада и плана в расчёт не попадает. Порог 80% — управленческий флаг, деньги не режет.
        </div>
      </Card>

      <Card title="Планы отдела" sub="цели поверх личных: на зарплату менеджеров не влияют — это плитки свода и премия РОПа">
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[12.5px]">
          <label className="flex items-center justify-between gap-2">Команда целиком
            <input className={inp} value={teamPlan} onChange={e => setTeamPlan(e.target.value)} disabled={closed} /></label>
          <label className="flex items-center justify-between gap-2">Энтерпрайс
            <input className={inp} value={enterprisePlan} onChange={e => setEnterprisePlan(e.target.value)} disabled={closed} /></label>
          {['uz', 'kz'].map(rid => (
            <label key={rid} className="flex items-center justify-between gap-2">
              {rid === 'uz' ? 'Узбекистан' : 'Казахстан'}
              <input className={inp} value={regionPlans[rid] || ''} disabled={closed}
                onChange={e => setRegionPlans(rp => ({ ...rp, [rid]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Card>

      <Card title="Оплата РОПа" sub="премия — от поступлений всего отдела, включая энтерпрайс">
        <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px] items-center">
          <label className="flex items-center gap-2">РОП
            <select value={ropAgentId} onChange={e => setRopAgentId(e.target.value)} disabled={closed}
              className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="">не выбран</option>
              {(data.roster || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <label className="flex items-center gap-2">Фикс
            <input className={inp} value={ropFix} onChange={e => setRopFix(e.target.value)} disabled={closed} /></label>
          <label className="flex items-center gap-2">Премия
            <input className="w-14 border border-gray-200 rounded px-1.5 py-1 text-right tabular-nums"
              value={ropPercent} onChange={e => setRopPercent(e.target.value)} disabled={closed} />%</label>
        </div>
      </Card>

      {!closed && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || Math.abs(weightSum - 100) > 0.5}
            className="text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 disabled:opacity-50">
            {saving ? 'Сохраняем…' : 'Сохранить шаблон'}
          </button>
          {saved && <span className="text-[12.5px] text-emerald-600">Сохранено — расчёт обновился</span>}
          {Math.abs(weightSum - 100) > 0.5 && (
            <span className="text-[12.5px] text-red-600">Веса должны давать 100%</span>
          )}
        </div>
      )}
    </>
  )
}

/* ─────────────────────────── Поступления из ПланФакта ─────────────────────────── */

function PfInbox() {
  const [tab, setTab] = useState<'new' | 'subscription' | 'linked' | 'ignored'>('new')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [indexing, setIndexing] = useState(false)
  // Один общий выбор сделки с поиском вместо сотни выпадающих списков
  const [pickFor, setPickFor] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    apiGet<any>(`/sales/kpi?action=pf_inbox&status=${tab}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Нет доступа'))
  }, [tab])
  useEffect(() => { setData(null); load() }, [load])

  const dealById = new Map<string, any>((data?.deals || []).map((d: any) => [d.id, d]))
  // Имя клиента: аккаунт надёжнее заголовка — у части сделок он «-»
  const dealName = (d: any) => d ? (d.account && d.account !== '-' ? d.account : d.title) : ''
  const dealLabel = (d: any) => d
    ? `${dealName(d)}${d.owner ? ` · ${d.owner}` : ''}${d.won ? ' · выиграна' : ''}` : ''

  const sync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const r = await apiPost<any>('/sales/kpi', { action: 'pf_sync', days: 60 })
      setSyncMsg(`Получено ${r.fetched}, новых ${r.added}, в подписку ушло ${r.reclassified || 0} · в разборе ${r.pending}`)
      load()
    } catch (e: any) { setSyncMsg(e?.message || 'Синхронизация не прошла') } finally { setSyncing(false) }
  }

  // История с 2021 года порциями: пока done не true, зовём со сдвигом дальше
  const indexHistory = async () => {
    setIndexing(true); setSyncMsg('Индексируем историю платежей с 2021 года…')
    let offset = 0, total = 0
    try {
      for (let i = 0; i < 60; i++) {
        const r = await apiPost<any>('/sales/kpi', { action: 'pf_index', offset })
        total += r.processed || 0
        if (r.done) {
          setSyncMsg(`История загружена: ${total} операций, клиентов в базе ${r.clients} · подписок размечено ${r.reclassified}`)
          break
        }
        setSyncMsg(`Индексируем историю… ${total} операций`)
        offset = r.nextOffset
      }
      load()
    } catch (e: any) { setSyncMsg(e?.message || 'Индексация не прошла') } finally { setIndexing(false) }
  }

  const link = async (opId: number, dealId: string) => {
    if (!dealId) return
    try {
      await apiPost('/sales/kpi', { action: 'pf_link', inboxId: opId, dealId })
      setPickFor(null); setSearch('')
      load()
    } catch (e: any) { alert(e?.message || 'Не удалось привязать') }
  }
  const act = async (action: string, opId: number) => {
    try { await apiPost('/sales/kpi', { action, inboxId: opId }); load() }
    catch (e: any) { alert(e?.message || 'Не получилось') }
  }

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>

  const q = search.trim().toLowerCase()
  const found = q.length < 2 ? [] : (data?.deals || []).filter((d: any) =>
    `${d.title} ${d.account || ''} ${d.owner || ''}`.toLowerCase().includes(q)).slice(0, 30)

  return (
    <>
      <Card title="Поступления из ПланФакта"
        sub="операции падают сюда, вы привязываете их к сделкам — комиссия менеджера считается от привязанного"
        right={
          <div className="flex gap-2">
            <button onClick={indexHistory} disabled={indexing || syncing}
              title="Прогнать всю историю платежей с 2021 года: кто платил раньше — подписка"
              className="text-[12px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {indexing ? 'Индексируем…' : 'История с 2021'}
            </button>
            <button onClick={sync} disabled={syncing || indexing}
              className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {syncing ? 'Забираем…' : 'Забрать из ПланФакта'}
            </button>
          </div>
        }>
        {syncMsg && <div className="px-4 py-2 text-[12px] text-gray-500 border-b border-gray-100">{syncMsg}</div>}
        <div className="flex gap-1 px-4 pt-2 border-b border-gray-100 overflow-x-auto">
          {([['new', 'Новые деньги'], ['subscription', 'Подписка'], ['linked', 'Привязаны'], ['ignored', 'Не продажи']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`text-[12px] px-3 py-2 border-b-2 whitespace-nowrap ${
                tab === k ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500'}`}>
              {label}
              {data?.counts?.[k] ? <span className="ml-1 text-[10.5px] text-gray-400 tabular-nums">{data.counts[k]}</span> : null}
            </button>
          ))}
        </div>
        {!data ? <Skeleton rows={3} kpis={false} /> : (data.items || []).length === 0 ? (
          <div className="px-4 py-5 text-[12.5px] text-gray-400">
            {tab === 'new'
              ? 'Пусто. Нажмите «Забрать из ПланФакта» — нужен сохранённый ключ в Настройки → Интеграции.'
              : 'Здесь пока ничего нет.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.items.map((op: any) => (
              <div key={op.id} className="px-4 py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-[12.5px] text-gray-900">
                      <span className="text-gray-400 tabular-nums mr-2">{op.date?.slice(5)}</span>
                      <b>{op.contragent || op.category || 'Без имени'}</b>
                      {op.category && op.contragent && op.category !== op.contragent && (
                        <span className="text-blue-600"> · {op.category}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {[op.comment, op.account ? `счёт: ${op.account}` : null].filter(Boolean).join(' · ')}
                    </div>
                    {tab === 'linked' && op.dealId && (
                      <div className="text-[11px] text-blue-600 truncate">→ {dealLabel(dealById.get(op.dealId)) || op.dealId}</div>
                    )}
                  </div>
                  <div className="text-right flex-none">
                    <div className="font-semibold text-emerald-600 tabular-nums text-[13px]">+{fmt(op.amount)} UZS</div>
                    {op.currency && op.currency !== 'UZS' && (
                      <div className="text-[10.5px] text-gray-400 tabular-nums">{fmt(op.amountOriginal)} {op.currency}</div>
                    )}
                  </div>
                  {tab === 'new' && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(op.suggested || []).map((sid: string) => (
                        <button key={sid} onClick={() => link(op.id, sid)}
                          title={dealLabel(dealById.get(sid))}
                          className="text-[11.5px] px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 max-w-[220px] truncate">
                          ✓ {dealLabel(dealById.get(sid)) || sid}
                        </button>
                      ))}
                      <button onClick={() => { setPickFor(pickFor === op.id ? null : op.id); setSearch('') }}
                        className="text-[11.5px] px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600">
                        найти сделку…
                      </button>
                      <button onClick={async () => { await apiPost('/sales/kpi', { action: 'pf_mark', inboxId: op.id, to: 'subscription' }); load() }}
                        className="text-[11.5px] px-2 py-1 rounded-lg text-gray-500 hover:text-blue-600 border border-gray-200">
                        подписка
                      </button>
                      <button onClick={() => act('pf_ignore', op.id)}
                        className="text-[11.5px] px-2 py-1 rounded-lg text-gray-400 hover:text-gray-600 border border-gray-200">
                        не продажи
                      </button>
                    </div>
                  )}
                  {tab === 'subscription' && (
                    <button onClick={async () => { await apiPost('/sales/kpi', { action: 'pf_mark', inboxId: op.id, to: 'new' }); load() }}
                      className="text-[11.5px] px-2 py-1 rounded-lg text-gray-500 hover:text-emerald-600 border border-gray-200">
                      это новая продажа
                    </button>
                  )}
                  {tab === 'linked' && (
                    <button onClick={() => act('pf_unlink', op.id)}
                      className="text-[11.5px] px-2 py-1 rounded-lg text-gray-400 hover:text-red-500 border border-gray-200">
                      отвязать
                    </button>
                  )}
                  {tab === 'ignored' && (
                    <button onClick={() => act('pf_restore', op.id)}
                      className="text-[11.5px] px-2 py-1 rounded-lg text-gray-400 hover:text-gray-600 border border-gray-200">
                      вернуть в разбор
                    </button>
                  )}
                </div>
                {pickFor === op.id && (
                  <div className="mt-2 ml-6 max-w-md">
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Название бренда, аккаунта или менеджера…"
                      className="w-full text-[12.5px] border border-blue-300 rounded-lg px-3 py-1.5" />
                    {q.length >= 2 && (
                      <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm max-h-56 overflow-y-auto divide-y divide-gray-50">
                        {found.length === 0 ? (
                          <div className="px-3 py-2 text-[12px] text-gray-400">Ничего не нашлось</div>
                        ) : found.map((d: any) => (
                          <button key={d.id} onClick={() => link(op.id, d.id)}
                            className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50">
                            <b>{dealName(d)}</b>
                            <span className="text-gray-400"> {d.owner ? `· ${d.owner}` : ''}{d.won ? ' · выиграна' : ' · в работе'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="text-[11.5px] text-gray-400 px-1">
        Кнопка «История с 2021» выучивает всю историю платежей: клиент, плативший раньше,
        автоматически уходит в «Подписку» — вне комиссий и планов. В «Новых деньгах» остаются
        только первые платежи — их привязываете к сделкам, и они идут в комиссию менеджера.
        Ошибку классификации правят кнопки «подписка» / «это новая продажа».
        Суммы приведены к сумам курсом ПланФакта, оригинал в валюте счёта — серым.
        Каждая операция привязывается один раз — дублей не будет.
      </div>
    </>
  )
}

/* ─────────────────────────── История ─────────────────────────── */

function KpiHistory() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    apiGet<any>('/sales/kpi?action=history', false)
      .then(d => { setData(d); setError(null); if (d.months?.length) setOpen(d.months[0].month) })
      .catch(e => setError(e?.message || 'Нет доступа'))
  }, [])

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>
  if (!data) return <Skeleton rows={3} />
  if (!data.months?.length) {
    return <div className="p-6 text-sm text-gray-400">
      Закрытых месяцев пока нет. Первый появится после кнопки «Закрыть месяц» в своде.
    </div>
  }

  return (
    <>
      {data.months.map((m: any) => (
        <Card key={m.month}
          title={monthLabel(m.month)}
          sub={`закрыт ${m.closedAt ? new Date(m.closedAt).toLocaleDateString('ru-RU') : ''} · поступления ${fmt(m.paid)}${m.teamPlan ? ` из ${fmt(m.teamPlan)}` : ''}`}
          right={<button onClick={() => setOpen(o => o === m.month ? null : m.month)}
            className="text-[12px] text-blue-600 font-medium">{open === m.month ? 'Свернуть' : 'Раскрыть'}</button>}>
          {open === m.month && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2">Сотрудник</th>
                    <th className="px-3 py-2 text-right">Фикс</th>
                    <th className="px-3 py-2 text-right">Дисциплина</th>
                    <th className="px-3 py-2 text-right">Комиссия</th>
                    <th className="px-3 py-2 text-right">Корректировки</th>
                    <th className="px-3 py-2 text-right">Выплачено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(m.people || []).map((p: any) => (
                    <tr key={p.agentId}>
                      <td className="px-4 py-2 font-medium text-gray-900">{p.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(p.fix)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.disciplinePct}% · {fmt(p.kpiMoney)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(p.commission)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        {p.adjustments > 0 ? `−${fmt(p.adjustments)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(p.total)}</td>
                    </tr>
                  ))}
                  {m.rop && (
                    <tr className="bg-gray-50/60">
                      <td className="px-4 py-2 font-medium">{m.rop.name} <span className="text-gray-400">· РОП</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.rop.fix)}</td>
                      <td className="px-3 py-2 text-right text-gray-400 text-[11px]">без KPI-блока</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.rop.commission)}</td>
                      <td className="px-3 py-2 text-right">—</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(m.rop.total)}</td>
                    </tr>
                  )}
                  {m.fund && (
                    <tr className="border-t border-gray-200 font-semibold text-gray-600">
                      <td className="px-4 py-2">Итого</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.fund.fix)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.fund.kpi)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.fund.commission)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        {m.fund.adjustments > 0 ? `−${fmt(m.fund.adjustments)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-gray-900">{fmt(m.fund.total)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  )
}

/* ─────────────────────────── Страница ─────────────────────────── */

export function SalesKpiPage() {
  const [tab, setTab] = useState<'my' | 'team' | 'pf' | 'settings' | 'history'>('my')
  const [month, setMonth] = useState(monthNow())
  const [isLead, setIsLead] = useState(false)

  useEffect(() => {
    // Право на свод/настройки проверяет бэкенд; тут только прячем вкладки
    apiGet<any>(`/sales/kpi?action=template&month=${monthNow()}`, false)
      .then(d => setIsLead(!!d.canEdit))
      .catch(() => setIsLead(false))
  }, [])

  const tabs: Array<['my' | 'team' | 'pf' | 'settings' | 'history', string]> = isLead
    ? [['my', 'Мой KPI'], ['team', 'Свод команды'], ['pf', 'Поступления'], ['settings', 'Настройки'], ['history', 'История выплат']]
    : [['my', 'Мой KPI']]

  return (
    <PageShell header={
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[17px] font-bold text-gray-900">Мотивация</h1>
          <div className="text-[11.5px] text-gray-400">
            зарплата = фикс + бюджет × % дисциплины + комиссия с поступлений − корректировки
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1 py-0.5">
            <button onClick={() => setMonth(m => shiftMonth(m, -1))}
              className="px-1.5 py-0.5 text-gray-400 hover:text-gray-700">‹</button>
            <span className="text-[12.5px] font-semibold text-gray-800 min-w-[110px] text-center">{monthLabel(month)}</span>
            <button onClick={() => setMonth(m => shiftMonth(m, 1))}
              disabled={month >= monthNow()}
              className="px-1.5 py-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30">›</button>
          </div>
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`text-[12px] px-2.5 py-1 rounded-md font-medium ${
                  tab === k ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    }>
      {tab === 'my' && <MyKpi month={month} />}
      {tab === 'team' && <TeamKpi month={month} onNeedSetup={() => setTab('settings')} />}
      {tab === 'pf' && <PfInbox />}
      {tab === 'settings' && <KpiSettings month={month} />}
      {tab === 'history' && <KpiHistory />}
    </PageShell>
  )
}

export default SalesKpiPage
