import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost, apiUpload } from '@/shared/services/api.service'
import { fmtDateTime } from './kit'
import { CallInsight } from './CallInsight'
import { useAuth } from '@/shared/hooks/useAuth'
import { parsePhone } from '@/shared/lib/phone'

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
 *
 * Внутренние сообщения команды — в этой же цепочке, отдельной веткой их
 * держать было нечестно: разговор о клиенте и события по клиенту — одна
 * история. Клиенту они не уходят: видно по жёлтой метке «внутри команды».
 */

type Activity = {
  id: string; type: string; direction: string | null; result: string | null
  text: string | null; agent_name: string | null; happened_at: string
  /** Кто написал, когда это сообщение клиента: имя из мессенджера. */
  sender_name?: string | null
  /** Канал сообщения отдельным полем; у старых записей он в тексте. */
  channel?: string | null
  record_uuid?: string | null
  summary?: string | null; outcome?: string | null; next_step?: string | null
}
type Message = {
  id: string; sender_name: string | null; is_from_client: boolean
  text_content: string | null; content_type: string | null; created_at: string
}
type Att = { url: string; name: string; size: number; type: string | null }
type TeamComment = {
  id: string; text: string; mentions: string[]; attachments: Att[]; task_id: string | null
  created_at: string; author_agent_id: string | null; author_name: string | null
}
type Item = {
  key: string; at: string; icon: string; who: string
  text: string; tone?: 'client' | 'system' | 'task' | 'team'
  recordUuid?: string | null
  attachments?: Att[]
  /** Разбор звонка: суть разговора и предложенный следующий шаг. */
  summary?: string | null; outcome?: string | null; nextStep?: string | null
}

const ICONS: Record<string, string> = { call: '📞', meeting: '🤝', note: '📝' }

