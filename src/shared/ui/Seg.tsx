import type { ReactNode } from 'react'

/**
 * Переключатель-сегмент: один стиль на всю систему.
 *
 * Раньше каждая страница рисовала своё: синие заливки, фиолетовые, белые
 * с рамкой, круглые пилюли — и в шапке воронки четыре группы кнопок
 * выглядели как четыре разных приложения. Переключатель — это не действие,
 * ему не нужен цвет действия: серая подложка, активный пункт тёмный.
 * Цвет остаётся за единственной кнопкой действия на экране.
 */
export function Seg<T extends string>({ items, value, onChange, size = 'md', title, className = '' }: {
  items: Array<{ key: T; label: ReactNode; title?: string; disabled?: boolean }>
  value: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
  title?: string
  className?: string
}) {
  return (
    <div className={`inline-flex bg-gray-100 rounded-lg p-0.5 ${className}`} title={title}>
      {items.map(it => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          title={it.title}
          disabled={it.disabled}
          className={`${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[11.5px]'}
                      rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${
            value === it.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
