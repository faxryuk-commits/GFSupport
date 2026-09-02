import { useEffect, useRef, useState } from 'react'
import { apiPost } from '@/shared/services/api.service'

/**
 * Саммари и разбор звонка: кнопка рядом с записью, раскрывающая выжимку
 * разговора и советы тренера, с транскриптом под спойлером. Непосчитанный
 * звонок ставится в очередь, и панель сама дожидается результата —
 * «загляните снова» никто не перечитывает.
 */
export function CallInsight({ uuid }: { uuid: string }) {
  const [state, setState] = useState<{
    status?: string; summary?: string; coach?: string; transcript?: string; note?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tries = useRef(0)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const fetchOnce = async (): Promise<string | undefined> => {
    const r = await apiPost<any>('/sales/call?action=insight', { uuid })
    setState(r)
    return r?.status
  }

  const poll = () => {
    if (timer.current) clearTimeout(timer.current)
    if (tries.current >= 10) return
    timer.current = setTimeout(async () => {
      tries.current++
      try {
        const st = await fetchOnce()
        if (st === 'pending') poll()
      } catch { /* сеть моргнула — следующая попытка по клику */ }
    }, 15000)
  }

  const click = async () => {
    if (busy) return
    if (state?.status === 'done') { setOpen(o => !o); return }
    setBusy(true)
    try {
      const st = await fetchOnce()
      setOpen(true)
      if (st === 'pending') { tries.current = 0; poll() }
    } catch (e: any) {
      setState({ status: 'error', note: e?.message || 'Не удалось получить разбор' })
      setOpen(true)
    } finally { setBusy(false) }
  }

  const waiting = open && state?.status === 'pending'

  return (
    <>
      <button onClick={click} disabled={busy}
        title="Саммари разговора и разбор для сейлза"
        className="text-[11.5px] text-violet-700 hover:underline disabled:opacity-40 whitespace-nowrap">
        {busy ? '…' : waiting ? '⏳ готовится…' : '📝 разбор'}
      </button>
      {open && state && (
        <div className="w-full rounded-lg border border-violet-100 bg-violet-50/50 p-2.5 text-[12px] mt-1.5">
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
          ) : state.status === 'pending' ? (
            <span className="text-gray-500">
              ⏳ Расшифровываю — панель обновится сама, обычно это минута-две.
              {state.note ? ` (${state.note})` : ''}
            </span>
          ) : (
            <span className="text-gray-500">{state.note || 'Не удалось получить разбор'}</span>
          )}
        </div>
      )}
    </>
  )
}
