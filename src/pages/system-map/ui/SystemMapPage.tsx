import { useEffect, useState } from 'react'
import { Map as MapIcon, ArrowRight, RefreshCw } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Карта системы (шаг 4 редизайна). Пайплайн модулей со статусами в реальном
 * времени: Приём → Анализ → Автоматизация → Витрины. Данные — тот же эндпоинт,
 * что и вкладка «Модули», но в виде потока, а не списка.
 */

interface Module {
  key: string
  name: string
  status: 'ok' | 'warn' | 'down' | 'idle'
  lastRunAt: string | null
  schedule: string
  summary: string
  mode?: string | null
}
interface Resp { modules: Module[]; fetchedAt: string }

const DOT: Record<string, string> = { ok: 'bg-green-500', warn: 'bg-amber-500', down: 'bg-red-500', idle: 'bg-slate-300' }
const LABEL: Record<string, string> = { ok: 'Работает', warn: 'Давно не запускался', down: 'Не работает', idle: 'Простаивает' }

const STAGES: Array<{ key: string; title: string; match: RegExp }> = [
  { key: 'ingest', title: 'Приём', match: /webhook|ingest|bridge|telegram|whatsapp|wa[-_]|channel/i },
  { key: 'analysis', title: 'Анализ', match: /taxonom|media|analyz|analiz|sentiment|transcri|auto[-_]?process|classif|backfill/i },
  { key: 'automation', title: 'Автоматизация', match: /agent|sla|guard|resolver|learn|outcome|commitment|autorespond|broadcast|reminder/i },
  { key: 'output', title: 'Витрины', match: /report|benchmark|analytic|health|recompute|daily/i },
]

function assignStage(m: Module): string {
  for (const s of STAGES) if (s.match.test(m.key) || s.match.test(m.name)) return s.key
  return 'automation'
}
function ago(ts: string | null): string {
  if (!ts) return 'никогда'
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return `${s} сек`
  if (s < 3600) return `${Math.floor(s / 60)} мин`
  if (s < 86400) return `${Math.floor(s / 3600)} ч`
  return `${Math.floor(s / 86400)} дн`
}

export function SystemMapPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    apiGet<Resp>('/analytics/modules-status', false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const byStage = (stageKey: string) => (data?.modules || []).filter(m => assignStage(m) === stageKey)
  const counts = (data?.modules || []).reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a }, {} as Record<string, number>)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <MapIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[19px] font-extrabold text-slate-900 leading-tight">Карта системы</h1>
            <p className="text-sm text-slate-500">Поток модулей и их статусы в реальном времени</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{counts.ok || 0}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{counts.warn || 0}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{counts.down || 0}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" />{counts.idle || 0}</span>
            </div>
          )}
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Обновить">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">Ошибка: {error}</div>}
      {loading && !data && <div className="p-8 text-center text-slate-400">Загрузка карты…</div>}

      {data && (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
          {STAGES.map((stage, i) => {
            const mods = byStage(stage.key)
            return (
              <div key={stage.key} className="flex items-stretch gap-2">
                <div className="w-[230px] flex-shrink-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#5d6f96] mb-2 px-1">{stage.title}</div>
                  <div className="space-y-2">
                    {mods.length === 0 && <div className="text-xs text-slate-400 px-1">—</div>}
                    {mods.map(m => (
                      <div key={m.key} className="bg-white rounded-xl border border-[#e8edf3] p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[m.status]}`} title={LABEL[m.status]} />
                          <span className="text-sm font-semibold text-slate-800 truncate flex-1">{m.name}</span>
                          {m.mode && <span className="text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">{m.mode}</span>}
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-2">{m.summary}</p>
                        <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400">
                          <span>{m.schedule}</span>
                          <span>{ago(m.lastRunAt)} назад</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="flex items-center flex-shrink-0">
                    <ArrowRight className="w-5 h-5 text-slate-300" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default SystemMapPage
