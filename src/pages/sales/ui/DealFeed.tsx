import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { fmtDateTime } from './kit'
import { useAuth } from '@/shared/hooks/useAuth'

/**
 * Единая лента сделки: звонки, сообщения, заметки, задачи и движения по этапам
 * одним потоком.
 *
 * Раньше это были четыре отдельных блока в правой колонке, и чтобы понять
 * «что вообще происходило с клиентом», приходилось читать их по очереди,
 * сверяя даты глазами. Порядок событий — это и есть история сделки, и она
 * должна читаться сверху вниз, как разговор.
 *
 * Запись итога и ответ клиенту здесь же: сейлз кладёт трубку и пишет
 * результат, не уходя из карточки. Это была главная претензия при сравнении
 * с amo — там из карточки пишут, у нас приходилось уходить в чат.
 */

type Activity = {
  id: string; type: string; direction: string | null; result: string | null
  text: string | null; agent_name: string | null; happened_at: string
  record_uuid?: string | null
}
type Message = {
  id: string; sender_name: string | null; is_from_client: boolean
  text_content: string | null; content_type: string | null; created_at: string
}
type Item = {
  key: string; at: string; icon: string; who: string
  text: string; tone?: 'client' | 'system' | 'task'
  recordUuid?: string | null
}

const ICONS: Record<string, string> = { call: '📞', meeting: '🤝', note: '📝' }

