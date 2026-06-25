import { useEffect, useState } from 'react'
import { ArrowRight, RefreshCw, Recycle } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Цикл знаний (шаг 5 редизайна). Визуализация петли самообучения:
 * Кейс решён → Извлечение пары → Проверка человеком → База знаний → Дообучение
 * агента → ♻. Метрики — из статистики решений агента (обратная связь).
 */

interface AgentStats {
  total?: number
  correct?: number
  wrong?: number
  avg_confidence?: number
}

const STEPS = [
  { emoji: '🎯', title: 'Кейс решён', desc: 'Диалог закрыт с решением' },
  { emoji: '🧩', title: 'Извлечение пары', desc: 'Проблема → решение' },
  { emoji: '👀', title: 'Проверка человеком', desc: 'Подтвердить / поправить' },
  { emoji: '📚', title: 'База знаний', desc: 'Сохранить в KB + контекст агента' },
  { emoji: '🤖', title: 'Дообучение агента', desc: 'Агент использует в ответах' },
]

export function KnowledgeCycleTab() {
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    apiGet<{ stats?: AgentStats }>('/ai/agent?limit=1')
      .then(d => setStats(d.stats || {}))
      .catch(() => setStats({}))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const metrics = [
    { label: 'Решений агента', value: stats?.total ?? '—', color: 'text-blue-600 bg-blue-50' },
    { label: 'Подтверждено', value: stats?.correct ?? '—', color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Помечено ошибкой', value: stats?.wrong ?? '—', color: 'text-rose-600 bg-rose-50' },
    { label: 'Ср. уверенность', value: stats?.avg_confidence != null ? `${Math.round(Number(stats.avg_confidence) * 100)}%` : '—', color: 'text-violet-600 bg-violet-50' },
  ]

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Recycle className="w-5 h-5 text-emerald-600" />
            <h2 className="text-[15.5px] font-bold text-slate-800">Цикл знаний — как система учится</h2>
          </div>
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Обновить">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Метрики */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {metrics.map(m => (
            <div key={m.label} className="bg-white rounded-xl border border-[#e8edf3] p-4">
              <div className={`inline-flex text-2xl font-extrabold tabular-nums px-2 py-0.5 rounded-lg ${m.color}`}>{m.value}</div>
              <div className="text-xs text-slate-500 mt-1.5">{m.label}</div>
            </div>
          ))}
        </div>

        {/* 5-шаговый цикл */}
        <div className="bg-white rounded-xl border border-[#e8edf3] p-6">
          <div className="flex flex-wrap items-start justify-center gap-y-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex items-center">
                <div className="flex flex-col items-center text-center w-[120px]">
                  <div className="w-[54px] h-[54px] rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-2xl">
                    {s.emoji}
                  </div>
                  <div className="text-sm font-semibold text-slate-800 mt-2">{s.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{s.desc}</div>
                </div>
                {i < STEPS.length - 1 ? (
                  <ArrowRight className="w-5 h-5 text-slate-300 mx-1 mt-5 flex-shrink-0" />
                ) : (
                  <div className="flex items-center mx-1 mt-5 text-emerald-500 flex-shrink-0" title="Цикл повторяется">
                    <Recycle className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 text-center mt-4">
            Каждый решённый кейс делает агента и базу знаний умнее. Подтверждённые пары попадают в ответы агента,
            ошибочные — отфильтровываются обратной связью.
          </p>
        </div>
      </div>
    </div>
  )
}

export default KnowledgeCycleTab
