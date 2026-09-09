import { useMemo, useState } from 'react'
import { apiPost } from '@/shared/services/api.service'
import { optionsFor } from './refs'
import { CallPhone } from '@/shared/ui/CallPhone'

/**
 * Квалификация как разговор, а не как форма.
 *
 * Регламент отдела продаж задаёт семь вопросов в жёстком порядке и требует
 * все семь до перехода на «Квалифицирован». В карточке они лежали списком
 * полей «Город», «Точек», «Боль» — это подписи для отчёта, а не реплики
 * для звонка. Итог измерим: боль заполнена у четырёх процентов живых
 * обращений, заказы в день у двенадцати.
 *
 * Поэтому здесь вопросы написаны так, как их произносят вслух, стоят в
 * порядке регламента, а ответы выбираются в один тап из справочника
 * значений. Цель одна: заполнять быстрее, чем идёт разговор. Если сейлз
 * кладёт трубку и идёт заполнять карточку — он не заполнит её никогда.
 */

/** Вопрос регламента: как звучит вслух и в какое поле пишется. */
type Q = {
  field: string
  ask: string
  /** Короткая подпись для строки ответа. */
  label: string
  /** Свои варианты, когда справочника нет: число точек, наличие оператора. */
  own?: string[]
  multi?: boolean
  /** Можно вписать руками, если ни один вариант не подошёл. */
  free?: boolean
}

const QUESTIONS: Q[] = [
  { field: 'points', label: 'Точек', free: true,
    ask: 'В каком городе работаете и сколько у вас точек?',
    own: ['1', '2–4', '5–9', '10+'] },
  { field: 'orders_per_day', label: 'Заказов в день',
    ask: 'Сколько заказов в день в среднем по всем точкам?' },
  { field: 'pos', label: 'Касса',
    ask: 'Какую кассовую систему используете?' },
  { field: 'aggregators', label: 'Агрегаторы', multi: true,
    ask: 'С какими агрегаторами работаете?' },
  { field: 'delivery_type', label: 'Доставка',
    ask: 'Свою доставку делаете или только через агрегаторов?' },
  { field: 'dispatch', label: 'Кто ведёт заказы',
    ask: 'Все заказы и курьеры завязаны на одного человека или есть оператор?',
    own: ['один человек', 'есть оператор', 'диспетчерская'] },
  { field: 'pain', label: 'Боль', free: true, multi: true,
    ask: 'Что сейчас не устраивает в доставке? Какую задачу хотите решить?' },
]

/** Поля, без которых движок не пустит обращение в сделку. */
const GATE = new Set(['points', 'orders_per_day', 'pos', 'pain'])

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''

/**
 * Светофор профиля из регламента. Считаем по тому, что уже известно:
 * часть приходит с карт, часть из ответов. Красный виден до того, как
 * на клиента потрачен день.
 */
export function trafficLight(q: Record<string, any>, city: string | null) {
  const orders = String(q.orders_per_day || '')
  const points = parseInt(String(q.points || '0'), 10) || 0
  const pos = String(q.pos || '')
  const big = /100|300|50-100/.test(orders)
  const mid = /30-50/.test(orders)
  const small = /до 10|10-30/.test(orders)
  const hasPos = filled(pos) && !/нет кассы/i.test(pos)
  const noDelivery = /доставки нет/i.test(String(q.delivery_type || ''))

  const pro: string[] = []
  const contra: string[] = []
  if (points >= 2) pro.push(`${points} точки`)
  else if (points === 1) pro.push('1 точка')
  if (big) pro.push('50+ заказов в день')
  else if (mid) contra.push('30–50 заказов в день')
  else if (small) contra.push('меньше 30 заказов в день')
  if (hasPos) pro.push(`касса ${pos}`)
  else if (filled(pos)) contra.push('кассы нет')
  if (filled(q.pain)) pro.push('боль названа')
  if (noDelivery) contra.push('доставки нет и не планируют')
  if (city) pro.push(city)

  if (!filled(q.orders_per_day) && !filled(q.points)) {
    return { tone: 'gray' as const, label: 'не квалифицирован', pro, contra }
  }
  if (noDelivery || small) return { tone: 'red' as const, label: 'красный · не наш', pro, contra }
  if (big && points >= 1 && hasPos) return { tone: 'green' as const, label: 'зелёный · берём', pro, contra }
  return { tone: 'amber' as const, label: 'жёлтый · уточнить', pro, contra }
}

