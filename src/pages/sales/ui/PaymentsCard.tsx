import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card } from './kit'

/**
 * Поступления по сделке — база комиссий в мотивации.
 *
 * Отмечает руководитель или финансист: сумма и дата фактического прихода
 * денег. Ровно эти строки видит менеджер в «Мой KPI», и от них считается
 * комиссия — поэтому никакого «оплатит на днях», только пришедшее.
 */
export function PaymentsCard({ dealId, canManage }: { dealId: string; canManage: boolean }) {
  const [payments, setPayments] = useState<any[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fmt = (n: any) => (Number(n) || 0).toLocaleString('ru-RU')

  const load = useCallback(() => {
    apiGet<{ payments: any[] }>(`/sales/kpi?action=payments&dealId=${dealId}`, false)
      .then(d => setPayments(d.payments || []))
      .catch(() => setPayments([]))
  }, [dealId])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await apiPost('/sales/kpi', {
        action: 'payment', dealId,
        amount: Number(amount.replace(/\s/g, '')), paidAt, note: note.trim() || undefined,
      })
      setFormOpen(false); setAmount(''); setNote('')
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить')
    } finally { setBusy(false) }
  }

  const remove = async (pid: number) => {
    if (!confirm('Убрать поступление? Комиссия менеджера пересчитается.')) return
    try { await apiPost('/sales/kpi', { action: 'payment_delete', id: pid }); load() }
    catch (e: any) { alert(e?.message || 'Не удалось удалить') }
  }

  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0)

  return (
    <Card
      title="Поступления"
      sub={total > 0 ? `пришло ${fmt(total)} — идёт в комиссию менеджера` : 'фактически пришедшие деньги · база комиссии'}
      right={canManage ? (
        <button onClick={() => setFormOpen(v => !v)}
          className="text-[12px] font-semibold text-emerald-700 hover:text-emerald-800">
          + оплата пришла
        </button>
      ) : undefined}
    >
      {formOpen && (
        <div className="px-4 py-3 border-b border-gray-100 bg-emerald-50/40 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Сумма, сум"
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 w-32 tabular-nums" />
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5" />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий (не обязательно)"
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[140px]" />
            <button onClick={add} disabled={busy || !Number(amount.replace(/\s/g, ''))}
              className="text-[12px] font-semibold text-white bg-emerald-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {busy ? '…' : 'Записать'}
            </button>
          </div>
          {error && <div className="text-[12px] text-red-600">{error}</div>}
        </div>
      )}
      {payments.length === 0 ? (
        <div className="px-4 py-3 text-[12.5px] text-gray-400">Оплат по сделке пока нет.</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {payments.map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2 text-[12.5px]">
              <span className="text-gray-600 truncate mr-3">
                <span className="text-gray-400 tabular-nums mr-2">{String(p.paid_at || '').slice(5)}</span>
                {p.note || (p.source === 'planfact' ? 'ПланФакт' : 'Оплата')}
              </span>
              <span className="flex items-center gap-2 flex-none">
                <span className="font-semibold text-emerald-600 tabular-nums">+{fmt(p.amount)}</span>
                {canManage && p.source === 'manual' && (
                  <button onClick={() => remove(Number(p.id))}
                    className="text-gray-300 hover:text-red-500" title="Убрать">✕</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
