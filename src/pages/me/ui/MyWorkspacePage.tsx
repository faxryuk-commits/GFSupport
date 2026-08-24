/**
 * «Моё» — личное пространство сотрудника.
 *
 * Всё адресованное лично мне: уведомления (здесь начинается лестница
 * эскалации), упоминания без ответа, задачи, тикеты, обещания, шаги
 * онбординга. Шапка закреплена, каждая секция скроллится внутри себя.
 * Клик по элементу — попап с деталями и ссылкой, чтобы не терять страницу.
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Loader2, AtSign, ListChecks, Briefcase, HandHeart, Plug, Bell, CheckCircle2, X, ExternalLink } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'
import { fetchNotifications, markNotificationRead, type AppNotification } from '@/shared/api'
import { formatDateTimeShort } from '@/shared/lib'

type Workspace = {
  me: { id: string; name: string; usernames: string[] }
  mentions: Array<{ id: string; text_content: string; sender_name: string; created_at: string; channel_id: string; channel_name: string; unanswered: boolean }>
  unansweredMentions: number
  workItems: Array<{ id: string; title: string; client_name: string; status: string; started_at: string }>
  cases: Array<{ id: string; ticket_number: string; title: string; status: string; hours_open: number }>
  commitments: Array<{ id: string; commitment_text: string; context: string | null; due_date: string | null; status: string; channel_name: string | null; channel_id: string | null }>
  onboarding: Array<{ id: string; step: string; brand: string; status: string; kind: string; status_since: string }>
  sales?: { leads: Array<{ id: string; name: string; sla_due_at: string | null }>; tasks: Array<{ id: string; title: string; due_at: string; deal_id: string | null; deal_title: string | null }> }
  week: { confirmed_week?: number; cases_week?: number; kept_week?: number }
}

/** Попап деталей: поля + ссылка на раздел — страница «Моё» не теряется */
type Detail = { title: string; rows: Array<[string, string]>; linkTo?: string; linkLabel?: string }

type Activity = {
  days: number; total: number; prevTotal: number
  perDay: Array<{ date: string; c: number }>
  split: { messages: number; onboarding: number; cases: number; tasks: number; sales: number }
}
const SPLIT_LABELS: Array<[keyof Activity['split'], string, string]> = [
  ['messages', 'Ответы клиентам', '#2563eb'],
  ['onboarding', 'Шаги онбординга', '#7c3aed'],
  ['cases', 'Решённые тикеты', '#d97706'],
  ['tasks', 'Подтверждённые задачи', '#059669'],
  ['sales', 'События сделок', '#0369a1'],
]
const PERIODS: Array<[number, string]> = [[1, 'День'], [7, 'Неделя'], [30, 'Месяц'], [365, 'Год']]

type Rating = {
  rank: number; of: number
  leader: { name: string; total: number } | null
  metrics: Array<{ key: string; label: string; value: number; pct: number }>
  achievements: Array<{ icon: string; label: string; earned: boolean }>
}

function Section({ icon: Icon, title, count, tone, children }: {
  icon: typeof Bell; title: string; count?: number; tone?: 'red' | 'amber'
  children: ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e8edf3] p-4 flex flex-col min-h-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3 flex-none">
        <Icon className={`w-4 h-4 ${tone === 'red' ? 'text-red-500' : tone === 'amber' ? 'text-amber-500' : 'text-slate-400'}`} />
        {title}
        {count !== undefined && count > 0 && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
        )}
      </h3>
      <div className="overflow-y-auto max-h-64" style={{ scrollbarWidth: 'thin' }}>{children}</div>
    </div>
  )
}

const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-slate-400">{text}</p>

