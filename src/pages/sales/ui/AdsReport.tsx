import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { Card, Kpis, Skeleton } from './kit'

/**
 * Вкладка «Реклама» в отчётах: бюджет Meta по сотрудникам.
 *
 * Отвечает на вопрос владельца «какая часть бюджета приходится на сотрудника
 * и сколько он сливает». Считается на сервере (reports?action=ads), здесь —
 * таблица с полосой «куда ушли деньги» и три оговорки, без которых цифры
 * несправедливы к людям.
 */

type Fate = 'paid' | 'advanced' | 'working' | 'junk_worked' | 'junk_target' | 'wasted'
const FATES: Fate[] = ['paid', 'advanced', 'working', 'junk_worked', 'junk_target', 'wasted']
const FATE: Record<Fate, { label: string; color: string }> = {
  paid: { label: 'оплатили', color: 'bg-emerald-800' },
  advanced: { label: 'продвинул (квалификация и дальше)', color: 'bg-emerald-500' },
  working: { label: 'в работе, звонки есть', color: 'bg-sky-500' },
  junk_worked: { label: 'отработал, но потерял (есть причина или звонки)', color: 'bg-amber-500' },
  junk_target: { label: 'не наш клиент — брак таргета, не сейлза', color: 'bg-slate-400' },
  wasted: { label: 'не отработано — закрыт или брошен без звонка и причины', color: 'bg-red-600' },
}

