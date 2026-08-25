import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiGet, apiPut, apiPost, apiDelete } from '@/shared/services/api.service'
import { Card, Chip, Tabs, money, PageShell, Skeleton } from './kit'
import { REGION_NAMES } from './region'

/**
 * Справочники продаж — здесь живёт движок.
 *
 * Обязательные поля этапа, каденция, нормативы, причины отказа со сроком
 * возврата и прайс правятся строкой в таблице, а не константой в коде: правило
 * меняется без деплоя.
 */

const TABS: Array<[string, string]> = [
  ['pipelines', 'Воронки'],
  ['stages', 'Этапы'],
  ['reasons', 'Причины отказа'],
  ['sources', 'Источники'],
  ['prices', 'Прайс'],
  ['options', 'Значения полей'],
  ['entities', 'Наши реквизиты'],
  ['amo', 'Мост Amo'],
]

/**
 * Режимы моста с Amo — предохранитель перехода команды на свою CRM.
 * Формулировки здесь важнее кода: переключая режим, руководитель решает,
 * чья работа считается истиной, и должен видеть последствие до клика.
 */
const AMO_MODES: Array<{ key: string; title: string; what: string; effect: string }> = [
  {
    key: 'full',
    title: 'Полный',
    what: 'Приезжают лиды, этапы Amo переносятся к нам.',
    effect: 'Истина в Amo. Работа команды в GFSupport затирается при следующем проходе.',
  },
  {
    key: 'leads_only',
    title: 'Только новые лиды',
    what: 'Приезжают новые заявки, но заведённые записи мост не трогает.',
    effect: 'Истина у нас. Команда работает здесь, поток заявок с рекламы ещё идёт через Amo.',
  },
  {
    key: 'off',
    title: 'Выключен',
    what: 'Мост молчит.',
    effect: 'Заявки должны приходить своим приёмником — иначе поток с рекламы оборвётся.',
  },
]

/** Наша сторона договора: то, что шаблон подставляет как «Лицензиар». */
const ENTITY_FIELDS: Array<[string, string]> = [
  ['name', 'Название'],
  ['legal_name', 'Юридическое название'],
  ['tax_code', 'ИНН / БИН'],
  ['legal_address', 'Юридический адрес'],
  ['bank_name', 'Банк'],
  ['bank_code', 'МФО / БИК'],
  ['bank_account', 'Расчётный счёт'],
  ['signer_name', 'Подписант'],
  ['signer_title', 'Должность подписанта'],
  ['signer_basis', 'Действует на основании'],
]

