/**
 * «Моё» — личное пространство сотрудника по утверждённому прототипу «Моё 2.0».
 *
 * Шапка закреплена, период — в шапке и управляет всем экраном. Ниже: пульс
 * (активность + куда уходит время) и рейтинг с ачивками; единый блок
 * «Требует меня сейчас» с вкладками по модулям (сюда влита очередь дня
 * продаж); уведомления и «сильные стороны / узкие места». Всё — из живых
 * журналов; блоки модулей видны только тем, у кого есть данные (роли).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Loader2, Bell, CheckCircle2, X, ExternalLink } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'
import { fetchNotifications, markNotificationRead, type AppNotification } from '@/shared/api'
import { completeCommitment } from '@/shared/api/commitments'
import { updateBrandTodo } from '@/shared/api/onboarding'
import { formatDateTimeShort } from '@/shared/lib'

type Workspace = {
  me: { id: string; name: string; usernames: string[] }
  mentions: Array<{ id: string; text_content: string; sender_name: string; created_at: string; channel_id: string; channel_name: string; unanswered: boolean }>
  workItems: Array<{ id: string; title: string; client_name: string; status: string; started_at: string }>
  cases: Array<{ id: string; ticket_number: string; title: string; status: string; hours_open: number }>
  commitments: Array<{ id: string; commitment_text: string; context: string | null; due_date: string | null; status: string; channel_name: string | null; channel_id: string | null }>
  onboarding: Array<{ id: string; step: string; brand: string; status: string; kind: string; status_since: string }>
  onboardingTodos?: Array<{ id: string; text: string; brand: string; brand_id: string; due_at: string | null; created_by: string | null; created_at: string }>
  sales?: { leads: Array<{ id: string; name: string; sla_due_at: string | null }>; tasks: Array<{ id: string; title: string; due_at: string; deal_id: string | null; deal_title: string | null }> }
  week: { confirmed_week?: number; cases_week?: number; kept_week?: number }
}
type Activity = {
  days: number; total: number; prevTotal: number; activeMinutesPerDay: number | null
  perDay: Array<{ date: string; c: number }>
  split: { messages: number; onboarding: number; cases: number; tasks: number; sales: number }
}
type Rating = {
  rank: number; of: number
  leader: { name: string; total: number } | null
  metrics: Array<{ key: string; label: string; value: number; pct: number }>
  achievements: Array<{ icon: string; label: string; earned: boolean }>
}
type Detail = { title: string; rows: Array<[string, string]>; linkTo?: string; linkLabel?: string }
type NeedItem = {
  id: string; mod: 'sales' | 'support' | 'onb'
  tone: 'red' | 'amber' | 'blue'
  text: string; meta: string
  linkTo?: string; detail?: Detail
  /** Закрыть позицию, не уходя с экрана. Без этого список копит выполненное. */
  done?: { label: string; run: () => Promise<unknown> }
}

