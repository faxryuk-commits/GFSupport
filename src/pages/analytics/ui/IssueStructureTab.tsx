import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'

interface Subtype { subtype: string; issues: number; automatablePct: number }
interface Domain { domain: string; issues: number; automatablePct: number; vaguePct: number; subtypes: Subtype[] }
interface Candidate { domain: string; subtype: string; issues: number; automatablePct: number }
interface Snapshot {
  totalIssues: number
  channels: number
  needsReliable: number
  waGap: number
  statuses: Array<{ status: string; count: number }>
}
interface Resp {
  available: boolean
  computedAt?: string | null
  snapshot?: Snapshot | null
  domains: Domain[]
  candidates?: Candidate[]
}

const STATUS_RU: Record<string, string> = {
  awaiting_team: 'Ждёт ответа', resolved: 'Решено', awaiting_client: 'Ждём клиента',
  stalled: 'Зависло', informational: 'Инфо/рассылки', abandoned: 'Брошено', empty: 'Пусто', unknown: '—',
}
const STATUS_COLOR: Record<string, string> = {
  awaiting_team: 'border-red-400', resolved: 'border-green-400', awaiting_client: 'border-amber-400',
  stalled: 'border-orange-400', informational: 'border-slate-300', abandoned: 'border-purple-400', empty: 'border-slate-200',
}

function Bar({ pct, className = 'bg-blue-500' }: { pct: number; className?: string }) {
  return (
    <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
      <div className={`h-full rounded ${className}`} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  )
}

export function IssueStructureTab() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    apiGet<Resp>('/analytics/issue-taxonomy')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-sm text-slate-400 py-8">Загрузка структуры обращений…</div>
  if (error) return <div className="text-sm text-red-600 py-8">Ошибка: {error}</div>
  if (!data?.available || !data.domains.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900">
        Снимок структуры обращений ещё не построен. Запустите пересчёт таксономии.
      </div>
    )
  }

  const snap = data.snapshot
  const maxDomain = Math.max(...data.domains.map((d) => d.issues), 1)
  const computed = data.computedAt ? new Date(data.computedAt).toLocaleDateString('ru-RU') : '—'

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Структура обращений</strong> — таксономия снизу-вверх из всех сообщений (текст + разбор
        фото/голоса). Клик по домену → подтипы. «размыто %» = доля «не конкретизировано».
        Снимок от {computed}.
      </div>

      {snap && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card big={snap.totalIssues} label="проблем извлечено" />
            <Card big={snap.channels} label="каналов" />
            <Card big={snap.needsReliable} label="реально ждут ответа" tone="text-red-600" />
            <Card big={snap.waGap} label="WhatsApp в дыре простоя" tone="text-amber-600" />
          </div>
          <div className="flex flex-wrap gap-2">
            {snap.statuses.map((s) => (
              <div key={s.status} className={`bg-white border rounded-lg px-3 py-2 border-t-2 ${STATUS_COLOR[s.status] || 'border-slate-300'}`}>
                <div className="text-lg font-bold text-slate-800">{s.count}</div>
                <div className="text-xs text-slate-500">{STATUS_RU[s.status] || s.status}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Домены — что спрашивают</h3>
        <div className="space-y-0.5">
          {data.domains.map((d) => {
            const isOpen = open[d.domain]
            return (
              <div key={d.domain}>
                <button
                  onClick={() => setOpen((p) => ({ ...p, [d.domain]: !p[d.domain] }))}
                  className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-slate-50 text-left"
                >
                  <span className="w-44 shrink-0 text-sm text-slate-700">
                    {isOpen ? '▾' : '▸'} {d.domain}{' '}
                    <span className="text-xs text-slate-400">размыто {d.vaguePct}%</span>
                  </span>
                  <Bar pct={(100 * d.issues) / maxDomain} />
                  <span className="w-16 text-right text-sm tabular-nums text-slate-700">{d.issues}</span>
                  <span className={`w-12 text-right text-sm tabular-nums ${d.automatablePct >= 25 ? 'text-green-600 font-semibold' : 'text-slate-400'}`}>
                    {d.automatablePct}%
                  </span>
                </button>
                {isOpen && (
                  <div className="ml-6 my-1 bg-slate-50 rounded-md p-2 space-y-0.5">
                    {d.subtypes.map((s) => {
                      const mx = Math.max(...d.subtypes.map((x) => x.issues), 1)
                      return (
                        <div key={s.subtype} className="flex items-center gap-3 px-2 py-1 text-sm">
                          <span className="w-40 shrink-0 text-slate-600">{s.subtype}</span>
                          <Bar pct={(100 * s.issues) / mx} className="bg-slate-400" />
                          <span className="w-16 text-right tabular-nums text-slate-600">{s.issues}</span>
                          <span className={`w-12 text-right tabular-nums ${s.automatablePct >= 25 ? 'text-green-600' : 'text-slate-400'}`}>
                            {s.automatablePct}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {data.candidates && data.candidates.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Топ кандидатов на автоматизацию</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase">
                <th className="text-left py-1.5 px-2">Домен</th>
                <th className="text-left py-1.5 px-2">Подтип</th>
                <th className="text-right py-1.5 px-2">Проблем</th>
                <th className="text-right py-1.5 px-2">Автомат.</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5 px-2 text-slate-600">{c.domain}</td>
                  <td className="py-1.5 px-2 text-slate-700">{c.subtype}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{c.issues}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-green-600 font-medium">{c.automatablePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Card({ big, label, tone = 'text-slate-900' }: { big: number; label: string; tone?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className={`text-2xl font-bold ${tone}`}>{big}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
