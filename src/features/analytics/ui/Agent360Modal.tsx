import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, AlertTriangle, MessageSquare, Clock, CheckCircle, Trophy,
  Phone, Hash, Mic, Image as ImageIcon, Video, FileText, Globe2, TrendingUp,
  TrendingDown, Minus, Smile, Meh, Frown, AlertCircle, Activity,
  Sparkles, ThumbsUp, AlertOctagon, Lightbulb, RefreshCw,
} from 'lucide-react'
import { Modal } from '@/shared/ui'

/* ============================================================ */
/* Types                                                         */
/* ============================================================ */

interface Agent360Payload {
  profile: {
    id: string | null
    name: string
    role: string
    status: string | null
    email?: string | null
    phone?: string | null
    position?: string | null
    telegramId?: string | null
    lastActiveAt?: string | null
  }
  period: { from: string; to: string; source: 'all' | 'telegram' | 'whatsapp' }
  kpi: {
    totalResponses: number
    totalMessages: number
    totalChars: number
    channelsServed: number
    activeDays: number
    avgFRT: number | null
    frtSessions?: number
    avgInBetween?: number | null
    inBetweenResponses?: number
    resolvedCases: number
    openCases: number
    stuckCases: number
    totalCases: number
  }
  bySource: Array<{ source: string; messages: number; avgFRT: number | null; channels: number }>
  byContentType: Array<{ type: string; count: number; share: number }>
  byLanguage: Array<{ lang: string; count: number; share: number }>
  byDomain: Array<{ domain: string; subcategory: string | null; count: number }>
  statusFunnel: Array<{ status: string; count: number }>
  dailyTrend: Array<{ date: string; messages: number; resolved: number; avgFRT: number | null }>
  sentiment: { positive: number; neutral: number; negative: number; total: number }
  vsTeam: { responses: number | null; resolved: number | null; medianResponses: number; medianResolved: number }
  recentResolved: Array<{ caseId: string; ticket: string | null; title: string; resolvedAt: string | null; resolutionHours: number | null }>
  stuck: Array<{ caseId: string; ticket: string | null; title: string; status?: string; createdAt?: string; daysOpen?: number }>
  topChannels: Array<{ channelId: string; name: string; source: string; messages: number }>
}

interface Agent360ModalProps {
  isOpen: boolean
  onClose: () => void
  agentName: string | null
  agentId?: string | null
  from: string
  to: string
  source: 'all' | 'telegram' | 'whatsapp'
}

/* ============================================================ */
/* Helpers                                                       */
/* ============================================================ */

const CONTENT_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  text: { label: 'Текст', icon: MessageSquare, color: 'text-slate-500' },
  voice: { label: 'Голос', icon: Mic, color: 'text-violet-500' },
  audio: { label: 'Аудио', icon: Mic, color: 'text-violet-500' },
  photo: { label: 'Фото', icon: ImageIcon, color: 'text-amber-500' },
  image: { label: 'Фото', icon: ImageIcon, color: 'text-amber-500' },
  video: { label: 'Видео', icon: Video, color: 'text-rose-500' },
  document: { label: 'Документ', icon: FileText, color: 'text-blue-500' },
  file: { label: 'Файл', icon: FileText, color: 'text-blue-500' },
}

const LANG_LABELS: Record<string, string> = {
  ru: 'Русский', uz: 'Узбекский', en: 'English', kk: 'Казахский',
  ky: 'Кыргызский', tg: 'Таджикский', tr: 'Турецкий', unknown: 'Неизв.',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  detected: { label: 'Обнаружено', color: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'В работе', color: 'bg-blue-100 text-blue-700' },
  waiting: { label: 'Ожидание', color: 'bg-amber-100 text-amber-700' },
  blocked: { label: 'Заблокировано', color: 'bg-red-100 text-red-700' },
  resolved: { label: 'Решено', color: 'bg-green-100 text-green-700' },
  closed: { label: 'Закрыто', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Отменено', color: 'bg-slate-100 text-slate-500' },
  recurring: { label: 'Повтор', color: 'bg-orange-100 text-orange-700' },
}

const ROLE_LABELS: Record<string, string> = { admin: 'Админ', manager: 'Менеджер', agent: 'Агент' }

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 1) return '<1м'
  if (m < 60) return `${Math.round(m * 10) / 10}м`
  return `${(m / 60).toFixed(1)}ч`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'whatsapp') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700">
        <Phone className="w-2.5 h-2.5" /> WhatsApp
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-100 text-blue-700">
      ✈ Telegram
    </span>
  )
}

