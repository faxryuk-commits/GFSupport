import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'

/**
 * Полоса над диалогом продаж (Instagram Direct, Messenger): что агент выяснил,
 * стал ли диалог обращением, и ручные действия сейлза.
 *
 * Три состояния одной полосы: диалог идёт (агент выясняет), обращение есть,
 * «не клиент». Сделка из диалога — это обращение плюс обычный перевод на
 * доску с проверкой обязательных полей: второй дороги с другими правилами нет.
 */

const FACT_LABELS: Array<[string, string]> = [
  ['city', 'город'], ['points', 'точек'], ['orders_per_day', 'заказов в день'],
  ['pos', 'касса'], ['delivery_type', 'доставка'], ['aggregators', 'агрегаторы'], ['phone', 'телефон'],
]
const WHO_LABELS: Record<string, string> = {
  personal: 'личное', spam: 'спам', existing_client: 'действующий клиент',
  job_seeker: 'соискатель', partner: 'партнёр',
}
const LEAD_STATUS: Record<string, string> = {
  new: 'новое', assigned: 'в работе', attempting: 'дозвон', nurture: 'прогрев',
  converted: 'сделка', junk: 'отказ',
}

interface DialogState {
  channelId: string
  source: string
  facts: Record<string, string>
  who: string | null
  draft: string | null
  lead: { id: string; name: string; status: string; phone: string | null } | null
  deal: { id: string; title: string; stage: string | null } | null
}

export function SalesDialogStrip({ channelId, onUseDraft, refreshKey }: {
  channelId: string
  /** Вставить черновик агента в поле ввода — отправляет человек. */
  onUseDraft: (text: string) => void
  /** Меняется, когда в диалог пришло новое сообщение: полоса перечитывается. */
  refreshKey?: number
}) {
  const navigate = useNavigate()
  const [st, setSt] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [whoOpen, setWhoOpen] = useState(false)

  const load = useCallback(() => {
    apiGet<DialogState>(`/sales/dialog?channelId=${channelId}`, false)
      .then(d => { setSt(d); setErr(null) })
      .catch(() => setSt(null))
  }, [channelId])
  useEffect(() => { load() }, [load, refreshKey])

  if (!st || !['instagram', 'messenger'].includes(st.source)) return null

  const act = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setErr(null)
    try { await fn(); load() }
    catch (e: any) { setErr(e?.message || 'Не получилось') }
    finally { setBusy(false) }
  }

  const toLead = async (): Promise<string | null> => {
    if (st.lead) return st.lead.id
    const r = await apiPost<{ leadId: string }>('/sales/dialog?action=to-lead', { channelId })
    return r.leadId
  }
  const toDeal = () => act(async () => {
    const leadId = await toLead()
    if (!leadId) return
    try {
      const r = await apiPost<{ dealId?: string }>('/sales/funnel?action=convert', { leadId })
      if (r.dealId) navigate(`/sales/deals/${r.dealId}`)
    } catch (e: any) {
      // Не хватает квалификации — движок сказал чего; дальше в карточке
      if (e?.status === 422) {
        navigate(`/sales/leads/${leadId}`)
        throw new Error(e.message)
      }
      throw e
    }
  })

  const facts = st.facts || {}
  const known = FACT_LABELS.filter(([k]) => facts[k])

  const chips = (
    <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
      {FACT_LABELS.map(([k, label]) => facts[k] ? (
        <span key={k} title={label}
          className="text-[11.5px] px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-slate-800">
          <span className="text-emerald-600">✓ </span>{k === 'phone' ? facts[k] : facts[k]}
        </span>
      ) : (
        <span key={k} className="text-[11.5px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-400">{label}</span>
      ))}
    </div>
  )

  // Не клиент
  if (st.who && !st.lead) {
    return (
      <div className="flex items-center gap-3 px-6 py-2 bg-amber-50 border-b border-[#e8edf3] text-[12.5px]">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 whitespace-nowrap">
          Не клиент · {WHO_LABELS[st.who] || st.who}
        </span>
        <span className="text-slate-500 flex-1">агент не вмешивается, обращение из диалога не родится</span>
        <button disabled={busy} onClick={() => act(async () => { await apiPost('/sales/dialog?action=reopen', { channelId }) })}
          className="text-[12px] font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
          Вернуть в работу
        </button>
      </div>
    )
  }

  const strip = st.lead ? (
    <div className="flex items-center gap-3 px-6 py-2 bg-emerald-50 border-b border-[#e8edf3] flex-wrap">
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-emerald-700 whitespace-nowrap">
        Обращение · {LEAD_STATUS[st.lead.status] || st.lead.status}
      </span>
      {chips}
      <div className="flex items-center gap-1.5 ml-auto">
        <button onClick={() => navigate(`/sales/leads/${st.lead!.id}`)}
          className="text-[12px] font-semibold px-2 py-1 text-blue-600 hover:underline">Открыть обращение →</button>
        {st.deal ? (
          <button onClick={() => navigate(`/sales/deals/${st.deal!.id}`)}
            className="text-[12px] font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
            Сделка · {st.deal.stage || 'открыта'} →
          </button>
        ) : st.lead.status !== 'junk' && (
          <button disabled={busy} onClick={toDeal}
            className="text-[12px] font-semibold px-3 py-1 rounded-lg bg-blue-600 text-white hover:brightness-110 disabled:opacity-50">
            В сделку
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-3 px-6 py-2 bg-blue-50 border-b border-[#e8edf3] flex-wrap">
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-blue-700 whitespace-nowrap">
        Диалог · {known.length ? `выяснено ${known.length} из ${FACT_LABELS.length}` : 'агент выясняет'}
      </span>
      {chips}
      <div className="flex items-center gap-1.5 ml-auto relative">
        <button disabled={busy} onClick={() => act(async () => { await toLead() })}
          className="text-[12px] font-semibold px-3 py-1 rounded-lg bg-blue-600 text-white hover:brightness-110 disabled:opacity-50">
          В обращение
        </button>
        <button disabled={busy} onClick={toDeal}
          className="text-[12px] font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
          В сделку
        </button>
        <button disabled={busy} onClick={() => setWhoOpen(v => !v)}
          className="text-[12px] font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
          Не клиент ▾
        </button>
        {whoOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-[#e8edf3] rounded-xl shadow-lg py-1 z-10">
            {Object.entries(WHO_LABELS).map(([k, label]) => (
              <button key={k}
                onClick={() => { setWhoOpen(false); act(async () => { await apiPost('/sales/dialog?action=not-client', { channelId, who: k }) }) }}
                className="w-full text-left px-4 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-50">{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {strip}
      {st.draft && (
        <div className="flex items-start gap-3 px-6 py-2 border-b border-dashed border-blue-300 bg-white text-[12.5px]">
          <span className="text-[11px] font-semibold text-blue-600 whitespace-nowrap pt-0.5">Агент · черновик</span>
          <p className="flex-1 text-slate-800 whitespace-pre-wrap">{st.draft}</p>
          <div className="flex gap-1.5 flex-none">
            <button disabled={busy}
              onClick={() => act(async () => { onUseDraft(st.draft || ''); await apiPost('/sales/dialog?action=draft-done', { channelId }) })}
              className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:brightness-110">В поле ввода</button>
            <button disabled={busy}
              onClick={() => act(async () => { await apiPost('/sales/dialog?action=draft-done', { channelId }) })}
              className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-50">Пропустить</button>
          </div>
        </div>
      )}
      {err && (
        <div className="px-6 py-1.5 text-[12px] text-red-600 bg-red-50 border-b border-[#e8edf3]">{err}</div>
      )}
    </>
  )
}
