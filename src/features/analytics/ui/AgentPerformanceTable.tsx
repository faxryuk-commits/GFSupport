import { useState, useMemo } from 'react'
import { Users, Trophy, Zap, Target, ArrowUpDown, Crown, Shield, Heart, ChevronDown, Lightbulb } from 'lucide-react'
import { getRecommendations, type TeamAvg } from './AgentRecommendations'

export interface AgentPerformanceData {
  name: string
  role: 'admin' | 'manager' | 'agent'
  totalResponses: number
  withinSLA: number
  violatedSLA: number
  slaCompliance: number | null
  avgMinutes: number
  minMinutes: number
  maxMinutes: number
  medianMinutes: number
  totalMessages: number
  totalChars: number
  avgCharsPerMessage: number
  channelsServed: number
  activeDays: number
  resolvedCases: number
  totalAssignedCases: number
  efficiencyRatio: number
  onlineHours: number
  engagementScore: number
  engagementLevel: 'high' | 'medium' | 'low'
  engagementBreakdown: {
    activity: number
    speed: number
    quality: number
    responsibility: number
  }
  isInactive: boolean
}

type SortField = 'slaCompliance' | 'totalResponses' | 'avgMinutes' | 'resolvedCases' | 'totalChars' | 'efficiencyRatio' | 'engagementScore'

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Crown }> = {
  admin: { label: 'Админ', color: 'text-purple-700', bg: 'bg-purple-100', icon: Crown },
  manager: { label: 'Менеджер', color: 'text-blue-700', bg: 'bg-blue-100', icon: Shield },
  agent: { label: 'Агент', color: 'text-slate-600', bg: 'bg-slate-100', icon: Users },
}

