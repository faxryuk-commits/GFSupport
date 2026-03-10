import { useState, useRef, useEffect } from 'react'
import { HelpCircle, X, Lightbulb } from 'lucide-react'
import { createPortal } from 'react-dom'

interface Tip {
  title: string
  text: string
}

interface PageHintProps {
  title: string
  description: string
  tips?: Tip[]
}

export function PageHint({ title, description, tips = [] }: PageHintProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open || !btnRef.current) return

    const rect = btnRef.current.getBoundingClientRect()
    const popupWidth = 320
    let left = rect.left
    if (left + popupWidth > window.innerWidth - 16) {
      left = window.innerWidth - popupWidth - 16
    }
    setPos({ top: rect.bottom + 6, left })

    const handleClick = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="text-gray-400 hover:text-blue-500 transition-colors"
        title="Справка"
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[200] w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{description}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {tips.length > 0 && (
            <div className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
              {tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 p-1.5 rounded-lg">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-gray-800">{tip.title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{tip.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
