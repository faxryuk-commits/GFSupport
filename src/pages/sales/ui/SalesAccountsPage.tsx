import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiGet } from '@/shared/services/api.service'
import { Card, Chip, Empty, fmtDate, money, Pager, PageShell, Th, Skeleton , Drawer , Kpis } from './kit'
import { RegionBadge, useRegion } from './region'
import { SalesAccountPage } from './SalesAccountPage'

/**
 * Список аккаунтов. Один экран для клиентов и партнёров — разница только в
 * типе: партнёр это тоже аккаунт, просто продаём мы ему условия, а не подписку.
 */

const LIFECYCLE: Record<string, [string, string]> = {
  lead: ['лид', 'gray'], prospect: ['в работе', 'blue'],
  customer: ['клиент', 'green'], churned: ['ушёл', 'red'],
}

export function SalesAccountsPage() {
  const location = useLocation()
  const type = location.pathname.includes('partners') ? 'partner' : 'client'
  const [rows, setRows] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [openAccount, setOpenAccount] = useState<string | null>(null)
  const [stats, setStats] = useState<any>({})
  const [lifecycle, setLifecycle] = useState('')
  const region = useRegion('accounts')
  const LIMIT = 50

  const load = useCallback(() => {
    apiGet<{ accounts: any[]; hasMore: boolean; stats?: any }>(
      `/sales/accounts?type=${type}&q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}` +
      (lifecycle ? `&lifecycle=${lifecycle}` : '') + `&region=${region || 'all'}`, false)
      .then(d => { setRows(d.accounts || []); setHasMore(Boolean(d.hasMore)); setStats(d.stats || {}); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить список'))
  }, [type, q, offset, region, lifecycle])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  if (error && !rows) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!rows) return <Skeleton rows={8} kpis={false} />

  return (
    <PageShell header={
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">
            {type === 'partner' ? 'Партнёры' : 'Аккаунты'}
          </h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {type === 'partner'
              ? 'Дистрибьюторы, агенты, реселлеры и разовые рекомендации'
              : 'Клиенты: от первого обращения до работающего ресторана'}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <RegionBadge scope="accounts" />
          <Link to={type === 'partner' ? '/sales/accounts' : '/sales/partners'}
            className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
            {type === 'partner' ? 'К клиентам' : 'К партнёрам'}
          </Link>
          <input value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} placeholder="Поиск по названию"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] w-52" />
        </div>
      </div>
    }>

      <Kpis items={[
        ['Всего', String(stats.total ?? rows.length), type === 'partner' ? 'партнёров' : 'аккаунтов'],
        ['Лиды', String(stats.leads ?? 0), 'обращались, но не купили'],
        ['Клиенты', String(stats.customers ?? 0), 'подписали'],
        ['Запущены', String(stats.launched ?? 0), 'есть первый заказ'],
        ['С merchant_id', String(stats.with_merchant ?? 0), 'связаны с админкой'],
      ]} />

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex gap-2 flex-wrap items-center sticky top-0 z-20 shadow-sm">
        <select value={lifecycle} onChange={e => { setLifecycle(e.target.value); setOffset(0) }}
          className={`border rounded-lg px-2 py-1.5 text-[12.5px] ${
            lifecycle ? 'border-blue-400 text-blue-700' : 'border-gray-300'}`}>
          <option value="">Все стадии</option>
          <option value="lead">Лид</option>
          <option value="opportunity">В работе</option>
          <option value="customer">Клиент</option>
          <option value="churned">Ушёл</option>
        </select>
        <span className="text-[11.5px] text-gray-400 ml-auto">
          показано {rows.length} из {stats.total ?? rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty title="Здесь пусто" hint="Аккаунты появляются автоматически из входящих обращений." />
      ) : (
        <Card title={`Всего ${rows.length}`} sub="аккаунт живёт от первого лида и не удаляется">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <Th>Название</Th><Th>Статус</Th>
                  <Th align="right">Сделок</Th><Th align="right">Подписано</Th>
                  <Th>{type === 'partner' ? 'Программа' : 'merchant_id'}</Th>
                  <Th align="right">{type === 'partner' ? 'Привёл' : 'Первый заказ'}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => {
                  const [label, tone] = LIFECYCLE[a.lifecycle] || ['—', 'gray']
                  return (
                    <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <button onClick={() => setOpenAccount(a.id)}
                          className="font-semibold text-gray-900 hover:text-blue-600 text-left">
                          {a.name}
                        </button>
                        <div className="text-[11px] text-gray-400">{a.city || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5"><Chip tone={tone}>{label}</Chip></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{a.deals}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(a.won_amount, 'UZS')}</td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {type === 'partner'
                          ? (a.program_name || <span className="text-amber-600">не задана</span>)
                          : (a.merchant_id || <span className="text-gray-300">нет</span>)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {type === 'partner' ? a.referred : fmtDate(a.first_order_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={LIMIT} count={rows.length} hasMore={hasMore} onChange={setOffset} />
        </Card>
      )}
      <Drawer
        open={!!openAccount}
        onClose={() => { setOpenAccount(null); load() }}
        title="Аккаунт"
        fullLink={openAccount ? `/sales/accounts/${openAccount}` : undefined}
      >
        {openAccount && <SalesAccountPage accountId={openAccount} />}
      </Drawer>
    </PageShell>
  )
}

export default SalesAccountsPage
