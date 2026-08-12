import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/shared/services/api.service'

/**
 * Конструктор КП: позиции берутся из прайса в валюте территории сделки.
 *
 * Количество подставляется по единице тарификации — «за точку» это филиалы из
 * квалификации, «за сервис» и «за киоск» сейлз указывает сам. Итог разложен на
 * три суммы: ежемесячный платёж, разовые работы и депозит. Смешивать их нельзя,
 * клиент никогда не заплатит их одной суммой.
 */

interface CatalogItem {
  key: string
  name: string
  description: string | null
  category: string
  unit: string | null
  unitKind: string
  recurring: string
  price: number | null
  includedOrders: number | null
  extraOrderPrice: number | null
  available: boolean
}

interface Selected {
  key: string
  qty: number
  custom?: boolean
  title?: string
  price?: number
  scope?: string
  recurring?: string
}

const CATEGORY_LABEL: Record<string, string> = {
  plan: 'Тарифы',
  integration: 'Интеграции',
  module: 'Модули',
  deposit: 'Депозиты',
  custom: 'Работы по оценке',
}

const UNIT_HINT: Record<string, string> = {
  per_point: 'за точку',
  per_service: 'за сервис',
  per_kiosk: 'за устройство',
  per_brand: 'за бренд',
  flat: '',
}

