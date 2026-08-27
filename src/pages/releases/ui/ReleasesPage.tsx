import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { VersionInfo } from '@/shared/hooks/useVersionCheck'
import { formatDateDMY } from '@/shared/lib/time'

/**
 * Что нового — история выпусков.
 *
 * Баннер обновления живёт секунды: его закрывают, не читая, и через день
 * никто не помнит, что появилось. Раздел с историей нужен, чтобы к списку
 * можно было вернуться — и чтобы вышедший из отпуска увидел, что пропустил.
 *
 * Источник тот же, что у баннера: один файл, две копии состава выпуска
 * разъехались бы на первой же выкладке.
 */
export function ReleasesPage() {
  const [list, setList] = useState<VersionInfo[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/releases.json?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setList(Array.isArray(d) ? d : []))
      .catch(() => setError(true))
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-[#f5f7fa]">
      <div className="max-w-2xl mx-auto px-5 py-6">
        <Link to="/me" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500
                                  hover:text-blue-600 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> в «Моё»
        </Link>

        <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Что нового</h1>
        <p className="text-[13px] text-slate-500 mt-1 mb-6">
          Что менялось в системе и когда. Свежее сверху.
        </p>

        {error && (
          <p className="text-[13px] text-slate-400">Не удалось загрузить историю выпусков.</p>
        )}
        {!list && !error && <p className="text-[13px] text-slate-400">Загружаю…</p>}

        <div className="space-y-4">
          {(list || []).map(r => (
            <section key={r.version} className="bg-white rounded-xl border border-[#e8edf3] overflow-hidden">
              <header className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2.5 flex-wrap">
                <h2 className="text-[15px] font-semibold text-slate-900">{r.title || 'Обновление'}</h2>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                  {r.version}
                </span>
                {r.date && (
                  <span className="text-[12px] text-slate-400 tabular-nums ml-auto">
                    {formatDateDMY(r.date)}
                  </span>
                )}
              </header>
              <ul className="divide-y divide-slate-50">
                {(r.notes || []).map((n, i) => (
                  <li key={i} className="px-5 py-3 flex gap-3">
                    <span className="flex-none text-lg leading-6">{n.icon || '•'}</span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-slate-800">{n.title}</p>
                      {n.text && (
                        <p className="text-[12.5px] text-slate-500 leading-snug mt-0.5">{n.text}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ReleasesPage
