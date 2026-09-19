import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Activity, TriangleAlert, Link2, Check, X, ChevronDown, ChevronUp, Plug, PieChart, Lightbulb, MessageSquareText } from 'lucide-react'

/**
 * «Пульс бренда» — живые заказы клиента из аналитики Delever в карточке
 * аккаунта. Появляется только у аккаунтов, связанных с брендом платформы
 * (ch_brand_map). Пороги светофора активации выверены по когорте 13+ мес.
 */

interface Pulse {
  mapped: boolean
  confirmed?: boolean
  shipperName?: string
  ageDays?: number | null
  weeks?: Array<{ week: string; n: number }>
  month30?: { done: number; cancelPct: number; ownPct: number; channels: number; medMin: number | null }
  rating?: { value: number; count: number } | null
  activation?: { level: 'green' | 'yellow' | 'red'; reasons: string[] } | null
  decline?: { droppedPct: number } | null
  dossier?: Dossier | null
  error?: string
}

/** Досье: что подключено, через что идут заказы, что из этого продавать. */
interface Dossier {
  branches: number
  integrations: Array<{ key: string; label: string; group: string }>
  modules: string[]
  channels: Array<{ key: string; label: string; n: number; pct: number }>
  done30: number
  signals: Array<{ key: string; tone: 'hot' | 'warm' | 'info'; title: string; evidence: string; offer: string; rule: string; say?: string }>
  script: string[]
}

const CHANNEL_COLOR: Record<string, string> = {
  aggregator: '#8b7ae0', bot: '#2a78d6', ios: '#1baf7a', android: '#3fc48f', website: '#eda100', kiosk: '#e87ba4', admin_panel: '#c4c8cf', hall: '#9ca3af', qr: '#f0b8cf',
}
const GROUP_LABEL: Record<string, string> = {
  pos: 'POS', aggregator: 'Агрегаторы', delivery: 'Доставка', payment: 'Оплата', channel: 'Каналы', marketing: 'Маркетинг', telephony: 'Телефония', other: 'Прочее',
}
const GROUP_ORDER = ['pos', 'aggregator', 'delivery', 'payment', 'channel', 'marketing', 'telephony', 'other']
/** Что могло бы быть, но не подключено — пунктиром, чтобы дыра читалась без сравнения списков. */
const EXPECTED_MODULES = ['Агрегатор все', 'Дашборд', 'Маркетинг', 'Кухня', 'Курьерка', 'Бронь', 'Киоск']
const SIG_CLS: Record<string, string> = {
  hot: 'border-red-200 bg-red-50/60', warm: 'border-amber-200 bg-amber-50/60', info: 'border-gray-200 bg-white',
}

