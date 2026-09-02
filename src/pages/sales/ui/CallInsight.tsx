import { useState } from 'react'
import { apiPost } from '@/shared/services/api.service'

/**
 * Саммари и разбор звонка: кнопка рядом с записью, раскрывающая выжимку
 * разговора и советы тренера, с транскриптом под спойлером. Готовое
 * приходит сразу; непосчитанное ставится в очередь и доходит за минуты.
 */
export function CallInsight({ uuid }: { uuid: string }) {
  const [state, setState] = useState<{
    status?: string; summary?: string; coach?: string; transcript?: string; note?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    if (busy) return
    if (state?.status === 'done') { setOpen(o => !o); return }
    setBusy(true)
    try {
      const r = await apiPost<any>('/sales/call?action=insight', { uuid })
      setState(r)
      setOpen(true)
    } catch (e: any) {
      setState({ status: 'error', note: e?.message || 'Не удалось получить разбор' })
      setOpen(true)
    } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={load} disabled={busy}
        title="Саммари разговора и разбор для сейлза"
        className="flex-none text-[11.5px] text-violet-700 hover:underline disabled:opacity-40">
        {busy ? '…' : '📝 разбор'}
      </button>
      {open && state && (
        <div className="w-full basis-full mt-1.5 rounded-lg border border-violet-100 bg-violet-50/50 p-2.5 text-[12px]">
          {state.status === 'done' ? (
            <>
              {state.summary && (
                <div className="whitespace-pre-line text-gray-800">{state.summary}</div>
              )}
              {state.coach && (
                <div className="mt-1.5 pt-1.5 border-t border-violet-100 whitespace-pre-line text-violet-800">
                  <span className="font-semibold">Разбор: </span>{state.coach}
                </div>
              )}
              {state.transcript && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] text-gray-400">полный транскрипт</summary>
                  <div className="mt-1 whitespace-pre-line text-[11.5px] text-gray-600 max-h-48 overflow-y-auto">
                    {state.transcript}
                  </div>
                </details>
              )}
            </>
          ) : (
            <span className="text-gray-500">
              {state.note || 'Расшифровка в очереди — обычно готово за минуту-две, загляните снова.'}
            </span>
          )}
        </div>
      )}
    </>
  )
}
