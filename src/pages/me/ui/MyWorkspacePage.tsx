/**
 * «Моё» — личное пространство сотрудника (одобренный простой прототип).
 *
 * Смысл экрана — разгрузка головы: всё адресованное лично мне в одном месте.
 * Уведомления (лестница эскалации начинается здесь), упоминания без ответа,
 * мои задачи, тикеты, обещания и шаги онбординга. Итог недели — сверху,
 * чтобы экран показывал не только долги.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Loader2, AtSign, ListChecks, Briefcase, HandHeart, Plug, Bell, CheckCircle2 } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'
import { fetchNotifications, markNotificationRead, type AppNotification } from '@/shared/api'
import { formatDateTimeShort } from '@/shared/lib'

type Workspace = {
  me: { id: string; name: string; usernames: string[] }
  mentions: Array<{ id: string; text_content: string; sender_name: string; created_at: string; channel_id: string; channel_name: string; unanswered: boolean }>
  unansweredMentions: number
  workItems: Array<{ id: string; title: string; client_name: string; status: string; started_at: string }>
  cases: Array<{ id: string; ticket_number: string; title: string; status: string; hours_open: number }>
  commitments: Array<{ id: string; commitment_text: string; due_date: string | null; status: string; channel_name: string | null; channel_id: string | null }>
  onboarding: Array<{ id: string; step: string; brand: string; status: string; kind: string; status_since: string }>
  week: { confirmed_week?: number; cases_week?: number; kept_week?: number }
}

function Section({ icon: Icon, title, count, tone, children }: {
  icon: typeof Bell; title: string; count?: number; tone?: 'red' | 'amber'
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e8edf3] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
        <Icon className={`w-4 h-4 ${tone === 'red' ? 'text-red-500' : tone === 'amber' ? 'text-amber-500' : 'text-slate-400'}`} />
        {title}
        {count !== undefined && count > 0 && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
        )}
      </h3>
      {children}
    </div>
  )
}

const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-slate-400">{text}</p>

export function MyWorkspacePage() {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    Promise.all([
      apiGet<Workspace>('/me/workspace'),
      fetchNotifications().then(r => r.notifications.filter(n => !n.isRead).slice(0, 12)).catch(() => [] as AppNotification[]),
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
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold text-slate-900 tracking-tight">Моё пространство</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {ws.me.name} · за неделю: подтверждено задач <b className="text-emerald-600">{w.confirmed_week || 0}</b> ·
            решено тикетов <b className="text-emerald-600">{w.cases_week || 0}</b> ·
            сдержано обещаний <b className="text-emerald-600">{w.kept_week || 0}</b>
          </p>
        </div>
        <button onClick={() => load()} className="p-2 rounded-lg border border-[#e8edf3] text-slate-400 hover:text-slate-700">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Требуют реакции: уведомления + упоминания без ответа */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section icon={Bell} title="Уведомления" count={notifs.length} tone="red">
          {notifs.length === 0 ? <Empty text="непрочитанных нет — бот не побеспокоит" /> : (
            <ul className="space-y-2">
              {notifs.map(n => (
                <li key={n.id} className="flex items-start gap-2">
                  <button onClick={() => readNotif(n.id)} title="Отметить прочитанным"
                    className="mt-0.5 text-slate-300 hover:text-emerald-600"><CheckCircle2 className="w-4 h-4" /></button>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 truncate">{n.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDateTimeShort(n.createdAt)}{n.channelName ? ` · ${n.channelName}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={AtSign} title="Упоминания без ответа" count={unanswered.length} tone="amber">
          {unanswered.length === 0 ? <Empty text="все упоминания закрыты" /> : (
            <ul className="space-y-2">
              {unanswered.slice(0, 8).map(m => (
                <li key={m.id}>
                  <Link to={`/chats/${m.channel_id}`} className="block hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5">
                    <p className="text-[13px] text-slate-700 line-clamp-2">«{m.text_content}»</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{m.channel_name} · {m.sender_name} · {formatDateTimeShort(m.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section icon={ListChecks} title="Мои задачи" count={ws.workItems.length}>
          {ws.workItems.length === 0 ? <Empty text="активных задач нет" /> : (
            <ul className="space-y-1.5">
              {ws.workItems.map(t => (
                <li key={t.id} className="text-[13px] text-slate-700 flex items-baseline gap-2">
                  <span className={`flex-none w-1.5 h-1.5 rounded-full ${t.status === 'awaiting_confirm' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                  <span className="truncate">{t.title}</span>
                  {t.client_name && <span className="text-xs text-slate-400 flex-none">· {t.client_name}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Briefcase} title="Мои тикеты" count={ws.cases.length}>
          {ws.cases.length === 0 ? <Empty text="открытых тикетов нет" /> : (
            <ul className="space-y-1.5">
              {ws.cases.map(c => (
                <li key={c.id} className="text-[13px] text-slate-700 flex items-baseline gap-2">
                  <span className={`flex-none text-[10px] font-mono ${c.hours_open > 48 ? 'text-red-500' : 'text-slate-400'}`}>{c.hours_open}ч</span>
                  <span className="truncate">{c.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={HandHeart} title="Мои обещания" count={ws.commitments.length} tone={ws.commitments.some(c => c.status === 'overdue') ? 'red' : undefined}>
          {ws.commitments.length === 0 ? <Empty text="невыполненных обещаний нет" /> : (
            <ul className="space-y-1.5">
              {ws.commitments.map(c => (
                <li key={c.id} className="text-[13px] text-slate-700">
                  <span className={c.status === 'overdue' ? 'text-red-600 font-medium' : ''}>«{c.commitment_text?.slice(0, 90)}»</span>
                  <span className="text-xs text-slate-400"> {c.channel_name ? `· ${c.channel_name}` : ''}{c.due_date ? ` · до ${formatDateTimeShort(c.due_date)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Plug} title="Мои шаги онбординга" count={ws.onboarding.length}>
          {ws.onboarding.length === 0 ? <Empty text="назначенных шагов нет" /> : (
            <ul className="space-y-1.5">
              {ws.onboarding.map(s => (
                <li key={s.id} className="text-[13px] text-slate-700 flex items-baseline gap-2">
                  <span className={`flex-none w-1.5 h-1.5 rounded-full ${s.kind === 'waiting' ? 'bg-amber-400' : s.kind === 'active' ? 'bg-blue-400' : 'bg-slate-300'}`} />
                  <span className="truncate">{s.step}</span>
                  <span className="text-xs text-slate-400 flex-none">· {s.brand} · {s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="text-xs text-slate-400">
        Лестница эскалации: адресное событие появляется здесь и в колокольчике; не отреагировали за 10–30 минут — бот напишет в Telegram; critical уходит в Telegram сразу.
      </p>
    </div>
  )
}

export default MyWorkspacePage
