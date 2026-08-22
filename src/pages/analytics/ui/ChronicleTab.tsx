import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { formatDayLabel, formatTimeHM } from '@/shared/lib/time'

/**
 * Хроника: любое действие системы и ИИ — видимым.
 *
 * Одна лента на все автоматы: решения агента, инциденты сводки, рождение и
 * сверка задач, пополнение базы примеров, синк Amo, разметка тем. Правило
 * продукта: если автомат что-то сделал, человек должен уметь увидеть — что,
 * как и когда. Пустые проходы («проверил, ничего нет») сюда не пишутся.
 */

interface Ev { at: string; actor: string; action: string; summary: string; ref: string | null }

const ACTOR_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  'AI-агент': { bg: 'bg-violet-50', fg: 'text-violet-700', icon: '🤖' },
  'Сводка аварий': { bg: 'bg-red-50', fg: 'text-red-700', icon: '📡' },
  'Учётчик задач': { bg: 'bg-blue-50', fg: 'text-blue-700', icon: '🗂' },
  'Сверка задач': { bg: 'bg-emerald-50', fg: 'text-emerald-700', icon: '✅' },
  'Учитель': { bg: 'bg-amber-50', fg: 'text-amber-700', icon: '🎓' },
  'Синк Amo': { bg: 'bg-sky-50', fg: 'text-sky-700', icon: '🔄' },
  'Темы тикетов': { bg: 'bg-indigo-50', fg: 'text-indigo-700', icon: '🏷' },
}
const style = (a: string) => ACTOR_STYLE[a] || { bg: 'bg-slate-100', fg: 'text-slate-600', icon: '⚙️' }

export function ChronicleTab() {
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [actors, setActors] = useState<string[]>([])
  const [actor, setActor] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<{ events: Ev[]; actors: string[] }>(
      `/system/journal?limit=150${actor ? `&actor=${encodeURIComponent(actor)}` : ''}`, false)
      .then(d => { setEvents(d.events); setActors(a => a.length ? a : d.actors); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить хронику'))
  }, [actor])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => clearInterval(t)
  }, [load])

  if (error) return <div className="p-6 text-sm text-slate-600">{error}</div>
  if (!events) return <div className="p-6 text-sm text-slate-400">Загружаем хронику…</div>

  let lastDay = ''
  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-[13px] text-slate-700">
        <b>Хроника</b> — что, как и когда делали автоматы и ИИ. Каждое действие системы оставляет
        видимый след; пустые проходы не показываются.
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setActor('')}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            !actor ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          Все
        </button>
        {actors.map(a => (
          <button key={a} onClick={() => setActor(a)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              actor === a ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {style(a).icon} {a}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {events.length === 0 && (
          <div className="p-8 text-center text-[13px] text-slate-400">Событий пока нет</div>
        )}
        {events.map((e, i) => {
          const day = formatDayLabel(e.at)
          const divider = day !== lastDay ? (lastDay = day) : null
          const s = style(e.actor)
          return (
            <div key={i}>
              {divider && (
                <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100 text-[11px]
                                font-semibold uppercase tracking-wider text-slate-400 first:border-t-0">
                  {divider}
                </div>
              )}
              <div className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <span className="text-[11.5px] text-slate-400 tabular-nums pt-0.5 w-11 flex-none">
                  {formatTimeHM(e.at)}
                </span>
                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-md flex-none mt-0.5 ${s.bg} ${s.fg}`}>
                  {s.icon} {e.actor}
                </span>
                <div className="min-w-0">
                  <span className="text-[12px] text-slate-400">{e.action} · </span>
                  <span className="text-[12.5px] text-slate-800 break-words">{e.summary}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
