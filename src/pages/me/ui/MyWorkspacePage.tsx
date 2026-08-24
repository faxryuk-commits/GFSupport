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
  week: { confirmed_week?: number; cases_week?: number; kept_week?: number }
}

/** Попап деталей: поля + ссылка на раздел — страница «Моё» не теряется */
type Detail = { title: string; rows: Array<[string, string]>; linkTo?: string; linkLabel?: string }

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
        <div className="grid md:grid-cols-2 gap-4">
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
