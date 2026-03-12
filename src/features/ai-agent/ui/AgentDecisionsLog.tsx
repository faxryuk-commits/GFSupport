import { useState, useEffect } from 'react'
import { Activity, ThumbsUp, ThumbsDown, MessageSquare, AlertTriangle, UserPlus, FileText, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { fetchAgentDecisions, submitAgentFeedback, type AgentDecisionItem, type AgentStats } from '@/shared/api'

const ACTION_CONFIG: Record<string, { icon: typeof Activity; label: string; color: string }> = {
  reply: { icon: MessageSquare, label: 'Ответил', color: 'bg-blue-100 text-blue-700' },
  tag_agent: { icon: UserPlus, label: 'Позвал сотрудника', color: 'bg-purple-100 text-purple-700' },
  reply_and_tag: { icon: MessageSquare, label: 'Ответил + позвал', color: 'bg-indigo-100 text-indigo-700' },
  escalate: { icon: AlertTriangle, label: 'Эскалация', color: 'bg-red-100 text-red-700' },
  create_case: { icon: FileText, label: 'Создал кейс', color: 'bg-orange-100 text-orange-700' },
  wait: { icon: Clock, label: 'Ожидание', color: 'bg-slate-100 text-slate-600' },
}

function StatCards({ stats }: { stats: AgentStats }) {
  const accuracy = stats.correct + stats.wrong > 0
    ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100)
    : null

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <StatCard label="Всего решений" value={stats.total} />
      <StatCard label="Авто-ответы" value={stats.replies} color="text-blue-600" />
      <StatCard label="Эскалации" value={stats.escalations} color="text-red-600" />
      <StatCard label="Уверенность" value={stats.avg_confidence ? `${Math.round(stats.avg_confidence * 100)}%` : '—'} />
      <StatCard label="Точность" value={accuracy !== null ? `${accuracy}%` : '—'} color={accuracy && accuracy >= 80 ? 'text-green-600' : 'text-orange-500'} />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color || 'text-slate-800'}`}>{value}</p>
    </div>
  )
}

function DecisionRow({ d, onFeedback }: { d: AgentDecisionItem; onFeedback: (id: string, fb: 'correct' | 'wrong') => void }) {
  const [expanded, setExpanded] = useState(false)
  const config = ACTION_CONFIG[d.action] || ACTION_CONFIG.wait
  const Icon = config.icon
  const time = new Date(d.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const confPct = Math.round(d.confidence * 100)

  return (
    <div className="bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
        <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${config.color}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-slate-800 truncate">{d.senderName}</span>
            <span className="text-xs text-slate-400">→</span>
            <span className="text-xs text-slate-500 truncate">{d.channelName}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${config.color}`}>{config.label}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{d.incomingMessage?.slice(0, 100)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${confPct >= 80 ? 'bg-green-100 text-green-700' : confPct >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
            {confPct}%
          </span>
          <span className="text-xs text-slate-400">{time}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoBlock label="Входящее сообщение" value={d.incomingMessage} />
            {d.replyText && <InfoBlock label="Ответ агента" value={d.replyText} highlight />}
            <InfoBlock label="Рассуждение" value={d.reasoning} />
            {d.tagAgentName && <InfoBlock label="Тег сотрудника" value={d.tagAgentName} />}
            {d.caseTitle && <InfoBlock label="Кейс" value={`[${d.casePriority}] ${d.caseTitle}`} />}
          </div>
          <div className="text-xs text-slate-400">
            Источник: {d.source} | Контекст: {d.contextMessagesCount} сообщений | Похожая история: {d.similarHistoryCount}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Оценка:</span>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback(d.id, 'correct') }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${d.feedback === 'correct' ? 'bg-green-100 text-green-700' : 'hover:bg-green-50 text-slate-400'}`}
            >
              <ThumbsUp className="w-3 h-3" /> Верно
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback(d.id, 'wrong') }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${d.feedback === 'wrong' ? 'bg-red-100 text-red-700' : 'hover:bg-red-50 text-slate-400'}`}
            >
              <ThumbsDown className="w-3 h-3" /> Ошибка
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoBlock({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50'}`}>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className="text-sm text-slate-800 whitespace-pre-wrap">{value}</p>
    </div>
  )
}

export function AgentDecisionsLog() {
  const [decisions, setDecisions] = useState<AgentDecisionItem[]>([])
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    fetchAgentDecisions(50)
      .then(r => { setDecisions(r.decisions); setStats(r.stats) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleFeedback(id: string, fb: 'correct' | 'wrong') {
    await submitAgentFeedback(id, fb).catch(() => {})
    setDecisions(prev => prev.map(d => d.id === id ? { ...d, feedback: fb } : d))
  }

  if (loading) return <div className="p-6 text-center text-slate-400">Загрузка решений...</div>

  return (
    <div className="space-y-4">
      {stats && <StatCards stats={stats} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Журнал решений</h2>
        </div>
        <button onClick={load} className="text-sm text-blue-600 hover:text-blue-700">Обновить</button>
      </div>

      {decisions.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Решений пока нет. Агент начнёт работать после получения сообщений.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map(d => <DecisionRow key={d.id} d={d} onFeedback={handleFeedback} />)}
        </div>
      )}
    </div>
  )
}