export function QuoteBuilder({ deal, onClose, onDone }: {
  deal: any
  onClose: () => void
  onDone: () => void
}) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [currency, setCurrency] = useState('UZS')
  const [selected, setSelected] = useState<Selected[]>(Array.isArray(deal.items) ? deal.items : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState({ title: '', price: '', scope: '' })

  useEffect(() => {
    apiGet<{ items: CatalogItem[]; currency: string }>(
      `/sales/catalog?market=${deal.market_id || 'uz'}`, false)
      .then(d => { setItems(d.items || []); setCurrency(d.currency || 'UZS') })
      .catch(e => setError(e?.message || 'Не удалось загрузить прайс'))
  }, [deal.market_id])

  const defaultQty = (it: CatalogItem) =>
    it.unitKind === 'per_point' ? Number(deal.points || 1) : 1

  const toggle = (it: CatalogItem) => {
    setSelected(prev => prev.some(s => s.key === it.key)
      ? prev.filter(s => s.key !== it.key)
      : [...prev, { key: it.key, qty: defaultQty(it) }])
  }

  const setQty = (key: string, qty: number) =>
    setSelected(prev => prev.map(s => s.key === key ? { ...s, qty: Math.max(1, qty) } : s))

  const totals = useMemo(() => {
    let monthly = 0, onetime = 0, deposit = 0
    const conditions: string[] = []
    for (const s of selected) {
      if (s.custom) {
        onetime += Number(s.price || 0) * (s.qty || 1)
        if (s.scope) conditions.push(`${s.title}: ${s.scope}`)
        continue
      }
      const it = items.find(i => i.key === s.key)
      if (!it || it.price === null) continue
      const sum = it.price * (s.qty || 1)
      if (it.category === 'deposit') deposit += sum
      else if (it.recurring === 'one-time') onetime += sum
      else monthly += sum
      if (it.includedOrders && it.extraOrderPrice !== null) {
        conditions.push(
          `${it.name}: включено ${it.includedOrders.toLocaleString('ru-RU')} заказов в месяц, ` +
          `сверх пакета — ${it.extraOrderPrice.toLocaleString('ru-RU')} ${currency} за заказ`)
      }
      if (it.category === 'deposit') {
        conditions.push(`${it.name}: расходуется помесячно в счёт оплаты, в ежемесячный платёж не входит`)
      }
    }
    return { monthly, onetime, deposit, conditions }
  }, [selected, items, currency])

  const save = async () => {
    setBusy(true)
    try {
      // Позиции живут на сделке: из них собирается КП и считается прогноз
      await apiPatch('/sales/deal', {
        id: deal.id,
        fields: { items: selected, monthly_amount: totals.monthly, onetime_amount: totals.onetime },
      })
      await apiPost('/sales/documents', { dealId: deal.id, kind: 'quote' })
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Не удалось собрать КП')
    } finally {
      setBusy(false)
    }
  }

  const byCategory = ['plan', 'integration', 'module', 'deposit', 'custom']
    .map(cat => ({ cat, list: items.filter(i => i.category === cat && i.available) }))
    .filter(g => g.list.length)

  const fmt = (v: number) => `${v.toLocaleString('ru-RU')} ${currency}`

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-start gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Собрать коммерческое предложение</h3>
            <p className="text-[11.5px] text-gray-400 mt-0.5">
              Цены в валюте территории · {currency}
              {deal.points ? ` · количество «за точку» подставлено: ${deal.points}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 text-[14px]">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}

          {byCategory.map(({ cat, list }) => (
            <div key={cat}>
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                {CATEGORY_LABEL[cat] || cat}
              </div>
              <div className="space-y-1.5">
                {list.map(it => {
                  const sel = selected.find(s => s.key === it.key)
                  return (
                    <div key={it.key}
                      className={`border rounded-lg px-3 py-2.5 flex items-start gap-3 ${
                        sel ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'}`}>
                      <button onClick={() => toggle(it)}
                        className={`w-4 h-4 rounded border flex-none mt-0.5 grid place-items-center text-[9px] ${
                          sel ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 text-transparent'}`}>
                        ✓
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium text-gray-900">{it.name}</div>
                        {it.description && <div className="text-[11px] text-gray-400">{it.description}</div>}
                      </div>
                      {sel && (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={1} value={sel.qty}
                            onChange={e => setQty(it.key, Number(e.target.value))}
                            className="w-14 border border-gray-300 rounded-md px-1.5 py-1 text-[12px] text-right" />
                          <span className="text-[10.5px] text-gray-400 w-16">{UNIT_HINT[it.unitKind] || it.unit}</span>
                        </div>
                      )}
                      <div className="text-[12.5px] text-gray-700 tabular-nums whitespace-nowrap w-28 text-right">
                        {it.price !== null ? fmt(it.price) : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Свободная позиция</span>
              <button onClick={() => setCustomOpen(v => !v)} className="text-[12px] text-blue-600 hover:underline">
                {customOpen ? 'Свернуть' : '+ Установка, интеграция, доработка'}
              </button>
            </div>
            {customOpen && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <input placeholder="Название работ, например «Интеграция с 1С»"
                  value={custom.title} onChange={e => setCustom({ ...custom, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-[12.5px]" />
                <input placeholder="Стоимость по оценке" value={custom.price}
                  onChange={e => setCustom({ ...custom, price: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-[12.5px]" />
                <textarea placeholder="Что входит в объём: попадёт в условия предложения" rows={2}
                  value={custom.scope} onChange={e => setCustom({ ...custom, scope: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-[12.5px]" />
                <button
                  disabled={!custom.title || !custom.price}
                  onClick={() => {
                    setSelected(prev => [...prev, {
                      key: `custom_${Date.now()}`, custom: true, qty: 1,
                      title: custom.title, price: Number(custom.price), scope: custom.scope,
                      recurring: 'one-time',
                    }])
                    setCustom({ title: '', price: '', scope: '' })
                    setCustomOpen(false)
                  }}
                  className="text-[12.5px] px-3 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-40">
                  Добавить в предложение
                </button>
              </div>
            )}
            {selected.filter(s => s.custom).map(s => (
              <div key={s.key} className="mt-2 border border-blue-200 bg-blue-50/40 rounded-lg px-3 py-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-[12.5px] text-gray-900">{s.title}</div>
                  {s.scope && <div className="text-[11px] text-gray-400">{s.scope}</div>}
                </div>
                <div className="text-[12.5px] tabular-nums">{fmt(Number(s.price || 0))}</div>
                <button onClick={() => setSelected(prev => prev.filter(x => x.key !== s.key))}
                  className="text-[11px] text-gray-400 hover:text-red-600">убрать</button>
              </div>
            ))}
          </div>

          {totals.conditions.length > 0 && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Условия попадут в предложение
              </div>
              <ul className="space-y-1">
                {totals.conditions.map((c, i) => (
                  <li key={i} className="text-[11.5px] text-gray-600">— {c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-5 text-[12px]">
            <div>
              <div className="text-gray-400">Ежемесячно</div>
              <div className="text-[15px] font-semibold text-gray-900 tabular-nums">{fmt(totals.monthly)}</div>
            </div>
            {totals.onetime > 0 && (
              <div>
                <div className="text-gray-400">Разово</div>
                <div className="text-[15px] font-medium text-gray-700 tabular-nums">{fmt(totals.onetime)}</div>
              </div>
            )}
            {totals.deposit > 0 && (
              <div>
                <div className="text-gray-400">Депозит</div>
                <div className="text-[15px] font-medium text-gray-700 tabular-nums">{fmt(totals.deposit)}</div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg">Отмена</button>
            <button onClick={save} disabled={busy || !selected.length}
              className="text-[12.5px] px-3 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-40">
              {busy ? 'Собираем…' : 'Собрать КП'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default QuoteBuilder
