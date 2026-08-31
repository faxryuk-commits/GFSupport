import { useState } from 'react'
import { apiPost } from '@/shared/services/api.service'
import { parsePhone } from '@/shared/lib/phone'

/**
 * Номер телефона, который звонит.
 *
 * Один компонент на все карточки: распознаёт номер с учётом рынка клиента
 * (узбекский, казахский, азербайджанский…), показывает его в человеческом
 * виде и по клику соединяет через АТС — она звонит сотруднику, потом клиенту,
 * разговор записывается. До этого по системе была россыпь tel:-ссылок,
 * которые с рабочего мака просто никуда не вели.
 */

type Props = {
  phone: string | null | undefined
  /** Код рынка клиента ('uz' | 'kz' | 'az'…) — локальный номер читается в его нумерации. */
  market?: string | null
  leadId?: string | null
  /** sm — в строку метаданных карточки, md — в поле карточки клиента. */
  size?: 'sm' | 'md'
  className?: string
}

type Status = 'idle' | 'calling' | 'ringing' | 'error'

export function CallPhone({ phone, market, leadId, size = 'md', className = '' }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  // Короткий добавочный (101) показываем в статусе — понятно, чья трубка
  // зазвонит; мобильный первой ногой остаётся «вам»
  const [viaExt, setViaExt] = useState('')

  if (!phone) return null
  const parsed = parsePhone(phone, market)
  const label = parsed.valid ? parsed.pretty : phone

  const call = async (e: React.MouseEvent) => {
    // Карточки вокруг кликабельны и таскаемы — звонок не должен их открывать
    e.stopPropagation()
    e.preventDefault()
    if (status === 'calling') return
    setStatus('calling'); setError('')
    try {
      const r = await apiPost<any>('/sales/call', { to: phone, ...(leadId ? { leadId } : {}) })
      setViaExt(/^\d{2,4}$/.test(String(r?.ext || '')) ? String(r.ext) : '')
      setStatus('ringing')
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err: any) {
      setStatus('error')
      setError(err?.message || 'Телефония не настроена')
      setTimeout(() => setStatus('idle'), 6000)
    }
  }

  const base = size === 'sm'
    ? 'text-inherit underline decoration-dotted underline-offset-2 hover:text-emerald-700'
    : 'text-blue-600 hover:text-emerald-700 hover:underline'

  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <button
        onClick={call}
        title={status === 'error' ? error : 'Позвонить через АТС: она наберёт вас, затем клиента. Разговор запишется'}
        className={`${base} tabular-nums cursor-pointer bg-transparent p-0 border-0 font-inherit text-left ${
          status === 'calling' ? 'opacity-60' : ''}`}
      >
        {status === 'calling' ? 'Соединяю…'
          : status === 'ringing' ? `📞 АТС звонит ${viaExt ? `на ${viaExt}` : 'вам'}…`
          : label}
      </button>
      {status === 'error' && size === 'md' && (
        <span className="text-[11px] text-red-600">{error}</span>
      )}
      {status === 'error' && size === 'sm' && (
        <span title={error} className="text-red-600">⚠︎</span>
      )}
    </span>
  )
}
