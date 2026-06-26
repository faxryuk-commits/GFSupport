import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'

interface FeedItem {
  actor: 'ai_agent' | 'sla_guard'
  ts: string
  channel: string | null
  title: string
  reasoning: string | null
  action?: string
  confidence?: number
  reply?: string | null
  tier?: string | null
  mode?: string | null
  kind?: string
  outcome?: 'correct' | 'wrong' | null
  id?: string
}
interface Resp {
  available: boolean
  feed: FeedItem[]
  agent: { total: number; avgConfidence: number | null; byAction: Array<{ action: string; n: number }>; successRate: number | null; labeled: number }
  guard: {
    lastCycle: any | null
    recentAlerts: Array<{ channel: string; tier: string; reasoning: string; mode: string; ts: string; ask: string | null }>
  }
}

const TIER_COLOR: Record<string, string> = { CRITICAL: 'text-red-600', BREACH: 'text-orange-600', WARNING: 'text-amber-600' }
const fmt = (ts: string) => { try { return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return ts } }

function Card({ big, label, tone = 'text-slate-900' }: { big: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="bg-white border border-[#e8edf3] rounded-xl px-4 py-3">
      <div className={`text-2xl font-bold ${tone}`}>{big}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

export function AIJournalTab() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'ai_agent' | 'sla_guard'>('all')
  const [rated, setRated] = useState<Record<string, 'correct' | 'wrong'>>({})

  useEffect(() => {
    apiGet<Resp>('/analytics/ai-journal', false).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [])

  const rate = (id: string, feedback: 'correct' | 'wrong') => {
    setRated((p) => ({ ...p, [id]: feedback }))
    apiPost('/analytics/ai-journal', { decisionId: id, feedback }).catch(() => setRated((p) => { const n = { ...p }; delete n[id]; return n }))
  }

  if (loading) return <div className="text-sm text-slate-400 py-8">Загрузка журнала…</div>
  if (error) return <div className="text-sm text-red-600 py-8">Ошибка: {error}</div>
  if (!data?.available) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900">
        Журнал пуст — AI-агент и SLA-страж ещё не записали решений. Появятся после первых циклов.
      </div>
    )
  }

  const cycle = data.guard.lastCycle
  const alertsCount = cycle ? (cycle.alerts?.WARNING || 0) + (cycle.alerts?.BREACH || 0) + (cycle.alerts?.CRITICAL || 0) : 0
  const feed = data.feed.filter((f) => filter === 'all' || f.actor === filter)

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Журнал ИИ</strong> — что решают автоматы (AI-агент и SLA-страж): что подумали, что решили,
        что сделали. Заходи в любой момент — видно текущее и прошлое.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card big={data.agent.total} label="решений агента" />
        <Card big={data.agent.avgConfidence ?? '—'} label="ср. уверенность" />
        <Card
          big={data.agent.successRate != null ? <span className="text-green-600">{data.agent.successRate}%</span> : '—'}
          label={`успех (по ${data.agent.labeled} с исходом)`}
        />
        <Card big={alertsCount} label="алертов стража" tone="text-red-600" />
        <Card
          big={<span className={cycle?.mode === 'live' ? 'text-green-600' : 'text-amber-600'}>{cycle?.mode === 'live' ? 'LIVE' : 'SHADOW'}</span>}
          label="режим стража"
        />
      </div>

      {data.guard.recentAlerts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">🛡 SLA-страж — последние срабатывания</h3>
          <div className="space-y-1">
            {data.guard.recentAlerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-white border border-[#e8edf3] rounded-lg text-sm">
                <span className={`font-bold w-20 ${TIER_COLOR[a.tier] || 'text-slate-600'}`}>{a.tier}</span>
                <span className="w-44 shrink-0 truncate text-slate-700">{a.channel}</span>
                <span className="flex-1 text-slate-500 truncate">{a.ask || a.reasoning}</span>
                <span className="text-xs text-slate-400">{a.mode === 'shadow' ? 'не отправлено' : 'отправлено'} · {fmt(a.ts)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">Лента решений</h3>
          <div className="flex gap-1 text-xs">
            {(['all', 'ai_agent', 'sla_guard'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'all' ? 'Все' : f === 'ai_agent' ? '🤖 Агент' : '🛡 Страж'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {feed.map((f, i) => (
            <div key={i} className="bg-white border border-[#e8edf3] rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span className={`px-1.5 py-0.5 rounded ${f.actor === 'ai_agent' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {f.actor === 'ai_agent' ? '🤖 Агент' : '🛡 Страж'}
                </span>
                {f.channel && <span className="truncate">{f.channel}</span>}
                {(rated[f.id || ''] || f.outcome) === 'correct' && <span className="text-green-600">✅ помог</span>}
                {(rated[f.id || ''] || f.outcome) === 'wrong' && <span className="text-red-600">❌ не помог</span>}
                <span className="ml-auto">{fmt(f.ts)}</span>
              </div>
              {f.title && <div className="text-sm text-slate-800">{f.actor === 'ai_agent' ? <>📩 {f.title}</> : f.title}</div>}
              {f.reasoning && <div className="text-sm text-slate-500 mt-0.5">🧠 {f.reasoning}</div>}
              <div className="flex items-center gap-3 mt-1 text-xs">
                {f.action && <span className="text-slate-600">⚡ {f.action}</span>}
                {typeof f.confidence === 'number' && (
                  <span className={f.confidence >= 0.8 ? 'text-green-600' : 'text-amber-600'}>уверенность {f.confidence}</span>
                )}
                {f.tier && <span className={`font-medium ${TIER_COLOR[f.tier] || ''}`}>{f.tier}</span>}
                {f.mode && <span className="text-slate-400">{f.mode}</span>}
                {f.actor === 'ai_agent' && f.id && !(rated[f.id] || f.outcome) && (
                  <span className="ml-auto flex gap-1">
                    <button onClick={() => rate(f.id!, 'correct')} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-green-100" title="Хороший ответ">👍</button>
                    <button onClick={() => rate(f.id!, 'wrong')} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-red-100" title="Плохой ответ">👎</button>
                  </span>
                )}
              </div>
              {f.reply && <div className="text-sm text-slate-600 mt-1 pl-3 border-l-2 border-[#e8edf3]">💬 {f.reply}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