const PERIODS: Array<[number, string]> = [[1, 'День'], [7, 'Неделя'], [30, 'Месяц'], [365, 'Год']]
const SPLIT_LABELS: Array<[keyof Activity['split'], string, string]> = [
  ['messages', 'Чаты клиентов', '#2563eb'],
  ['onboarding', 'Подключения', '#7c3aed'],
  ['cases', 'Кейсы', '#d97706'],
  ['tasks', 'Задачи', '#059669'],
  ['sales', 'Продажи', '#0369a1'],
]
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}ч ${m % 60}м` : `${m}м`)

export function MyWorkspacePage() {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [act, setAct] = useState<Activity | null>(null)
  const [rating, setRating] = useState<Rating | null>(null)
  const [days, setDays] = useState(7)
  const [tab, setTab] = useState<'all' | 'sales' | 'support' | 'onb'>('all')
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

  useEffect(() => {
    setAct(null); setRating(null)
    apiGet<Activity>(`/me/activity?days=${days}`).then(setAct).catch(() => {})
    apiGet<Rating>(`/me/rating?days=${days}`).then(setRating).catch(() => {})
  }, [days])

  const readNotif = async (id: string) => {
    await markNotificationRead(id).catch(() => {})
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  // ── «Требует меня сейчас»: один блок, вкладки по модулям — очередь дня влита
  const needs = useMemo<NeedItem[]>(() => {
    if (!ws) return []
    const list: NeedItem[] = []
    for (const l of ws.sales?.leads || []) list.push({
      id: 'l' + l.id, mod: 'sales', tone: 'red',
      text: `Лид без касания: ${l.name}`,
      meta: l.sla_due_at ? `SLA ${formatDateTimeShort(l.sla_due_at)}` : 'SLA не задан',
      linkTo: `/sales/leads/${l.id}`,
    })
    for (const t of ws.sales?.tasks || []) list.push({
      id: 't' + t.id, mod: 'sales', tone: 'amber',
      text: `${t.title}${t.deal_title ? ` · ${t.deal_title}` : ''}`,
      meta: formatDateTimeShort(t.due_at),
      linkTo: t.deal_id ? `/sales/deals/${t.deal_id}` : '/sales/queue',
    })
    for (const m of ws.mentions.filter(x => x.unanswered)) list.push({
      id: 'm' + m.id, mod: 'support', tone: 'red',
      text: `Упоминание без ответа: «${m.text_content?.slice(0, 70)}»`,
      meta: m.channel_name,
      detail: {
        title: `Упоминание · ${m.channel_name}`,
        rows: [['Сообщение', m.text_content], ['От кого', m.sender_name], ['Когда', formatDateTimeShort(m.created_at)]],
        linkTo: `/chats/${m.channel_id}`, linkLabel: 'Ответить в чате',
      },
    })
    for (const c of ws.commitments.filter(x => x.status === 'overdue')) list.push({
      id: 'c' + c.id, mod: 'support', tone: 'red',
      text: `Просрочено обещание: «${(c.context || c.commitment_text || '').slice(0, 70)}»`,
      meta: c.channel_name || '',
      done: { label: 'Выполнено', run: () => completeCommitment(c.id) },
      detail: {
        title: `Обещание · ${c.channel_name || ''}`,
        rows: [['Что сказали', c.context || c.commitment_text || '—'], ['Срок', c.due_date ? formatDateTimeShort(c.due_date) : '—']],
        linkTo: c.channel_id ? `/chats/${c.channel_id}` : undefined, linkLabel: 'Открыть чат',
      },
    })
    for (const c of ws.cases) list.push({
      id: 'k' + c.id, mod: 'support', tone: c.hours_open > 48 ? 'amber' : 'blue',
      text: c.title, meta: `${c.hours_open}ч открыт`,
      detail: { title: c.title, rows: [['Номер', c.ticket_number || c.id], ['Статус', c.status], ['Открыт', `${c.hours_open} ч назад`]], linkTo: '/cases', linkLabel: 'Открыть кейсы' },
    })
    for (const c of ws.commitments.filter(x => x.status !== 'overdue')) list.push({
      id: 'p' + c.id, mod: 'support', tone: 'blue',
      text: `Обещание: «${(c.context || c.commitment_text || '').slice(0, 70)}»`,
      meta: c.due_date ? `до ${formatDateTimeShort(c.due_date)}` : c.channel_name || '',
      done: { label: 'Выполнено', run: () => completeCommitment(c.id) },
      detail: {
        title: `Обещание · ${c.channel_name || ''}`,
        rows: [['Что сказали', c.context || c.commitment_text || '—'], ['Срок', c.due_date ? formatDateTimeShort(c.due_date) : '—']],
        linkTo: c.channel_id ? `/chats/${c.channel_id}` : undefined, linkLabel: 'Открыть чат',
      },
    })
    for (const t of ws.workItems) list.push({
      id: 'w' + t.id, mod: 'support', tone: t.status === 'awaiting_confirm' ? 'amber' : 'blue',
      text: t.title, meta: t.client_name || '',
      detail: { title: t.title, rows: [['Клиент', t.client_name || '—'], ['Статус', t.status === 'awaiting_confirm' ? 'ждёт подтверждения' : t.status]] },
    })
    for (const s of ws.onboarding) {
      const stuckDays = Math.floor((Date.now() - new Date(s.status_since).getTime()) / 864e5)
      list.push({
        id: 'o' + s.id, mod: 'onb',
        tone: s.kind === 'waiting' && stuckDays >= 7 ? 'red' : s.kind === 'waiting' ? 'amber' : 'blue',
        text: `${s.step} · ${s.brand}`,
        meta: s.kind === 'waiting' ? `${s.status} · ${stuckDays} дн` : s.status,
        detail: { title: `${s.step} · ${s.brand}`, rows: [['Статус', s.status], ['В статусе с', formatDateTimeShort(s.status_since)]], linkTo: '/onboarding', linkLabel: 'Открыть Подключения' },
      })
    }
    // Мини-задачи из карточек подключений: их ставят руками друг другу,
    // и до этого экрана они не доходили — задача жила только внутри карточки
    for (const t of ws.onboardingTodos || []) {
      const overdue = t.due_at ? new Date(t.due_at).getTime() < Date.now() : false
      list.push({
        id: 'ot' + t.id, mod: 'onb',
        tone: overdue ? 'red' : 'blue',
        text: t.text,
        meta: t.due_at ? `${t.brand} · до ${formatDateTimeShort(t.due_at)}` : t.brand,
        done: { label: 'Сделано', run: () => updateBrandTodo(t.id, { done: true }) },
        detail: {
          title: t.text,
          rows: [
            ['Бренд', t.brand],
            ['Поставил', t.created_by || '—'],
            ['Срок', t.due_at ? formatDateTimeShort(t.due_at) : 'без срока'],
            ['Создана', formatDateTimeShort(t.created_at)],
          ],
          linkTo: '/onboarding', linkLabel: 'Открыть Подключения',
        },
      })
    }
    const w = { red: 0, amber: 1, blue: 2 }
    return list.sort((a, b) => w[a.tone] - w[b.tone])
  }, [ws])

  // Отметка «сделано» прямо в списке. Раньше выполненное обещание висело до
  // ночного крона: человек читал упрёк за работу, которую сделал полчаса назад,
  // и закрыть её из этого окна было нечем
  const [closing, setClosing] = useState<Set<string>>(new Set())
  const closeItem = async (n: NeedItem) => {
    if (!n.done) return
    setClosing(s => new Set(s).add(n.id))
    setDetail(null)
    try {
      await n.done.run()
      load(true)
    } catch {
      // не закрылось — возвращаем в список, иначе позиция молча пропадёт
      setClosing(s => { const c = new Set(s); c.delete(n.id); return c })
    }
  }

  const byMod = (m: NeedItem['mod']) => needs.filter(n => n.mod === m)
  const visible = (tab === 'all' ? needs : byMod(tab)).filter(n => !closing.has(n.id))
  const tabs: Array<['all' | 'sales' | 'support' | 'onb', string, number]> = [
    ['all', 'Всё', needs.length],
    ['sales', 'Продажи', byMod('sales').length],
    ['support', 'Саппорт', byMod('support').length],
    ['onb', 'Подключения', byMod('onb').length],
  ]

  // ── Сильные стороны и узкие места — из тех же данных, без субъективщины
  const strengths = useMemo(() => {
    const good: string[] = []
    const bad: string[] = []
    if (rating) {
      for (const m of rating.metrics) if (m.value > 0 && m.pct >= 67) good.push(`${m.label}: топ-${Math.max(1, 101 - m.pct)}% команды`)
      for (const a of rating.achievements) if (a.earned) good.push(`${a.icon} ${a.label}`)
    }
    if (ws) {
      const overdue = ws.commitments.filter(c => c.status === 'overdue').length
      if (overdue) bad.push(`Просроченных обещаний: ${overdue}`)
      const unans = ws.mentions.filter(m => m.unanswered).length
      if (unans) bad.push(`Упоминаний без ответа: ${unans}`)
      const stuck = ws.onboarding.filter(s => s.kind === 'waiting' && Date.now() - new Date(s.status_since).getTime() > 7 * 864e5)
      if (stuck.length) bad.push(`Зависло на клиенте дольше недели: ${stuck.map(s => s.brand).join(', ')}`)
      const hotLeads = (ws.sales?.leads || []).length
      if (hotLeads) bad.push(`Лидов без первого касания: ${hotLeads}`)
    }
    return { good: good.slice(0, 5), bad: bad.slice(0, 5) }
  }, [rating, ws])

  const buildReport = () => {
    if (!act) return
    const periodName = PERIODS.find(([d]) => d === days)?.[1]?.toLowerCase() || `${days} дн`
    const lines = [
      `Отчёт: ${ws?.me.name} · период: ${periodName}`,
      ``,
      `Действий: ${act.total}${act.prevTotal ? ` (${act.total >= act.prevTotal ? '+' : ''}${Math.round(((act.total - act.prevTotal) / Math.max(1, act.prevTotal)) * 100)}% к прошлому периоду)` : ''}`,
      act.activeMinutesPerDay != null ? `Активное время: ~${fmtMin(act.activeMinutesPerDay)}/день` : '',
      `— чаты клиентов: ${act.split.messages} · подключения: ${act.split.onboarding} · кейсы: ${act.split.cases} · задачи: ${act.split.tasks} · продажи: ${act.split.sales}`,
      ``,
      rating && rating.of > 0 ? `Место в команде: ${rating.rank} из ${rating.of}` : '',
      rating ? rating.metrics.map(m => `— ${m.label}: ${m.value}${m.value > 0 ? ` (топ-${Math.max(1, 101 - m.pct)}%)` : ''}`).join('\n') : '',
      rating ? `Ачивки: ${rating.achievements.filter(a => a.earned).map(a => a.icon + ' ' + a.label).join('; ') || 'пока нет'}` : '',
      strengths.bad.length ? `\nУзкие места: ${strengths.bad.join('; ')}` : '',
    ].filter(Boolean)
    const text = lines.join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
    setDetail({ title: 'Отчёт за период — скопирован в буфер', rows: [['Текст', text]] })
  }

  if (loading && !ws) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }
  if (error && !ws) {
    return <div className="p-6"><div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div></div>
  }
  if (!ws) return null

  const w = ws.week || {}

  return (
    <div>
      {/* Шапка как в прототипе: имя + итог недели + ПЕРИОД, закреплена */}
      <div className="bg-[#f8fafc] border-b border-[#eef2f7] sticky top-0 z-10">
        <div className="max-w-[1240px] mx-auto px-6 pt-4 pb-3 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[20px] font-extrabold text-slate-900 tracking-tight">Моё пространство</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {ws.me.name} · за неделю: задач <b className="text-emerald-600">{w.confirmed_week || 0}</b> ·
            тикетов <b className="text-emerald-600">{w.cases_week || 0}</b> ·
            обещаний <b className="text-emerald-600">{w.kept_week || 0}</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-white border border-[#e8edf3] rounded-lg p-0.5">
            {PERIODS.map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${days === d ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => load()} className="p-2 rounded-lg border border-[#e8edf3] text-slate-400 hover:text-slate-700 bg-white">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>

      <div className="max-w-[1240px] mx-auto px-6 py-4 space-y-4">
        {/* Пульс + рейтинг — двумя карточками, как в прототипе */}
        <div className="grid lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border border-[#e8edf3] p-4 lg:col-span-3">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">⚡ Моя активность</h3>
            {!act ? <p className="text-[13px] text-slate-400">считаю…</p> : (
              <>
                <div className="flex gap-6 flex-wrap items-end">
                  <div>
                    <b className="block font-mono text-[26px] font-bold tabular-nums leading-none">{act.total}</b>
                    <span className="text-[11px] text-slate-500">действий</span>
                    {act.prevTotal + act.total >= 5 && act.prevTotal > 0 && (
                      <span className={`block text-[11px] font-bold ${act.total >= act.prevTotal ? 'text-emerald-600' : 'text-red-500'}`}>
                        {act.total >= act.prevTotal ? '▲' : '▼'} {Math.abs(Math.round(((act.total - act.prevTotal) / act.prevTotal) * 100))}%
                      </span>
                    )}
                  </div>
                  {act.activeMinutesPerDay != null && (
                    <div>
                      <b className="block font-mono text-[26px] font-bold tabular-nums leading-none">{fmtMin(act.activeMinutesPerDay)}</b>
                      <span className="text-[11px] text-slate-500">активное время/день</span>
                    </div>
                  )}
                  <div className="flex items-end gap-[3px] h-16 flex-1 min-w-[200px]">
                    {(() => {
                      const per = act.perDay
                      const size = Math.ceil(per.length / 31)
                      const buckets: number[] = []
                      for (let i = 0; i < per.length; i += size)
                        buckets.push(per.slice(i, i + size).reduce((s2, x) => s2 + x.c, 0))
                      // пол в знаменателе: 1 действие не должно рисовать башню
                      const max = Math.max(5, ...buckets)
                      return buckets.map((c, i) => (
                        <div key={i} title={`${c} действий`} className="flex-1 rounded-t"
                          style={{ height: `${Math.max(4, (c / max) * 100)}%`, background: c ? '#2563eb' : '#e2e8f0' }} />
                      ))
                    })()}
                  </div>
                </div>
                <div className="mt-4 space-y-1">
                  {SPLIT_LABELS.map(([k, label, color]) => {
                    const v = act.split[k]
                    const tot = Math.max(1, act.total)
                    return (
                      <div key={k} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-[11.5px] text-slate-600">
                        <span>{label}</span>
                        <span className="h-1.5 rounded bg-slate-100 overflow-hidden">
                          <i className="block h-full rounded" style={{ width: `${(v / tot) * 100}%`, background: color }} />
                        </span>
                        <b className="font-mono text-right tabular-nums">{v}</b>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-xl border border-[#e8edf3] p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">🏆 Мой рейтинг</h3>
            {!rating ? <p className="text-[13px] text-slate-400">считаю…</p> : rating.of === 0 ? <p className="text-[13px] text-slate-400">пока нет данных за период</p> : (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-mono text-lg font-extrabold text-white flex-none"
                    style={{ background: rating.rank <= 3 ? 'linear-gradient(145deg,#fbbf24,#f59e0b)' : 'linear-gradient(145deg,#94a3b8,#64748b)' }}>
                    #{rating.rank}
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-slate-900">{rating.rank} место из {rating.of}</p>
                    <p className="text-[11.5px] text-slate-500">{rating.rank === 1 ? 'вы задаёте темп' : rating.leader ? `лидер: ${rating.leader.name}` : ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-3">
                  {rating.metrics.map(m => (
                    <div key={m.key} className="bg-slate-50 border border-[#e8edf3] rounded-lg px-2.5 py-1.5">
                      <b className="font-mono text-[15px] tabular-nums">{m.value}</b>
                      {m.value > 0 && <span className={`ml-1.5 text-[9.5px] font-bold ${m.pct >= 67 ? 'text-emerald-600' : 'text-slate-400'}`}>топ-{Math.max(1, 101 - m.pct)}%</span>}
                      <span className="block text-[9.5px] text-slate-500 uppercase tracking-wide">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 flex-wrap mt-3">
                  {rating.achievements.map((a, i) => (
                    <span key={i} title={a.label}
                      className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 border ${a.earned ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                      {a.earned ? a.icon : '🔒'} {a.label}
                    </span>
                  ))}
                </div>
                <button onClick={buildReport}
                  className="mt-3 w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-bold hover:bg-blue-700">
                  Сформировать отчёт за период
                </button>
              </>
            )}
          </div>
        </div>

        {/* «Требует меня сейчас» — единый блок с вкладками; очередь дня влита */}
        <div className="bg-white rounded-xl border border-[#e8edf3] p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <h3 className="text-sm font-semibold text-slate-800">📌 Требует меня сейчас</h3>
            <div className="flex gap-1 ml-2">
              {tabs.map(([k, l, c]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border ${tab === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-[#e8edf3] hover:text-slate-800'}`}>
                  {l}{c > 0 ? ` · ${c}` : ''}
                </button>
              ))}
            </div>
            <Link to="/sales/queue" className="ml-auto text-[11.5px] text-blue-600 hover:underline">вся очередь продаж →</Link>
          </div>
          {visible.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-1">пусто — всё разобрано 💪</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {visible.map(n => {
                const dot = n.tone === 'red' ? 'bg-red-500' : n.tone === 'amber' ? 'bg-amber-400' : 'bg-blue-400'
                const inner = (
                  <>
                    <span className={`flex-none w-1.5 h-1.5 rounded-full ${dot}`} />
                    <span className="truncate text-[13px] text-slate-700">{n.text}</span>
                    <span className="ml-auto flex-none font-mono text-[10px] text-slate-400">{n.meta}</span>
                  </>
                )
                return (
                  <li key={n.id} className="group flex items-baseline gap-1">
                    {n.linkTo && !n.detail ? (
                      <Link to={n.linkTo} className="flex-1 min-w-0 flex items-baseline gap-2 py-1.5 px-1.5 rounded hover:bg-slate-50">{inner}</Link>
                    ) : (
                      <button onClick={() => n.detail && setDetail(n.detail)} className="flex-1 min-w-0 text-left flex items-baseline gap-2 py-1.5 px-1.5 rounded hover:bg-slate-50">{inner}</button>
                    )}
                    {n.done && (
                      <button onClick={() => closeItem(n)} title={n.done.label}
                        className="flex-none p-1 rounded text-slate-300 hover:text-emerald-600 hover:bg-emerald-50
                                   opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Уведомления + сильные стороны */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-[#e8edf3] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
              <Bell className="w-4 h-4 text-red-500" /> Уведомления
              {notifs.length > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">{notifs.length}</span>}
            </h3>
            <div className="overflow-y-auto max-h-64" style={{ scrollbarWidth: 'thin' }}>
              {notifs.length === 0 ? <p className="text-[13px] text-slate-400">непрочитанных нет — бот не побеспокоит</p> : (
                <ul className="space-y-2">
                  {notifs.map(n => (
                    <li key={n.id} className="flex items-start gap-2">
                      <button onClick={() => readNotif(n.id)} title="Отметить прочитанным"
                        className="mt-0.5 flex-none text-slate-300 hover:text-emerald-600"><CheckCircle2 className="w-4 h-4" /></button>
                      <button className="min-w-0 text-left" onClick={() => setDetail({
                        title: n.title,
                        rows: [['Текст', n.body || '—'], ['Когда', formatDateTimeShort(n.createdAt)], ['Канал', n.channelName || '—']],
                        // Адрес уведомления главнее канала: задача по сделке
                        // должна открывать сделку, а не чат её клиента
                        linkTo: n.link || (n.channelId ? `/chats/${n.channelId}` : undefined),
                        linkLabel: n.link ? 'Открыть' : 'Открыть чат',
                      })}>
                        <p className="text-[13px] font-medium text-slate-800 truncate">{n.title}</p>
                        <p className="text-xs text-slate-500 line-clamp-2">{n.body}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatDateTimeShort(n.createdAt)}{n.channelName ? ` · ${n.channelName}` : ''}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#e8edf3] p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">💪 Сильные стороны и узкие места</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <ul className="space-y-1.5">
                {strengths.good.length === 0 && <li className="text-[12.5px] text-slate-400">наберётся с активностью</li>}
                {strengths.good.map((g, i) => (
                  <li key={i} className="text-[12.5px] text-slate-700 pl-4 relative">
                    <span className="absolute left-0 text-emerald-600 text-[10px]">▲</span>{g}
                  </li>
                ))}
              </ul>
              <ul className="space-y-1.5">
                {strengths.bad.length === 0 && <li className="text-[12.5px] text-slate-400">узких мест не видно 👌</li>}
                {strengths.bad.map((b, i) => (
                  <li key={i} className="text-[12.5px] text-slate-700 pl-4 relative">
                    <span className="absolute left-0 text-red-500 text-[10px]">▼</span>{b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 pb-4">
          Лестница эскалации: событие появляется здесь и в колокольчике; нет реакции 10–30 минут — бот напишет в Telegram; critical уходит сразу. Очередь дня продаж влита в «Требует меня»; полная страница очереди — по ссылке.
        </p>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[460px] max-w-[92vw] max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
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