/* ============================================================ */
/* Modal                                                         */
/* ============================================================ */

export function Agent360Modal({
  isOpen, onClose, agentName, agentId, from, to, source,
}: Agent360ModalProps) {
  const [data, setData] = useState<Agent360Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || (!agentName && !agentId)) {
      setData(null)
      setError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const token = localStorage.getItem('support_agent_token')
        const params = new URLSearchParams()
        if (agentId) params.set('agentId', agentId)
        if (agentName) params.set('name', agentName)
        params.set('from', from)
        params.set('to', to)
        params.set('source', source)

        const res = await fetch(`/api/support/analytics/agent-360?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token || ''}` },
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) {
          if (json?.error === 'agent_not_in_team') {
            throw new Error(
              json?.message ||
                'Этот пользователь не входит в нашу команду поддержки — 360°-профиль доступен только для членов команды.'
            )
          }
          throw new Error(json?.message || json?.error || `HTTP ${res.status}`)
        }
        if (json?.error) throw new Error(json.message || json.error)
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [isOpen, agentName, agentId, from, to, source])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={agentName ? `360° — ${agentName}` : '360°'} size="xl">
      <div className="space-y-5 max-h-[80vh] overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            <span className="ml-3 text-sm text-slate-500">Собираем 360° профиль…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Не удалось построить профиль</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && data && <Agent360Body data={data} />}
      </div>
    </Modal>
  )
}

/* ============================================================ */
/* Body                                                          */
/* ============================================================ */

