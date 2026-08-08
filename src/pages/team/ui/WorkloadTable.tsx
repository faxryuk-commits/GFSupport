import { useEffect, useState } from 'react'
import { Loader2, Info, MessageSquare, Briefcase, Zap, Monitor, CalendarDays } from 'lucide-react'
import { fetchWorkload, type WorkloadPayload } from '@/shared/api'

const PERIODS = [7, 30, 90] as const

/**
 * Таблица загрузки сотрудников поддержки.
 *
 * ВАЖНО про честность данных (по этой таблице принимают кадровые решения):
 * ни одна колонка не измеряет «реальные часы работы» — это набор прокси,
 * которые нужно читать вместе. «Часы в приложении» — время с открытой
 * вкладкой; кто отвечает клиентам прямо из Telegram (Фирдавс, Насиба),
 * в этой колонке почти невидим, зато виден в объёме переписки. И наоборот:
 * можно держать вкладку открытой и не работать. Поэтому и подписи, и
 * тултипы проговаривают методику, а не изображают точность.
 */
export function WorkloadTable() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<WorkloadPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWorkload(days)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить данные о нагрузке') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const maxMessages = Math.max(1, ...(data?.agents.map(a => a.messages) ?? [1]))

  return (
    <div className="bg-white border border-[#e8edf3] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e8edf3] flex-wrap">
        <h3 className="font-semibold text-slate-800">Загрузка команды</h3>
        <span className="text-xs text-slate-400">кто сколько реально делает в поддержке</span>
        <div className="flex-1" />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setDays(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                days === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p} дн
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="p-6 text-sm text-red-600 text-center">{error}</div>
      ) : !data && loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Считаем нагрузку…
        </div>
      ) : !data || data.agents.length === 0 ? (
        <div className="p-6 text-sm text-slate-400 text-center">Нет активности за период.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-[#e8edf3]">
                <th className="text-left font-medium px-4 py-2">Сотрудник</th>
                <th className="text-right font-medium px-3 py-2" title="Сообщений клиентам за период (Telegram + WhatsApp), в скобках — тысяч символов">
                  <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" />Сообщений</span>
                </th>
                <th className="text-right font-medium px-3 py-2" title="Тикеты, в чей канал сотрудник писал в период жизни тикета">
                  <span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3" />Тикетов</span>
                </th>
                <th className="text-right font-medium px-3 py-2" title="Календарные дни (Ташкент) хотя бы с одним сообщением клиенту">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />Дней</span>
                </th>
                <th className="text-right font-medium px-3 py-2" title="Средняя скорость первого ответа клиенту; в скобках — сколько первых ответов дал">
                  <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" />Ср. ответ</span>
                </th>
                <th className="text-right font-medium px-4 py-2" title="Время с открытой вкладкой приложения (по heartbeat). НЕ включает работу из Telegram напрямую — читать вместе с колонкой «Сообщений»">
                  <span className="inline-flex items-center gap-1"><Monitor className="w-3 h-3" />В приложении</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => (
                <tr key={a.id || 'unmatched'} className={`border-b border-slate-50 hover:bg-slate-50/60 ${a.id ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{a.name}</p>
                        {a.role && <p className="text-[11px] text-slate-400">{a.role}</p>}
                      </div>
                    </div>
                    {/* Мини-бар объёма относительно лидера — мгновенное сравнение без чтения цифр */}
                    <div className="mt-1 h-1 w-full max-w-[160px] bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full"
                        style={{ width: `${Math.max(2, Math.round((a.messages / maxMessages) * 100))}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="font-semibold text-slate-800">{a.messages.toLocaleString('ru-RU')}</span>
                    <span className="text-[11px] text-slate-400"> · {Math.round(a.chars / 1000)}К</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{a.casesTouched || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{a.activeDays || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {a.frtAvgMinutes != null ? (
                      <>
                        <span className={a.frtAvgMinutes <= 15 ? 'text-emerald-600 font-medium' : a.frtAvgMinutes <= 60 ? 'text-slate-700' : 'text-amber-600'}>
                          {a.frtAvgMinutes} мин
                        </span>
                        <span className="text-[11px] text-slate-400"> ({a.frtResponses})</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {a.appHours != null && a.appHours > 0 ? `${a.appHours.toLocaleString('ru-RU')} ч` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 px-4 py-3 bg-slate-50 border-t border-[#e8edf3] text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <p>
          Все колонки — прокси, читать вместе. «В приложении» = время с открытой вкладкой:
          кто работает из Telegram напрямую, здесь невидим, но виден в «Сообщений».
          «Тикетов» — по факту переписки в канале тикета, а не по полю «назначен».
          Реальные часы фокуса на клиенте система не измеряет.
        </p>
      </div>
    </div>
  )
}