export function DealFeed({
  dealId, accountId, messages = [], tasks = [], events = [], channelId, onChanged,
}: {
  dealId?: string
  accountId?: string | null
  messages?: Message[]
  tasks?: any[]
  events?: any[]
  channelId?: string | null
  /** Задачи живут в данных сделки — после создания карточку надо перечитать. */
  onChanged?: () => void
}) {
  const { agent } = useAuth()
  const [acts, setActs] = useState<Activity[]>([])
  const [kind, setKind] = useState<'note' | 'call' | 'meeting' | 'message' | 'task'>(
    channelId ? 'message' : 'note')
  // Срок задачи: без него задача не попадёт в очередь дня и не напомнит о себе
  const [due, setDue] = useState<'today' | 'tomorrow' | 'in3'>('tomorrow')
  // Отправленное показываем сразу: ответ канала доедет с обновлением карточки,
  // а сейлзу нужно видеть, что письмо ушло, в момент отправки
  const [sent, setSent] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!dealId && !accountId) return
    const q = dealId ? `dealId=${dealId}` : `accountId=${accountId}`
    apiGet<{ activities: Activity[] }>(`/sales/activities?${q}`, false)
      .then(r => setActs(r.activities || []))
      .catch(() => setActs([]))
  }, [dealId, accountId])

  useEffect(() => { load() }, [load])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const a of acts) {
      out.push({
        key: `a_${a.id}`, at: a.happened_at, icon: ICONS[a.type] || '•',
        who: a.agent_name || 'Сотрудник',
        text: [a.result, a.text].filter(Boolean).join(' · ') || 'без описания',
        recordUuid: a.record_uuid || null,
      })
    }
    for (const m of messages) {
      out.push({
        key: `m_${m.id}`, at: m.created_at, icon: '💬',
        who: m.is_from_client ? (m.sender_name || 'Клиент') : (m.sender_name || 'Мы'),
        text: m.text_content || `[${m.content_type || 'вложение'}]`,
        tone: m.is_from_client ? 'client' : undefined,
      })
    }
    for (const t of tasks) {
      out.push({
        key: `t_${t.id}`, at: t.done_at || t.due_at || t.created_at, icon: t.done_at ? '✅' : '⏳',
        who: t.assignee_name || 'Задача',
        text: `${t.title}${t.done_at ? '' : ' — запланировано'}`,
        tone: 'task',
      })
    }
    for (const e of events) {
      out.push({
        key: `e_${e.changed_at}_${e.to_stage}`, at: e.changed_at, icon: '→',
        who: e.changed_by || '—',
        text: `${e.from_stage ? `${e.from_stage} → ` : ''}${e.to_stage}`,
        tone: 'system',
      })
    }
    out.push(...sent)
    return out
      .filter(i => i.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [acts, messages, tasks, events, sent])

  const play = async (uuid: string) => {
    try {
      const r = await apiPost<{ url: string }>('/sales/call?action=record', { uuid })
      if (r?.url) { setPlaying(uuid); new Audio(r.url).play().catch(() => {}) }
    } catch { /* записи может не быть — молчим */ }
  }

  const submit = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true); setErr('')
    try {
      if (kind === 'message') {
        if (!channelId) { setErr('Канал не привязан — сообщение отправить некуда'); return }
        await apiPost('/messages/send', {
          channelId, text: body,
          senderName: agent?.name || undefined,
          senderId: agent?.id || undefined,
        })
        setSent(s => [...s, {
          key: `s_${Date.now()}`, at: new Date().toISOString(), icon: '💬',
          who: agent?.name || 'Мы', text: body,
        }])
      } else if (kind === 'task') {
        const at = new Date()
        if (due === 'tomorrow') at.setDate(at.getDate() + 1)
        if (due === 'in3') at.setDate(at.getDate() + 3)
        at.setHours(10, 0, 0, 0)
        await apiPost('/sales/tasks', {
          dealId, title: body, kind: 'task', dueAt: at.toISOString(),
        })
        onChanged?.()
      } else {
        await apiPost('/sales/activities', { dealId, accountId, type: kind, text: body })
        load()
      }
      setText('')
    } catch (e: any) {
      setErr(e?.message || (kind === 'message' ? 'Не удалось отправить' : 'Не удалось записать'))
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex flex-col max-h-[70vh]">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-gray-900">Лента</h3>
        <span className="text-[11px] text-gray-400">звонки, сообщения, заметки и этапы</span>
        {channelId ? (
          <Link to={`/chats/${channelId}`} className="ml-auto text-[12px] text-blue-600 hover:underline">
            Открыть чат
          </Link>
        ) : (
          <span className="ml-auto text-[11px] text-gray-400">канал не привязан</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {!items.length && (
          <p className="px-4 py-8 text-center text-[12.5px] text-gray-400">
            Пока пусто. Запишите итог звонка — через месяц это единственный способ
            вспомнить, на чём остановились.
          </p>
        )}
        {items.map(i => (
          <div key={i.key} className="px-4 py-2.5 flex gap-2.5">
            <span className="text-[13px] leading-5 flex-none w-5 text-center">{i.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-[11.5px] font-semibold ${
                  i.tone === 'client' ? 'text-blue-700'
                    : i.tone === 'system' ? 'text-gray-400' : 'text-gray-700'}`}>
                  {i.who}
                </span>
                <span className="text-[10.5px] text-gray-400 ml-auto whitespace-nowrap">
                  {fmtDateTime(i.at)}
                </span>
              </div>
              <div className={`text-[12.5px] mt-0.5 ${
                i.tone === 'system' ? 'text-gray-500' : 'text-gray-800'}`}>
                {i.text}
              </div>
              {i.recordUuid && (
                <button onClick={() => play(i.recordUuid!)}
                  className="mt-1 text-[11px] font-semibold text-blue-600 hover:underline">
                  {playing === i.recordUuid ? '▶ играет' : '▶ прослушать запись'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 p-3">
        {err && <div className="mb-2 text-[11.5px] text-red-600">{err}</div>}
        <div className="flex gap-1.5 mb-2">
          {([
            ...(channelId ? [['message', 'Клиенту'] as const] : []),
            ['note', 'Заметка'], ['call', 'Звонок'], ['meeting', 'Встреча'],
            ['task', 'Задача'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                kind === k ? 'bg-gray-900 text-white border-gray-900'
                           : 'bg-white text-gray-500 border-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
        {kind === 'task' && (
          <div className="flex gap-1.5 mb-2 items-center">
            <span className="text-[11px] text-gray-400 font-semibold">Когда:</span>
            {([['today', 'сегодня'], ['tomorrow', 'завтра'], ['in3', 'через 3 дня']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setDue(k)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                  due === k ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-gray-500 border-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            placeholder={
              kind === 'message' ? 'Сообщение клиенту'
                : kind === 'task' ? 'Что нужно сделать'
                  : 'Что произошло — одной строкой'}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
          <button onClick={submit} disabled={busy || !text.trim()}
            className="px-3 py-2 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white disabled:opacity-40">
            {busy ? '…' : kind === 'message' ? 'Отправить' : kind === 'task' ? 'Поставить' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  )
}