function formatChars(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function EngagementRing({ score, level, breakdown }: {
  score: number
  level: string
  breakdown: AgentPerformanceData['engagementBreakdown']
}) {
  const size = 44
  const stroke = 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const ringColor = level === 'high' ? 'stroke-green-500' : level === 'medium' ? 'stroke-yellow-500' : 'stroke-red-500'
  const [showBreakdown, setShowBreakdown] = useState(false)

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="cursor-pointer"
        onMouseEnter={() => setShowBreakdown(true)}
        onMouseLeave={() => setShowBreakdown(false)}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-slate-100" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            className={ringColor}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{score}</span>
      </div>
      {showBreakdown && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-white border border-slate-200 shadow-lg rounded-lg p-3 w-44 text-xs">
          {[
            { label: 'Активность', val: breakdown.activity, max: 25, color: 'bg-blue-400' },
            { label: 'Скорость', val: breakdown.speed, max: 25, color: 'bg-green-400' },
            { label: 'Качество', val: breakdown.quality, max: 25, color: 'bg-violet-400' },
            { label: 'Ответств.', val: breakdown.responsibility, max: 25, color: 'bg-amber-400' },
          ].map(b => (
            <div key={b.label} className="mb-1.5 last:mb-0">
              <div className="flex justify-between mb-0.5">
                <span className="text-slate-600">{b.label}</span>
                <span className="font-bold">{b.val}/{b.max}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${b.color}`} style={{ width: `${(b.val / b.max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  agents: AgentPerformanceData[]
}

export function AgentPerformanceTable({ agents }: Props) {
  const [sortField, setSortField] = useState<SortField>('totalResponses')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  const sorted = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1
      const mul = sortAsc ? 1 : -1
      const aVal = (a[sortField] as number) ?? -1
      const bVal = (b[sortField] as number) ?? -1
      return (aVal - bVal) * mul
    })
  }, [agents, sortField, sortAsc])

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const active = agents.filter(a => !a.isInactive)
  const maxResponses = Math.max(...active.map(a => a.totalResponses), 1)
  const maxChars = Math.max(...active.map(a => a.totalChars), 1)

  const teamAvg = useMemo(() => {
    if (active.length === 0) return { sla: 0, avgTime: 0, responses: 0, engagement: 0 }
    const withSla = active.filter(a => a.slaCompliance !== null && a.totalResponses > 0)
    return {
      sla: withSla.length > 0 ? Math.round(withSla.reduce((s, a) => s + (a.slaCompliance ?? 0), 0) / withSla.length) : 0,
      avgTime: Math.round(active.filter(a => a.totalResponses > 0).reduce((s, a) => s + a.avgMinutes, 0) / Math.max(active.filter(a => a.totalResponses > 0).length, 1) * 10) / 10,
      responses: Math.round(active.reduce((s, a) => s + a.totalResponses, 0) / active.length),
      engagement: Math.round(active.reduce((s, a) => s + a.engagementScore, 0) / active.length),
    }
  }, [active])

  const bestSLA = active.filter(a => a.slaCompliance !== null && a.totalResponses > 0).length > 0
    ? active.filter(a => a.slaCompliance !== null && a.totalResponses > 0)
        .reduce((best, a) => (a.slaCompliance! > (best.slaCompliance ?? 0) ? a : best))
    : null
  const mostProductive = active.length > 0
    ? active.reduce((best, a) => a.resolvedCases > best.resolvedCases ? a : best) : null
  const mostEfficient = active.filter(a => a.resolvedCases > 0).length > 0
    ? active.filter(a => a.resolvedCases > 0).reduce((best, a) => a.efficiencyRatio < best.efficiencyRatio ? a : best)
    : null
  const mostEngaged = active.length > 0
    ? active.reduce((best, a) => a.engagementScore > best.engagementScore ? a : best) : null

  if (agents.length === 0) {
    return <p className="text-slate-500 text-center py-8">Нет данных за выбранный период</p>
  }

  return (
    <div className="space-y-4">
      {/* Leader cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {bestSLA && bestSLA.slaCompliance !== null && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-green-700">Лучший по SLA</span>
            </div>
            <p className="font-bold text-slate-900 truncate">{bestSLA.name}</p>
            <p className="text-2xl font-bold text-green-600">{bestSLA.slaCompliance}%</p>
          </div>
        )}
        {mostProductive && mostProductive.resolvedCases > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-blue-700">Самый продуктивный</span>
            </div>
            <p className="font-bold text-slate-900 truncate">{mostProductive.name}</p>
            <p className="text-2xl font-bold text-blue-600">{mostProductive.resolvedCases} тикетов</p>
          </div>
        )}
        {mostEfficient && (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-violet-600" />
              <span className="text-xs font-semibold text-violet-700">Самый эффективный</span>
            </div>
            <p className="font-bold text-slate-900 truncate">{mostEfficient.name}</p>
            <p className="text-2xl font-bold text-violet-600">{formatChars(mostEfficient.efficiencyRatio)} сим/тикет</p>
          </div>
        )}
        {mostEngaged && mostEngaged.engagementScore > 0 && (
          <div className="bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-4 h-4 text-rose-600" />
              <span className="text-xs font-semibold text-rose-700">Самый вовлечённый</span>
            </div>
            <p className="font-bold text-slate-900 truncate">{mostEngaged.name}</p>
            <p className="text-2xl font-bold text-rose-600">{mostEngaged.engagementScore}/100</p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-3 font-medium text-slate-600">Сотрудник</th>
              <SortableHeader label="Вовлеч." field="engagementScore" current={sortField} asc={sortAsc} onClick={handleSort} />
              <SortableHeader label="Ответов" field="totalResponses" current={sortField} asc={sortAsc} onClick={handleSort} />
              <th className="text-center py-3 px-2 font-medium text-slate-600">В срок / Наруш.</th>
              <SortableHeader label="SLA %" field="slaCompliance" current={sortField} asc={sortAsc} onClick={handleSort} />
              <SortableHeader label="Среднее" field="avgMinutes" current={sortField} asc={sortAsc} onClick={handleSort} />
              <SortableHeader label="Тикеты" field="resolvedCases" current={sortField} asc={sortAsc} onClick={handleSort} />
              <SortableHeader label="Символы" field="totalChars" current={sortField} asc={sortAsc} onClick={handleSort} />
              <SortableHeader label="Сим/тикет" field="efficiencyRatio" current={sortField} asc={sortAsc} onClick={handleSort} />
              <th className="text-center py-3 px-2 font-medium text-slate-600">Диапазон</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <AgentRowWithRecs
                key={agent.name}
                agent={agent}
                maxResponses={maxResponses}
                maxChars={maxChars}
                teamAvg={teamAvg}
                isExpanded={expandedAgent === agent.name}
                onToggle={() => setExpandedAgent(expandedAgent === agent.name ? null : agent.name)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AgentRowWithRecs({ agent, maxResponses, maxChars, teamAvg, isExpanded, onToggle }: {
  agent: AgentPerformanceData
  maxResponses: number
  maxChars: number
  teamAvg: TeamAvg
  isExpanded: boolean
  onToggle: () => void
}) {
  const recs = useMemo(() => getRecommendations(agent, teamAvg), [agent, teamAvg])
  const typeColors = {
    warning: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-500' },
    improvement: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-500' },
    strength: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-500' },
  }
  const hasIssues = recs.some(r => r.type === 'warning' || r.type === 'improvement')

  return (
    <>
      <AgentRow agent={agent} maxResponses={maxResponses} maxChars={maxChars} onToggle={onToggle} isExpanded={isExpanded} hasIssues={hasIssues} />
      {isExpanded && (
        <tr>
          <td colSpan={10} className="p-0">
            <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold text-slate-700">Рекомендации для {agent.name}</span>
              </div>
              <div className="space-y-1.5">
                {recs.map((rec, i) => {
                  const colors = typeColors[rec.type]
                  const Icon = rec.icon
                  return (
                    <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${colors.bg} ${colors.border}`}>
                      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colors.icon}`} />
                      <span className={`text-xs ${colors.text}`}>{rec.text}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AgentRow({ agent, maxResponses, maxChars, onToggle, isExpanded, hasIssues }: {
  agent: AgentPerformanceData
  maxResponses: number
  maxChars: number
  onToggle: () => void
  isExpanded: boolean
  hasIssues: boolean
}) {
  const role = ROLE_CONFIG[agent.role] || ROLE_CONFIG.agent
  const RoleIcon = role.icon
  const isLeader = agent.role === 'admin' || agent.role === 'manager'

  const rowBg = agent.isInactive
    ? 'bg-slate-50/80 opacity-60'
    : agent.slaCompliance !== null && agent.slaCompliance < 80 && !isLeader
      ? 'bg-red-50/50'
      : agent.violatedSLA === 0 && agent.totalResponses > 0 ? 'bg-green-50/30' : ''

  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${rowBg}`} onClick={onToggle}>
      {/* Name + Role + Inactive */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-700 flex-shrink-0 relative">
            {agent.name.charAt(0)}
            {hasIssues && !agent.isInactive && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-medium block truncate">{agent.name}</span>
            <div className="flex items-center gap-1">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${role.bg} ${role.color}`}>
                <RoleIcon className="w-2.5 h-2.5" />
                {role.label}
              </span>
              {agent.isInactive && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-200 text-slate-500">
                  Неактивен
                </span>
              )}
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </td>

      {/* Engagement ring */}
      <td className="py-3 px-2 text-center">
        {agent.isInactive ? (
          <span className="text-slate-400 text-xs">-</span>
        ) : (
          <EngagementRing score={agent.engagementScore} level={agent.engagementLevel} breakdown={agent.engagementBreakdown} />
        )}
      </td>

      {/* Responses with bar */}
      <td className="py-3 px-2 text-center">
        <div className="w-20 mx-auto">
          <span className="font-bold text-slate-900">{agent.totalResponses}</span>
          <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(agent.totalResponses / maxResponses) * 100}%` }} />
          </div>
        </div>
      </td>

      {/* Stacked bar */}
      <td className="py-3 px-2">
        {agent.totalResponses > 0 ? (
          <div className="w-24 mx-auto">
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="text-green-600 font-medium">{agent.withinSLA}</span>
              {agent.violatedSLA > 0 && <span className="text-red-600 font-medium">{agent.violatedSLA}</span>}
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
              <div className="bg-green-500 h-full" style={{ width: `${(agent.withinSLA / agent.totalResponses) * 100}%` }} />
              {agent.violatedSLA > 0 && (
                <div className="bg-red-500 h-full" style={{ width: `${(agent.violatedSLA / agent.totalResponses) * 100}%` }} />
              )}
            </div>
          </div>
        ) : (
          <span className="text-slate-400 text-xs block text-center">-</span>
        )}
      </td>

      {/* SLA % */}
      <td className="py-3 px-2">
        {agent.slaCompliance !== null ? (
          <div className="w-20 mx-auto">
            <span className={`text-sm font-bold ${
              agent.slaCompliance >= 95 ? 'text-green-700' :
              agent.slaCompliance >= 80 ? 'text-yellow-700' : 'text-red-700'
            }`}>{agent.slaCompliance}%</span>
            <div className="h-2 bg-slate-100 rounded-full mt-0.5 overflow-hidden">
              <div className={`h-full rounded-full ${
                agent.slaCompliance >= 95 ? 'bg-green-500' :
                agent.slaCompliance >= 80 ? 'bg-yellow-500' : 'bg-red-500'
              }`} style={{ width: `${agent.slaCompliance}%` }} />
            </div>
          </div>
        ) : (
          <span className="text-slate-400 text-xs block text-center">Н/Д</span>
        )}
      </td>

      {/* Avg time */}
      <td className="py-3 px-2 text-center">
        {agent.totalResponses > 0 ? (
          <span className="text-sm">{agent.avgMinutes} мин</span>
        ) : (
          <span className="text-slate-400 text-xs">-</span>
        )}
      </td>

      {/* Tickets */}
      <td className="py-3 px-2 text-center">
        {agent.totalAssignedCases > 0 ? (
          <span className="text-sm">
            <span className="font-bold text-green-600">{agent.resolvedCases}</span>
            <span className="text-slate-400">/{agent.totalAssignedCases}</span>
          </span>
        ) : (
          <span className="text-slate-400 text-xs">-</span>
        )}
      </td>

      {/* Characters */}
      <td className="py-3 px-2 text-center">
        {agent.totalChars > 0 ? (
          <div className="w-20 mx-auto">
            <span className="text-sm font-medium">{formatChars(agent.totalChars)}</span>
            <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-violet-400 rounded-full" style={{ width: `${(agent.totalChars / maxChars) * 100}%` }} />
            </div>
          </div>
        ) : (
          <span className="text-slate-400 text-xs">-</span>
        )}
      </td>

      {/* Efficiency */}
      <td className="py-3 px-2 text-center">
        {agent.efficiencyRatio > 0 ? (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            agent.efficiencyRatio < 500 ? 'bg-green-100 text-green-700' :
            agent.efficiencyRatio < 1500 ? 'bg-yellow-100 text-yellow-700' :
            'bg-orange-100 text-orange-700'
          }`}>
            {formatChars(agent.efficiencyRatio)}
          </span>
        ) : (
          <span className="text-slate-400 text-xs">-</span>
        )}
      </td>

      {/* Range */}
      <td className="py-3 px-2 text-center text-xs text-slate-500">
        {agent.totalResponses > 0 ? (
          <span>{agent.minMinutes} - {agent.maxMinutes} мин</span>
        ) : '-'}
      </td>
    </tr>
  )
}

function SortableHeader({ label, field, current, asc, onClick }: {
  label: string
  field: SortField
  current: SortField
  asc: boolean
  onClick: (f: SortField) => void
}) {
  const isActive = current === field
  return (
    <th
      className="text-center py-3 px-2 font-medium text-slate-600 cursor-pointer hover:bg-slate-100 select-none"
      onClick={() => onClick(field)}
    >
      <div className="flex items-center justify-center gap-1">
        <span>{label}</span>
        <ArrowUpDown className={`w-3 h-3 ${isActive ? 'text-blue-500' : 'text-slate-400'} ${isActive && asc ? 'rotate-180' : ''}`} />
      </div>
    </th>
  )
}
