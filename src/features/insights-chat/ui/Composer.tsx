import { useEffect, useRef, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'

interface ComposerProps {
  onSend: (text: string) => void | Promise<void>
  disabled?: boolean
  initialValue?: string
}

export function Composer({ onSend, disabled, initialValue }: ComposerProps) {
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Подхватываем внешнее заполнение (например, по клику на quick-prompt).
  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue)
      requestAnimationFrame(() => {
        taRef.current?.focus()
        const len = initialValue.length
        try { taRef.current?.setSelectionRange(len, len) } catch {}
      })
    }
  }, [initialValue])

  // Авто-resize textarea.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = '0'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [value])

  function handleSubmit() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder="Спроси о SLA, командах, кейсах… Enter — отправить, Shift+Enter — новая строка"
          className="flex-1 resize-none px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="h-10 px-3 rounded-xl bg-slate-900 text-white text-sm font-medium flex items-center gap-2 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {disabled ? 'Думаю…' : 'Отправить'}
        </button>
      </div>
      <div className="text-[10px] text-slate-400 text-center mt-2">
        ИИ может ошибаться. Цифры берутся из текущей базы — нажми на карточку «источник», чтобы проверить.
      </div>
    </div>
  )
}
