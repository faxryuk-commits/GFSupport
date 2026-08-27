import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Btn } from './kit'
import { formatDateTimeShort } from '@/shared/lib/time'

/**
 * ТЗ на подключение — собирается по ходу продажи, а не в момент выигрыша.
 *
 * Выигранная сделка сама заводит проект в «Подключениях», но приезжал он
 * пустым: список задач есть, а чем клиент пользуется — нет. Инженер выяснял
 * звонком то, что клиент неделю назад рассказал сейлзу.
 *
 * Спрашивать всё это на финише бесполезно: там сейлз хочет закрыть сделку и
 * идти дальше, и форма заполняется словом «уточним». Поэтому карточка стоит
 * в сделке и наполняется по ходу разговоров, а выигрыш только проверяет,
 * что главное выяснено.
 */

interface Task {
  id: string
  label: string
  group: string | null
  category: string | null
  options: Array<{ id: string; label: string }>
}

interface SpecData {
  tasks: Task[]
  spec: { selections: Record<string, string[]>; note: string | null }
  updatedAt: string | null
  updatedBy: string | null
  hints: { pos: string | null; aggregators: string | null; delivery: string | null }
}

export function SpecCard({ dealId }: { dealId: string }) {
  const [data, setData] = useState<SpecData | null>(null)
  const [sel, setSel] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  // Свёрнуто по умолчанию: карточка сделки и так длинная, а разворачивают
  // ТЗ не каждый раз — обычно когда собирают КП
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<SpecData>(`/sales/spec?dealId=${dealId}`, false)
      .then(d => {
        setData(d)
        setSel(d.spec?.selections || {})
        setNote(d.spec?.note || '')
        setDirty(false)
      })
      .catch(e => setError(e?.message || 'Не удалось загрузить ТЗ'))
  }, [dealId])

  useEffect(() => { load() }, [load])

  const toggle = (taskId: string, optionId: string) => {
    setSel(s => {
      const cur = s[taskId] || []
      const next = cur.includes(optionId) ? cur.filter(x => x !== optionId) : [...cur, optionId]
      const out = { ...s }
      if (next.length) out[taskId] = next
      else delete out[taskId]
      return out
    })
    setDirty(true)
  }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await apiPost('/sales/spec', { dealId, selections: sel, note: note.trim() || null })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить')
    } finally { setBusy(false) }
  }

  if (!data) return null

  const filled = Object.values(sel).filter(v => v.length).length
  const groups = new Map<string, Task[]>()
  for (const t of data.tasks) {
    const key = t.group || 'Прочее'
    groups.set(key, [...(groups.get(key) || []), t])
  }

  return (
    <Card
      title="ТЗ на подключение"
      sub={filled
        ? `заполнено блоков: ${filled} из ${data.tasks.length}`
        : 'чем клиент пользуется — это уйдёт в подключение вместе со сделкой'}
      right={
        <span className="flex items-center gap-2">
          {dirty && <Btn kind="primary" onClick={save} disabled={busy}>{busy ? '…' : 'Сохранить'}</Btn>}
          {!dirty && data.updatedBy && (
            <span className="text-[11px] text-gray-400">
              {data.updatedBy}{data.updatedAt ? ` · ${formatDateTimeShort(data.updatedAt)}` : ''}
            </span>
          )}
          <button onClick={() => setOpen(o => !o)}
            className="text-[12px] px-2.5 py-1 border border-gray-300 rounded-lg
                       hover:border-blue-500 hover:text-blue-600">
            {open ? 'Свернуть' : filled ? 'Показать' : 'Заполнить'}
          </button>
        </span>
      }
    >
      {!open ? null : (
      <>
      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {/* Подсказки из квалификации: сейлз это уже выяснил, и переспрашивать
          клиента о том же — верный способ выглядеть несобранным */}
      {(data.hints.pos || data.hints.aggregators || data.hints.delivery) && (
        <div className="px-4 pt-3 text-[11.5px] text-gray-500">
          Из квалификации:{' '}
          {[
            data.hints.pos && `касса ${data.hints.pos}`,
            data.hints.aggregators && `агрегаторы ${data.hints.aggregators}`,
            data.hints.delivery && `доставка ${data.hints.delivery}`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        {[...groups.entries()].map(([group, tasks]) => (
          <div key={group}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              {group}
            </div>
            <div className="space-y-2">
              {tasks.map(t => (
                <div key={t.id}>
                  <div className="text-[12.5px] text-gray-700 mb-1">{t.label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.options.length === 0 && (
                      <span className="text-[11.5px] text-gray-300">вариантов нет в справочнике</span>
                    )}
                    {t.options.map(o => {
                      const on = (sel[t.id] || []).includes(o.id)
                      return (
                        <button key={o.id} onClick={() => toggle(t.id, o.id)}
                          className={`text-[11.5px] px-2.5 py-1 rounded-full border transition-colors ${
                            on ? 'bg-blue-600 border-blue-600 text-white'
                               : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
            Что ещё важно знать подключению
          </div>
          <textarea
            rows={2} value={note}
            onChange={e => { setNote(e.target.value); setDirty(true) }}
            placeholder="Особенности: два юрлица, свои курьеры на части точек, запуск после ремонта…"
            className="w-full text-[12.5px] px-3 py-2 border border-gray-200 rounded-lg
                       focus:outline-none focus:border-blue-400 resize-y"
          />
        </div>
      </div>
      </>
      )}
    </Card>
  )
}