function DossierBlock({ d, accountId }: { d: Dossier; accountId: string }) {
  const [scriptOpen, setScriptOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const groups = GROUP_ORDER.filter(g => d.integrations.some(i => i.group === g))
  const ownModules = new Set(d.modules.map(m => m.toLowerCase()))
  const missing = EXPECTED_MODULES.filter(m => ![...ownModules].some(x => x.includes(m.toLowerCase().split(' ')[0])))
  const signals = showAll ? d.signals : d.signals.slice(0, 3)

  const toTask = async (sg: Dossier['signals'][number]) => {
    const title = `${sg.title}${sg.offer ? ` — ${sg.offer}` : ''}`.slice(0, 480)
    try {
      await apiPost('/sales/tasks', { accountId, title, kind: 'task' })
      setDone(x => ({ ...x, [sg.key]: true }))
    } catch { /* ошибку покажет тост api.service */ }
  }

  return (
    <>
      {/* Каналы заказов */}
      {d.done30 > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><PieChart size={12} /> каналы заказов · 30 дней</div>
          <div className="flex h-3 rounded-md overflow-hidden bg-gray-100">
            {d.channels.map(c => (
              <div key={c.key} title={`${c.label}: ${c.n.toLocaleString('ru-RU')} · ${c.pct}%`}
                style={{ width: `${c.pct}%`, background: CHANNEL_COLOR[c.key] || '#d1d5db' }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 mt-1 text-[11.5px] text-gray-600">
            {d.channels.filter(c => c.n > 0).map(c => (
              <span key={c.key}><i className="inline-block w-2 h-2 rounded-sm mr-1 align-[-1px]" style={{ background: CHANNEL_COLOR[c.key] || '#d1d5db' }} />{c.label} <b>{c.pct}%</b></span>
            ))}
            {['bot', 'ios', 'website', 'kiosk'].filter(k => !d.channels.some(c => c.key === k && c.n > 0)).map(k => (
              <span key={k} className="text-gray-300">{k === 'ios' ? 'приложение' : k === 'bot' ? 'бот' : k === 'website' ? 'сайт' : 'киоск'} 0</span>
            ))}
          </div>
        </div>
      )}

      {/* Подключено */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Plug size={12} /> подключено{d.branches ? ` · ${d.branches} ${d.branches === 1 ? 'филиал' : d.branches < 5 ? 'филиала' : 'филиалов'}` : ''}</div>
        <div className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[12px]">
          {groups.map(g => (
            <div key={g} className="contents">
              <div className="text-[10.5px] uppercase tracking-wider text-gray-400 pt-0.5">{GROUP_LABEL[g]}</div>
              <div className="flex flex-wrap gap-1">
                {d.integrations.filter(i => i.group === g).map(i => (
                  <span key={i.key} className="px-2 py-px rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">{i.label}</span>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <><div className="text-[10.5px] uppercase tracking-wider text-gray-400">POS</div><div className="text-gray-400">интеграций нет</div></>}
          <div className="text-[10.5px] uppercase tracking-wider text-gray-400 pt-0.5">Модули</div>
          <div className="flex flex-wrap gap-1">
            {d.modules.map(m => <span key={m} className="px-2 py-px rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">{m}</span>)}
            {missing.map(m => <span key={m} className="px-2 py-px rounded-md border border-dashed border-gray-300 text-gray-400">{m}</span>)}
          </div>
        </div>
      </div>

      {/* Сигналы допродажи */}
      {d.signals.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Lightbulb size={12} /> сигналы допродажи · правила, не мнение · цены из прайса</div>
          <div className="space-y-1.5">
            {signals.map(sg => (
              <div key={sg.key} className={`rounded-lg border px-3 py-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 ${SIG_CLS[sg.tone]}`}>
                <div className="text-[12.5px] font-semibold text-gray-900">{sg.title}</div>
                <div className="row-span-3 flex flex-col items-end gap-1">
                  <button onClick={() => toTask(sg)} disabled={done[sg.key]}
                    className={`text-[11px] px-2.5 py-1 rounded-md border whitespace-nowrap ${sg.tone === 'hot' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-700 hover:border-gray-500'} disabled:opacity-60`}>
                    {done[sg.key] ? '✓ в задачах' : 'в задачу'}
                  </button>
                  <span className="text-[10px] text-gray-400 text-right max-w-[150px]">правило: {sg.rule}</span>
                </div>
                <div className="text-[12px] text-gray-700">{sg.evidence}</div>
                {sg.offer && <div className="text-[12px] text-gray-500">Предложить: <span className="text-gray-800 font-medium">{sg.offer}</span></div>}
              </div>
            ))}
          </div>
          {d.signals.length > 3 && (
            <button onClick={() => setShowAll(v => !v)} className="mt-1 text-[11.5px] text-gray-400 hover:text-gray-600 inline-flex items-center gap-1">
              {showAll ? <><ChevronUp size={12} /> свернуть</> : <><ChevronDown size={12} /> ещё {d.signals.length - 3}</>}
            </button>
          )}
        </div>
      )}

      {/* Сценарий */}
      {d.script.length > 0 && (
        <div>
          <button onClick={() => setScriptOpen(v => !v)} className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 mb-1">
            <MessageSquareText size={12} /> сценарий разговора · из сигналов {scriptOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {scriptOpen && (
            <ol className="list-decimal pl-5 space-y-1 text-[12.5px] text-gray-800">
              {d.script.map((line, i) => <li key={i}>{line}</li>)}
            </ol>
          )}
        </div>
      )}
    </>
  )
}

function Sparkline({ weeks }: { weeks: Array<{ week: string; n: number }> }) {
  if (weeks.length < 2) return null
  const w = 280, h = 44, pad = 2
  const max = Math.max(...weeks.map(p => p.n), 1)
  const pts = weeks.map((p, i) => {
    const x = pad + (i * (w - pad * 2)) / (weeks.length - 1)
    const y = h - pad - (p.n / max) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="shrink-0" role="img" aria-label="Динамика заказов по неделям">
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

const LEVEL: Record<string, { label: string; cls: string }> = {
  green: { label: 'активация идёт', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  yellow: { label: 'активация под риском', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  red: { label: 'активация не случилась', cls: 'bg-red-50 text-red-700 border-red-200' },
}

/** Поиск и ручная привязка бренда Delever — когда автомэппинг не нашёл. */
function LinkBrand({ accountId, onLinked }: { accountId: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [brands, setBrands] = useState<Array<{ id: string; name: string; is_archived: number; done30?: number; lastOrderDays?: number | null }>>([])

  useEffect(() => {
    if (q.trim().length < 2) { setBrands([]); return }
    const t = setTimeout(() => {
      apiGet<any>(`/sales/brand-map?q=${encodeURIComponent(q)}`, false)
        .then(r => setBrands(r.brands || []))
        .catch(() => setBrands([]))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[12px] text-gray-400 hover:text-blue-600">
        <Link2 size={13} /> Связать с брендом Delever
      </button>
    )
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-2">
      <div className="text-[12.5px] font-medium text-gray-700">Связать с брендом Delever</div>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Название бренда в платформе…"
        className="w-full text-[12.5px] border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200" />
      {brands.map(b => (
        <button key={b.id}
          onClick={async () => {
            await apiPost('/sales/brand-map', { action: 'link', accountId, shipperId: b.id, shipperName: b.name })
            onLinked()
          }}
          className="w-full text-left text-[12.5px] px-2.5 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2">
          <span className="font-medium text-gray-900">{b.name}</span>
          {(b.done30 ?? 0) > 0 ? (
            <span className="text-[10.5px] px-1.5 py-px rounded bg-emerald-50 text-emerald-700 font-semibold">
              активен · {Number(b.done30).toLocaleString('ru-RU')} заказов/30д
            </span>
          ) : (
            <span className="text-[10.5px] text-gray-400">
              {b.lastOrderDays !== null && b.lastOrderDays !== undefined
                ? `посл. заказ ${b.lastOrderDays} дн назад`
                : 'заказов не было'}
            </span>
          )}
          {Number(b.is_archived) === 1 && <span className="text-[10.5px] px-1.5 py-px rounded bg-gray-100 text-gray-400">архивный</span>}
        </button>
      ))}
      <button onClick={() => setOpen(false)} className="text-[11.5px] text-gray-400 hover:text-gray-600">Отмена</button>
    </div>
  )
}

export function BrandPulse({ accountId }: { accountId: string }) {
  const [p, setP] = useState<Pulse | null>(null)

  const load = () => {
    apiGet<Pulse>(`/sales/brand-pulse?accountId=${accountId}`, false)
      .then(setP)
      .catch(() => setP(null))
  }
  useEffect(() => { if (accountId) load() }, [accountId])

  if (!p) return null
  if (!p.mapped) return <LinkBrand accountId={accountId} onLinked={load} />
  if (p.error) return null

  const m = p.month30
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Activity size={14} className="text-blue-600" />
        <span className="text-[13px] font-semibold text-gray-900">Пульс бренда · {p.shipperName}</span>
        <span className="text-[10.5px] px-1.5 py-px rounded bg-blue-50 text-blue-700 font-semibold">данные Delever</span>
        {!p.confirmed && (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] px-1.5 py-px rounded bg-gray-100 text-gray-500"
            title="Связка найдена по совпадению названия — проверь, что это тот самый бренд">
            автосвязка по имени
            <button title="Да, это тот бренд" onClick={async () => { await apiPost('/sales/brand-map', { action: 'confirm', accountId }); load() }}
              className="text-emerald-600 hover:text-emerald-700"><Check size={11} /></button>
            <button title="Не тот бренд — отвязать" onClick={async () => { await apiPost('/sales/brand-map', { action: 'unlink', accountId }); load() }}
              className="text-red-500 hover:text-red-600"><X size={11} /></button>
          </span>
        )}
        {typeof p.ageDays === 'number' && (
          <span className="text-[11px] text-gray-400">в платформе {Math.floor(p.ageDays / 30)} мес</span>
        )}
        <span className="flex-1" />
        {/* Ошибочную связку можно снять всегда, даже подтверждённую */}
        <button
          title="Отвязать бренд и выбрать другой"
          onClick={async () => {
            if (!confirm(`Отвязать «${p.shipperName}» от этого аккаунта?`)) return
            await apiPost('/sales/brand-map', { action: 'unlink', accountId })
            load()
          }}
          className="text-[11px] text-gray-300 hover:text-red-600">сменить связку</button>
      </div>

      {p.decline && (
        <div className="flex items-center gap-2 text-[12.5px] px-3 py-2 rounded-lg border bg-red-50 text-red-700 border-red-200">
          <TriangleAlert size={14} />
          Заказы за последние 2 недели упали на {p.decline.droppedPct}% против нормы — повод позвонить первыми.
        </div>
      )}

      {p.activation && (
        <div className={`text-[12.5px] px-3 py-2 rounded-lg border ${LEVEL[p.activation.level].cls}`}>
          <span className="font-semibold">Светофор запуска: {LEVEL[p.activation.level].label}.</span>
          {p.activation.reasons.length > 0 && (
            <span> {p.activation.reasons.join('; ')}.</span>
          )}
        </div>
      )}

      <div className="flex items-end gap-5 flex-wrap">
        {m && (
          <>
            <div><div className="text-[11px] text-gray-400">заказов / 30 дн</div>
              <div className="text-[17px] font-semibold text-gray-900">{m.done.toLocaleString('ru-RU')}</div></div>
            <div><div className="text-[11px] text-gray-400">отмены</div>
              <div className={`text-[17px] font-semibold ${m.cancelPct > 40 ? 'text-red-600' : 'text-gray-900'}`}>{m.cancelPct}%</div></div>
            <div><div className="text-[11px] text-gray-400">свои каналы</div>
              <div className="text-[17px] font-semibold text-gray-900">{m.ownPct}%</div></div>
            <div><div className="text-[11px] text-gray-400">каналов</div>
              <div className="text-[17px] font-semibold text-gray-900">{m.channels}</div></div>
            {m.medMin !== null && (
              <div><div className="text-[11px] text-gray-400">доставка, мед.</div>
                <div className="text-[17px] font-semibold text-gray-900">{m.medMin} мин</div></div>
            )}
            {p.rating && p.rating.count > 0 && (
              <div><div className="text-[11px] text-gray-400">рейтинг</div>
                <div className="text-[17px] font-semibold text-gray-900">{p.rating.value.toFixed(1)} <span className="text-[11px] text-gray-400 font-normal">({p.rating.count})</span></div></div>
            )}
          </>
        )}
        <div className="flex-1 min-w-[200px]">
          <div className="text-[11px] text-gray-400 mb-0.5">заказы по неделям, 12 недель</div>
          {p.weeks && <Sparkline weeks={p.weeks} />}
        </div>
      </div>

      {p.dossier && <DossierBlock d={p.dossier} accountId={accountId} />}
    </div>
  )
}