const fmtSize = (n: number) => n < 1024 * 1024
  ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`

/** Текст с подсветкой упоминаний: «@Имя» — жирным. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(@[^\s@,.!?:;]+(?: [А-ЯA-Z][^\s@,.!?:;]*)?)/g)
  return <>{parts.map((p, i) => p.startsWith('@')
    ? <b key={i} className="text-blue-700 font-semibold">{p}</b>
    : <span key={i}>{p}</span>)}</>
}

type Kind = 'note' | 'call' | 'meeting' | 'message' | 'tg' | 'wa' | 'task' | 'team'

/** Куда писать клиенту: свой Telegram/WhatsApp подключён? номер в мессенджере есть? */
type ChanState = {
  tgReady: boolean | null
  waReady: boolean | null
  /** online | reconnecting | qr | need_qr | off — из моста WhatsApp. */
  waState: string | null
  hasTelegram: boolean | null
  tgUsername: string | null
  hasWhatsapp: boolean | null
  waPending: boolean
  waReason: string | null
}

export function DealFeed({
  dealId, leadId, accountId, phone, messages = [], tasks = [], events = [], channelId, team = [], onChanged,
}: {
  dealId?: string
  leadId?: string
  accountId?: string | null
  /** Номер клиента — чтобы писать в Telegram/WhatsApp прямо отсюда.
   *  Если не передан, берём первый контакт клиента. */
  phone?: string | null
  /** Коллеги для «@имя»: без них внутреннее сообщение некому адресовать. */
  team?: Array<{ id: string; name: string }>
  messages?: Message[]
  tasks?: any[]
  events?: any[]
  channelId?: string | null
  /** Задачи живут в данных сделки — после создания карточку надо перечитать. */
  onChanged?: () => void
}) {
  const { agent } = useAuth()
  const [acts, setActs] = useState<Activity[]>([])
  const [kind, setKind] = useState<Kind>(channelId ? 'message' : 'note')
  // Номер, куда писать: свой из карточки или первый контакт клиента
  const [toPhone, setToPhone] = useState<string | null>(phone || null)
  const [chan, setChan] = useState<ChanState>({
    tgReady: null, waReady: null, waState: null, hasTelegram: null, tgUsername: null,
    hasWhatsapp: null, waPending: false, waReason: null,
  })
  const chanAsked = useRef<{ tg: boolean; wa: boolean; presence: string | null }>({ tg: false, wa: false, presence: null })
  const [comments, setComments] = useState<TeamComment[]>([])
  // «@имя» и вложения — только для внутренних сообщений команде
  const [mentions, setMentions] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState<{ q: string; at: number } | null>(null)
  const [files, setFiles] = useState<Att[]>([])
  const [asTask, setAsTask] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Срок задачи: без него задача не попадёт в очередь дня и не напомнит о себе
  const [due, setDue] = useState<'today' | 'tomorrow' | 'in3'>('tomorrow')
  // Отправленное показываем сразу: ответ канала доедет с обновлением карточки,
  // а сейлзу нужно видеть, что письмо ушло, в момент отправки
  const [sent, setSent] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    const q = dealId ? `dealId=${dealId}` : leadId ? `leadId=${leadId}` : accountId ? `accountId=${accountId}` : ''
    if (!q) return
    if (dealId || accountId) {
      apiGet<{ activities: Activity[] }>(`/sales/activities?${dealId ? `dealId=${dealId}` : `accountId=${accountId}`}`, false)
        .then(r => setActs(r.activities || []))
        .catch(() => setActs([]))
    }
    apiGet<{ comments: TeamComment[] }>(`/sales/comments?${q}`, false)
      .then(r => setComments(r.comments || []))
      .catch(() => setComments([]))
  }, [dealId, leadId, accountId])

  useEffect(() => { load() }, [load])

  // Сообщение из меню номера тоже ложится в журнал — лента узнаёт по событию
  useEffect(() => {
    const on = () => load()
    window.addEventListener('gf:feed-changed', on)
    return () => window.removeEventListener('gf:feed-changed', on)
  }, [load])

  useEffect(() => { if (phone) setToPhone(phone) }, [phone])

  // Каналы: спрашиваем только когда сейлз выбрал Telegram/WhatsApp, а не при
  // каждом открытии карточки — каждый вопрос идёт в мост
  useEffect(() => {
    if (kind !== 'tg' && kind !== 'wa') return
    if (!toPhone && accountId) {
      apiGet<{ contacts: Array<{ phone: string | null }> }>(`/sales/contacts?accountId=${accountId}`, false)
        .then(r => setToPhone((r.contacts || []).map(c => c.phone).find(Boolean) || ''))
        .catch(() => setToPhone(''))
    }
    if (kind === 'tg' && !chanAsked.current.tg) {
      chanAsked.current.tg = true
      apiGet<any>('/sales/telegram?action=status', false)
        .then(d => setChan(c => ({ ...c, tgReady: !!d.connected })))
        .catch(() => setChan(c => ({ ...c, tgReady: false })))
    }
    if (kind === 'wa' && !chanAsked.current.wa) {
      chanAsked.current.wa = true
      apiGet<any>('/sales/whatsapp?action=status', false)
        .then(d => setChan(c => ({ ...c, waReady: !!d.connected, waState: d.state || null })))
        .catch(() => setChan(c => ({ ...c, waReady: false, waState: null })))
    }
  }, [kind, toPhone, accountId])

  // Есть ли номер в мессенджере — ответ кэширован на сутки, мост
  // при необходимости допроверит в фоне, тогда переспросим
  useEffect(() => {
    if ((kind !== 'tg' && kind !== 'wa') || !toPhone) return
    if (chanAsked.current.presence === toPhone) return
    chanAsked.current.presence = toPhone
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let tries = 0
    const ask = () => apiGet<any>(`/sales/channels?phone=${encodeURIComponent(toPhone)}`, false)
      .then(d => {
        if (!alive) return
        setChan(c => ({
          ...c, hasTelegram: d.hasTelegram ?? null, tgUsername: d.tgUsername || null,
          hasWhatsapp: d.hasWhatsapp ?? null, waPending: !!d.whatsappPending, waReason: d.whatsappReason || null,
        }))
        if (d.whatsappPending && tries++ < 4) timer = setTimeout(ask, Math.min(60, d.whatsappPending) * 1000)
      })
      .catch(() => {})
    ask()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [kind, toPhone])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const a of acts) {
      // Входящее написал клиент, а не сотрудник. Раньше автором всегда стоял
      // агент — и сообщение клиента оказывалось подписано именем сейлза,
      // чей мост его поймал
      const fromClient = a.type === 'message' && a.direction === 'in'
      const body = [a.result, a.text].filter(Boolean).join(' · ') || 'без описания'
      out.push({
        key: `a_${a.id}`, at: a.happened_at, icon: ICONS[a.type] || '•',
        who: fromClient
          ? (a.sender_name || 'Клиент')
          : (a.agent_name || 'Сотрудник'),
        text: a.channel ? `${a.channel}: ${body}` : body,
        tone: fromClient ? 'client' : undefined,
        recordUuid: a.record_uuid || null,
        summary: a.summary || null, outcome: a.outcome || null, nextStep: a.next_step || null,
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
    for (const c of comments) {
      out.push({
        key: `c_${c.id}`, at: c.created_at, icon: '👥',
        who: c.author_name || 'Коллега',
        text: c.text || (c.attachments?.length ? '' : '—'),
        tone: 'team',
        attachments: c.attachments || [],
      })
    }
    out.push(...sent)
    return out
      .filter(i => i.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [acts, comments, messages, tasks, events, sent])

  const [loadingRec, setLoadingRec] = useState<string | null>(null)
  const [rec, setRec] = useState<{ uuid: string; url: string } | null>(null)
  const [recErr, setRecErr] = useState<Record<string, string>>({})
  // Запись отдаёт АТС по запросу — секунду-другую. Раньше кнопка на это
  // время молчала, а отказ АТС («запись не найдена») терялся вовсе — и
  // выглядело так, будто прослушивание пропало
  const play = async (uuid: string) => {
    setLoadingRec(uuid); setRecErr(e => ({ ...e, [uuid]: '' }))
    try {
      const r = await apiPost<{ url: string }>('/sales/call?action=record', { uuid })
      // Один плеер на ленту, а не new Audio() на каждый клик: раньше каждое
      // нажатие запускало ещё одну дорожку поверх прежней, и остановить
      // их было нечем. Плеер — обычный, с паузой, перемоткой и громкостью
      if (r?.url) setRec({ uuid, url: r.url })
      else setRecErr(e => ({ ...e, [uuid]: 'Запись не найдена' }))
    } catch (e: any) {
      setRecErr(x => ({ ...x, [uuid]: e?.message || 'АТС не отдала запись' }))
    } finally { setLoadingRec(null) }
  }

  // Подсказка «@»: показываем команду и подставляем имя целиком
  const onText = (v: string) => {
    setText(v)
    if (kind !== 'team') { setPick(null); return }
    const caret = inputRef.current?.selectionStart ?? v.length
    const m = v.slice(0, caret).match(/@([^\s@]*)$/)
    setPick(m ? { q: m[1].toLowerCase(), at: caret - m[0].length } : null)
  }
  const choose = (t: { id: string; name: string }) => {
    if (!pick) return
    const caret = inputRef.current?.selectionStart ?? text.length
    setText(`${text.slice(0, pick.at)}@${t.name} ${text.slice(caret)}`)
    setMentions(s2 => new Set(s2).add(t.id))
    setPick(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const candidates = pick
    ? team.filter(t => t.id !== agent?.id && t.name.toLowerCase().includes(pick.q)).slice(0, 8)
    : []

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true); setErr('')
    try {
      for (const f of Array.from(list).slice(0, 5)) {
        const fd = new FormData(); fd.append('file', f)
        const r = await apiUpload<Att & { ok: boolean }>('/sales/comments?action=upload', fd)
        setFiles(fs => [...fs, { url: r.url, name: r.name, size: r.size, type: r.type }])
      }
    } catch (e: any) {
      setErr(e?.message || 'Не удалось загрузить файл')
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const submit = async () => {
    const body = text.trim()
    if (!body && !(kind === 'team' && files.length)) return
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
      } else if (kind === 'tg' || kind === 'wa') {
        if (!toPhone) { setErr('У клиента нет номера — писать некуда'); return }
        const p = parsePhone(toPhone)
        const to = p.valid ? p.e164 : '+' + toPhone.replace(/\D/g, '')
        if (kind === 'tg') {
          await apiPost('/sales/telegram', { action: 'send', phone: to, text: body, dealId, accountId, leadId })
        } else {
          await apiPost('/sales/channels', { action: 'wa_send', phone: to, text: body, dealId, accountId, leadId })
        }
        // След пишет сервер — перечитываем журнал, чтобы не показать сообщение дважды
        if (dealId || accountId) load()
        else setSent(s => [...s, {
          key: `s_${Date.now()}`, at: new Date().toISOString(), icon: '💬',
          who: agent?.name || 'Мы', text: `${kind === 'tg' ? 'Telegram' : 'WhatsApp'}: ${body}`,
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
      } else if (kind === 'team') {
        // «@Имя» могли стереть — зовём только тех, чьё имя осталось в тексте
        const kept = [...mentions].filter(id => {
          const t = team.find(x => x.id === id); return t && body.includes(`@${t.name}`)
        })
        const at = new Date()
        if (due === 'tomorrow') at.setDate(at.getDate() + 1)
        if (due === 'in3') at.setDate(at.getDate() + 3)
        at.setHours(10, 0, 0, 0)
        await apiPost('/sales/comments', {
          dealId, leadId, accountId: accountId || undefined,
          text: body, mentions: kept, attachments: files,
          task: asTask ? { dueAt: at.toISOString(), assigneeAgentId: kept[0] || agent?.id } : undefined,
        })
        setMentions(new Set()); setFiles([]); setAsTask(false)
        load(); onChanged?.()
      } else {
        await apiPost('/sales/activities', { dealId, accountId, type: kind, text: body })
        load()
      }
      setText('')
    } catch (e: any) {
      setErr(e?.message || (kind === 'message' || kind === 'tg' || kind === 'wa' ? 'Не удалось отправить' : 'Не удалось записать'))
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex flex-col max-h-[70vh]">
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-gray-900">Лента</h3>
        <span className="text-[11px] text-gray-400">звонки, сообщения, заметки, этапы и разговор команды</span>
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
          <div key={i.key} className={`px-4 py-2.5 flex gap-2.5 ${
            i.tone === 'team' ? 'bg-amber-50/40' : ''}`}>
            <span className="text-[13px] leading-5 flex-none w-5 text-center">{i.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-[11.5px] font-semibold ${
                  i.tone === 'client' ? 'text-blue-700'
                    : i.tone === 'system' ? 'text-gray-400' : 'text-gray-700'}`}>
                  {i.who}
                </span>
                {i.tone === 'team' && (
                  <span className="text-[9.5px] font-semibold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                    внутри команды
                  </span>
                )}
                <span className="text-[10.5px] text-gray-400 ml-auto whitespace-nowrap">
                  {fmtDateTime(i.at)}
                </span>
              </div>
              <div className={`text-[12.5px] mt-0.5 ${
                i.tone === 'system' ? 'text-gray-500' : 'text-gray-800'}`}>
                {i.tone === 'team' ? <Rich text={i.text} /> : i.text}
              </div>
              {!!i.attachments?.length && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {i.attachments.map(a => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
                      className="text-[11px] text-blue-600 hover:underline bg-white border border-gray-200 rounded-md px-2 py-0.5">
                      📎 {a.name} <span className="text-gray-400">{fmtSize(a.size)}</span>
                    </a>
                  ))}
                </div>
              )}
              {i.summary && (
                <div className="mt-1.5 rounded-lg bg-violet-50/70 border border-violet-200 px-2.5 py-1.5">
                  {/* Кто внёс данные — видно сразу: это разбор машины, а не
                      запись сейлза. Смешивать их в ленте нельзя: доверие
                      к строке зависит от того, кто её написал */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-white
                                     bg-violet-600 rounded px-1.5 py-0.5"
                      title="Запись сделана искусственным интеллектом по записи разговора. Расшифровка автоматическая — возможны ошибки">
                      ✨ ИИ
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                      разбор разговора{i.outcome ? ` · ${i.outcome}` : ''}
                    </span>
                  </div>
                  <div className="text-[12.5px] text-gray-800 mt-0.5">{i.summary}</div>
                  {i.nextStep && (
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="text-[11.5px] text-gray-600">ИИ предлагает шаг: <b>{i.nextStep}</b></span>
                      <button
                        onClick={async () => {
                          const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(10, 0, 0, 0)
                          try {
                            await apiPost('/sales/tasks', {
                              dealId, title: i.nextStep, kind: 'task',
                              dueAt: at.toISOString(), auto: true,
                            })
                            onChanged?.()
                          } catch { /* задача не критична */ }
                        }}
                        className="text-[11px] font-semibold text-white bg-blue-500 rounded-md px-2 py-0.5">
                        поставить задачу
                      </button>
                    </div>
                  )}
                </div>
              )}
              {i.recordUuid && (
                <div className="mt-1 flex items-center gap-3 flex-wrap">
                  {rec?.uuid === i.recordUuid ? (
                    <button onClick={() => setRec(null)}
                      className="text-[11px] font-semibold text-gray-500 hover:text-red-600">
                      ■ закрыть запись
                    </button>
                  ) : (
                    <button onClick={() => play(i.recordUuid!)} disabled={loadingRec === i.recordUuid}
                      className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-60">
                      {loadingRec === i.recordUuid ? '⏳ запрашиваю запись у АТС…' : '▶ прослушать запись'}
                    </button>
                  )}
                  {/* Разбор по кнопке — как в карточке обращения: расшифровка,
                      выжимка и советы тренера. Автоматический разбор приходит
                      только для новых звонков, старые — по запросу */}
                  <CallInsight uuid={i.recordUuid} />
                  {recErr[i.recordUuid] && <span className="text-[11px] text-red-600">{recErr[i.recordUuid]}</span>}
                </div>
              )}
              {rec && rec.uuid === i.recordUuid && (
                <audio controls autoPlay src={rec.url} className="mt-1.5 w-full h-8" onEnded={() => setRec(null)} />
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
            ...(toPhone !== '' && (toPhone || accountId) ? [['tg', '✈ Telegram'] as const, ['wa', 'WhatsApp'] as const] : []),
            ['note', 'Заметка'], ['call', 'Звонок'], ['meeting', 'Встреча'],
            ['task', 'Задача'], ['team', '👥 Команде'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setKind(k); setPick(null) }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                kind === k
                  ? (k === 'team' ? 'bg-amber-500 text-white border-amber-500'
                    : k === 'tg' ? 'bg-[#229ED9] text-white border-[#229ED9]'
                      : k === 'wa' ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-gray-900 text-white border-gray-900')
                  : 'bg-white text-gray-500 border-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
        {(kind === 'tg' || kind === 'wa') && (
          <ChannelHint kind={kind} phone={toPhone} chan={chan} />
        )}
        {(kind === 'task' || (kind === 'team' && asTask)) && (
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
        {kind === 'team' && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <input type="checkbox" checked={asTask} onChange={e => setAsTask(e.target.checked)} />
              как задачу
            </label>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-0.5 hover:text-blue-600">
              {uploading ? 'загружаю…' : '📎 файл'}
            </button>
            <input ref={fileRef} type="file" multiple hidden onChange={e => upload(e.target.files)} />
            <span className="text-[10.5px] text-amber-700">клиент этого не увидит · «@имя» зовёт коллегу</span>
            {files.map(f => (
              <span key={f.url} className="text-[10.5px] bg-white border border-gray-200 rounded px-1.5 py-0.5">
                {f.name}
                <button onClick={() => setFiles(fs => fs.filter(x => x.url !== f.url))}
                  className="ml-1 text-gray-300 hover:text-red-500">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 relative">
          {kind === 'team' && candidates.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-64 max-h-52 overflow-y-auto bg-white
                            border border-gray-200 rounded-lg shadow-lg z-20">
              {candidates.map(t => (
                <button key={t.id} onClick={() => choose(t)}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-blue-50">
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={text}
            onChange={e => onText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            placeholder={
              kind === 'message' ? 'Сообщение клиенту'
                : kind === 'tg' ? 'Сообщение в Telegram — уйдёт от вашего имени'
                : kind === 'wa' ? 'Сообщение в WhatsApp — уйдёт с вашего номера'
                : kind === 'task' ? 'Что нужно сделать'
                  : kind === 'team' ? 'Коллегам о клиенте · «@имя» позовёт'
                    : 'Что произошло — одной строкой'}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
          <button onClick={submit} disabled={busy || (!text.trim() && !(kind === 'team' && files.length))}
            className={`px-3 py-2 text-[12.5px] font-semibold rounded-lg text-white disabled:opacity-40 ${
              kind === 'team' ? 'bg-amber-500' : kind === 'tg' ? 'bg-[#229ED9]' : kind === 'wa' ? 'bg-emerald-500' : 'bg-blue-500'}`}>
            {busy ? '…' : kind === 'message' || kind === 'tg' || kind === 'wa' ? 'Отправить'
              : kind === 'task' ? 'Поставить' : kind === 'team' ? 'Написать' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Строка под выбором канала: подключён ли свой аккаунт и есть ли у клиента номер там. */
function ChannelHint({ kind, phone, chan }: { kind: 'tg' | 'wa'; phone: string | null; chan: ChanState }) {
  const Me = ({ what }: { what: string }) => (
    <span>
      {what} не подключён —{' '}
      <Link to="/me" className="text-blue-600 hover:underline">подключить в «Моё»</Link>
    </span>
  )
  let body: ReactNode
  if (phone === '') body = <span className="text-red-600">у клиента нет номера — писать некуда</span>
  else if (!phone) body = 'ищу номер клиента…'
  else if (kind === 'tg') {
    body = chan.tgReady === false ? <Me what="Ваш Telegram" />
      : chan.tgReady === null ? 'проверяю ваш Telegram…'
      : chan.hasTelegram === false ? <span className="text-amber-700">аккаунт по номеру не найден — сообщение может не дойти</span>
      : chan.hasTelegram ? `от вашего имени${chan.tgUsername ? ` · @${chan.tgUsername}` : ''} · останется в ленте`
      : 'от вашего имени · останется в ленте'
  } else {
    body = chan.waReady === false && chan.waState === 'reconnecting'
      ? <span className="text-amber-700">ваш WhatsApp переподключается — сервис вернётся сам, минуту</span>
      : chan.waReady === false ? <Me what="Ваш WhatsApp" />
      : chan.waReady === null ? 'проверяю ваш WhatsApp…'
      : chan.hasWhatsapp === false ? <span className="text-red-600">номера нет в WhatsApp — проверено по вашему аккаунту</span>
      : chan.hasWhatsapp ? 'с вашего номера · номер в WhatsApp есть · останется в ленте'
      : chan.waPending ? 'с вашего номера · номер ещё проверяется, отправка проверит сама'
      : `с вашего номера · ${chan.waReason || 'номер проверю при отправке'}`
  }
  return <div className="mb-2 text-[10.5px] text-gray-500">{body}</div>
}
