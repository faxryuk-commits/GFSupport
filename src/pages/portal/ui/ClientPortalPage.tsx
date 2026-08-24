/**
 * Клиентский статус-портал — публичная страница /r/:token (ссылка живёт
 * в группе клиента). Утверждённый прототип на живых данных: прогресс
 * подключения, «что нужно от вас» с инструкциями базы знаний, этапы
 * работ и статусы запросов из переписки. Без авторизации, гейт — токен.
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

type Portal = {
  brand: { name: string; tariff: string | null; launchDue: string | null; pos: string | null }
  progress: { done: number; total: number }
  needs: Array<{ title: string; desc: string; guide: string | null; state: string; waitDays: number }>
  groups: Array<{ label: string; state: string }>
  requests: Array<{ title: string; state: string; at: string }>
}

const fmtD = (iso: string | null) => {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) } catch { return null }
}

function StateBadge({ state, waitDays }: { state: string; waitDays?: number }) {
  if (state === 'done') return <span className="ml-auto flex-none font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 text-emerald-700 bg-emerald-100">получено</span>
  if (state === 'waiting') return <span className="ml-auto flex-none font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 text-amber-700 bg-amber-100">ждём{waitDays ? ` ${waitDays} дн` : ' вас'}</span>
  return <span className="ml-auto flex-none font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 text-blue-700 bg-blue-100">в работе</span>
}

export default function ClientPortalPage() {
  const { token } = useParams()
  const [data, setData] = useState<Portal | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading')

  useEffect(() => {
    if (!token) { setState('notfound'); return }
    const load = () => fetch(`/api/support/public/portal?token=${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { setData(d); setState('ok') })
      .catch(() => setState('notfound'))
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [token])

  if (state === 'loading') {
    return <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center text-slate-400 text-sm">Загружаем статус…</div>
  }
  if (state === 'notfound' || !data) {
    return <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center text-slate-500 text-sm">Страница не найдена — уточните ссылку у команды Delever</div>
  }

  const p = data.progress
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const waiting = data.needs.filter(n => n.state !== 'done')

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#0f1c2e]" style={{ font: '15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="max-w-[760px] mx-auto px-5 py-8">
        <div className="rounded-3xl text-white p-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#1d4ed8,#4338ca)' }}>
          <div className="absolute right-5 top-4 text-5xl opacity-25">🚀</div>
          <div className="text-2xl font-extrabold tracking-tight">{data.brand.name} × Delever</div>
          <div className="text-[13.5px] opacity-85 mt-1">
            Подключение к платформе онлайн-заказов
            {data.brand.tariff ? ` · тариф ${data.brand.tariff}` : ''}
            {fmtD(data.brand.launchDue) ? ` · запуск до ${fmtD(data.brand.launchDue)}` : ''}
          </div>
          {data.brand.pos && <div className="text-[12.5px] mt-3 opacity-90">POS: <b className="font-mono">{data.brand.pos}</b></div>}
          <div className="mt-4">
            <div className="h-2.5 rounded-md overflow-hidden" style={{ background: '#ffffff2e' }}>
              <div className="h-full rounded-md bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs mt-1.5 opacity-90">
              Готово {p.done} из {p.total} шагов{waiting.length ? ` · сейчас нужны ${waiting.length} пункт(а) ниже 👇` : ' · почти на финише!'}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#e3e9f2] rounded-2xl p-5 mt-4 shadow-sm">
          <h2 className="text-base font-extrabold">📋 Что нужно от вас</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2">Пришлите прямо в нашу общую группу — по пунктам есть инструкции из базы знаний Delever.</p>
          {data.needs.length === 0 && <p className="text-[13px] text-slate-400 py-2">Сейчас от вас ничего не нужно — работаем 💪</p>}
          {data.needs.map((n, i) => (
            <div key={i} className="flex gap-3 py-2.5 border-t border-slate-100 items-start">
              <span className={`flex-none w-7 h-7 rounded-lg flex items-center justify-center text-[13px] ${n.state === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {n.state === 'done' ? '✓' : '⏳'}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{n.title}</div>
                {n.state !== 'done' && <div className="text-[12.5px] text-slate-500 mt-0.5">{n.desc}</div>}
                {n.state !== 'done' && n.guide && (
                  <a href={n.guide} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600 hover:underline">Как это сделать → инструкция</a>
                )}
              </div>
              <StateBadge state={n.state} waitDays={n.waitDays} />
            </div>
          ))}
        </div>

        {data.groups.length > 0 && (
          <div className="bg-white border border-[#e3e9f2] rounded-2xl p-5 mt-4 shadow-sm">
            <h2 className="text-base font-extrabold mb-2.5">⚙️ Что делаем мы</h2>
            <div className="flex gap-1.5 flex-wrap">
              {data.groups.map((g, i) => (
                <span key={i} className={`flex-1 min-w-[110px] rounded-xl px-2.5 py-2 text-[11.5px] border ${
                  g.state === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : g.state === 'now' ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold'
                      : 'bg-slate-50 border-[#e3e9f2] text-slate-500'}`}>
                  <b className="block text-[9.5px] opacity-70">{g.state === 'done' ? 'ГОТОВО' : g.state === 'now' ? 'СЕЙЧАС' : 'ДАЛЬШЕ'}</b>
                  {g.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {data.requests.length > 0 && (
          <div className="bg-white border border-[#e3e9f2] rounded-2xl p-5 mt-4 shadow-sm">
            <h2 className="text-base font-extrabold">🗂 Ваши запросы</h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2">Всё, что вы просили в группе, — со статусами. Обновляется само.</p>
            {data.requests.map((r, i) => (
              <div key={i} className="flex gap-3 py-2.5 border-t border-slate-100 items-start">
                <span className={`flex-none w-7 h-7 rounded-lg flex items-center justify-center text-[13px] ${r.state === 'done' ? 'bg-emerald-100 text-emerald-700' : r.state === 'waiting' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {r.state === 'done' ? '✓' : r.state === 'waiting' ? '⏳' : '🔧'}
                </span>
                <div className="text-sm font-semibold min-w-0 truncate">{r.title}</div>
                <StateBadge state={r.state === 'waiting' ? 'waiting' : r.state} />
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl px-4.5 py-3.5 mt-4 text-[13.5px] p-4" style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', color: '#065f46' }}>
          💬 Вопрос по любому пункту — пишите прямо в нашу общую группу, команда Delever на связи.
        </div>
        <p className="mt-5 text-xs text-slate-400 text-center">
          Delever · платформа онлайн-заказов для ресторанов · <a className="text-blue-600" href="https://delever.gitbook.io/delever" target="_blank" rel="noreferrer">база знаний</a>
        </p>
      </div>
    </div>
  )
}
