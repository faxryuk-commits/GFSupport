import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'

/**
 * Что нового — заметки о выпусках для команды.
 *
 * Исправления выходили по несколько раз в день, а команда не понимала,
 * решаются ли проблемы, о которых она говорила. Здесь — что было не так,
 * что теперь и где смотреть. Та же запись уходит в колокольчик и в Telegram.
 */

interface Item { kind: 'fix' | 'new' | 'change'; text: string; where?: string }
interface Release { version: string; date: string; title: string; items: Item[] }

const KIND: Record<Item['kind'], { label: string; cls: string }> = {
  fix: { label: 'исправлено', cls: 'bg-emerald-50 text-emerald-700' },
  new: { label: 'новое', cls: 'bg-blue-50 text-blue-700' },
  change: { label: 'изменено', cls: 'bg-gray-100 text-gray-600' },
}

export const SEEN_KEY = 'whatsnew.seen'

export function WhatsNewPage() {
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiGet<{ releases: Release[]; latest: string | null }>('/release-notes', false)
      .then(r => {
        setReleases(r.releases || [])
        // Открыли страницу — точка в меню гаснет
        try { if (r.latest) localStorage.setItem(SEEN_KEY, r.latest) } catch { /* приватный режим */ }
        window.dispatchEvent(new CustomEvent('whatsnew:seen'))
      })
      .catch(e => setError(e?.message || 'Не удалось загрузить'))
  }, [])

  return (
    <div className="max-w-[860px] mx-auto px-6 py-5 space-y-5">
      <div>
        <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">Что нового</h1>
        <p className="text-[12.5px] text-gray-500">Что было не так → что теперь → где смотреть. Свежее сверху.</p>
      </div>
      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
      {!releases && !error && <div className="text-[12.5px] text-gray-400">Загружаю…</div>}
      {releases?.map((r, i) => (
        <section key={r.version} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <header className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-baseline gap-3">
            <h2 className="text-[14px] font-semibold text-gray-900">{r.title}</h2>
            <span className="text-[11.5px] text-gray-400 tabular-nums">{r.date}</span>
            {i === 0 && <span className="text-[10.5px] font-semibold px-1.5 py-px rounded-md bg-blue-600 text-white">свежее</span>}
          </header>
          <ul className="divide-y divide-gray-100">
            {r.items.map((it, j) => (
              <li key={j} className="px-4 py-2.5 flex gap-3 items-start">
                <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap mt-0.5 ${KIND[it.kind].cls}`}>
                  {KIND[it.kind].label}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] text-gray-800 leading-snug">{it.text}</div>
                  {it.where && <div className="text-[11.5px] text-gray-400 mt-0.5">{it.where}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default WhatsNewPage