export function MyWorkspacePage() {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [actDays, setActDays] = useState(7)
  const [act, setAct] = useState<Activity | null>(null)

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    Promise.all([
      apiGet<Workspace>('/me/workspace'),
      fetchNotifications().then(r => r.notifications.filter(n => !n.isRead).slice(0, 30)).catch(() => [] as AppNotification[]),
    ])
      .then(([w, n]) => { setWs(w); setNotifs(n); setError('') })
      .catch(() => setError('Не удалось загрузить пространство'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 60000)
    return () => clearInterval(t)
  }, [load])

  const [rating, setRating] = useState<Rating | null>(null)
  useEffect(() => {
    apiGet<Activity>(`/me/activity?days=${actDays}`).then(setAct).catch(() => {})
    apiGet<Rating>(`/me/rating?days=${actDays}`).then(setRating).catch(() => {})
  }, [actDays])

  const buildReport = () => {
    if (!act) return
    const periodName = PERIODS.find(([d]) => d === actDays)?.[1]?.toLowerCase() || `${actDays} дн`
    const lines = [
      `Отчёт: ${ws?.me.name} · период: ${periodName}`,
      ``,
      `Действий: ${act.total}${act.prevTotal ? ` (${act.total >= act.prevTotal ? '+' : ''}${Math.round(((act.total - act.prevTotal) / Math.max(1, act.prevTotal)) * 100)}% к прошлому периоду)` : ''}`,
      `— ответы клиентам: ${act.split.messages}`,
      `— шаги онбординга: ${act.split.onboarding}`,
      `— решённые тикеты: ${act.split.cases}`,
      `— подтверждённые задачи: ${act.split.tasks}`,
      `— события сделок: ${act.split.sales}`,
      ``,
      rating ? `Место в команде: ${rating.rank} из ${rating.of}` : '',
      rating ? rating.metrics.map(m => `— ${m.label}: ${m.value} (топ-${100 - m.pct + 1}%)`).join('\n') : '',
      rating ? `Ачивки: ${rating.achievements.filter(a => a.earned).map(a => a.icon + ' ' + a.label).join('; ') || 'пока нет'}` : '',
    ].filter(Boolean)
    const text = lines.join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
    setDetail({ title: 'Отчёт за период — скопирован в буфер', rows: [['Текст', text]] })
  }

  const readNotif = async (id: string) => {
    await markNotificationRead(id).catch(() => {})
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  if (loading && !ws) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }
  if (error && !ws) {
    return <div className="p-6"><div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div></div>
  }
  if (!ws) return null

  const w = ws.week || {}
  const unanswered = ws.mentions.filter(m => m.unanswered)

  return (
    <div>
      {/* Шапка закреплена в скролле раздела; секции скроллятся внутри себя */}
      <div className="px-6 pt-5 pb-3 bg-[#f8fafc] border-b border-[#eef2f7] flex items-start justify-between flex-wrap gap-3 sticky top-0 z-10">
        <div>
          <h1 className="font-display text-[22px] font-extrabold text-slate-900 tracking-tight">Моё пространство</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {ws.me.name} · за неделю: подтверждено задач <b className="text-emerald-600">{w.confirmed_week || 0}</b> ·
            решено тикетов <b className="text-emerald-600">{w.cases_week || 0}</b> ·
            сдержано обещаний <b className="text-emerald-600">{w.kept_week || 0}</b>
          </p>
        </div>
        <button onClick={() => load()} className="p-2 rounded-lg border border-[#e8edf3] text-slate-400 hover:text-slate-700 bg-white">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Этап 1 «Моё 2.0»: активность из журналов — действия, дни, разрез по модулям */}
        <div className="bg-white rounded-xl border border-[#e8edf3] p-4">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="text-sm font-semibold text-slate-800">⚡ Моя активность</h3>
            <div className="ml-auto flex gap-1 bg-slate-100 rounded-lg p-0.5">
              {PERIODS.map(([d, l]) => (
                <button key={d} onClick={() => setActDays(d)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${actDays === d ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          {!act ? <p className="text-[13px] text-slate-400">считаю…</p> : (
            <div className="flex gap-6 flex-wrap items-end">
              <div>
                <b className="block font-mono text-2xl font-bold tabular-nums">{act.total}</b>
                <span className="text-[11px] text-slate-500">действий за период</span>
                {act.prevTotal > 0 && (
                  <span className={`block text-[11px] font-bold ${act.total >= act.prevTotal ? 'text-emerald-600' : 'text-red-500'}`}>
                    {act.total >= act.prevTotal ? '▲' : '▼'} {Math.abs(Math.round(((act.total - act.prevTotal) / act.prevTotal) * 100))}% к прошлому периоду
                  </span>
                )}
              </div>
              <div className="flex items-end gap-[3px] h-16 flex-1 min-w-[220px]">
                {(() => {
                  const buckets: number[] = []
                  const per = act.perDay
                  const size = Math.ceil(per.length / 31)
                  for (let i = 0; i < per.length; i += size)
                    buckets.push(per.slice(i, i + size).reduce((s2, x) => s2 + x.c, 0))
                  const max = Math.max(1, ...buckets)
                  return buckets.map((c, i) => (
                    <div key={i} title={`${c} действий`} className="flex-1 rounded-t"
                      style={{ height: `${Math.max(4, (c / max) * 100)}%`, background: c ? '#2563eb' : '#e2e8f0' }} />
                  ))
                })()}
              </div>
              <div className="min-w-[220px] space-y-1">
                {SPLIT_LABELS.map(([k, label, color]) => {
                  const v = act.split[k]
                  const tot = Math.max(1, act.total)
                  return (
                    <div key={k} className="grid grid-cols-[130px_1fr_34px] items-center gap-2 text-[11.5px] text-slate-600">
                      <span>{label}</span>
                      <span className="h-1.5 rounded bg-slate-100 overflow-hidden">
                        <i className="block h-full rounded" style={{ width: `${(v / tot) * 100}%`, background: color }} />
                      </span>
                      <b className="font-mono text-right tabular-nums">{v}</b>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {rating && rating.of > 0 && (
          <div className="bg-white rounded-xl border border-[#e8edf3] p-4 flex gap-6 flex-wrap items-start">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-mono text-xl font-extrabold text-white"
                style={{ background: rating.rank <= 3 ? 'linear-gradient(145deg,#fbbf24,#f59e0b)' : 'linear-gradient(145deg,#94a3b8,#64748b)' }}>
                #{rating.rank}
              </div>
              <div>
                <p className="text-[15px] font-bold text-slate-900">{rating.rank} место из {rating.of}</p>
                <p className="text-xs text-slate-500">{rating.rank === 1 ? 'вы задаёте темп команде' : rating.leader ? `лидер периода: ${rating.leader.name}` : ''}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[12px] text-slate-600">
              {rating.metrics.map(m => (
                <span key={m.key}>{m.label}: <b className="font-mono tabular-nums">{m.value}</b>
                  <span className={`ml-1 text-[10px] font-bold ${m.pct >= 70 ? 'text-emerald-600' : 'text-slate-400'}`}>топ-{Math.max(1, 100 - m.pct + 1)}%</span></span>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center flex-1 min-w-[220px]">
              {rating.achievements.map((a, i) => (
                <span key={i} title={a.label}
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border ${a.earned ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                  {a.earned ? a.icon : '🔒'} {a.label}
                </span>
              ))}
            </div>
            <button onClick={buildReport}
              className="ml-auto self-center px-3.5 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-bold hover:bg-blue-700">
              Сформировать отчёт
            </button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {(ws.sales && (ws.sales.leads.length > 0 || ws.sales.tasks.length > 0)) && (
            <Section icon={ListChecks} title="Продажи — очередь дня" count={(ws.sales.leads.length + ws.sales.tasks.length)} tone="red">
              <ul className="space-y-1.5">
                {ws.sales.leads.map(l => (
                  <li key={l.id}>
                    <Link to={`/sales/leads/${l.id}`} className="flex items-baseline gap-2 text-[13px] text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                      <span className="flex-none w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="truncate">Лид без касания: {l.name}</span>
                      {l.sla_due_at && <span className="text-[10px] font-mono text-red-500 flex-none">SLA {formatDateTimeShort(l.sla_due_at)}</span>}
                    </Link>
                  </li>
                ))}
                {ws.sales.tasks.map(t => (
                  <li key={t.id}>
                    <Link to={t.deal_id ? `/sales/deals/${t.deal_id}` : '/sales/queue'} className="flex items-baseline gap-2 text-[13px] text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                      <span className="flex-none w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="truncate">{t.title}{t.deal_title ? ` · ${t.deal_title}` : ''}</span>
                      <span className="text-[10px] font-mono text-slate-400 flex-none">{formatDateTimeShort(t.due_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section icon={Bell} title="Уведомления" count={notifs.length} tone="red">
            {notifs.length === 0 ? <Empty text="непрочитанных нет — бот не побеспокоит" /> : (
              <ul className="space-y-2">
                {notifs.map(n => (
                  <li key={n.id} className="flex items-start gap-2">
                    <button onClick={() => readNotif(n.id)} title="Отметить прочитанным"
                      className="mt-0.5 flex-none text-slate-300 hover:text-emerald-600"><CheckCircle2 className="w-4 h-4" /></button>
                    <button className="min-w-0 text-left" onClick={() => setDetail({
                      title: n.title,
                      rows: [['Текст', n.body || '—'], ['Когда', formatDateTimeShort(n.createdAt)], ['Канал', n.channelName || '—']],
                      linkTo: n.channelId ? `/chats/${n.channelId}` : undefined,
                      linkLabel: 'Открыть чат',
                    })}>
                      <p className="text-[13px] font-medium text-slate-800 truncate">{n.title}</p>
                      <p className="text-xs text-slate-500 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatDateTimeShort(n.createdAt)}{n.channelName ? ` · ${n.channelName}` : ''}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={AtSign} title="Упоминания без ответа" count={unanswered.length} tone="amber">
            {unanswered.length === 0 ? <Empty text="все упоминания закрыты" /> : (
              <ul className="space-y-2">
                {unanswered.slice(0, 12).map(m => (
                  <li key={m.id}>
                    <button className="text-left w-full hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5" onClick={() => setDetail({
                      title: `Упоминание · ${m.channel_name}`,
                      rows: [['Сообщение', m.text_content], ['От кого', m.sender_name], ['Когда', formatDateTimeShort(m.created_at)]],
                      linkTo: `/chats/${m.channel_id}`, linkLabel: 'Ответить в чате',
                    })}>
                      <p className="text-[13px] text-slate-700 line-clamp-2">«{m.text_content}»</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{m.channel_name} · {m.sender_name} · {formatDateTimeShort(m.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={ListChecks} title="Мои задачи" count={ws.workItems.length}>
            {ws.workItems.length === 0 ? <Empty text="активных задач нет" /> : (
              <ul className="space-y-1.5">
                {ws.workItems.map(t => (
                  <li key={t.id}>
                    <button className="text-left w-full text-[13px] text-slate-700 flex items-baseline gap-2 hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => setDetail({
                        title: t.title,
                        rows: [['Клиент', t.client_name || '—'], ['Статус', t.status === 'awaiting_confirm' ? 'ждёт подтверждения' : t.status], ['Начата', formatDateTimeShort(t.started_at)]],
                      })}>
                      <span className={`flex-none w-1.5 h-1.5 rounded-full ${t.status === 'awaiting_confirm' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                      <span className="truncate">{t.title}</span>
                      {t.client_name && <span className="text-xs text-slate-400 flex-none">· {t.client_name}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Briefcase} title="Мои тикеты" count={ws.cases.length}>
            {ws.cases.length === 0 ? <Empty text="открытых тикетов нет" /> : (
              <ul className="space-y-1.5">
                {ws.cases.map(c => (
                  <li key={c.id}>
                    <button className="text-left w-full text-[13px] text-slate-700 flex items-baseline gap-2 hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => setDetail({
                        title: c.title,
                        rows: [['Номер', c.ticket_number || c.id], ['Статус', c.status], ['Открыт', `${c.hours_open} ч назад`]],
                        linkTo: '/cases', linkLabel: 'Открыть кейсы',
                      })}>
                      <span className={`flex-none text-[10px] font-mono ${c.hours_open > 48 ? 'text-red-500' : 'text-slate-400'}`}>{c.hours_open}ч</span>
                      <span className="truncate">{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={HandHeart} title="Мои обещания" count={ws.commitments.length} tone={ws.commitments.some(c => c.status === 'overdue') ? 'red' : undefined}>
            {ws.commitments.length === 0 ? <Empty text="невыполненных обещаний нет" /> : (
              <ul className="space-y-1.5">
                {ws.commitments.map(c => (
                  <li key={c.id}>
                    <button className="text-left w-full text-[13px] text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => setDetail({
                        title: `Обещание · ${c.channel_name || 'без канала'}`,
                        rows: [['Что сказали', c.context || c.commitment_text || '—'], ['Ключевая фраза', c.commitment_text || '—'], ['Статус', c.status === 'overdue' ? 'просрочено' : 'в силе'], ['Срок', c.due_date ? formatDateTimeShort(c.due_date) : 'не задан']],
                        linkTo: c.channel_id ? `/chats/${c.channel_id}` : undefined, linkLabel: 'Открыть чат',
                      })}>
                      <span className={c.status === 'overdue' ? 'text-red-600 font-medium' : ''}>«{(c.context || c.commitment_text || '').slice(0, 90)}»</span>
                      <span className="text-xs text-slate-400"> {c.channel_name ? `· ${c.channel_name}` : ''}{c.due_date ? ` · до ${formatDateTimeShort(c.due_date)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Plug} title="Мои шаги онбординга" count={ws.onboarding.length}>
            {ws.onboarding.length === 0 ? <Empty text="назначенных шагов нет" /> : (
              <ul className="space-y-1.5">
                {ws.onboarding.map(s => (
                  <li key={s.id}>
                    <button className="text-left w-full text-[13px] text-slate-700 flex items-baseline gap-2 hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => setDetail({
                        title: `${s.step} · ${s.brand}`,
                        rows: [['Статус', s.status], ['В статусе с', formatDateTimeShort(s.status_since)]],
                        linkTo: '/onboarding', linkLabel: 'Открыть Подключения',
                      })}>
                      <span className={`flex-none w-1.5 h-1.5 rounded-full ${s.kind === 'waiting' ? 'bg-amber-400' : s.kind === 'active' ? 'bg-blue-400' : 'bg-slate-300'}`} />
                      <span className="truncate">{s.step}</span>
                      <span className="text-xs text-slate-400 flex-none">· {s.brand} · {s.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <p className="text-xs text-slate-400 pb-4">
          Лестница эскалации: адресное событие появляется здесь и в колокольчике; не отреагировали за 10–30 минут — бот напишет в Telegram; critical уходит в Telegram сразу.
        </p>
      </div>

      {/* Попап деталей: страница не теряется, переход — по желанию */}
      {detail && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[440px] max-w-[92vw] max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-[15px] font-bold text-slate-900">{detail.title}</h3>
              <button onClick={() => setDetail(null)} className="flex-none p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              {detail.rows.map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
                  <div className="text-[13px] text-slate-700 whitespace-pre-wrap">{v}</div>
                </div>
              ))}
            </div>
            {detail.linkTo && (
              <Link to={detail.linkTo} className="inline-flex items-center gap-1.5 mt-4 text-[13px] font-semibold text-blue-600 hover:text-blue-700">
                <ExternalLink className="w-3.5 h-3.5" /> {detail.linkLabel || 'Открыть'}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MyWorkspacePage