function Agent360Body({ data }: { data: Agent360Payload }) {
  const { profile, kpi, period, bySource, byContentType, byLanguage, byDomain,
    statusFunnel, dailyTrend, sentiment, vsTeam, recentResolved, stuck, topChannels } = data

  const maxDailyMsg = useMemo(
    () => Math.max(1, ...dailyTrend.map((d) => d.messages)),
    [dailyTrend]
  )

  const totalResolved = useMemo(
    () => statusFunnel.find((s) => s.status === 'resolved')?.count || 0,
    [statusFunnel]
  )
  const totalCases = statusFunnel.reduce((s, r) => s + r.count, 0)

  return (
    <>
      {/* Profile header */}
      <div className="bg-gradient-to-r from-slate-50 to-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{profile.name}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-medium">
                {ROLE_LABELS[profile.role] || profile.role}
              </span>
              {profile.position && <span>· {profile.position}</span>}
              {profile.status && <span>· {profile.status}</span>}
              {profile.lastActiveAt && <span>· был {formatDate(profile.lastActiveAt)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
              {profile.email && <span>{profile.email}</span>}
              {profile.phone && <span>{profile.phone}</span>}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Период: {period.from} — {period.to}</p>
            <p className="mt-0.5">
              Источник: {period.source === 'all' ? 'все' : period.source === 'telegram' ? 'Telegram' : 'WhatsApp'}
            </p>
          </div>
        </div>
      </div>

      {/* AI-обзор */}
      <AgentAiSummary data={data} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<MessageSquare className="w-4 h-4" />}
          label="Ответов / сообщений"
          value={String(kpi.totalResponses)}
          sub={`${formatNumber(kpi.totalChars)} символов · ${kpi.channelsServed} каналов`}
          accent="blue"
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          label="Время первой реакции"
          value={formatMinutes(kpi.avgFRT)}
          sub={
            kpi.frtSessions
              ? `${kpi.frtSessions} сессий · в беседе ${formatMinutes(kpi.avgInBetween ?? null)}`
              : 'нет данных по FRT'
          }
          accent="violet"
          title="Классический FRT — первый ответ агента на новый запрос клиента (исключая короткие 'спасибо/ок'). Совпадает с SLA-лидербордом. В скобках — средняя задержка между сообщением клиента и любым ответом агента в беседе."
        />
        <KpiCard
          icon={<CheckCircle className="w-4 h-4" />}
          label="Решено / открыто"
          value={`${kpi.resolvedCases} / ${kpi.openCases}`}
          sub={kpi.totalCases ? `всего ${kpi.totalCases} кейсов` : 'нет кейсов'}
          accent="green"
        />
        <KpiCard
          icon={<AlertCircle className="w-4 h-4" />}
          label="Зависших >24ч"
          value={String(kpi.stuckCases)}
          sub={kpi.stuckCases > 0 ? 'требуют внимания' : 'всё чисто'}
          accent={kpi.stuckCases > 0 ? 'red' : 'slate'}
        />
      </div>

      {/* vs Team */}
      {(vsTeam.responses != null || vsTeam.resolved != null) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-700">Сравнение с командой</h4>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <VsTeamItem
              label="Ответов в чатах"
              value={kpi.totalResponses}
              median={vsTeam.medianResponses}
              delta={vsTeam.responses}
            />
            <VsTeamItem
              label="Решённых кейсов"
              value={kpi.resolvedCases}
              median={vsTeam.medianResolved}
              delta={vsTeam.resolved}
            />
          </div>
        </div>
      )}

      {/* Trend */}
      {dailyTrend.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-700">Активность по дням</h4>
            <span className="text-xs text-slate-400">{dailyTrend.length} дней</span>
          </div>
          <div className="flex items-end gap-1 h-24">
            {dailyTrend.map((d) => {
              const h = Math.max(2, Math.round((d.messages / maxDailyMsg) * 100))
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative" title={`${d.date}: ${d.messages} сообщ., решено ${d.resolved}`}>
                  <div className="w-full bg-blue-100 rounded-t relative" style={{ height: `${h}%` }}>
                    <div className="absolute inset-x-0 bottom-0 bg-blue-500 rounded-t" style={{ height: '100%' }} />
                    {d.resolved > 0 && (
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
            <span>{dailyTrend[0]?.date}</span>
            <span>{dailyTrend[dailyTrend.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Two columns: source/content/language vs domain/funnel/sentiment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By source */}
        <SectionBox title="Каналы по источнику" icon={<TrendingUp className="w-4 h-4 text-slate-500" />}>
          {bySource.length === 0 ? (
            <EmptyHint />
          ) : (
            bySource.map((s) => {
              const total = bySource.reduce((sum, r) => sum + r.messages, 0)
              const pct = total > 0 ? Math.round((s.messages / total) * 100) : 0
              return (
                <div key={s.source} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <SourceBadge source={s.source} />
                    <span className="text-slate-600 text-xs">{s.channels} каналов</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${s.source === 'whatsapp' ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-medium tabular-nums text-slate-800 w-14 text-right">
                      {s.messages}
                    </span>
                    <span className="text-xs text-slate-400 w-12 text-right">
                      {s.avgFRT != null ? formatMinutes(s.avgFRT) : '—'}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </SectionBox>

        {/* By content type */}
        <SectionBox title="Типы контента" icon={<MessageSquare className="w-4 h-4 text-slate-500" />}>
          {byContentType.length === 0 ? (
            <EmptyHint />
          ) : (
            byContentType.map((ct) => {
              const cfg = CONTENT_TYPE_LABELS[ct.type] || { label: ct.type, icon: FileText, color: 'text-slate-500' }
              const Icon = cfg.icon
              return (
                <div key={ct.type} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    <span className="text-slate-700">{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-400" style={{ width: `${ct.share}%` }} />
                    </div>
                    <span className="font-medium tabular-nums text-slate-800 w-12 text-right">{ct.count}</span>
                    <span className="text-xs text-slate-400 w-10 text-right">{ct.share}%</span>
                  </div>
                </div>
              )
            })
          )}
        </SectionBox>

        {/* Languages */}
        <SectionBox title="Языки клиентов" icon={<Globe2 className="w-4 h-4 text-slate-500" />}>
          {byLanguage.length === 0 ? (
            <EmptyHint hint="Языки берутся из расшифровок голосовых, нет данных" />
          ) : (
            byLanguage.map((l) => (
              <div key={l.lang} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-700">{LANG_LABELS[l.lang] || l.lang}</span>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400" style={{ width: `${l.share}%` }} />
                  </div>
                  <span className="font-medium tabular-nums text-slate-800 w-12 text-right">{l.count}</span>
                  <span className="text-xs text-slate-400 w-10 text-right">{l.share}%</span>
                </div>
              </div>
            ))
          )}
        </SectionBox>

        {/* Sentiment */}
        <SectionBox title="Настроение клиентов" icon={<Smile className="w-4 h-4 text-slate-500" />}>
          {sentiment.total === 0 ? (
            <EmptyHint hint="AI-анализ настроения недоступен" />
          ) : (
            <div className="space-y-2">
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                {sentiment.positive > 0 && <div className="bg-green-500" style={{ width: `${sentiment.positive}%` }} />}
                {sentiment.neutral > 0 && <div className="bg-slate-300" style={{ width: `${sentiment.neutral}%` }} />}
                {sentiment.negative > 0 && <div className="bg-red-500" style={{ width: `${sentiment.negative}%` }} />}
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1 text-green-700"><Smile className="w-3.5 h-3.5" /> {sentiment.positive}%</span>
                <span className="flex items-center gap-1 text-slate-600"><Meh className="w-3.5 h-3.5" /> {sentiment.neutral}%</span>
                <span className="flex items-center gap-1 text-red-700"><Frown className="w-3.5 h-3.5" /> {sentiment.negative}%</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">по {sentiment.total} сообщениям клиентов в его каналах</p>
            </div>
          )}
        </SectionBox>

        {/* Status funnel */}
        <SectionBox title="Воронка кейсов" icon={<Trophy className="w-4 h-4 text-slate-500" />}>
          {statusFunnel.length === 0 ? (
            <EmptyHint />
          ) : (
            statusFunnel.map((s) => {
              const cfg = STATUS_LABELS[s.status] || { label: s.status, color: 'bg-slate-100 text-slate-600' }
              return (
                <div key={s.status} className="flex items-center justify-between py-1.5 text-sm">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-800">{s.count}</span>
                </div>
              )
            })
          )}
          {totalCases > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Конверсия в решение</span>
              <span className="font-semibold text-slate-700">
                {Math.round((totalResolved / totalCases) * 100)}%
              </span>
            </div>
          )}
        </SectionBox>

        {/* Top categories */}
        <SectionBox title="Топ категорий обращений" icon={<Hash className="w-4 h-4 text-slate-500" />}>
          {byDomain.length === 0 ? (
            <EmptyHint hint="Кейсы ещё не категоризированы" />
          ) : (
            byDomain.map((d, i) => (
              <div key={`${d.domain}-${d.subcategory}-${i}`} className="flex items-center justify-between py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="text-slate-700">{d.domain}</span>
                  {d.subcategory && (
                    <span className="text-slate-400 text-xs ml-1">/ {d.subcategory}</span>
                  )}
                </div>
                <span className="font-semibold tabular-nums text-slate-800 ml-2">{d.count}</span>
              </div>
            ))
          )}
        </SectionBox>
      </div>

      {/* Top channels */}
      {topChannels.length > 0 && (
        <SectionBox title="Топ каналов" icon={<MessageSquare className="w-4 h-4 text-slate-500" />}>
          {topChannels.map((c) => (
            <div key={c.channelId} className="flex items-center justify-between py-1.5 text-sm">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SourceBadge source={c.source} />
                <span className="truncate text-slate-700">{c.name}</span>
              </div>
              <span className="font-semibold tabular-nums text-slate-800 ml-2">{c.messages}</span>
            </div>
          ))}
        </SectionBox>
      )}

      {/* Lists: stuck + recent resolved */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionBox
          title={
            kpi.stuckCases > stuck.length
              ? `Зависшие кейсы (${stuck.length} из ${kpi.stuckCases})`
              : `Зависшие кейсы (${stuck.length})`
          }
          icon={<AlertCircle className="w-4 h-4 text-red-500" />}
        >
          {stuck.length === 0 ? (
            <EmptyHint hint="Нет зависших кейсов — отлично" />
          ) : (
            stuck.map((c) => (
              <a
                key={c.caseId}
                href={`/cases/${c.caseId}`}
                className="block py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {c.ticket && <span className="text-slate-400 mr-1">#{c.ticket}</span>}
                      {c.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {STATUS_LABELS[c.status || '']?.label || c.status} · открыт {(c.daysOpen || 0).toFixed(1)} дн.
                    </p>
                  </div>
                </div>
              </a>
            ))
          )}
        </SectionBox>

        <SectionBox
          title={
            kpi.resolvedCases > recentResolved.length
              ? `Последние решённые (${recentResolved.length} из ${kpi.resolvedCases})`
              : `Последние решённые (${recentResolved.length})`
          }
          icon={<CheckCircle className="w-4 h-4 text-green-500" />}
        >
          {recentResolved.length === 0 ? (
            <EmptyHint hint="За период нет решённых кейсов" />
          ) : (
            recentResolved.map((c) => (
              <a
                key={c.caseId}
                href={`/cases/${c.caseId}`}
                className="block py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {c.ticket && <span className="text-slate-400 mr-1">#{c.ticket}</span>}
                      {c.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatDate(c.resolvedAt)}
                      {c.resolutionHours != null && ` · за ${c.resolutionHours}ч`}
                    </p>
                  </div>
                </div>
              </a>
            ))
          )}
        </SectionBox>
      </div>
    </>
  )
}

/* ============================================================ */
/* Subcomponents                                                 */
/* ============================================================ */

function KpiCard({ icon, label, value, sub, accent, title }: {
  icon: React.ReactNode; label: string; value: string; sub: string
  accent: 'blue' | 'green' | 'violet' | 'red' | 'slate'
  title?: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
  }
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-3"
      title={title}
    >
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${colors[accent]}`}>
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  )
}

function VsTeamItem({ label, value, median, delta }: {
  label: string; value: number; median: number; delta: number | null
}) {
  let icon: React.ReactNode = <Minus className="w-3.5 h-3.5" />
  let color = 'text-slate-500'
  let bg = 'bg-slate-100'
  if (delta != null) {
    if (delta > 10) { icon = <TrendingUp className="w-3.5 h-3.5" />; color = 'text-green-700'; bg = 'bg-green-100' }
    else if (delta < -10) { icon = <TrendingDown className="w-3.5 h-3.5" />; color = 'text-red-700'; bg = 'bg-red-100' }
  }
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xl font-bold text-slate-900 tabular-nums">{value}</span>
        {delta != null && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded ${bg} ${color}`}>
            {icon}
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-0.5">медиана команды: {median}</p>
    </div>
  )
}

function SectionBox({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2.5">
        {icon}
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      </div>
      <div className="divide-y divide-slate-50">{children}</div>
    </div>
  )
}

/* ============================================================ */
/* AI Summary                                                    */
/* ============================================================ */

interface AiSummary {
  tldr: string
  strengths: string[]
  concerns: string[]
  recommendations: string[]
  verdict: 'top' | 'solid' | 'watch' | 'risk'
}

interface AiSummaryHistoryItem {
  id: string
  agentName: string
  period: { from: string; to: string; source: string }
  summary: AiSummary
  generatedAt: string
}

const VERDICT_META: Record<AiSummary['verdict'], { label: string; bg: string; text: string; ring: string }> = {
  top: { label: 'Топ-исполнитель', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  solid: { label: 'Стабильно', bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' },
  watch: { label: 'Под наблюдение', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  risk: { label: 'Срочно вмешаться', bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200' },
}

function AgentAiSummary({ data }: { data: Agent360Payload }) {
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AiSummaryHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const agentName = data.profile?.name || ''
  const periodFrom = data.period?.from || ''
  const periodTo = data.period?.to || ''
  const periodSource = data.period?.source || 'all'

  // 1) При открытии — подтягиваем историю и используем последнюю запись,
  //    если есть, чтобы не тратить токены без необходимости.
  useEffect(() => {
    if (!agentName) return
    let cancelled = false
    const load = async () => {
      setHistoryLoading(true)
      try {
        const token = localStorage.getItem('support_agent_token')
        const params = new URLSearchParams({ name: agentName, limit: '20' })
        const res = await fetch(`/api/support/analytics/agent-360-summary?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token || ''}` },
        })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        const items: AiSummaryHistoryItem[] = Array.isArray(json?.history) ? json.history : []
        setHistory(items)

        // Если есть запись по тому же периоду+источнику — показываем её сразу
        const match = items.find(
          (h) => h.period.from === periodFrom && h.period.to === periodTo && h.period.source === periodSource
        )
        if (match) {
          setSummary(match.summary)
          setGeneratedAt(match.generatedAt)
        } else {
          setSummary(null)
          setGeneratedAt(null)
          // Автогенерация если истории по этому периоду нет
          generate()
        }
      } catch {
        // история не критична — молча игнорируем, но триггерим генерацию
        if (!cancelled) generate()
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, periodFrom, periodTo, periodSource])

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/analytics/agent-360-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ payload: data }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`)
      const s: AiSummary = json?.summary
      if (!s) throw new Error('пустой ответ AI')
      setSummary(s)
      setGeneratedAt(json?.generatedAt || new Date().toISOString())
      // Добавляем в начало истории
      if (json?.id) {
        setHistory((prev) => [
          {
            id: String(json.id),
            agentName,
            period: { from: periodFrom, to: periodTo, source: periodSource },
            summary: s,
            generatedAt: json.generatedAt || new Date().toISOString(),
          },
          ...prev,
        ])
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить AI-обзор')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-gradient-to-br from-violet-50 via-white to-blue-50 border border-violet-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-100 text-violet-600">
            <Sparkles className="w-4 h-4" />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">AI-обзор по сотруднику</h4>
            <p className="text-[11px] text-slate-500">сгенерировано на основе метрик за период</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary && !loading && (
            <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${VERDICT_META[summary.verdict].bg} ${VERDICT_META[summary.verdict].text} ring-1 ${VERDICT_META[summary.verdict].ring}`}>
              {VERDICT_META[summary.verdict].label}
            </span>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-50"
            title="Сгенерировать заново"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Думаю…' : 'Обновить'}
          </button>
        </div>
      </div>

      {loading && !summary && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
          AI анализирует профиль (10–20 секунд)…
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">AI-обзор не построился</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-3">
          {summary.tldr && (
            <p className="text-sm text-slate-800 leading-relaxed">{summary.tldr}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryColumn
              icon={<ThumbsUp className="w-3.5 h-3.5" />}
              title="Сильные стороны"
              tone="green"
              items={summary.strengths}
              empty="Нет явных сильных метрик за период"
            />
            <SummaryColumn
              icon={<AlertOctagon className="w-3.5 h-3.5" />}
              title="Что просаживает"
              tone="red"
              items={summary.concerns}
              empty="Просадок не обнаружено"
            />
            <SummaryColumn
              icon={<Lightbulb className="w-3.5 h-3.5" />}
              title="Что делать"
              tone="blue"
              items={summary.recommendations}
              empty="Рекомендаций нет"
            />
          </div>

          {generatedAt && (
            <p className="text-[11px] text-slate-400">
              Сгенерировано {formatDate(generatedAt)}
            </p>
          )}
        </div>
      )}

      {/* История генераций ----------------------------------------- */}
      {history.length > 0 && (
        <div className="mt-4 pt-3 border-t border-violet-100">
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              История генераций
            </h5>
            <span className="text-[11px] text-slate-400">
              {history.length}
              {historyLoading && (
                <Loader2 className="inline-block w-3 h-3 ml-1 animate-spin text-slate-400" />
              )}
            </span>
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {history.map((item) => {
              const isOpen = expandedId === item.id
              const v = VERDICT_META[item.summary.verdict]
              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-lg text-xs"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : item.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 rounded-lg"
                  >
                    <span className="text-slate-500 tabular-nums w-[88px] shrink-0">
                      {formatDate(item.generatedAt)}
                    </span>
                    <span className="text-slate-400 hidden sm:inline">·</span>
                    <span className="text-slate-500 hidden sm:inline tabular-nums">
                      {item.period.from} – {item.period.to}
                    </span>
                    <span className="text-slate-400 hidden md:inline">·</span>
                    <span className="text-slate-500 hidden md:inline">
                      {item.period.source === 'all' ? 'все' : item.period.source}
                    </span>
                    <span className={`ml-auto inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ${v.bg} ${v.text}`}>
                      {v.label}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 px-3 py-2.5 space-y-2.5 bg-slate-50/40">
                      {item.summary.tldr && (
                        <p className="text-[12px] text-slate-700 leading-relaxed">
                          {item.summary.tldr}
                        </p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <SummaryColumn
                          icon={<ThumbsUp className="w-3 h-3" />}
                          title="Плюсы"
                          tone="green"
                          items={item.summary.strengths}
                          empty="—"
                        />
                        <SummaryColumn
                          icon={<AlertOctagon className="w-3 h-3" />}
                          title="Минусы"
                          tone="red"
                          items={item.summary.concerns}
                          empty="—"
                        />
                        <SummaryColumn
                          icon={<Lightbulb className="w-3 h-3" />}
                          title="Действия"
                          tone="blue"
                          items={item.summary.recommendations}
                          empty="—"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryColumn({
  icon, title, tone, items, empty,
}: {
  icon: React.ReactNode
  title: string
  tone: 'green' | 'red' | 'blue'
  items: string[]
  empty: string
}) {
  const toneClass = {
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }[tone]

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${toneClass} mb-2`}>
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, idx) => (
            <li key={idx} className="text-xs text-slate-700 leading-relaxed flex gap-1.5">
              <span className="text-slate-300 mt-0.5">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyHint({ hint }: { hint?: string }) {
  return <p className="text-xs text-slate-400 py-2">{hint || 'Нет данных за период'}</p>
}
