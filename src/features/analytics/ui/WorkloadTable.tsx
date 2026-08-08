import { Fragment, useEffect, useMemo, useState } from 'react'
import { Loader2, Info, MessageSquare, Briefcase, Zap, Monitor, CalendarDays, Clock, ChevronDown } from 'lucide-react'
import { fetchWorkload, type WorkloadPayload, type WorkloadGroupRow } from '@/shared/api'

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
  // Раскрытые строки: сотрудник → топ групп по времени
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groupsByAgent = useMemo(() => {
    const map = new Map<string, WorkloadGroupRow[]>()
    for (const g of data?.groups ?? []) {
      const list = map.get(g.agentId) || []
      list.push(g)
      map.set(g.agentId, list)
    }
    return map
  }, [data])

  const toggleExpand = (id: string | null) => {
    if (!id) return
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
                <th className="text-right font-medium px-3 py-2" title="Часы в переписке: промежутки ≤15 мин между сообщениями агента суммируются, больший разрыв = перерыв. Оценка снизу — работа без сообщений (чтение, звонки, настройки) не видна">
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />В переписке</span>
                </th>
                <th className="text-right font-medium px-4 py-2" title="Время с открытой вкладкой приложения (по heartbeat). НЕ включает работу из Telegram напрямую — читать вместе с «В переписке»">
                  <span className="inline-flex items-center gap-1"><Monitor className="w-3 h-3" />В приложении</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => (
                <Fragment key={a.id || 'unmatched'}>
                <tr
                  onClick={() => toggleExpand(a.id)}
                  className={`border-b border-slate-50 hover:bg-slate-50/60 ${a.id ? 'cursor-pointer' : 'opacity-60'}`}
                  title={a.id ? 'Клик — на какие группы уходит время' : undefined}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      {a.id && (
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-300 flex-shrink-0 transition-transform ${expanded.has(a.id) ? 'rotate-180' : ''}`} />
                      )}
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
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {a.chatHours != null && a.chatHours > 0 ? (
                      <>
                        <span className="font-medium text-slate-800">
                          {(Math.round((a.chatHours - (a.chatHoursInternal || 0)) * 10) / 10).toLocaleString('ru-RU')} ч
                        </span>
                        {(a.chatHoursInternal || 0) > 0 && (
                          <span className="text-[11px] text-slate-400" title="Из них во внутренних чатах команды — не клиентская работа">
                            {' '}+{a.chatHoursInternal!.toLocaleString('ru-RU')} внутр.
                          </span>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {a.appHours != null && a.appHours > 0 ? `${a.appHours.toLocaleString('ru-RU')} ч` : '—'}
                  </td>
                </tr>
                {a.id && expanded.has(a.id) && (
                  <tr className="border-b border-slate-100 bg-slate-50/40">
                    <td colSpan={7} className="px-4 py-2.5">
                      {(() => {
                        const list = groupsByAgent.get(a.id!) || []
                        if (list.length === 0) return <p className="text-xs text-slate-400 py-1">Нет данных по группам за период.</p>
                        const maxH = Math.max(...list.map(g => g.hours), 0.1)
                        return (
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Куда уходит время · топ-{list.length} групп</p>
                            {list.map(g => (
                              <div key={g.channelId} className="flex items-center gap-2 text-xs">
                                <span className="w-52 truncate text-slate-700" title={g.name}>{g.name}</span>
                                {g.kind === 'internal' && (
                                  <span className="px-1 py-px text-[9px] rounded bg-slate-200 text-slate-500 flex-shrink-0" title="Внутренний чат команды">внутр.</span>
                                )}
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[240px]">
                                  <div
                                    className={`h-full rounded-full ${g.kind === 'internal' ? 'bg-slate-300' : 'bg-blue-400'}`}
                                    style={{ width: `${Math.max(3, Math.round((g.hours / maxH) * 100))}%` }}
                                  />
                                </div>
                                <span className="tabular-nums text-slate-600 w-14 text-right">{g.hours.toLocaleString('ru-RU')} ч</span>
                                <span className="tabular-nums text-slate-400 w-16 text-right">{g.msgs} сообщ.</span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 px-4 py-3 bg-slate-50 border-t border-[#e8edf3] text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <p>
          Все колонки — прокси, читать вместе. «В переписке» — клиентские группы; «+N внутр.» —
          внутренние чаты команды отдельно. Это кластеры сообщений
          (разрыв больше 15 мин = перерыв), оценка снизу: консультации, звонки и настройки
          без сообщений не видны. «В приложении» — время с открытой вкладкой: кто работает
          из Telegram, здесь невидим. «Тикетов» — по факту переписки, а не по полю «назначен».
          Работа вне системы (обучение клиентов, сведение с поставщиками) не измеряется ничем.
        </p>
      </div>
    </div>
  )
}
