import { useState, useMemo } from 'react'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'

interface CategoryData {
  category: string
  messages: number
  cases: number
  resolved: number
}

export interface AgentExpertiseEntry {
  name: string
  categories: CategoryData[]
}

interface Props {
  data: AgentExpertiseEntry[]
}

const CATEGORY_COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
]

export function AgentExpertise({ data }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const allCategories = useMemo(() => {
    const map: Record<string, number> = {}
    for (const agent of data) {
      for (const cat of agent.categories) {
        map[cat.category] = (map[cat.category] || 0) + cat.messages
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [data])

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const totalA = a.categories.reduce((s, c) => s + c.messages, 0)
      const totalB = b.categories.reduce((s, c) => s + c.messages, 0)
      return totalB - totalA
    })
  }, [data])

  if (data.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-violet-500" />
        Экспертиза по категориям
      </h3>

      <div className="mb-3 flex flex-wrap gap-2">
        {allCategories.slice(0, 8).map((cat, i) => (
          <span key={cat} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`w-2.5 h-2.5 rounded-sm ${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}`} />
            {cat}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {sortedData.map(agent => {
          const totalMsgs = agent.categories.reduce((s, c) => s + c.messages, 0)
          const isOpen = expanded === agent.name
          const isEmpty = totalMsgs === 0

          return (
            <div key={agent.name} className={`border border-slate-100 rounded-lg ${isEmpty ? 'opacity-50' : ''}`}>
              <button
                onClick={() => !isEmpty && setExpanded(isOpen ? null : agent.name)}
                className={`w-full flex items-center gap-3 p-3 transition-colors ${isEmpty ? 'cursor-default' : 'hover:bg-slate-50'}`}
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
                  {agent.name.charAt(0)}
                </div>
                <span className="font-medium text-sm flex-1 text-left truncate">{agent.name}</span>

                {isEmpty ? (
                  <span className="text-xs text-slate-400 italic">Нет данных за период</span>
                ) : (
                  <>
                    <div className="flex h-3 w-48 rounded-full overflow-hidden bg-slate-100 flex-shrink-0">
                      {agent.categories.slice(0, 6).map(cat => (
                        <div
                          key={cat.category}
                          className={`h-full ${CATEGORY_COLORS[allCategories.indexOf(cat.category) % CATEGORY_COLORS.length]}`}
                          style={{ width: `${(cat.messages / totalMsgs) * 100}%` }}
                          title={`${cat.category}: ${cat.messages}`}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-slate-500 w-12 text-right flex-shrink-0">{totalMsgs}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </>
                )}
              </button>

              {isOpen && !isEmpty && (
                <div className="px-3 pb-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-100">
                        <th className="text-left py-1.5 font-medium">Категория</th>
                        <th className="text-center py-1.5 font-medium">Сообщений</th>
                        <th className="text-center py-1.5 font-medium">Кейсов</th>
                        <th className="text-center py-1.5 font-medium">Решено</th>
                        <th className="text-left py-1.5 font-medium w-32">Доля</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agent.categories.map(cat => (
                        <tr key={cat.category} className="border-b border-slate-50">
                          <td className="py-1.5 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${CATEGORY_COLORS[allCategories.indexOf(cat.category) % CATEGORY_COLORS.length]}`} />
                            <span className="truncate max-w-40">{cat.category}</span>
                          </td>
                          <td className="py-1.5 text-center font-medium">{cat.messages}</td>
                          <td className="py-1.5 text-center">{cat.cases || '-'}</td>
                          <td className="py-1.5 text-center text-green-600">{cat.resolved || '-'}</td>
                          <td className="py-1.5">
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${CATEGORY_COLORS[allCategories.indexOf(cat.category) % CATEGORY_COLORS.length]}`}
                                style={{ width: `${(cat.messages / totalMsgs) * 100}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
