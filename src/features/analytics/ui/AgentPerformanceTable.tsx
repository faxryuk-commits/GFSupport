import { useState, useMemo } from 'react'
import { Users, Trophy, Zap, Target, ArrowUpDown, Crown, Shield } from 'lucide-react'

export interface AgentPerformanceData {
  name: string
  role: 'admin' | 'manager' | 'agent'
  totalResponses: number
  withinSLA: number
  violatedSLA: number
  slaCompliance: number
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
}

type SortField = 'slaCompliance' | 'totalResponses' | 'avgMinutes' | 'resolvedCases' | 'totalChars' | 'efficiencyRatio'

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
      const mul = sortAsc ? 1 : -1
      return ((a[sortField] as number) - (b[sortField] as number)) * mul
    })
  }, [agents, sortField, sortAsc])

  const maxResponses = Math.max(...agents.map(a => a.totalResponses), 1)
  const maxChars = Math.max(...agents.map(a => a.totalChars), 1)

  const bestSLA = agents.length > 0 ? agents.reduce((best, a) => a.slaCompliance > best.slaCompliance ? a : best) : null
  const mostProductive = agents.length > 0 ? agents.reduce((best, a) => a.resolvedCases > best.resolvedCases ? a : best) : null
  const mostEfficient = agents.filter(a => a.resolvedCases > 0).length > 0
    ? agents.filter(a => a.resolvedCases > 0).reduce((best, a) => a.efficiencyRatio < best.efficiencyRatio ? a : best)
    : null

  if (agents.length === 0) {
    return <p className="text-slate-500 text-center py-8">Нет данных за выбранный период</p>
  }

  const isLeader = (role: string) => role === 'admin' || role === 'manager'

  return (
    <div className="space-y-4">
      {/* Leader cards */}
      <div className="grid grid-cols-3 gap-3">
        {bestSLA && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-green-700">Лучший по SLA</span>
            </div>
            <p className="font-bold text-slate-900">{bestSLA.name}</p>
            <p className="text-2xl font-bold text-green-600">{bestSLA.slaCompliance}%</p>
          </div>
        )}
        {mostProductive && mostProductive.resolvedCases > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-blue-700">Самый продуктивный</span>
            </div>
            <p className="font-bold text-slate-900">{mostProductive.name}</p>
            <p className="text-2xl font-bold text-blue-600">{mostProductive.resolvedCases} тикетов</p>
          </div>
        )}
        {mostEfficient && (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-violet-600" />
              <span className="text-xs font-semibold text-violet-700">Самый эффективный</span>
            </div>
            <p className="font-bold text-slate-900">{mostEfficient.name}</p>
            <p className="text-2xl font-bold text-violet-600">{formatChars(mostEfficient.efficiencyRatio)} сим/тикет</p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-3 font-medium text-slate-600">Сотрудник</th>
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
            {sorted.map((agent) => {
              const role = ROLE_CONFIG[agent.role] || ROLE_CONFIG.agent
              const RoleIcon = role.icon
              const rowBg = agent.slaCompliance < 80 && !isLeader(agent.role) ? 'bg-red-50/50' :
                agent.violatedSLA === 0 && agent.totalResponses > 0 ? 'bg-green-50/30' : ''

              return (
                <tr key={agent.name} className={`border-b border-slate-100 hover:bg-slate-50 ${rowBg}`}>
                  {/* Name + Role */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-700 flex-shrink-0">
                        {agent.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium block truncate">{agent.name}</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${role.bg} ${role.color}`}>
                          <RoleIcon className="w-2.5 h-2.5" />
                          {role.label}
                        </span>
                      </div>
                    </div>
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

                  {/* Stacked bar: within SLA / violations */}
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
                      <span className="text-slate-400 text-xs">-</span>
                    )}
                  </td>

                  {/* SLA progress bar */}
                  <td className="py-3 px-2">
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
                  </td>

                  {/* Avg time */}
                  <td className="py-3 px-2 text-center">
                    <span className="text-sm">{agent.avgMinutes} мин</span>
                  </td>

                  {/* Tickets: resolved / total */}
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

                  {/* Characters with bar */}
                  <td className="py-3 px-2 text-center">
                    <div className="w-20 mx-auto">
                      <span className="text-sm font-medium">{formatChars(agent.totalChars)}</span>
                      <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${(agent.totalChars / maxChars) * 100}%` }} />
                      </div>
                    </div>
                  </td>

                  {/* Efficiency ratio */}
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

                  {/* Range min-max */}
                  <td className="py-3 px-2 text-center text-xs text-slate-500">
                    {agent.totalResponses > 0 ? (
                      <span>{agent.minMinutes} - {agent.maxMinutes} мин</span>
                    ) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
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