export function QualCall({ leadId, market, city, qual, refs, phone, onSaved, onQualified }: {
  leadId: string
  market: string | null
  city: string | null
  qual: Record<string, any>
  refs: any
  /** Звонок начинается здесь же: иначе блок живёт отдельно от разговора. */
  phone?: string | null
  onSaved: () => void
  /** Семь из семи — предлагаем следующий шаг прямо в блоке. */
  onQualified?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [free, setFree] = useState<{ field: string; value: string } | null>(null)
  const [err, setErr] = useState('')

  const done = QUESTIONS.filter(q => filled(qual[q.field])).length
  const missing = QUESTIONS.filter(q => GATE.has(q.field) && !filled(qual[q.field]))
  const light = useMemo(() => trafficLight(qual, city), [qual, city])

  const save = async (field: string, value: string) => {
    setBusy(field); setErr('')
    try {
      await apiPost('/sales/leads?action=qual', { leadId, fields: { [field]: value } })
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'не сохранилось')
    } finally { setBusy(null) }
  }

  /** Мультивыбор дописывает значение к уже отмеченным, повтор снимает. */
  const toggle = (q: Q, value: string) => {
    const cur = String(qual[q.field] || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!q.multi) return save(q.field, cur[0] === value ? '' : value)
    const next = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value]
    return save(q.field, next.join(', '))
  }

  const tone = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-500 border-gray-200',
  }[light.tone]

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <h3 className="text-[13px] font-semibold text-gray-900">Квал-звонок</h3>
        <span className={`text-[10.5px] font-semibold border rounded-full px-2 py-px ${tone}`}>{light.label}</span>
        <span className="ml-auto text-[11.5px] text-gray-500 tabular-nums">{done} из {QUESTIONS.length}</span>
        {phone && (
          <CallPhone phone={phone} market={market} leadId={leadId} size="sm" channels />
        )}
      </header>
      <div className="px-4 py-1.5 border-b border-gray-100 text-[11px] text-gray-500">
        Звоните отсюда и задавайте вопросы по порядку. Ответ в один тап, сохраняется сразу —
        заполнять после разговора не нужно.
      </div>

      <div className="h-1 bg-gray-100">
        <div className="h-full bg-blue-500 transition-all"
          style={{ width: `${Math.round((done / QUESTIONS.length) * 100)}%` }} />
      </div>

      {(light.pro.length > 0 || light.contra.length > 0) && (
        <div className="px-4 py-1.5 border-b border-gray-100 text-[11px] flex gap-3 flex-wrap">
          {light.pro.length > 0 && <span className="text-emerald-700">за: {light.pro.join(' · ')}</span>}
          {light.contra.length > 0 && <span className="text-amber-700">против: {light.contra.join(' · ')}</span>}
        </div>
      )}

      {err && <div className="px-4 py-1.5 text-[11.5px] text-red-600">{err}</div>}

      <div>
        {QUESTIONS.map((q, i) => {
          const value = String(qual[q.field] ?? '')
          const chosen = value.split(',').map(s => s.trim()).filter(Boolean)
          const opts = q.own || optionsFor(refs, q.field, market)
          const ok = filled(value)
          return (
            <div key={q.field}
              className={`px-4 py-2.5 border-b border-gray-50 last:border-0 ${ok ? 'bg-emerald-50/30' : ''}`}>
              <div className="text-[12.5px] text-gray-900 mb-1.5">
                <span className="text-[11px] font-semibold text-gray-400 mr-2">{i + 1}</span>
                {q.ask}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {opts.slice(0, 12).map((o: string) => {
                  const on = chosen.includes(o)
                  return (
                    <button key={o} onClick={() => toggle(q, o)} disabled={busy === q.field}
                      className={`px-2.5 py-1 rounded-full text-[11.5px] border transition disabled:opacity-40 ${
                        on ? 'bg-blue-500 text-white border-blue-500 font-semibold'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                      {o}
                    </button>
                  )
                })}
                {q.free && (
                  free?.field === q.field ? (
                    <input
                      autoFocus
                      value={free.value}
                      onChange={e => setFree({ field: q.field, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { save(q.field, free.value.trim()); setFree(null) }
                        if (e.key === 'Escape') setFree(null)
                      }}
                      onBlur={() => setFree(null)}
                      placeholder="своими словами"
                      className="border border-blue-300 rounded-full px-3 py-1 text-[11.5px] w-56" />
                  ) : (
                    <button onClick={() => setFree({ field: q.field, value: '' })}
                      className="px-2.5 py-1 rounded-full text-[11.5px] border border-dashed border-gray-300 text-gray-500 hover:border-blue-300">
                      вписать
                    </button>
                  )
                )}
              </div>
              {ok && !opts.includes(value) && (
                <div className="mt-1 text-[11.5px] text-gray-700">{value}</div>
              )}
            </div>
          )
        })}
      </div>

      {missing.length > 0 ? (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-[11.5px] text-amber-800">
          До этапа «Квалифицирован» не хватает: {missing.map(m => m.label.toLowerCase()).join(', ')}
        </div>
      ) : (
        <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-emerald-800">
            Всё собрано. {light.tone === 'red'
              ? 'Но профиль красный — по регламенту такого клиента в работу не берём.'
              : 'Можно заводить сделку и назначать демо.'}
          </span>
          {onQualified && light.tone !== 'red' && (
            <button onClick={onQualified}
              className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold">
              В сделку
            </button>
          )}
        </div>
      )}
    </section>
  )
}
