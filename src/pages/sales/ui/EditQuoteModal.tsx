import { useEffect, useState } from 'react'
import { apiGet, apiPut } from '@/shared/services/api.service'

/**
 * Правка готового КП: заголовок, срок действия и строки с пересчётом сумм.
 *
 * Собранное предложение раньше было неприкасаемым — опечатка в цене означала
 * «собери заново». Опубликованный документ правится по той же ссылке:
 * клиент увидит свежую редакцию, ничего пересылать не нужно.
 */

interface Line {
  title?: string; qty?: number; price?: number; total?: number
  scope?: string; [k: string]: any
}

export function EditQuoteModal({ docId, onClose, onSaved }: {
  docId: string; onClose: () => void; onSaved: () => void
}) {
  const [doc, setDoc] = useState<any | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [title, setTitle] = useState('')
  const [validTill, setValidTill] = useState('')
  const [discount, setDiscount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ document: any }>(`/sales/documents?id=${docId}`, false)
      .then(d => {
        setDoc(d.document)
        setLines(Array.isArray(d.document?.lines) ? d.document.lines : [])
        setTitle(d.document?.title || '')
        setValidTill(d.document?.valid_till ? String(d.document.valid_till).slice(0, 10) : '')
        setDiscount(Number(d.document?.discount_pct || 0))
      })
      .catch(e => setError(e?.message || 'Не удалось открыть документ'))
  }, [docId])

  const patch = (i: number, p: Partial<Line>) => {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...p }
      const qty = Number(next.qty ?? 1) || 1
      const price = Number(next.price ?? 0) || 0
      return { ...next, total: qty * price }
    }))
  }

  const save = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await apiPut('/sales/documents', {
        id: docId, lines, title: title || null,
        validTill: validTill ? `${validTill}T23:59:59` : null,
        discountPct: discount,
      })
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Не сохранилось')
    } finally { setBusy(false) }
  }

  const fmt = (v: number) =>
    `${Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${doc?.currency || ''}`
  const total = lines.reduce((a, l) => a + Number(l.total || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">
              Изменить {doc?.number ? `№${doc.number}` : 'КП'}
            </h3>
            {doc?.share_token && (
              <p className="text-[11px] text-amber-600 mt-0.5">
                Документ опубликован: клиент увидит изменения по той же ссылке.
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {error && <div className="mb-3 text-[12.5px] text-red-600">{error}</div>}
        {!doc && !error && <div className="py-8 text-center text-[13px] text-gray-400">загружаю…</div>}

        {doc && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Заголовок</span>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Действует до</span>
                <input type="date" value={validTill} onChange={e => setValidTill(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Скидка, %</span>
                <input type="number" min={0} max={100} step={0.5} value={discount}
                  onChange={e => setDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] tabular-nums" />
              </label>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Строки предложения
              </div>
              <div className="space-y-1.5">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={l.title || ''} onChange={e => patch(i, { title: e.target.value })}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
                    <input type="number" min={1} value={l.qty ?? 1}
                      onChange={e => patch(i, { qty: Number(e.target.value) })}
                      title="Количество"
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-[12.5px] tabular-nums text-right" />
                    <input type="number" min={0} value={l.price ?? 0}
                      onChange={e => patch(i, { price: Number(e.target.value) })}
                      title="Цена"
                      className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-[12.5px] tabular-nums text-right" />
                    <span className="w-28 text-right text-[12.5px] tabular-nums text-gray-700 flex-none">
                      {fmt(Number(l.total || 0))}
                    </span>
                    <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                      title="Убрать строку"
                      className="text-gray-300 hover:text-red-600 flex-none">✕</button>
                  </div>
                ))}
                {!lines.length && (
                  <div className="text-[12px] text-gray-400 py-2">Строк нет — добавьте хотя бы одну.</div>
                )}
              </div>
              <button
                onClick={() => setLines(prev => [...prev, { title: '', qty: 1, price: 0, total: 0 }])}
                className="mt-2 text-[12px] text-blue-600 hover:underline">
                + строка
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <div className="text-[13px] text-gray-700">
                Итого: {discount > 0 && (
                  <span className="text-gray-400 line-through tabular-nums mr-1">{fmt(total)}</span>
                )}
                <b className="tabular-nums">{fmt(Math.round(total * (1 - discount / 100)))}</b>
                {discount > 0 && <span className="text-emerald-700 text-[12px]"> · −{discount}%</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg">Отмена</button>
                <button onClick={save} disabled={busy || !lines.length}
                  className="text-[12.5px] px-4 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-40">
                  {busy ? 'Сохраняю…' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
