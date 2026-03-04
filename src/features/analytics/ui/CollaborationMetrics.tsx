import { UsersRound, User, Users } from 'lucide-react'

export interface CollaborationData {
  totalChannels: number
  multiAgentChannels: number
  soloChannels: number
  avgAgentsPerChannel: number
  multiAgentPercent: number
  details: Array<{
    channelName: string
    agentCount: number
    agents: string[]
  }>
}

interface Props {
  data: CollaborationData
}

export function CollaborationMetrics({ data }: Props) {
  if (data.totalChannels === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <UsersRound className="w-5 h-5 text-cyan-500" />
        Коллаборация в каналах
      </h3>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-slate-900">{data.totalChannels}</p>
          <p className="text-[10px] text-slate-500">Активных каналов</p>
        </div>
        <div className="bg-cyan-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-cyan-700">{data.avgAgentsPerChannel}</p>
          <p className="text-[10px] text-slate-500">Среднее агентов/канал</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-blue-700">{data.multiAgentChannels}</p>
          <p className="text-[10px] text-slate-500">Командная работа ({data.multiAgentPercent}%)</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-slate-600">{data.soloChannels}</p>
          <p className="text-[10px] text-slate-500">Соло-обработка</p>
        </div>
      </div>

      {/* Distribution bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span className="flex items-center gap-1"><User className="w-3 h-3" /> 1 агент</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 2+ агентов</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
          <div className="bg-slate-400 h-full" style={{ width: `${100 - data.multiAgentPercent}%` }} />
          <div className="bg-cyan-500 h-full" style={{ width: `${data.multiAgentPercent}%` }} />
        </div>
      </div>

      {/* Multi-agent channels list */}
      {data.details.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Каналы с командной работой:</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {data.details.map((ch, i) => (
              <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg text-xs">
                <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 font-bold flex-shrink-0">
                  {ch.agentCount}
                </span>
                <span className="font-medium truncate flex-1">{ch.channelName}</span>
                <div className="flex -space-x-1.5 flex-shrink-0">
                  {ch.agents.slice(0, 4).map((agent, j) => (
                    <div key={j} className="w-5 h-5 rounded-full bg-blue-100 border border-white flex items-center justify-center text-[9px] font-bold text-blue-700" title={agent}>
                      {agent.charAt(0)}
                    </div>
                  ))}
                  {ch.agents.length > 4 && (
                    <div className="w-5 h-5 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[9px] font-bold text-slate-600">
                      +{ch.agents.length - 4}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.multiAgentPercent > 50 && (
        <p className="mt-3 text-xs text-slate-500">
          Более половины каналов обрабатываются командой — высокий уровень взаимодействия.
        </p>
      )}
      {data.multiAgentPercent < 20 && data.totalChannels > 5 && (
        <p className="mt-3 text-xs text-amber-600">
          Большинство каналов обрабатывается одним человеком — низкая взаимозаменяемость.
        </p>
      )}
    </div>
  )
}
