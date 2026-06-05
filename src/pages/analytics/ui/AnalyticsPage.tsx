/**
 * Унифицированная страница аналитики — три уровня глубины в одном URL.
 *
 *   /analytics?tab=pulse      — Pulse: 4 ключевые метрики с бенчмарками (10 сек чтения)
 *   /analytics?tab=diagnosis  — Diagnosis: где у Delever болит (категории, root cause)
 *   /analytics?tab=detail     — Detail: per-agent, SLA-отчёт, экспорт
 *
 * Старые страницы /health и /sla-report пока существуют как fallback URLs.
 * Из nav убраны — следующим шагом редиректы.
 */

import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, Heart, FileSpreadsheet, LayoutGrid } from 'lucide-react'
import { RoleFilter, defaultRoleFilter, type RoleFilterValue } from '@/features/analytics'
import { PulseTab } from './PulseTab'
import { DiagnosisTab } from './DiagnosisTab'
import { DetailTab } from './DetailTab'
import { IssueStructureTab } from './IssueStructureTab'

type Tab = 'pulse' | 'diagnosis' | 'structure' | 'detail'
type Period = '7d' | '30d' | '90d'
type Source = 'all' | 'telegram' | 'whatsapp'

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode; hint: string }> = [
  {
    key: 'pulse',
    label: 'Pulse',
    icon: <Heart className="w-4 h-4" />,
    hint: 'Сводка по 4 ключевым метрикам с целями. Чтение 10 секунд.',
  },
  {
    key: 'diagnosis',
    label: 'Diagnosis',
    icon: <Activity className="w-4 h-4" />,
    hint: 'Где болит: категории обращений, корневые причины, ignored / stuck.',
  },
  {
    key: 'structure',
    label: 'Структура',
    icon: <LayoutGrid className="w-4 h-4" />,
    hint: 'Таксономия обращений снизу-вверх (текст + медиа): домены, подтипы, автоматизируемость.',
  },
  {
    key: 'detail',
    label: 'Detail',
    icon: <FileSpreadsheet className="w-4 h-4" />,
    hint: 'Per-agent breakdown, SLA-отчёт, экспорт.',
  },
]

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
]

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: 'all', label: 'Все каналы' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab: Tab = useMemo(() => {
    if (rawTab === 'pulse' || rawTab === 'diagnosis' || rawTab === 'structure' || rawTab === 'detail') return rawTab
    return 'pulse'
  }, [rawTab])
  const [period, setPeriod] = useState<Period>(() => {
    const p = params.get('period')
    return p === '7d' || p === '30d' || p === '90d' ? p : '30d'
  })
  const [sourceFilter, setSourceFilter] = useState<Source>(() => {
    const s = params.get('source')
    return s === 'telegram' || s === 'whatsapp' ? s : 'all'
  })
  const [roleFilter, setRoleFilter] = useState<RoleFilterValue>(() => defaultRoleFilter())

  const setTab = (next: Tab) => {
    const merged = new URLSearchParams(params)
    merged.set('tab', next)
    setParams(merged, { replace: true })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Аналитика</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pulse → Diagnosis → Detail — от сводки к причинам и построчным данным.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as Source)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <RoleFilter value={roleFilter} onChange={setRoleFilter} />
        </div>
      </div>

      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const active = t.key === tab
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
                title={t.hint}
              >
                {t.icon}
                {t.label}
              </button>
            )
          })}
        </nav>
      </div>

      {tab === 'pulse' && (
        <PulseTab period={period} source={sourceFilter} roles={roleFilter.roles} />
      )}
      {tab === 'diagnosis' && <DiagnosisTab period={period} source={sourceFilter} />}
      {tab === 'structure' && <IssueStructureTab />}
      {tab === 'detail' && (
        <DetailTab period={period} source={sourceFilter} roles={roleFilter.roles} />
      )}
    </div>
  )
}
