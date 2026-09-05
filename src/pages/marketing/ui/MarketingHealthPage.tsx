import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, ArrowDown, RefreshCw } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'
import { formatDateTime } from '@/shared/lib'

/**
 * Маркетинговый контур одним взглядом: светофор по цепочке
 * «сайт → пиксель → CRM → петля → Meta». Не дашборд с графиками, а ответ
 * на один вопрос «всё ли работает и где болит» за секунду. Обновляется само.
 */

type LinkStatus = 'ok' | 'warn' | 'down'
interface ChainLink {
  key: string
  title: string
  status: LinkStatus
  detail: string
  facts: string[]
  lastAt: string | null
}
interface Resp { links: ChainLink[]; overall: LinkStatus; fetchedAt: string }

const DOT: Record<LinkStatus, string> = {
  ok: 'bg-emerald-500', warn: 'bg-amber-400', down: 'bg-red-500',
}
const CARD: Record<LinkStatus, string> = {
  ok: 'border-slate-200', warn: 'border-amber-300', down: 'border-red-300',
}
const BANNER: Record<LinkStatus, { cls: string; text: string }> = {
  ok: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', text: 'Всё работает: события идут по всей цепочке' },
  warn: { cls: 'bg-amber-50 border-amber-200 text-amber-800', text: 'Работает, но есть на что посмотреть' },
  down: { cls: 'bg-red-50 border-red-200 text-red-800', text: 'Цепочка порвана — смотрите красное звено' },
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return formatDateTime(iso)
}

export function MarketingHealthPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiGet<Resp>('/integrations/meta-health', false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось получить состояние'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 60_000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-slate-500" />
          <div>
            <h1 className="text-[19px] font-semibold text-slate-800">Маркетинговый контур</h1>
            <p className="text-[12.5px] text-slate-500">
              Реклама → сайт → CRM → обратно в Meta. Обновляется само раз в минуту
              {data && <> · снято {ago(data.fetchedAt)}</>}
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[12.5px] px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-slate-300 text-slate-600 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-[13.5px] text-red-700">{error}</div>
      )}

      {data && (
        <div className={`mb-5 px-4 py-3 rounded-xl border text-[13.5px] font-medium ${BANNER[data.overall].cls}`}>
          {BANNER[data.overall].text}
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-stretch gap-2">
        {(data?.links || []).map((link, i) => (
          <div key={link.key} className="flex flex-col lg:flex-row lg:items-stretch gap-2 lg:flex-1">
            {i > 0 && (
              <div className="flex items-center justify-center text-slate-300 flex-none">
                <ArrowRight className="hidden lg:block w-4 h-4" />
                <ArrowDown className="lg:hidden w-4 h-4" />
              </div>
            )}
            <div className={`flex-1 rounded-xl border bg-white p-4 ${CARD[link.status]}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-2.5 h-2.5 rounded-full flex-none ${DOT[link.status]}`} />
                <span className="text-[13px] font-semibold text-slate-800">{link.title}</span>
              </div>
              <div className="text-[12.5px] text-slate-600 leading-snug">{link.detail}</div>
              {link.facts.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {link.facts.map(f => (
                    <span key={f} className="text-[11.5px] text-slate-400 font-mono">{f}</span>
                  ))}
                </div>
              )}
              {link.lastAt && (
                <div className="mt-1.5 text-[11.5px] text-slate-400">последнее: {ago(link.lastAt)}</div>
              )}
            </div>
          </div>
        ))}
        {!data && loading && (
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-6 text-[13px] text-slate-400">
            Опрашиваем цепочку…
          </div>
        )}
      </div>

      <p className="mt-5 text-[12px] text-slate-400 max-w-3xl">
        Зелёное — звено живо и через него идут события. Жёлтое — работает, но событий давно не было
        или скоро потребуется действие. Красное — звено сломано, в карточке написано, что именно.
        Подробные счётчики петли — в настройках, в окне интеграции Meta.
      </p>
    </div>
  )
}
