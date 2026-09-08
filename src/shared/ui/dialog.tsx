import { useEffect, useRef, useState } from 'react'

/**
 * Свои диалоги вместо window.confirm / prompt / alert.
 *
 * Системные окна браузер рисует по-своему (а Safari и вовсе может их
 * заглушить — тогда клик молча ничего не делает), они выпадают из оформления
 * и не дают ни заголовка, ни подписи на кнопках. Здесь тот же интерфейс, но
 * промисом: `if (!await confirmDialog('...')) return` читается как раньше.
 *
 * Хост монтируется один раз в приложении и слушает singleton — поэтому вызвать
 * диалог можно из любого места, включая обработчики вне React-компонентов.
 */

type DialogKind = 'confirm' | 'prompt' | 'alert'

interface DialogRequest {
  kind: DialogKind
  title: string
  message?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (v: any) => void
}

let listener: ((req: DialogRequest) => void) | null = null

function ask(req: Omit<DialogRequest, 'resolve'>): Promise<any> {
  return new Promise(resolve => {
    if (!listener) {
      // Хост не смонтирован (тесты, ранний вызов) — не роняем действие
      resolve(req.kind === 'confirm' ? window.confirm(req.title)
        : req.kind === 'prompt' ? window.prompt(req.title, req.defaultValue || '')
          : undefined)
      return
    }
    listener({ ...req, resolve })
  })
}

export function confirmDialog(title: string, opts?: {
  message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean
}): Promise<boolean> {
  return ask({ kind: 'confirm', title, ...opts })
}

export function promptDialog(title: string, defaultValue = '', opts?: {
  message?: string; confirmLabel?: string
}): Promise<string | null> {
  return ask({ kind: 'prompt', title, defaultValue, ...opts })
}

export function alertDialog(title: string, opts?: { message?: string }): Promise<void> {
  return ask({ kind: 'alert', title, ...opts })
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listener = (r) => { setReq(r); setValue(r.defaultValue || '') }
    return () => { listener = null }
  }, [])

  useEffect(() => {
    if (req?.kind === 'prompt') setTimeout(() => inputRef.current?.select(), 30)
  }, [req])

  if (!req) return null

  const close = (result: any) => { req.resolve(result); setReq(null) }
  const cancel = () => close(req.kind === 'prompt' ? null : req.kind === 'confirm' ? false : undefined)
  const ok = () => close(req.kind === 'prompt' ? value : req.kind === 'confirm' ? true : undefined)

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4"
      onClick={cancel}
      onKeyDown={e => { if (e.key === 'Escape') cancel() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-[15px] font-semibold text-gray-900 leading-snug">{req.title}</h3>
          {req.message && (
            <p className="mt-1.5 text-[13px] text-gray-500 leading-relaxed">{req.message}</p>
          )}
          {req.kind === 'prompt' && (
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); ok() }
                if (e.key === 'Escape') cancel()
              }}
              className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 text-[14px]
                         focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          )}
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          {req.kind !== 'alert' && (
            <button onClick={cancel}
              className="px-3.5 py-2 text-[13px] font-semibold text-gray-600 bg-white border
                         border-gray-200 rounded-lg hover:bg-gray-50">
              {req.cancelLabel || 'Отмена'}
            </button>
          )}
          <button onClick={ok} autoFocus
            className={`px-4 py-2 text-[13px] font-semibold text-white rounded-lg ${
              req.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {req.confirmLabel || (req.kind === 'alert' ? 'Понятно' : req.kind === 'prompt' ? 'Сохранить' : 'Подтвердить')}
          </button>
        </div>
      </div>
    </div>
  )
}
