import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, Clock, TrendingUp, TrendingDown,
  Repeat, Users, Loader2, RefreshCw, Flame, Timer, ArrowRight,
} from 'lucide-react'
import { fetchSupportHealth, type SupportHealthPayload, type HealthPeriod } from '@/shared/api'

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

export function HealthPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<HealthPeriod>('7d')
  const [data, setData] = useState<SupportHealthPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

        {/* Root causes */}
        <SectionCard
          title="Корневые причины"
          hint="С наибольшим влиянием на выручку"
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
                onClick={() => navigate('/cases')}
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

      <div className="text-xs text-slate-400 mt-4 text-center">
        Данные за период с {new Date(data.period.from).toLocaleDateString('ru-RU')} по {new Date(data.period.to).toLocaleDateString('ru-RU')}
      </div>
    </div>
  )
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