export function SalesSettingsPage() {
  const [tab, setTab] = useState('stages')
  // Воронка = регион: этапы, нормативы и каденции у каждой страны свои,
  // плюс общая (для сделок без территории) и партнёрская
  const [pipeline, setPipeline] = useState('sales')
  const [refs, setRefs] = useState<any>(null)
  const [catalog, setCatalog] = useState<any>(null)
  const [entities, setEntities] = useState<any[] | null>(null)
  const [market, setMarket] = useState('uz')
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null)
  // Списки значений полей: город, касса, тип доставки, тариф
  const OPTION_FIELDS: Array<[string, string]> = [
    ['country', 'Страна'], ['city', 'Город'], ['segment', 'Тип заведения'],
    ['pos', 'POS-система'], ['delivery_type', 'Тип доставки'], ['aggregators', 'Агрегаторы'],
    ['orders_per_day', 'Заказов в день'], ['pain', 'Боль клиента'], ['dm_role', 'Роль ЛПР'],
    ['tariff', 'Тариф'], ['products', 'Продукты и модули'], ['currency', 'Валюта'],
    ['term_months', 'Срок, мес'], ['discount_pct', 'Скидка, %'],
    ['partner_kind', 'Тип партнёра'], ['vendor', 'Поставщики и подрядчики'],
  ]
  const [optField, setOptField] = useState('city')
  const [newOption, setNewOption] = useState('')
  const [amo, setAmo] = useState<any>(null)
  const [amoBusy, setAmoBusy] = useState(false)
  const [recon, setRecon] = useState<Recon | null>(null)

  const load = useCallback(() => {
    apiGet<any>('/sales/refs', false).then(setRefs).catch(e => setError(e?.message || 'Ошибка загрузки'))
    apiGet<any>(`/sales/catalog?market=${market}`, false).then(setCatalog).catch(() => {})
    apiGet<any>('/sales/legal-entity', false).then(d => setEntities(d.entities)).catch(() => {})
    apiGet<any>('/sales/amo', false).then(setAmo).catch(() => {})
  }, [market])

  /**
   * Смена режима моста. Спрашиваем подтверждение с последствием в тексте:
   * это решение о том, чья работа считается истиной, а не настройка вида.
   */
  const setAmoMode = async (mode: string) => {
    const m = AMO_MODES.find(x => x.key === mode)
    if (!m || !confirm(`Переключить мост в режим «${m.title}»?\n\n${m.effect}`)) return
    setAmoBusy(true)
    try {
      await apiPost('/sales/amo', { mode })
      const d = await apiGet<any>('/sales/amo', false)
      setAmo(d)
    } catch (e: any) {
      setError(e?.message || 'Не удалось переключить режим')
    } finally {
      setAmoBusy(false)
    }
  }

  useEffect(() => { load() }, [load])

  /**
   * Реквизиты сохраняем по уходу из поля, без кнопки «Сохранить»: их правят
   * раз в год, и лишний шаг здесь означает забытую половину формы.
   */
  const saveEntity = async (marketId: string, field: string, value: string) => {
    const current = entities?.find(e => e.market_id === marketId)
    if ((current?.[field] || '') === value) return
    try {
      await apiPut('/sales/legal-entity', { market_id: marketId, [field]: value })
      const d = await apiGet<any>('/sales/legal-entity', false)
      setEntities(d.entities)
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить реквизиты')
    }
  }

  /**
   * Сверка идёт страницами: сколько сделок в Amo, заранее неизвестно, а один
   * запрос «за всё сразу» упёрся бы в лимит функции. Страницы заказываем
   * отсюда и складываем результат — заодно видно, что сверка идёт, а не висит.
   */
  const runReconcile = async () => {
    const acc: Recon = { running: true, page: 0, seen: 0, checked: 0, missing: [], noDeal: [], stageDiff: [] }
    setRecon({ ...acc })
    for (let page = 1; page <= 200; page++) {
      let r: any
      try {
        r = await apiGet<any>(`/sales/amo?action=reconcile&page=${page}`, false)
      } catch (e: any) {
        setRecon({ ...acc, running: false, error: e?.message || 'Сверка прервалась' })
        return
      }
      acc.page = page
      acc.seen += r.seen || 0
      acc.checked += r.checked || 0
      acc.missing.push(...(r.missing || []))
      acc.noDeal.push(...(r.noDeal || []))
      acc.stageDiff.push(...(r.stageDiff || []))
      setRecon({ ...acc, missing: [...acc.missing], noDeal: [...acc.noDeal], stageDiff: [...acc.stageDiff] })
      if (!r.hasMore) break
    }
    setRecon({ ...acc, running: false, done: true })
  }

  const addPipeline = async () => {
    const label = prompt('Название воронки (например «Партнёрские внедрения»):')
    if (!label) return
    const key = prompt('Ключ латиницей (например partner_impl):', 
      label.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    if (!key) return
    const copyFrom = prompt('С какой воронки скопировать этапы? Ключ:', 'sales') || 'sales'
    try {
      await apiPost('/sales/refs', { kind: 'pipeline', key, label, copyFrom })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось создать воронку') }
  }

  const renamePipeline = async (p: any) => {
    const label = prompt('Новое название воронки:', p.label)
    if (!label || label === p.label) return
    try {
      await apiPut('/sales/refs', { kind: 'pipeline', id: p.id, label })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось переименовать') }
  }

  const removePipeline = async (p: any) => {
    if (!confirm(`Удалить воронку «${p.label}» вместе с её этапами?`)) return
    try {
      await apiDelete(`/sales/refs?kind=pipeline&id=${p.id}`)
      load()
    } catch (e: any) {
      // Сделки нельзя оставить без воронки — спрашиваем, куда их перенести
      const moveTo = prompt(`${e?.message || ''}\n\nКлюч воронки, куда перенести сделки:`, 'sales')
      if (!moveTo) return
      try {
        await apiDelete(`/sales/refs?kind=pipeline&id=${p.id}&moveTo=${moveTo}`)
        load()
      } catch (e2: any) { setError(e2?.message || 'Не удалось удалить') }
    }
  }

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
  if (!refs) return <Skeleton rows={7} kpis={false} />

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

      {tab === 'pipelines' && (
        <Card
          title="Воронки"
          sub="у каждой свой набор этапов: регион, партнёрский процесс или отдельное направление"
          right={
            <button onClick={addPipeline}
              className="text-[12.5px] px-3 py-1.5 bg-blue-600 text-white rounded-lg">
              + Воронка
            </button>
          }
        >
          <div className="divide-y divide-gray-100">
            {(refs.pipelines || []).map((p: any) => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[13px] font-medium text-gray-900">{p.label}</div>
                  <div className="text-[11px] text-gray-400">
                    {[p.key, p.market_id ? `рынок ${p.market_id.toUpperCase()}` : null,
                      `${p.stages} этапов`, `${p.deals} сделок`].filter(Boolean).join(' · ')}
                  </div>
                  {p.description && (
                    <div className="text-[11.5px] text-gray-500 mt-0.5">{p.description}</div>
                  )}
                </div>
                <button onClick={() => { setPipeline(p.key); setTab('stages') }}
                  className="text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                  Этапы
                </button>
                <button onClick={() => renamePipeline(p)}
                  className="text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg hover:border-blue-500 hover:text-blue-600">
                  Переименовать
                </button>
                <button onClick={() => removePipeline(p)}
                  className="text-[12px] px-2.5 py-1 border border-gray-200 text-gray-400 rounded-lg hover:text-red-600 hover:border-red-200">
                  Удалить
                </button>
              </div>
            ))}
            {!(refs.pipelines || []).length && (
              <div className="px-4 py-4 text-[12.5px] text-gray-400">Воронок пока нет</div>
            )}
          </div>
          <div className="px-4 py-3 text-[11.5px] text-gray-400 border-t border-gray-100">
            Удалить воронку со сделками нельзя молча: система спросит, куда их перенести,
            и переложит по совпадающим ключам этапов.
          </div>
        </Card>
      )}

      {tab === 'stages' && (
        <Card
          title="Этапы воронки"
          sub="у каждого региона своя воронка: нормативы и каденции настраиваются под страну"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <select value={pipeline} onChange={e => setPipeline(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-[12px]">
                {(refs.pipelines || []).map((p: any) => (
                  <option key={p.id} value={p.key}>{p.label}</option>
                ))}
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

      {tab === 'entities' && (
        <Card title="Наши реквизиты"
              sub="подставляются в договор как наша сторона — по стране сделки">
          <div className="divide-y divide-gray-100">
            {(entities || []).map((e: any) => (
              <div key={e.market_id} className="p-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-gray-900">
                    {REGION_NAMES[e.market_id] || e.market_id}
                  </span>
                  {e.empty && <Chip tone="amber">не заполнено</Chip>}
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6">
                  {ENTITY_FIELDS.map(([f, label]) => (
                    <label key={f} className="flex items-center gap-2 py-1">
                      <span className="text-[11.5px] text-gray-500 w-44 flex-none">{label}</span>
                      <input
                        defaultValue={e[f] || ''}
                        onBlur={ev => saveEntity(e.market_id, f, ev.target.value)}
                        className="flex-1 min-w-0 border border-gray-200 rounded-md px-2 py-1 text-[12px]
                                   focus:border-blue-400 outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!entities?.length && (
              <div className="px-4 py-6 text-[12.5px] text-gray-400">Рынки ещё не заведены</div>
            )}
          </div>
          <div className="px-4 py-3 text-[11.5px] text-gray-400 border-t border-gray-100">
            Незаполненное поле не мешает создать договор — оно встанет прочерком, который
            видно до подписи.
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

      {tab === 'amo' && (
        <div className="space-y-4">
          <Card title="Режим моста с AmoCRM"
            sub="чья работа считается истиной — переключается без выкладки и откатывается так же">
            <div className="p-4 grid sm:grid-cols-3 gap-3">
              {AMO_MODES.map(m => {
                const active = amo?.mode === m.key
                return (
                  <button key={m.key} onClick={() => !active && setAmoMode(m.key)} disabled={amoBusy || active}
                    className={`text-left rounded-xl border p-3.5 transition ${
                      active ? 'border-blue-500 bg-blue-50 cursor-default'
                             : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[13.5px] font-semibold ${active ? 'text-blue-700' : 'text-gray-900'}`}>
                        {m.title}
                      </span>
                      {active && <Chip tone="blue">сейчас</Chip>}
                    </div>
                    <div className="text-[12px] text-gray-600 leading-snug">{m.what}</div>
                    <div className="text-[11.5px] text-gray-400 leading-snug mt-1.5">{m.effect}</div>
                  </button>
                )
              })}
            </div>
            {amo && !amo.tokenSet && (
              <div className="mx-4 mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                Доступ к Amo не настроен — мост не работает независимо от режима.
              </div>
            )}
          </Card>

          <Card title="Состояние моста" sub="по этим цифрам видно, что мост жив, даже когда в Amo тихо">
            <div className="p-4 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-[12.5px]">
              <Row label="Дочитано до">
                {amo?.cursorAt ? new Date(amo.cursorAt).toLocaleString('ru-RU') : '—'}
              </Row>
              <Row label="Последний проход">
                {amo?.lastRunAt ? new Date(amo.lastRunAt).toLocaleString('ru-RU') : '—'}
              </Row>
              <Row label="За последний проход">
                {amo?.lastRun
                  ? [amo.lastRun.created ? `новых ${amo.lastRun.created}` : '',
                     amo.lastRun.staged ? `этапов ${amo.lastRun.staged}` : '',
                     amo.lastRun.deferred ? `отложено ${amo.lastRun.deferred}` : '',
                     amo.lastRun.errors ? `ошибок ${amo.lastRun.errors}` : ''
                    ].filter(Boolean).join(' · ') || 'без изменений'
                  : '—'}
              </Row>
              <Row label="Сделки">
                <span className="tabular-nums">
                  {amo?.counts?.deals_from_amo ?? '—'} из Amo · {amo?.counts?.deals_native ?? '—'} заведены у нас
                </span>
              </Row>
              <Row label="Лиды">
                <span className="tabular-nums">
                  {amo?.counts?.leads_from_amo ?? '—'} из Amo · всего {amo?.counts?.leads_total ?? '—'}
                </span>
              </Row>
            </div>
            <div className="px-4 py-3 text-[11.5px] text-gray-400 border-t border-gray-100">
              Мост односторонний: из Amo к нам. Обратно не уходит ничего — поэтому в полном режиме
              правки в нашей CRM перезаписываются данными Amo.
            </div>
          </Card>

          <Card title="Сверка с Amo"
            sub="пропуск на переключение режима: пока расхождения есть, переезжать рано"
            right={
              <button onClick={runReconcile} disabled={recon?.running}
                className="text-[12.5px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {recon?.running ? 'Сверяем…' : 'Запустить сверку'}
              </button>
            }>
            {!recon && (
              <div className="p-4 text-[12.5px] text-gray-500">
                Сравним каждую сделку Amo с нашей базой: чего нет у нас, где завели лид, но не создали
                сделку, и где разошёлся этап. Только чтение — на Amo это никак не влияет.
              </div>
            )}
            {recon && (
              <div className="p-4 space-y-3">
                <div className="text-[12.5px] text-gray-500 tabular-nums">
                  {recon.running ? `Страница ${recon.page}, ` : 'Готово. '}
                  проверено {recon.checked} сделок наших воронок из {recon.seen} просмотренных
                </div>
                {recon.error && <div className="text-[12.5px] text-red-600">{recon.error}</div>}
                <div className="grid sm:grid-cols-3 gap-2.5">
                  <ReconTile n={recon.missing.length} label="нет у нас"
                    hint="сделка есть в Amo, а у нас ни лида, ни сделки" tone="red" />
                  <ReconTile n={recon.noDeal.length} label="лид есть, сделки нет"
                    hint="заявку приняли, но до воронки она не дошла" tone="amber" />
                  <ReconTile n={recon.stageDiff.length} label="этап разошёлся"
                    hint="сделка есть у обоих, но стоит на разных этапах" tone="amber" />
                </div>
                {recon.done && !recon.missing.length && !recon.noDeal.length && !recon.stageDiff.length && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12.5px] text-emerald-800">
                    Расхождений нет — данные полные, режим можно переключать.
                  </div>
                )}
                <ReconList title="Нет у нас" rows={recon.missing} />
                <ReconList title="Лид есть, сделки нет" rows={recon.noDeal} />
                <ReconList title="Этап разошёлся" rows={recon.stageDiff} withOurs />
              </div>
            )}
          </Card>
        </div>
      )}

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

/** Накопленный результат постраничной сверки с Amo. */
type ReconRow = {
  id: number; name: string | null; amoStatus: string | null
  amoStage: string | null; ourStage?: string; market: string | null
}
type Recon = {
  running: boolean; done?: boolean; error?: string
  page: number; seen: number; checked: number
  missing: ReconRow[]; noDeal: ReconRow[]; stageDiff: ReconRow[]
}

function ReconTile({ n, label, hint, tone }: {
  n: number; label: string; hint: string; tone: 'red' | 'amber'
}) {
  const ok = n === 0
  const color = ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'red' ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${color}`} title={hint}>
      <div className="text-[19px] font-semibold tabular-nums leading-none">{n}</div>
      <div className="text-[11.5px] mt-1">{label}</div>
    </div>
  )
}

/** Список расхождений: показываем первые, остальное считаем — таблица на тысячу строк не помогает. */
function ReconList({ title, rows, withOurs }: { title: string; rows: ReconRow[]; withOurs?: boolean }) {
  if (!rows.length) return null
  const shown = rows.slice(0, 40)
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[11.5px] font-semibold text-gray-600">
        {title} · {rows.length}
      </div>
      <div className="divide-y divide-gray-100">
        {shown.map(r => (
          <div key={r.id} className="px-3 py-2 flex items-center gap-2.5 text-[12px]">
            <span className="text-gray-400 tabular-nums flex-none">{r.id}</span>
            <span className="text-gray-900 truncate flex-1 min-w-0">{r.name || 'без названия'}</span>
            {r.market && <span className="text-gray-400 flex-none uppercase">{r.market}</span>}
            <span className="text-gray-500 flex-none">
              {withOurs ? `у нас ${r.ourStage} · в Amo ${r.amoStage}` : (r.amoStatus || r.amoStage || '')}
            </span>
          </div>
        ))}
      </div>
      {rows.length > shown.length && (
        <div className="px-3 py-2 text-[11.5px] text-gray-400 border-t border-gray-100">
          и ещё {rows.length - shown.length} — показаны первые {shown.length}
        </div>
      )}
    </div>
  )
}

/** Строка «подпись — значение» в сводках этой страницы. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-gray-400 flex-none">{label}</span>
      <span className="h-px flex-1 bg-gray-100" />
      <span className="text-gray-900 text-right min-w-0 truncate">{children}</span>
    </div>
  )
}

export default SalesSettingsPage
