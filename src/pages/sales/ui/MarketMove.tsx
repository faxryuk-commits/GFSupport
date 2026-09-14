import { useState } from 'react'
import { REGION_NAMES } from './region'
import { MarketFlag } from './kit'

/**
 * Перенос карточки в другую страну — полоска подтверждения под рядом действий,
 * той же формы, что перевод в Enterprise-воронку: вопрос, выбор, одна кнопка.
 *
 * Появилась, когда двенадцать заведений Баку оказались в узбекском рынке,
 * а исправить это из системы было нельзя — только в базе. Рынок у карточки
 * решает воронку, валюту и то, кто из сейлзов её видит, поэтому ошибка здесь
 * прячет работу от того, кто должен её делать.
 */
export function MarketMoveStrip({ current, note, busy, onMove, onCancel }: {
  current?: string | null
  /** Что именно произойдёт с этой карточкой — обращение и сделка переезжают по-разному. */
  note: string
  busy?: boolean
  onMove: (market: string) => void | Promise<void>
  onCancel: () => void
}) {
  const options = Object.entries(REGION_NAMES).filter(([code]) => code !== (current || ''))
  const [pick, setPick] = useState(options[0]?.[0] || '')
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950
                    flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[240px]">
        Сейчас — <b>{REGION_NAMES[current || ''] || 'страна не указана'}</b>. {note}
      </span>
      <label className="flex items-center gap-1.5">
        <MarketFlag market={pick} />
        <select value={pick} onChange={e => setPick(e.target.value)} disabled={busy}
          className="text-[12px] px-2 py-1.5 rounded-lg border border-amber-300 bg-white text-gray-800">
          {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <button disabled={busy || !pick} onClick={() => onMove(pick)}
        className="text-[12px] px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50">
        {busy ? '…' : 'Перенести'}
      </button>
      <button onClick={onCancel} className="text-[12px] text-amber-800 hover:underline">отмена</button>
    </div>
  )
}
