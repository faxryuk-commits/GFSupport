import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Activity, TriangleAlert, Link2, Check, X } from 'lucide-react'

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
  error?: string
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
  const [brands, setBrands] = useState<Array<{ id: string; name: string; is_archived: number }>>([])

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
          {Number(b.is_archived) === 1 && <span className="text-[10.5px] text-gray-400">архивный</span>}
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
    </div>
  )
}
