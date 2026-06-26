import { useEffect, useState, useCallback } from 'react'
import { apiGet } from '@/shared/services/api.service'

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

function ago(ts: string | null): string {
  if (!ts) return 'никогда'
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return `${s} сек назад`
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return `${Math.floor(s / 86400)} дн назад`
}

export function ModulesStatusTab() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(() => {
    apiGet<Resp>('/analytics/modules-status', false).then(setData).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 20000) // авто-обновление каждые 20 сек = реал-тайм
    const t = setInterval(() => setTick((x) => x + 1), 5000) // пересчёт «X назад»
    return () => { clearInterval(iv); clearInterval(t) }
  }, [load])

  void tick

  if (error) return <div className="text-sm text-red-600 py-8">Ошибка: {error}</div>
  if (!data) return <div className="text-sm text-slate-400 py-8">Загрузка статуса модулей…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900 flex-1">
          <strong>Модули в реальном времени</strong> — что и когда работает. Обновляется автоматически каждые 20 сек.
        </div>
        <span className="ml-3 text-xs text-slate-400 whitespace-nowrap flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> live · {ago(data.fetchedAt)}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.modules.map((m) => (
          <div key={m.key} className="bg-white border border-[#e8edf3] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${DOT[m.status]} ${m.status === 'ok' ? 'animate-pulse' : ''}`} />
              <span className="font-semibold text-slate-800">{m.name}</span>
              {m.mode && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${m.mode === 'live' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {m.mode === 'live' ? 'LIVE' : 'SHADOW'}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">{LABEL[m.status]}</span>
            </div>
            <div className="text-sm text-slate-600">{m.summary}</div>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
              <span>🕐 {ago(m.lastRunAt)}</span>
              <span>· {m.schedule}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
