import { useState } from 'react'
import { X, Lightbulb } from 'lucide-react'

interface TabGuideProps {
  id: string
  text: string
  tips?: string[]
}

export function TabGuide({ id, text, tips = [] }: TabGuideProps) {
  const storageKey = `guide_dismissed_${id}`
  const [hidden, setHidden] = useState(() => !!localStorage.getItem(storageKey))

  if (hidden) return null

  return (
    <div className="mb-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Lightbulb className="w-4 h-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-blue-900 leading-relaxed">{text}</p>
          {tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {tips.map((tip, i) => (
                <li key={i} className="text-xs text-blue-700 flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => {
            localStorage.setItem(storageKey, 'true')
            setHidden(true)
          }}
          className="text-blue-300 hover:text-blue-500 flex-shrink-0"
          title="Скрыть подсказку"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