const usd = (v: number) => '$' + Math.round(v).toLocaleString('ru-RU')
const uzs = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} млн` : Math.round(v).toLocaleString('ru-RU')

export function AdsReport({ from, to, region }: { from: string; to: string; region: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    apiGet<any>(`/sales/reports?action=ads&from=${from}&to=${to}&region=${region || 'all'}`, false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить отчёт по рекламе'))
  }, [from, to, region])

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={5} />

  const t = data.totals || { cost: 0, leads: 0, n: {}, c: {} }
  const advanced = (t.n.advanced || 0) + (t.n.paid || 0)
  const wasted = t.c.wasted || 0
  const wastedPct = t.cost > 0 ? Math.round(100 * wasted / t.cost) : 0
  const q = data.quality || { junk: 0, junkNoReason: 0 }
  const campaigns: any[] = data.campaigns || []
  const active = campaigns.filter(c => c.live)
  // Деньги, которые не дошли ни до одного лида в CRM: их нет ни у кого из людей
  const noLeadSpend = Math.max(0, (t.spend ?? t.cost) - t.cost)

  if (!data.configured) {
    return (
      <Card title="Реклама по сотрудникам">
        <div className="px-4 py-6 text-[12.5px] text-gray-500">
          Нет доступа к рекламному кабинету Meta: подключите Instagram и Facebook в настройках —
          интеграции — и дайте доступ к рекламе.
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Kpis items={[
        ['Потрачено', usd(t.spend ?? t.cost), `${active.length} активных · ${usd(data.dailyBudget || 0)} в день сейчас`],
        ['Лидов в CRM', String(t.leads), t.leads ? `${usd(t.cost / t.leads)} за лид` : ''],
        ['Продвинуто', usd((t.c.advanced || 0) + (t.c.paid || 0)), `${advanced} лидов дошли до квалификации+`],
        ['Не отработано', usd(wasted), `${wastedPct}% бюджета · ${t.n.wasted || 0} лидов без единого звонка`],
        ['Оплат', String(t.n.paid || 0), t.n.paid ? usd(t.c.paid || 0) + ' бюджета окупилось' : 'окупаемость пока не считается'],
      ]} />

      <Card title="Каналы привлечения" sub="откуда приходят и во что превращаются · расход там, где он известен">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-gray-500 bg-gray-50/80">
                <th className="text-left font-semibold px-4 py-2">Канал</th>
                <th className="text-right font-semibold px-4 py-2">Лидов</th>
                <th className="text-right font-semibold px-4 py-2">В работу</th>
                <th className="text-right font-semibold px-4 py-2">Продвинуто</th>
                <th className="text-right font-semibold px-4 py-2">Выиграно</th>
                <th className="text-right font-semibold px-4 py-2">Получено, UZS</th>
                <th className="text-right font-semibold px-4 py-2">Расход</th>
                <th className="text-right font-semibold px-4 py-2">Цена лида</th>
                <th className="text-right font-semibold px-4 py-2">Цена выигрыша</th>
              </tr>
            </thead>
            <tbody>
              {(data.channels || []).map((c: any) => {
                const dim = c.leads === 0 && !c.spend
                const known = c.spend != null
                return (
                  <tr key={c.key} className={`border-t border-gray-100 ${dim ? 'text-gray-400' : ''}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`font-semibold ${dim ? '' : 'text-gray-900'}`}>{c.label}</span>
                      {c.paid && (
                        <span className={`ml-1.5 text-[10px] px-1.5 py-px border rounded align-[1px] ${
                          known ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}`}>
                          {known ? (c.spendSource === 'meta' ? 'расход из кабинета' : 'расход из Метрики') : 'расход неизвестен'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.leads}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.deals}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.advanced}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.won}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.paidAmount > 0 ? uzs(c.paidAmount) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{known ? usd(c.spend) : (c.paid ? '?' : '—')}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{known && c.leads ? usd(c.spend / c.leads) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{known && c.won ? usd(c.spend / c.won) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[12px] text-gray-500 border-t border-gray-100 space-y-1">
          <p><b className="text-gray-800">Google и Яндекс</b> — лиды с сайта с меткой gclid / yclid или utm. Без метки заявка с сайта считается «Сайт delever.io»: платный трафик от органики тогда не отличить.</p>
          <p><b className="text-gray-800">Расход Яндекса</b> приходит из Метрики раз в сутки (счётчик связан с Директом). Google Ads — одна кампания на паузе, расход нулевой; когда запустится, подключим кабинет.</p>
        </div>
      </Card>

      <Card title="Бюджет по сотрудникам" sub="кому достались лиды с рекламы и что с деньгами стало">
        {!data.agents?.length ? (
          <div className="px-4 py-6 text-[12.5px] text-gray-500">За период лидов с рекламы Meta не было.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-gray-500 bg-gray-50/80">
                  <th className="text-left font-semibold px-4 py-2">Сотрудник</th>
                  <th className="text-right font-semibold px-4 py-2">Лидов</th>
                  <th className="text-right font-semibold px-4 py-2">Бюджет</th>
                  <th className="text-left font-semibold px-4 py-2 w-[34%] min-w-[240px]">Куда ушли деньги</th>
                  <th className="text-right font-semibold px-4 py-2">Продвинул</th>
                  <th className="text-right font-semibold px-4 py-2">Не отработано</th>
                  <th className="text-right font-semibold px-4 py-2">Оплат</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a: any) => {
                  const adv = (a.n.advanced || 0) + (a.n.paid || 0)
                  const w = a.c.wasted || 0
                  const nobody = !a.agentId
                  return (
                    <tr key={a.agentId || 'nobody'} className={`border-t border-gray-100 ${nobody ? 'bg-gray-50' : ''}`}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-semibold text-gray-900">{a.agent}</span>
                        {a.markets.map((m: string) => (
                          <span key={m} className="ml-1.5 text-[10px] px-1.5 py-px border border-gray-200 rounded text-gray-500 align-[1px]">
                            {m.toUpperCase()}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{a.leads}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div className="font-semibold text-gray-900">{usd(a.cost)}</div>
                        <div className="text-[11px] text-gray-400">{t.cost ? Math.round(100 * a.cost / t.cost) : 0}%</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex h-3.5 rounded overflow-hidden bg-gray-100">
                          {FATES.map(f => a.c[f] > 0 && (
                            <i key={f} className={`block h-full ${FATE[f].color}`}
                              style={{ width: `${(100 * a.c[f] / a.cost).toFixed(1)}%` }}
                              title={`${FATE[f].label}: ${a.n[f]} лид · ${usd(a.c[f])}`} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div>{adv}</div>
                        <div className="text-[11px] text-gray-400">{adv ? `${usd(a.cost / adv)} за лид` : '—'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div className={`font-semibold ${w > 0 ? 'text-red-600' : 'text-gray-900'}`}>{usd(w)}</div>
                        <div className="text-[11px] text-gray-400">
                          {a.n.wasted || 0} лид · {a.cost ? Math.round(100 * w / a.cost) : 0}%
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{a.n.paid || 0}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-3 text-[11.5px] text-gray-500 border-t border-gray-100">
          {FATES.map(f => (
            <span key={f} className="inline-flex items-center gap-1.5">
              <i className={`inline-block w-2.5 h-2.5 rounded-sm ${FATE[f].color}`} />{FATE[f].label}
            </span>
          ))}
        </div>
        <div className="px-4 py-3 text-[12px] text-gray-500 border-t border-gray-100 space-y-1">
          {noLeadSpend > 0 && (
            <p><b className="text-gray-800">{usd(noLeadSpend)}</b> потрачено кампаниями, чьи лиды до CRM не дошли, — в строках сотрудников этих денег нет, они в таблице кампаний ниже.</p>
          )}
          <p><b className="text-gray-800">«Никто не взял»</b> — лиды, у которых нет владельца ни в обращении, ни в сделке: в группе кнопку «Беру» не нажали. Это тоже судьба денег, и самая дорогая.</p>
          <p><b className="text-gray-800">Звонки</b> считаются только через АТС и мессенджеры системы. Кто звонит с личного телефона — выглядит как «не отработал». Команда KZ работает в Amo — её лиды здесь всегда «не отработаны».</p>
          <p><b className="text-gray-800">Причина отказа</b> есть у {q.junk - q.junkNoReason} из {q.junk} отказов за период. Без причины отказ считается «не отработано», если по лиду не было звонков. С этого выпуска отказ без причины не принимается.</p>
        </div>
      </Card>

      <Card title="Кампании и бюджеты" sub="что крутится сейчас и что тратило в периоде">
        {!campaigns.length ? (
          <div className="px-4 py-6 text-[12.5px] text-gray-500">Кампаний с тратами за период нет.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-gray-500 bg-gray-50/80">
                  <th className="text-left font-semibold px-4 py-2">Кампания</th>
                  <th className="text-right font-semibold px-4 py-2">В день</th>
                  <th className="text-right font-semibold px-4 py-2">Потрачено</th>
                  <th className="text-right font-semibold px-4 py-2" title="лидов по данным Meta / дошло до CRM">Лидов Meta / CRM</th>
                  <th className="text-right font-semibold px-4 py-2">Цена лида</th>
                  <th className="text-left font-semibold px-4 py-2 w-[26%] min-w-[200px]">Куда ушли деньги</th>
                  <th className="text-right font-semibold px-4 py-2">Продвинул</th>
                  <th className="text-right font-semibold px-4 py-2">Не отработано</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: any) => {
                  const on = Boolean(c.live)
                  const adv = (c.n.advanced || 0) + (c.n.paid || 0)
                  const w = c.c.wasted || 0
                  return (
                    <tr key={c.id} className={`border-t border-gray-100 ${on ? '' : 'text-gray-500'}`}>
                      <td className="px-4 py-2.5 max-w-[360px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`flex-none w-2 h-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}
                            title={on ? 'активна' : 'на паузе'} />
                          <span className={`truncate ${on ? 'font-semibold text-gray-900' : ''}`} title={c.name}>{c.name}</span>
                          {c.markets.map((m: string) => (
                            <span key={m} className="flex-none text-[10px] px-1.5 py-px border border-gray-200 rounded text-gray-500">
                              {m.toUpperCase()}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11px] text-gray-400 pl-4">
                          {on
                            ? `${c.activeAdsets} ${c.activeAdsets === 1 ? 'группа' : c.activeAdsets < 5 ? 'группы' : 'групп'} в работе`
                            : c.status === 'ACTIVE' ? 'все группы на паузе' : 'на паузе'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{on && c.dailyBudget > 0 ? usd(c.dailyBudget) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">{usd(c.spend)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.metaLeads} / <span className={c.crmLeads < c.metaLeads ? 'text-amber-600' : ''}>{c.crmLeads}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.crmLeads ? usd(c.spend / c.crmLeads) : '—'}</td>
                      <td className="px-4 py-2.5">
                        {c.crmLeads > 0 ? (
                          <div className="flex h-3.5 rounded overflow-hidden bg-gray-100">
                            {FATES.map(f => c.c[f] > 0 && (
                              <i key={f} className={`block h-full ${FATE[f].color}`}
                                style={{ width: `${(100 * c.c[f] / c.spend).toFixed(1)}%` }}
                                title={`${FATE[f].label}: ${c.n[f]} лид · ${usd(c.c[f])}`} />
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-400">лидов в CRM нет</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div>{adv}</div>
                        <div className="text-[11px] text-gray-400">{adv ? `${usd(c.spend / adv)} за лид` : '—'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div className={`font-semibold ${w > 0 ? 'text-red-600' : ''}`}>{usd(w)}</div>
                        <div className="text-[11px] text-gray-400">{c.n.wasted || 0} лид</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 text-[12px] text-gray-500 border-t border-gray-100 space-y-1">
          <p><b className="text-gray-800">В день</b> — дневной бюджет активных групп кампании на сейчас, а не в среднем за период. Если Meta насчитала лидов больше, чем дошло до CRM, — цифра CRM подсвечена: лиды теряются по дороге (Amo, дубли, форма без телефона).</p>
        </div>
      </Card>
    </div>
  )
}
