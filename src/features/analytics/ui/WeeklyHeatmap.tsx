import { CalendarDays, TrendingDown, TrendingUp } from 'lucide-react'

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const DAY_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

export interface WeeklyEntry {
  name: string
  days: number[]
  total: number
  peakDay: number
}

interface Props {
  agents: WeeklyEntry[]
  teamWeekly: number[]
}

function getCellColor(value: number, max: number): string {
  if (max === 0) return 'bg-slate-50'
  const ratio = value / max
  if (ratio === 0) return 'bg-slate-50'
  if (ratio < 0.2) return 'bg-blue-100'
  if (ratio < 0.4) return 'bg-blue-200'
  if (ratio < 0.6) return 'bg-blue-300 text-white'
  if (ratio < 0.8) return 'bg-blue-500 text-white'
  return 'bg-blue-700 text-white'
}

export function WeeklyHeatmap({ agents, teamWeekly }: Props) {
  const globalMax = Math.max(...agents.flatMap(a => a.days), 1)
  const teamTotal = teamWeekly.reduce((s, v) => s + v, 0)
  const teamMax = Math.max(...teamWeekly, 1)
  const teamPeak = teamWeekly.indexOf(Math.max(...teamWeekly))
  const teamLow = teamWeekly.indexOf(Math.min(...teamWeekly.filter((_, i) => i >= 1 && i <= 5)))

  const workdayTotal = teamWeekly.slice(1, 6).reduce((s, v) => s + v, 0)
  const weekendTotal = teamWeekly[0] + teamWeekly[6]
  const avgPerAgent = agents.length > 0 ? Math.round(teamTotal / agents.length) : 0

  if (agents.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-blue-500" />
        Загруженность по дням недели
      </h3>

      {/* Team summary */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-slate-900">{teamTotal}</p>
          <p className="text-[10px] text-slate-500">Всего сообщений</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
          <div className="flex items-center justify-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
            <p className="text-lg font-bold text-blue-700">{DAY_NAMES[teamPeak]}</p>
          </div>
          <p className="text-[10px] text-slate-500">Пиковый день ({teamWeekly[teamPeak]})</p>
        </div>
        <div className="bg-green-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-green-700">{workdayTotal}</p>
          <p className="text-[10px] text-slate-500">Будни / {weekendTotal} выходные</p>
        </div>
        <div className="bg-violet-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-violet-700">{avgPerAgent}</p>
          <p className="text-[10px] text-slate-500">Среднее на сотрудника</p>
        </div>
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-2 px-2 font-medium text-slate-500 w-36">Сотрудник</th>
              {DAY_NAMES.map((d, i) => (
                <th key={i} className="text-center py-2 px-1 font-medium text-slate-500 w-12">{d}</th>
              ))}
              <th className="text-center py-2 px-2 font-medium text-slate-500">Итого</th>
            </tr>
          </thead>
          <tbody>
            {/* Team total row */}
            <tr className="border-b-2 border-slate-200 bg-slate-50 font-bold">
              <td className="py-2 px-2 text-slate-700">Команда</td>
              {teamWeekly.map((val, i) => (
                <td key={i} className="py-1.5 px-1 text-center">
                  <div className={`rounded px-1 py-1 ${getCellColor(val, teamMax)} font-bold`}>
                    {val}
                  </div>
                </td>
              ))}
              <td className="py-2 px-2 text-center font-bold text-slate-900">{teamTotal}</td>
            </tr>

            {agents.map(agent => (
              <tr key={agent.name} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700 flex-shrink-0">
                      {agent.name.charAt(0)}
                    </div>
                    <span className="truncate font-medium">{agent.name}</span>
                  </div>
                </td>
                {agent.days.map((val, i) => (
                  <td key={i} className="py-1.5 px-1 text-center">
                    <div className={`rounded px-1 py-1 text-[11px] ${getCellColor(val, globalMax)}`}>
                      {val || ''}
                    </div>
                  </td>
                ))}
                <td className="py-2 px-2 text-center font-bold text-slate-700">{agent.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {agents.length >= 3 && (
        <p className="mt-3 text-xs text-slate-500 flex items-center gap-1">
          <TrendingDown className="w-3.5 h-3.5" />
          {weekendTotal === 0
            ? 'В выходные активности нет — команда работает только в будни.'
            : weekendTotal < workdayTotal * 0.1
              ? 'В выходные активность минимальна — возможно оптимизировать график.'
              : `Нагрузка в выходные: ${Math.round((weekendTotal / teamTotal) * 100)}% от общего объёма.`
          }
        </p>
      )}
    </div>
  )
}
