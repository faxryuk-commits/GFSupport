import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiGet } from '@/shared/services/api.service'
import { formatDateTime } from '@/shared/lib'

/**
 * Светофор маркетингового контура — компактный блок для окна интеграции Meta.
 * Пять звеньев «сайт → пиксель → CRM → петля → крон» строками: открыл окно —
 * за секунду видно, всё ли живо и где болит. Живёт здесь, а не отдельной
 * страницей: смотреть на здоровье подключения естественно там же, где его
 * подключали.
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
const BANNER: Record<LinkStatus, { cls: string; text: string }> = {
  ok: { cls: 'bg-emerald-50 text-emerald-700', text: 'Всё работает: события идут по всей цепочке' },
  warn: { cls: 'bg-amber-50 text-amber-700', text: 'Работает, но есть жёлтые звенья' },
  down: { cls: 'bg-red-50 text-red-700', text: 'Цепочка порвана — смотрите красное звено' },
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return formatDateTime(iso)
}

export function MetaChainHealth() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiGet<Resp>('/integrations/meta-health', false)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 60_000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  if (!data && loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] text-slate-400">
        Проверяем цепочку рекламы…
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 rounded-t-xl text-[12.5px] font-medium ${BANNER[data.overall].cls}`}>
        <span>{BANNER[data.overall].text}</span>
        <button onClick={load} disabled={loading} title="Обновить"
          className="flex-none opacity-60 hover:opacity-100 disabled:opacity-30">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {data.links.map(link => (
          <div key={link.key} className="flex items-start gap-2.5 px-4 py-2.5">
            <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-none ${DOT[link.status]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-semibold text-slate-800">{link.title}</span>
                <span className="text-[12.5px] text-slate-500">{link.detail}</span>
              </div>
              {link.facts.length > 0 && (
                <div className="flex flex-wrap gap-x-3 mt-0.5">
                  {link.facts.map(f => (
                    <span key={f} className="text-[11px] text-slate-400 font-mono">{f}</span>
                  ))}
                </div>
              )}
            </div>
            {link.lastAt && (
              <span className="flex-none text-[11px] text-slate-400 mt-0.5">{ago(link.lastAt)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
