import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPut, apiPost, apiDelete } from '@/shared/services/api.service'
import { Card, Chip, Tabs, money, PageShell } from './kit'
import { REGION_NAMES } from './region'

/**
 * Справочники продаж — здесь живёт движок.
 *
 * Обязательные поля этапа, каденция, нормативы, причины отказа со сроком
 * возврата и прайс правятся строкой в таблице, а не константой в коде: правило
 * меняется без деплоя.
 */

const TABS: Array<[string, string]> = [
  ['stages', 'Этапы'],
  ['reasons', 'Причины отказа'],
  ['sources', 'Источники'],
  ['prices', 'Прайс'],
  ['options', 'Значения полей'],
]

export function SalesSettingsPage() {
  const [tab, setTab] = useState('stages')
  // Воронка = регион: этапы, нормативы и каденции у каждой страны свои,
  // плюс общая (для сделок без территории) и партнёрская
  const [pipeline, setPipeline] = useState('sales')
  const [refs, setRefs] = useState<any>(null)
  const [catalog, setCatalog] = useState<any>(null)
  const [market, setMarket] = useState('uz')
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null)
  // Списки значений полей: город, касса, тип доставки, тариф
  const OPTION_FIELDS: Array<[string, string]> = [
    ['city', 'Город'], ['pos', 'POS-система'], ['delivery_type', 'Тип доставки'],
    ['aggregators', 'Агрегаторы'], ['orders_per_day', 'Заказов в день'], ['tariff', 'Тариф'],
  ]
  const [optField, setOptField] = useState('city')
  const [newOption, setNewOption] = useState('')

  const load = useCallback(() => {
    apiGet<any>('/sales/refs', false).then(setRefs).catch(e => setError(e?.message || 'Ошибка загрузки'))
    apiGet<any>(`/sales/catalog?market=${market}`, false).then(setCatalog).catch(() => {})
  }, [market])

  useEffect(() => { load() }, [load])

  const addOption = async () => {
    const value = newOption.trim()
    if (!value) return
    try {
      // Город привязан к региону: список Узбекистана не должен подсказывать Алматы
      await apiPost('/sales/refs', {
        kind: 'option', field: optField, value,
        market: optField === 'city' ? market : null,
      })
      setNewOption('')
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось добавить значение')
    }
  }

  const removeOption = async (id: string, label: string) => {
    if (!confirm(`Убрать «${label}» из списка? В уже заполненных сделках значение останется.`)) return
    try {
      await apiDelete(`/sales/refs?kind=option&id=${id}`)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось убрать значение')
    }
  }

  const savePrice = async (key: string, value: string) => {
    try {
      await apiPut('/sales/catalog', { key, prices: { [catalog.currency]: Number(value) } })
      setEdit(null)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить цену')
    }
  }

  if (error && !refs) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!refs) return <div className="p-6 text-sm text-gray-400">Загружаем справочники…</div>

  return (
    <PageShell header={
      <div>
        <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Справочники продаж</h1>
        <p className="text-[12.5px] text-gray-500 mt-0.5">
          Правила движка: обязательные поля этапа, каденции, нормативы, причины отказа и цены
        </p>
      </div>
    }>

      <div className="bg-white border border-gray-200 rounded-xl">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'stages' && (
        <Card
          title="Этапы воронки"
          sub="у каждого региона своя воронка: нормативы и каденции настраиваются под страну"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <select value={pipeline} onChange={e => setPipeline(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12px]">
                <optgroup label="Продажи">
                  <option value="sales">Общая воронка</option>
                  {Object.entries(REGION_NAMES).map(([code, name]) => (
                    <option key={code} value={`sales_${code}`}>{name}</option>
                  ))}
                </optgroup>
                <optgroup label="Прочее">
                  <option value="partner">Партнёры</option>
                </optgroup>
              </select>
              <span className="text-[11.5px] text-gray-400">
                {(refs.stages || []).filter((s: any) => (s.pipeline || 'sales') === pipeline).length} этапов
              </span>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Этап</th>
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Владелец</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Норматив</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Вероятн.</th>
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Обязательные поля</th>
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Каденция</th>
                </tr>
              </thead>
              <tbody>
                {(refs.stages || []).filter((s: any) => (s.pipeline || 'sales') === pipeline).map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-100 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{s.label}</div>
                      <div className="text-[11px] text-gray-400">{s.key} · {s.kind}</div>
                    </td>
                    <td className="px-4 py-2.5 uppercase text-gray-600">{s.owner_role}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {s.sla_hours ? (Number(s.sla_hours) < 1
                        ? `${Math.round(Number(s.sla_hours) * 60)} мин`
                        : `${Math.round(Number(s.sla_hours) / 24) || 1} дн`) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.probability}%</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(s.required_fields || []).length === 0
                          ? <span className="text-gray-300">—</span>
                          : s.required_fields.map((f: string) => <Chip key={f} tone="blue">{f}</Chip>)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {(s.cadence || []).length === 0
                        ? <span className="text-gray-300">—</span>
                        : (s.cadence || []).map((c: any, i: number) => (
                          <div key={i} className="text-[11.5px] text-gray-600">
                            день {c.day}: {c.title}
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-gray-400 border-t border-gray-100">
            Пока поле в списке обязательных — сделка не уйдёт дальше этого этапа. Это и есть движок.
          </div>
        </Card>
      )}

      {tab === 'reasons' && (
        <Card title="Причины отказа" sub="срок возврата запускает реактивацию автоматически">
          <div className="divide-y divide-gray-100">
            {(refs.reasons || []).map((r: any) => (
              <div key={r.id} className="px-4 py-2.5 flex justify-between items-center gap-3">
                <div>
                  <div className="text-[12.5px] text-gray-900">{r.label}</div>
                  <div className="text-[11px] text-gray-400">{r.code}</div>
                </div>
                <Chip tone={r.reactivate_days ? 'blue' : 'gray'}>
                  {r.reactivate_days ? `вернётся через ${r.reactivate_days} дн` : 'не возвращаемся'}
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'sources' && (
        <Card title="Источники лидов" sub="источник обязателен: без него конверсия по каналам не считается">
          <div className="divide-y divide-gray-100">
            {(refs.sources || []).map((s: any) => (
              <div key={s.id} className="px-4 py-2.5 flex justify-between items-center gap-3">
                <div>
                  <div className="text-[12.5px] text-gray-900">{s.label}</div>
                  <div className="text-[11px] text-gray-400">{s.key}</div>
                </div>
                <Chip tone={s.kind === 'paid' ? 'amber' : s.kind === 'referral' ? 'violet' : 'gray'}>
                  {s.kind}
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'options' && (
        <Card
          title="Значения полей"
          sub="списки, из которых выбирают в карточке сделки: одно написание вместо трёх"
          right={
            <div className="flex items-center gap-2">
              <select value={optField} onChange={e => setOptField(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12px]">
                {OPTION_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {optField === 'city' && (
                <select value={market} onChange={e => setMarket(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12px]">
                  {(catalog?.markets || []).map((m: any) => (
                    <option key={m.market_id} value={m.market_id}>{m.market_id.toUpperCase()}</option>
                  ))}
                </select>
              )}
            </div>
          }
        >
          <div className="divide-y divide-gray-100">
            {(refs.options || [])
              .filter((o: any) => o.field === optField)
              .filter((o: any) => optField !== 'city' || o.market_id === market)
              .map((o: any) => (
                <div key={o.id} className="px-4 py-2 flex justify-between items-center gap-3">
                  <span className="text-[12.5px] text-gray-900">{o.label}</span>
                  <button onClick={() => removeOption(o.id, o.label)}
                    className="text-[11.5px] text-gray-400 hover:text-red-600">
                    убрать
                  </button>
                </div>
              ))}
            {(refs.options || []).filter((o: any) => o.field === optField
                && (optField !== 'city' || o.market_id === market)).length === 0 && (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">
                Список пуст — значения можно вводить свободно.
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <input value={newOption} onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addOption() }}
              placeholder="Новое значение"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-[12.5px] flex-1 max-w-xs" />
            <button onClick={addOption}
              className="text-[12.5px] px-3 py-1.5 bg-blue-600 text-white rounded-lg">
              Добавить
            </button>
          </div>
          <div className="px-4 pb-3 text-[11.5px] text-gray-400">
            Список подсказывает норму написания, но не запрещает вписать своё: жизнь богаче справочника.
          </div>
        </Card>
      )}

      {tab === 'prices' && catalog && (
        <Card
          title="Прайс"
          sub={`цены в валюте территории · ${catalog.currency} · ${catalog.legalEntity || ''}`}
          right={
            <select value={market} onChange={e => setMarket(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-[12px]">
              {(catalog.markets || []).map((m: any) => (
                <option key={m.market_id} value={m.market_id}>
                  {m.market_id.toUpperCase()} · {m.currency}
                </option>
              ))}
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Позиция</th>
                  <th className="text-left font-semibold px-4 py-2 sticky top-0 bg-white z-10">Тарификация</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Включено заказов</th>
                  <th className="text-right font-semibold px-4 py-2 sticky top-0 bg-white z-10">Цена</th>
                </tr>
              </thead>
              <tbody>
                {(catalog.items || []).map((it: any) => {
                  // Сужаем тип заранее: внутри JSX TypeScript теряет проверку на null
                  const editing = edit && edit.key === it.key ? edit : null
                  return (
                  <tr key={it.key} className="border-b border-gray-100">
                    <td className="px-4 py-2.5">
                      <div className="text-gray-900">{it.name}</div>
                      <div className="text-[11px] text-gray-400">{it.description}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip tone={it.recurring === 'monthly' ? 'blue' : it.recurring === 'deposit' ? 'violet' : 'gray'}>
                        {it.unitKind === 'per_point' ? 'за точку'
                          : it.unitKind === 'per_service' ? 'за сервис'
                          : it.unitKind === 'per_kiosk' ? 'за устройство'
                          : it.unitKind === 'per_brand' ? 'за бренд' : 'за подключение'}
                      </Chip>
                      <div className="text-[11px] text-gray-400 mt-0.5">{it.unit}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {it.includedOrders
                        ? <>
                            {it.includedOrders.toLocaleString('ru-RU')}
                            <div className="text-[11px] text-gray-400">
                              сверх: {money(it.extraOrderPrice, catalog.currency)}
                            </div>
                          </>
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {editing ? (
                        <input autoFocus value={editing.value}
                          onChange={e => setEdit({ key: it.key, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') savePrice(it.key, (e.target as HTMLInputElement).value)
                          }}
                          onBlur={e => savePrice(it.key, e.target.value)}
                          className="w-32 border border-blue-400 rounded-md px-2 py-1 text-[12.5px] text-right" />
                      ) : (
                        <button onClick={() => setEdit({ key: it.key, value: String(it.price ?? '') })}
                          className="tabular-nums text-gray-900 hover:text-blue-600">
                          {money(it.price, catalog.currency)}
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-gray-400 border-t border-gray-100">
            Правка меняет цену только в выбранной валюте — в остальных регионах она останется прежней.
          </div>
        </Card>
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

export default SalesSettingsPage
