import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, Clock, TrendingUp, TrendingDown,
  Repeat, Users, Loader2, RefreshCw, Flame, Timer, ArrowRight,
  MessageSquare, Mic, Video, Image as ImageIcon, FileText, Languages,
  Target, UserX, Smile, Frown, Zap,
} from 'lucide-react'
import { fetchSupportHealth, type SupportHealthPayload, type HealthPeriod, type HealthDrillKind } from '@/shared/api'
import { HealthDrilldownModal } from './HealthDrilldownModal'
import { RootCauseSection } from './RootCauseSection'
import { CategoryFlowSection } from './CategoryFlowSection'
import { TaxonomyBackfillPanel } from './TaxonomyBackfillPanel'

const PERIOD_OPTIONS: { value: HealthPeriod; label: string }[] = [
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: '90d', label: 'Последние 90 дней' },
]

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Техническая',
  integration: 'Интеграция',
  general: 'Общее',
  complaint: 'Жалоба',
  billing: 'Оплата / биллинг',
  feature_request: 'Запрос функции',
  onboarding: 'Подключение',
  question: 'Вопрос',
  feedback: 'Обратная связь',
  order: 'Заказы',
  delivery: 'Доставка',
  menu: 'Меню',
  app: 'Приложение',
}

function formatCategory(c: string): string {
  return CATEGORY_LABELS[c?.toLowerCase()] || c || 'Без категории'
}

function formatHours(h: number): string {
  if (h < 1) return '<1ч'
  if (h < 24) return `${Math.round(h)}ч`
  return `${Math.round(h / 24)}д`
}

interface DrillState {
  kind: HealthDrillKind
  value: string
  title: string
}

