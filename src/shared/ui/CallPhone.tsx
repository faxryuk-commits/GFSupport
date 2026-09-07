import { useEffect, useState } from 'react'
import { apiPost } from '@/shared/services/api.service'
import { parsePhone, PBX_COUNTRY } from '@/shared/lib/phone'

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
  /** sm — в строку метаданных карточки, md — в поле карточки клиента,
   *  icon — одна трубка, номер по наведению: для тесных мест вроде подвала карточки. */
  size?: 'sm' | 'md' | 'icon'
  className?: string
}

type Status = 'idle' | 'calling' | 'ringing' | 'error'

export function CallPhone({ phone, market, leadId, size = 'md', className = '' }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  // Короткий добавочный (101) показываем в статусе — понятно, чья трубка
  // зазвонит; мобильный первой ногой остаётся «вам»
  const [viaExt, setViaExt] = useState('')
  const [copied, setCopied] = useState(false)
  // Есть ли прямой звонок из браузера — держим в состоянии и слушаем звонилку:
  // софтфон подключается позже первой отрисовки, и подсказка должна обновиться
  const [direct, setDirect] = useState<boolean>(() => Boolean((window as any).__gfDirectCall))
  useEffect(() => {
    const on = (e: Event) => setDirect(Boolean((e as CustomEvent).detail))
    window.addEventListener('gf:direct-call', on)
    return () => window.removeEventListener('gf:direct-call', on)
  }, [])

  if (!phone) return null
  const parsed = parsePhone(phone, market)
  const label = parsed.valid ? parsed.pretty : phone
  // АТС одна и узбекская: номер другого региона не звоним через транк —
  // клик копирует его, сейлз набирает со своего мобильного
  const foreign = parsed.valid && parsed.country !== null && parsed.country !== PBX_COUNTRY

  const call = async (e: React.MouseEvent) => {
    // Карточки вокруг кликабельны и таскаемы — звонок не должен их открывать
    e.stopPropagation()
    e.preventDefault()
    if (foreign) {
      navigator.clipboard?.writeText(parsed.pretty || phone).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
      return
    }
    if (status === 'calling') return
    setStatus('calling'); setError('')
    // ПК-режим: софтфон подключён — звоним прямо из браузера, одной ногой.
    // Иначе старый путь: АТС набирает вас, потом клиента
    const direct = (window as any).__gfDirectCall as ((num: string) => Promise<void>) | null | undefined
    if (direct) {
      try {
        await direct(parsed.valid ? parsed.e164 : phone)
        setViaExt('browser')
        setStatus('ringing')
        setTimeout(() => setStatus('idle'), 4000)
      } catch (err: any) {
        setStatus('error')
        setError(err?.message === 'Permission denied'
          ? 'Браузер не дал доступ к микрофону — разрешите его для сайта'
          : err?.message || 'Звонок из браузера не прошёл')
        setTimeout(() => setStatus('idle'), 6000)
      }
      return
    }
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
    : size === 'icon'
      ? 'text-gray-600 hover:text-emerald-700'
      : 'text-blue-600 hover:text-emerald-700 hover:underline'

  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <button
        onClick={call}
        title={foreign
          ? `${label} · ${parsed.countryName}: АТС подключена только для Узбекистана — клик скопирует номер, наберите с мобильного`
          : status === 'error' ? error
          : direct
            ? `${label} · Позвонить из браузера (ПК-режим): гудки и разговор в наушниках. Разговор запишется`
            : `${label} · Позвонить через АТС: она наберёт вас, затем клиента. Разговор запишется`}
        className={`${base} tabular-nums cursor-pointer bg-transparent p-0 border-0 font-inherit text-left ${
          status === 'calling' ? 'opacity-60' : ''}`}
      >
        {size === 'icon'
          ? (copied ? '✓' : status === 'calling' ? '…' : status === 'ringing' ? '📞…' : '📞')
          : copied ? '✓ номер скопирован'
          : status === 'calling' ? 'Соединяю…'
          : status === 'ringing' ? (viaExt === 'browser' ? '📞 звоним из браузера…' : `📞 АТС звонит ${viaExt ? `на ${viaExt}` : 'вам'}…`)
          : label}
      </button>
      {status === 'error' && size === 'md' && (
        <span className="text-[11px] text-red-600">{error}</span>
      )}
      {status === 'error' && size !== 'md' && (
        <span title={error} className="text-red-600">⚠︎</span>
      )}
    </span>
  )
}
