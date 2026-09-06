import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { fmtDateTime } from './kit'

/**
 * Единая лента сделки: звонки, сообщения, заметки, задачи и движения по этапам
 * одним потоком.
 *
 * Раньше это были четыре отдельных блока в правой колонке, и чтобы понять
 * «что вообще происходило с клиентом», приходилось читать их по очереди,
 * сверяя даты глазами. Порядок событий — это и есть история сделки, и она
 * должна читаться сверху вниз, как разговор.
 *
 * Запись итога здесь же: сейлз кладёт трубку и пишет результат, не уходя
 * из карточки. Отправка сообщений остаётся в чате — здесь на неё ссылка.
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
  dealId, accountId, messages = [], tasks = [], events = [], channelId,
}: {
  dealId?: string
  accountId?: string | null
  messages?: Message[]
  tasks?: any[]
  events?: any[]
  channelId?: string | null
}) {
  const [acts, setActs] = useState<Activity[]>([])
  const [kind, setKind] = useState<'note' | 'call' | 'meeting'>('note')
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
    return out
      .filter(i => i.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [acts, messages, tasks, events])

  const play = async (uuid: string) => {
    try {
      const r = await apiPost<{ url: string }>('/sales/call?action=record', { uuid })
      if (r?.url) { setPlaying(uuid); new Audio(r.url).play().catch(() => {}) }
    } catch { /* записи может не быть — молчим */ }
  }

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true); setErr('')
    try {
      await apiPost('/sales/activities', { dealId, accountId, type: kind, text: text.trim() })
      setText('')
      load()
    } catch (e: any) {
      setErr(e?.message || 'Не удалось записать')
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex flex-col max-h-[70vh]">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-gray-900">Лента</h3>
        <span className="text-[11px] text-gray-400">звонки, сообщения, заметки и этапы</span>
        {channelId && (
          <Link to={`/chats/${channelId}`} className="ml-auto text-[12px] text-blue-600 hover:underline">
            Открыть чат
          </Link>
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
          {([['note', 'Заметка'], ['call', 'Звонок'], ['meeting', 'Встреча']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                kind === k ? 'bg-gray-900 text-white border-gray-900'
                           : 'bg-white text-gray-500 border-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            placeholder="Что произошло — одной строкой"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
          <button onClick={submit} disabled={busy || !text.trim()}
            className="px-3 py-2 text-[12.5px] font-semibold rounded-lg bg-blue-500 text-white disabled:opacity-40">
            {busy ? '…' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  )
}