export function HealthPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<HealthPeriod>('7d')
  const [data, setData] = useState<SupportHealthPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drill, setDrill] = useState<DrillState | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchSupportHealth({ period })
      setData(res)
    } catch (e) {
      console.error(e)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-slate-500">Загрузка…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-slate-700 font-medium">{error}</p>
          <button onClick={load} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const createdDeltaTone = data.stats.createdDelta > 0 ? 'text-red-600' : data.stats.createdDelta < 0 ? 'text-green-600' : 'text-slate-500'
  const actions = buildActions(data, {
    openDrill: (d) => setDrill(d),
    goChannel: (id) => navigate(`/chats?channel=${id}`),
    goCases: () => navigate('/cases'),
  })

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-800">Где у нас болит</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">Сводка сигналов, на которые стоит реагировать сегодня</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as HealthPeriod)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {PERIOD_OPTIONS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            title="Обновить"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiCard
          label="Создано за период"
          value={data.stats.totalCreated}
          hint={
            <span className={createdDeltaTone}>
              {data.stats.createdDelta > 0 ? '↑' : data.stats.createdDelta < 0 ? '↓' : ''}
              {' '}{Math.abs(data.stats.createdDelta)} к прошлому периоду
            </span>
          }
          icon={TrendingUp}
          color="text-blue-600 bg-blue-50"
        />
        <KpiCard
          label="Закрыто за период"
          value={data.stats.totalResolved}
          icon={TrendingDown}
          color="text-green-600 bg-green-50"
        />
        <KpiCard
          label="Открыто сейчас"
          value={data.stats.openNow}
          icon={Clock}
          color="text-amber-600 bg-amber-50"
        />
        <KpiCard
          label="Без ответственного"
          value={data.stats.unassignedNow}
          icon={Users}
          color="text-red-600 bg-red-50"
          warn={data.stats.unassignedNow > 0}
        />
        <KpiCard
          label="Среднее закрытие"
          value={data.stats.avgResolutionHours != null ? `${data.stats.avgResolutionHours.toFixed(1)}ч` : '—'}
          icon={Timer}
          color="text-slate-600 bg-slate-100"
        />
      </div>

      {/* Новая таксономия: KPI + treemap + stacked bars + таблицы */}
      <CategoryFlowSection period={period} />

      {/* Переразметка таксономии (админский блок) */}
      <TaxonomyBackfillPanel period={period} />

      {/* Корневые причины — AI-анализ */}
      <RootCauseSection period={period} />

      {/* Что делать прямо сейчас */}
      {actions.length > 0 && (
        <div className="bg-white border-2 border-blue-200 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <Zap className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">Что делать сейчас</div>
              <div className="text-xs text-slate-500">Самые важные сигналы за период — с кнопкой прямого действия</div>
            </div>
          </div>
          <ul className="space-y-2">
            {actions.map((a, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border ${a.tone === 'red' ? 'bg-red-50 border-red-100' : a.tone === 'amber' ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${a.tone === 'red' ? 'text-red-800' : a.tone === 'amber' ? 'text-amber-800' : 'text-slate-800'}`}>
                    {a.title}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{a.hint}</div>
                </div>
                <button
                  onClick={a.onAction}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 flex-shrink-0 ${a.tone === 'red' ? 'bg-red-600 text-white hover:bg-red-700' : a.tone === 'amber' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-700 text-white hover:bg-slate-800'}`}
                >
                  {a.actionLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Что болит в продукте */}
        <SectionCard
          title="Что болит в продукте"
          hint="Категории с наибольшим числом кейсов"
          icon={AlertTriangle}
          empty={data.topCategories.length === 0}
        >
          {data.topCategories.map(cat => (
            <RowLink
              key={cat.category}
              onClick={() => navigate(`/cases?category=${encodeURIComponent(cat.category)}`)}
              left={
                <>
                  <span className="font-medium text-slate-800">{formatCategory(cat.category)}</span>
                  <span className="text-xs text-slate-500">{cat.cases} {pluralCases(cat.cases)}</span>
                </>
              }
              right={<DeltaBadge delta={cat.delta} pct={cat.deltaPct} />}
            />
          ))}
        </SectionCard>

        {/* Root causes (по полю root_cause из кейсов — заполняет агент) */}
        <SectionCard
          title="Причины из карточек кейсов"
          hint="Что агенты вручную указали в root_cause"
          icon={Flame}
          empty={data.topRootCauses.length === 0}
        >
          {data.topRootCauses.map((rc, i) => (
            <RowLink
              key={`${rc.rootCause}-${i}`}
              onClick={() => {}}
              left={
                <>
                  <span className="font-medium text-slate-800 truncate">{rc.rootCause}</span>
                  <span className="text-xs text-slate-500">{rc.cases} {pluralCases(rc.cases)}</span>
                </>
              }
              right={
                rc.impactMrr > 0 ? (
                  <span className="text-sm text-red-600 font-semibold">−{rc.impactMrr.toLocaleString('ru-RU')}</span>
                ) : null
              }
            />
          ))}
        </SectionCard>

        {/* Клиенты с наибольшей болью */}
        <SectionCard
          title="Клиенты, которые грузят больше всех"
          hint="Топ каналов по количеству кейсов"
          icon={Users}
          empty={data.hotChannels.length === 0}
        >
          {data.hotChannels.map(ch => (
            <RowLink
              key={ch.channelId}
              onClick={() => navigate(`/chats?channel=${ch.channelId}`)}
              left={
                <>
                  <span className="font-medium text-slate-800 truncate">{ch.channelName}</span>
                  <span className="text-xs text-slate-500">
                    {ch.totalCases} {pluralCases(ch.totalCases)} • открыто {ch.openCases} • ср. возраст {formatHours(ch.avgAgeHours)}
                  </span>
                </>
              }
              right={
                ch.openCases > 0 ? (
                  <span className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded font-medium">
                    {ch.openCases} откр.
                  </span>
                ) : null
              }
            />
          ))}
        </SectionCard>

        {/* Повторяющиеся проблемы */}
        <SectionCard
          title="Повторяющиеся проблемы"
          hint="Кейсы с флагом «повторяется» по категориям"
          icon={Repeat}
          empty={data.recurring.length === 0}
        >
          {data.recurring.map((r, i) => (
            <RowLink
              key={`${r.category}-${i}`}
              onClick={() => navigate(`/cases?category=${encodeURIComponent(r.category)}`)}
              left={
                <>
                  <span className="font-medium text-slate-800">{formatCategory(r.category)}</span>
                  <span className="text-xs text-slate-500">
                    {r.cases} {pluralCases(r.cases)} в {r.channelsCount} {pluralChannels(r.channelsCount)}
                  </span>
                </>
              }
              right={null}
            />
          ))}
        </SectionCard>

        {/* О чём реально пишут клиенты (AI-темы) */}
        <SectionCard
          title="О чём реально пишут клиенты"
          hint="AI определил темы из текста и расшифровок аудио/видео"
          icon={MessageSquare}
          empty={data.topAiTopics.length === 0}
        >
          {data.topAiTopics.map((t) => (
            <RowLink
              key={t.topic}
              onClick={() => setDrill({ kind: 'topic', value: t.topic, title: formatCategory(t.topic) })}
              left={
                <>
                  <span className="font-medium text-slate-800">{formatCategory(t.topic)}</span>
                  <span className="text-xs text-slate-500">{t.messages} {pluralMessages(t.messages)}</span>
                </>
              }
              right={<DeltaBadge delta={t.delta} pct={t.deltaPct} />}
            />
          ))}
        </SectionCard>

        {/* Что хотят клиенты (intents) */}
        <SectionCard
          title="Что хотят клиенты"
          hint="Намерения из сообщений: жалобы, просьбы, вопросы"
          icon={Target}
          empty={data.topIntents.length === 0}
        >
          {data.topIntents.map((it) => (
            <RowLink
              key={it.intent}
              onClick={() => setDrill({ kind: 'intent', value: it.intent, title: formatIntent(it.intent) })}
              left={
                <>
                  <span className="font-medium text-slate-800">{formatIntent(it.intent)}</span>
                  <span className="text-xs text-slate-500">
                    {it.messages} {pluralMessages(it.messages)} • {it.channels} {pluralChannels(it.channels)}
                  </span>
                </>
              }
              right={
                <div className="flex items-center gap-1">
                  {it.urgent > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded">
                      срочно: {it.urgent}
                    </span>
                  )}
                  {it.negative > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 rounded">
                      негатив: {it.negative}
                    </span>
                  )}
                </div>
              }
            />
          ))}
        </SectionCard>

        {/* Как клиенты общаются: текст/голос/видео/фото */}
        <SectionCard
          title="Как клиенты пишут"
          hint="Распределение сообщений по типу контента"
          icon={Mic}
          empty={data.contentMix.length === 0}
        >
          {data.contentMix.map((ct) => (
            <RowLink
              key={ct.contentType}
              onClick={() => setDrill({ kind: 'content_type', value: ct.contentType, title: formatContentType(ct.contentType) })}
              left={
                <>
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    {contentTypeIcon(ct.contentType)}
                    {formatContentType(ct.contentType)}
                  </span>
                  <span className="text-xs text-slate-500">{ct.messages} {pluralMessages(ct.messages)}</span>
                </>
              }
              right={<ShareBar percent={ct.share} />}
            />
          ))}
        </SectionCard>

        {/* Языки переписки */}
        <SectionCard
          title="Языки общения"
          hint="По расшифровкам голосовых и видео"
          icon={Languages}
          empty={data.byLanguage.length === 0}
        >
          {data.byLanguage.map((l) => (
            <RowLink
              key={l.language}
              onClick={() => setDrill({ kind: 'language', value: l.language, title: languageLabel(l.language) })}
              left={
                <>
                  <span className="font-medium text-slate-800">{languageLabel(l.language)}</span>
                  <span className="text-xs text-slate-500">{l.messages} {pluralMessages(l.messages)}</span>
                </>
              }
              right={<ShareBar percent={l.share} />}
            />
          ))}
        </SectionCard>

        {/* Слабые звенья команды - на всю ширину */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Кто из команды тянет назад"
            hint="Агенты ≥3 кейса за период: сортировка по зависшим и % закрытых"
            icon={UserX}
            accent="border-amber-200"
            empty={data.bottomAgents.length === 0}
          >
            {data.bottomAgents.map((a) => (
              <li
                key={a.agentId}
                className="px-4 py-3 hover:bg-slate-50 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-full bg-slate-200 flex-shrink-0 flex items-center justify-center text-slate-600 font-semibold text-sm overflow-hidden">
                  {a.avatarUrl ? (
                    <img src={a.avatarUrl} alt={a.agentName} className="w-full h-full object-cover" />
                  ) : (
                    a.agentName.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">{a.agentName}</div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>назначено: {a.assigned}</span>
                    <span className={a.resolvedPct < 50 ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                      закрыто: {a.resolved} ({a.resolvedPct}%)
                    </span>
                    {a.avgFirstResponseMin != null && (
                      <span>FRT: {formatMinutes(a.avgFirstResponseMin)}</span>
                    )}
                    {a.avgResolutionHours != null && (
                      <span>ср. закрытие: {a.avgResolutionHours.toFixed(1)}ч</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {a.stuck > 0 && (
                    <span className="px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-700 rounded">
                      зависло: {a.stuck}
                    </span>
                  )}
                  {a.openNow > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded">
                      в работе: {a.openNow}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </SectionCard>
        </div>

        {/* Застряли без движения - на всю ширину */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Застряли без движения"
            hint="Открытые кейсы > 24ч без смены статуса"
            icon={Timer}
            accent="border-red-200"
            empty={data.stuckCases.length === 0}
          >
            {data.stuckCases.map(c => (
              <RowLink
                key={c.id}
                onClick={() => c.channelId ? navigate(`/chats?channel=${c.channelId}`) : navigate('/cases')}
                left={
                  <>
                    <span className="text-xs font-mono text-blue-600 font-semibold">
                      {c.ticketNumber ? `#${c.ticketNumber}` : c.id.slice(0, 6).toUpperCase()}
                    </span>
                    <span className="font-medium text-slate-800 truncate">{c.title}</span>
                    <span className="text-xs text-slate-500 truncate">
                      {c.channelName || '—'} • {c.assigneeName || 'без ответственного'}
                    </span>
                  </>
                }
                right={
                  <span className="px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 rounded">
                    {formatHours(c.hoursInStatus)} в {statusLabel(c.status)}
                  </span>
                }
              />
            ))}
          </SectionCard>
        </div>
      </div>

      {/* Sentiment bar */}
      {data.sentiment.total > 0 && (
        <div className="mt-5 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-slate-800">Настроение клиентов</div>
            <div className="text-xs text-slate-500">{data.sentiment.total} оценённых сообщений</div>
          </div>
          <SentimentBar s={data.sentiment} />
        </div>
      )}

      <div className="text-xs text-slate-400 mt-4 text-center">
        Данные за период с {new Date(data.period.from).toLocaleDateString('ru-RU')} по {new Date(data.period.to).toLocaleDateString('ru-RU')}
      </div>

      {drill && (
        <HealthDrilldownModal
          kind={drill.kind}
          value={drill.value}
          title={drill.title}
          period={period}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  )
}

// ===== action items builder =====

interface ActionItem {
  title: string
  hint: string
  actionLabel: string
  tone: 'red' | 'amber' | 'slate'
  onAction: () => void
}

interface ActionHandlers {
  openDrill: (d: DrillState) => void
  goChannel: (id: string) => void
  goCases: () => void
}

function buildActions(data: SupportHealthPayload, h: ActionHandlers): ActionItem[] {
  const out: ActionItem[] = []

  if (data.stats.unassignedNow > 0) {
    out.push({
      title: `${data.stats.unassignedNow} ${pluralCases(data.stats.unassignedNow)} без ответственного`,
      hint: 'Нужно назначить агента, иначе время первого ответа просядет',
      actionLabel: 'Распределить',
      tone: 'red',
      onAction: h.goCases,
    })
  }

  const stuckTop = data.stuckCases.slice(0, 3)
  if (stuckTop.length > 0) {
    const maxH = Math.max(...stuckTop.map((c) => c.hoursInStatus))
    out.push({
      title: `${data.stuckCases.length} ${pluralCases(data.stuckCases.length)} зависли > 24ч`,
      hint: `Самый старый — ${Math.round(maxH)}ч в статусе. Посмотри и двинь${stuckTop[0].assigneeName ? `, ответственный: ${stuckTop[0].assigneeName}` : ''}`,
      actionLabel: 'К кейсам',
      tone: 'amber',
      onAction: () => (stuckTop[0].channelId ? h.goChannel(stuckTop[0].channelId) : h.goCases()),
    })
  }

  const worstAgent = data.bottomAgents.find((a) => a.stuck >= 2 || (a.assigned >= 5 && a.resolvedPct < 40))
  if (worstAgent) {
    out.push({
      title: `${worstAgent.agentName}: ${worstAgent.stuck > 0 ? `${worstAgent.stuck} зависших, ` : ''}закрыто ${worstAgent.resolvedPct}% из ${worstAgent.assigned}`,
      hint: 'Разберите один на один — либо разгрузить, либо помочь с конкретными кейсами',
      actionLabel: 'К кейсам',
      tone: 'red',
      onAction: h.goCases,
    })
  }

  const growingTopic = data.topAiTopics.find((t) => t.delta >= 5 && (t.deltaPct == null || t.deltaPct >= 25))
  if (growingTopic) {
    const pct = growingTopic.deltaPct != null ? `, +${growingTopic.deltaPct}%` : ''
    out.push({
      title: `Тема «${formatCategory(growingTopic.topic)}» резко выросла (+${growingTopic.delta}${pct})`,
      hint: 'Посмотри сообщения — возможно, появилась системная проблема или нужна доработка',
      actionLabel: 'Смотреть',
      tone: 'amber',
      onAction: () => h.openDrill({ kind: 'topic', value: growingTopic.topic, title: formatCategory(growingTopic.topic) }),
    })
  }

  const urgentIntent = data.topIntents.find((it) => it.urgent >= 3 || (it.negative >= 5 && it.messages >= 10))
  if (urgentIntent) {
    const mark = urgentIntent.urgent >= 3 ? `${urgentIntent.urgent} срочных` : `${urgentIntent.negative} негативных`
    out.push({
      title: `«${formatIntent(urgentIntent.intent)}»: ${mark} сообщений`,
      hint: 'Разобраться с первопричиной и ответить клиентам',
      actionLabel: 'Смотреть',
      tone: 'red',
      onAction: () => h.openDrill({ kind: 'intent', value: urgentIntent.intent, title: formatIntent(urgentIntent.intent) }),
    })
  }

  const hot = data.hotChannels[0]
  if (hot && data.hotChannels.length > 1) {
    const second = data.hotChannels[1]
    if (hot.totalCases >= 5 && hot.totalCases >= second.totalCases * 2) {
      out.push({
        title: `${hot.channelName} грузит в ${(hot.totalCases / Math.max(1, second.totalCases)).toFixed(1)}× больше остальных`,
        hint: `${hot.totalCases} кейсов, открыто ${hot.openCases}. Это либо крупный клиент, либо системная боль — разобраться`,
        actionLabel: 'Открыть чат',
        tone: 'amber',
        onAction: () => h.goChannel(hot.channelId),
      })
    }
  }

  const voice = data.contentMix.find((c) => c.contentType === 'voice')
  if (voice && voice.share >= 25) {
    out.push({
      title: `${voice.share}% сообщений — голосовые`,
      hint: 'Посмотри расшифровки — так клиенты часто прячут жалобы, которые AI видит в тексте лучше',
      actionLabel: 'Смотреть',
      tone: 'slate',
      onAction: () => h.openDrill({ kind: 'content_type', value: 'voice', title: 'Голосовые' }),
    })
  }

  const nonRu = data.byLanguage.find((l) => l.language !== 'ru' && l.share >= 30)
  if (nonRu) {
    out.push({
      title: `${nonRu.share}% общения на ${languageLabel(nonRu.language).toLowerCase()}`,
      hint: 'Убедись, что в смене есть агент, свободно владеющий этим языком',
      actionLabel: 'Смотреть',
      tone: 'slate',
      onAction: () => h.openDrill({ kind: 'language', value: nonRu.language, title: languageLabel(nonRu.language) }),
    })
  }

  return out.slice(0, 5)
}

// ===== helpers =====

function pluralCases(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'кейс'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'кейса'
  return 'кейсов'
}

function pluralChannels(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'канале'
  return 'каналах'
}

function statusLabel(status: string): string {
  const m: Record<string, string> = {
    detected: 'новом',
    in_progress: 'работе',
    waiting: 'ожидании',
    blocked: 'блокировке',
  }
  return m[status] || status
}

function pluralMessages(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'сообщение'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'сообщения'
  return 'сообщений'
}

const INTENT_LABELS: Record<string, string> = {
  complaint: 'Жалоба',
  question: 'Вопрос',
  request: 'Просьба / запрос',
  bug: 'Сообщение об ошибке',
  feedback: 'Отзыв',
  order: 'Про заказ',
  refund: 'Возврат / компенсация',
  status: 'Проверить статус',
  help: 'Помощь',
  integration: 'Интеграция',
  billing: 'Оплата',
  technical: 'Техвопрос',
  feature_request: 'Хочет функцию',
  onboarding: 'Подключение',
  cancel: 'Отмена',
  other: 'Другое',
}

function formatIntent(intent: string): string {
  if (!intent) return 'Без намерения'
  const key = intent.toLowerCase()
  return INTENT_LABELS[key] || intent.charAt(0).toUpperCase() + intent.slice(1)
}

const CONTENT_LABELS: Record<string, string> = {
  text: 'Текст',
  voice: 'Голосовые',
  audio: 'Аудио',
  video: 'Видео',
  video_note: 'Видеосообщение',
  photo: 'Фото',
  image: 'Фото',
  document: 'Документ',
  file: 'Файл',
  sticker: 'Стикер',
  animation: 'Гифка',
  location: 'Геолокация',
  contact: 'Контакт',
}

function formatContentType(ct: string): string {
  return CONTENT_LABELS[ct?.toLowerCase()] || ct || 'Прочее'
}

function contentTypeIcon(ct: string) {
  const key = (ct || '').toLowerCase()
  const cls = 'w-4 h-4 text-slate-400'
  if (key === 'voice' || key === 'audio') return <Mic className={cls} />
  if (key === 'video' || key === 'video_note' || key === 'animation') return <Video className={cls} />
  if (key === 'photo' || key === 'image') return <ImageIcon className={cls} />
  if (key === 'document' || key === 'file') return <FileText className={cls} />
  return <MessageSquare className={cls} />
}

const LANG_LABELS: Record<string, string> = {
  ru: 'Русский',
  uz: 'Узбекский',
  'uz-latn': 'Узбекский (лат.)',
  'uz-cyrl': 'Узбекский (кир.)',
  en: 'Английский',
  tr: 'Турецкий',
  kk: 'Казахский',
  ky: 'Киргизский',
  tg: 'Таджикский',
  ar: 'Арабский',
}

function languageLabel(lang: string): string {
  if (!lang) return 'Не определён'
  return LANG_LABELS[lang.toLowerCase()] || lang.toUpperCase()
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}

function ShareBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">
        {percent.toFixed(percent < 10 ? 1 : 0)}%
      </span>
    </div>
  )
}

function SentimentBar({ s }: { s: { negative: number; neutral: number; positive: number; total: number } }) {
  const total = s.total || 1
  const neg = Math.round((s.negative / total) * 100)
  const neu = Math.round((s.neutral / total) * 100)
  const pos = Math.max(0, 100 - neg - neu)
  return (
    <>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
        <div className="bg-red-500" style={{ width: `${neg}%` }} />
        <div className="bg-slate-300" style={{ width: `${neu}%` }} />
        <div className="bg-green-500" style={{ width: `${pos}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs mt-2">
        <span className="flex items-center gap-1 text-red-600 font-medium">
          <Frown className="w-3.5 h-3.5" />
          Негатив: {s.negative} ({neg}%)
        </span>
        <span className="text-slate-500">Нейтрально: {s.neutral} ({neu}%)</span>
        <span className="flex items-center gap-1 text-green-600 font-medium">
          <Smile className="w-3.5 h-3.5" />
          Позитив: {s.positive} ({pos}%)
        </span>
      </div>
    </>
  )
}

// ===== компоненты =====

interface KpiCardProps {
  label: string
  value: number | string
  hint?: React.ReactNode
  icon: typeof TrendingUp
  color: string
  warn?: boolean
}

function KpiCard({ label, value, hint, icon: Icon, color, warn }: KpiCardProps) {
  return (
    <div className={`bg-white border ${warn ? 'border-red-200' : 'border-slate-200'} rounded-xl p-3`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  )
}

interface SectionCardProps {
  title: string
  hint: string
  icon: typeof AlertTriangle
  empty: boolean
  accent?: string
  children: React.ReactNode
}

function SectionCard({ title, hint, icon: Icon, empty, accent, children }: SectionCardProps) {
  return (
    <div className={`bg-white border ${accent || 'border-slate-200'} rounded-xl overflow-hidden`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">{hint}</div>
        </div>
      </div>
      {empty ? (
        <div className="px-4 py-8 text-sm text-slate-400 text-center">Чисто, проблем не замечено</div>
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
    </div>
  )
}

interface RowLinkProps {
  onClick: () => void
  left: React.ReactNode
  right: React.ReactNode
}

function RowLink({ onClick, left, right }: RowLinkProps) {
  return (
    <li
      onClick={onClick}
      className="px-4 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-3 group"
    >
      <div className="flex-1 min-w-0 flex flex-col">
        {left}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {right}
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
    </li>
  )
}

function DeltaBadge({ delta, pct }: { delta: number; pct: number | null }) {
  if (delta === 0) {
    return <span className="text-xs text-slate-400">без изменений</span>
  }
  const up = delta > 0
  const tone = up ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
  const icon = up ? '↑' : '↓'
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${tone}`}>
      {icon} {Math.abs(delta)}{pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}
    </span>
  )
}
