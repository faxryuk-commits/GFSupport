import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, apiDelete } from '@/shared/services/api.service'
import { Card, Btn } from './kit'
import { formatDateTimeShort } from '@/shared/lib/time'

/**
 * История касаний: звонки, встречи, заметки — и то, что пишется само
 * (сообщения клиенту, решения по скидке).
 *
 * Записать итог разговора раньше было некуда: таблица активностей была, но
 * её никто не читал и заполнить руками было нечем. Это и есть та половина
 * работы менеджера, ради которой держали Amo.
 */

type Activity = {
  id: string; type: string; direction: string | null; result: string | null
  text: string | null; agent_id: string | null; agent_name: string | null
  happened_at: string
  /** Запись пришла из АТС — её нельзя убрать руками, она факт, а не заметка. */
  readonly?: boolean
  /** uuid звонка в АТС — по нему достаётся запись разговора. */
  record_uuid?: string | null
}

const TYPES: Array<[string, string, string]> = [
  ['call', 'Звонок', '📞'],
  ['meeting', 'Встреча', '🤝'],
  ['note', 'Заметка', '📝'],
]

/** Исходы звонка: чаще всего запись состоит из одного этого слова. */
const CALL_RESULTS = ['дозвонился', 'не дозвонился', 'перезвонить', 'отказ']

const TYPE_VIEW: Record<string, { label: string; icon: string }> = {
  call: { label: 'звонок', icon: '📞' },
  meeting: { label: 'встреча', icon: '🤝' },
  note: { label: 'заметка', icon: '📝' },
  message: { label: 'сообщение', icon: '💬' },
  approval: { label: 'решение', icon: '✅' },
}

export function ActivityCard({ dealId, accountId }: { dealId?: string; accountId?: string }) {
  const [items, setItems] = useState<Activity[]>([])
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('call')
  const [result, setResult] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Прослушивание: ссылка на mp3 подписанная и недолгая, тянем по клику
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [recBusy, setRecBusy] = useState<string | null>(null)

  const listen = async (a: Activity) => {
    if (!a.record_uuid) return
    setRecBusy(a.id)
    try {
      const r = await apiPost<{ url: string }>('/sales/call?action=record', { uuid: a.record_uuid })
      setPlaying({ id: a.id, url: r.url })
    } catch (e: any) {
      setError(e?.message || 'Запись не нашлась')
    } finally { setRecBusy(null) }
  }

  const query = dealId ? `dealId=${dealId}` : `accountId=${accountId}`

  const load = useCallback(() => {
    if (!dealId && !accountId) return
    apiGet<{ activities: Activity[] }>(`/sales/activities?${query}`, false)
      .then(r => setItems(r.activities || []))
      .catch(() => {})
  }, [query, dealId, accountId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!text.trim() && !result) return
    setBusy(true); setError(null)
    try {
      await apiPost('/sales/activities', { dealId, accountId, type, result: result || null, text })
      setText(''); setResult(''); setOpen(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось записать')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Activity) => {
    if (!confirm('Убрать запись из истории?')) return
    try {
      await apiDelete(`/sales/activities?id=${a.id}`)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось убрать запись')
    }
  }

  return (
    <Card
      title="История касаний"
      sub={items.length ? `${items.length} записей` : 'звонки, встречи и заметки по клиенту'}
      right={
        <Btn kind={open ? 'ghost' : 'primary'} onClick={() => setOpen(o => !o)}>
          {open ? 'Отмена' : '+ Записать'}
        </Btn>
      }
    >
      {open && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 space-y-2.5">
          <div className="flex gap-1.5 flex-wrap">
            {TYPES.map(([k, label, icon]) => (
              <button key={k} onClick={() => { setType(k); setResult('') }}
                className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                  type === k ? 'bg-blue-600 border-blue-600 text-white'
                             : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                {icon} {label}
              </button>
            ))}
          </div>
          {type === 'call' && (
            <div className="flex gap-1.5 flex-wrap">
              {CALL_RESULTS.map(r => (
                <button key={r} onClick={() => setResult(result === r ? '' : r)}
                  className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                    result === r ? 'bg-gray-900 border-gray-900 text-white'
                                 : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <textarea
            autoFocus value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
              if (e.key === 'Escape') setOpen(false)
            }}
            rows={2}
            placeholder={type === 'call'
              ? 'О чём договорились? Можно оставить пустым — хватит исхода'
              : type === 'meeting' ? 'Кто был, к чему пришли' : 'Что важно помнить об этом клиенте'}
            className="w-full text-[13px] px-3 py-2 border border-gray-200 rounded-lg resize-y
                       focus:outline-none focus:border-blue-400"
          />
          <div className="flex items-center gap-2">
            <Btn kind="primary" onClick={save} disabled={busy || (!text.trim() && !result)}>
              {busy ? '…' : 'Записать'}
            </Btn>
            <span className="text-[11px] text-gray-400">⌘↵ чтобы сохранить</span>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {!items.length && !open && (
        <div className="px-4 py-4 text-[12.5px] text-gray-400">
          Пока пусто. Запишите итог звонка — через месяц это единственный способ вспомнить,
          на чём остановились.
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {items.map(a => {
          const view = TYPE_VIEW[a.type] || { label: a.type, icon: '•' }
          return (
            <div key={a.id} className="px-4 py-2.5 flex gap-2.5 group">
              <span className="flex-none text-[13px] leading-5" title={view.label}>{view.icon}</span>
              <div className="min-w-0 flex-1">
                {a.result && (
                  <span className="text-[12.5px] font-medium text-gray-900">{a.result}</span>
                )}
                {a.text && (
                  <div className={`text-[12.5px] text-gray-700 whitespace-pre-wrap break-words ${a.result ? 'mt-0.5' : ''}`}>
                    {a.text}
                  </div>
                )}
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {formatDateTimeShort(a.happened_at)} · {view.label}
                  {a.agent_name ? ` · ${a.agent_name}` : ''}
                  {/* Запись есть только у состоявшихся разговоров — у недозвонов
                      АТС писать нечего */}
                  {a.record_uuid && playing?.id !== a.id && (
                    <button onClick={() => listen(a)} disabled={recBusy === a.id}
                      className="ml-2 text-emerald-700 hover:underline disabled:opacity-50">
                      {recBusy === a.id ? 'загружаю…' : '▶ запись'}
                    </button>
                  )}
                </div>
                {playing?.id === a.id && (
                  <audio controls autoPlay src={playing.url} className="mt-1.5 h-8 w-full max-w-[360px]" />
                )}
              </div>
              {!a.readonly && (
                <button onClick={() => remove(a)} title="Убрать запись"
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-red-600 flex-none">
                  убрать
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
