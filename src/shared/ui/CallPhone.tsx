import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { parsePhone, PBX_COUNTRY } from '@/shared/lib/phone'

/**
 * Номер телефона, который звонит — и, если попросить, показывает каналы.
 *
 * Один компонент на все карточки: распознаёт номер с учётом рынка клиента
 * (узбекский, казахский, азербайджанский…), показывает его в человеческом
 * виде и по клику соединяет через АТС — она звонит сотруднику, потом клиенту,
 * разговор записывается. До этого по системе была россыпь tel:-ссылок,
 * которые с рабочего мака просто никуда не вели.
 *
 * С пропом `channels` рядом появляются значки «есть WhatsApp / Telegram»
 * и стрелка с меню действий. Клик по самому номеру при этом звонит как
 * раньше — переучивать сейлзов нельзя. Без пропа компонент ведёт себя
 * ровно так же, как до появления каналов: на доске с сотней карточек
 * лишние проверки никому не нужны.
 */

type Props = {
  phone: string | null | undefined
  /** Код рынка клиента ('uz' | 'kz' | 'az'…) — локальный номер читается в его нумерации. */
  market?: string | null
  leadId?: string | null
  /** sm — в строку метаданных карточки, md — в поле карточки клиента,
   *  icon — одна трубка, номер по наведению: для тесных мест вроде подвала карточки. */
  size?: 'sm' | 'md' | 'icon'
  /** Показать значки каналов и меню действий: карточка сделки, контакты, лид. */
  channels?: boolean
  /** Сделка, в ленту которой ляжет отправленное сообщение. */
  dealId?: string | null
  className?: string
}

type Status = 'idle' | 'calling' | 'ringing' | 'error'

interface ChannelInfo {
  hasWhatsapp: boolean | null
  hasTelegram: boolean | null
  tgUsername: string | null
  tgName: string | null
  tgLastSeen: string | null
  tgPremium: boolean | null
  channels: Array<{ id: string; source: string; name: string; messages: number }>
}

/** «был недавно» вместо ISO-строки: сейлзу важно, живой ли аккаунт. */
function seenLabel(v: string | null): string {
  if (!v) return ''
  if (v === 'online') return 'в сети'
  if (v === 'recently') return 'был недавно'
  if (v === 'week') return 'был на этой неделе'
  if (v === 'month') return 'был в этом месяце'
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'был сегодня'
  if (days === 1) return 'был вчера'
  if (days < 30) return `был ${days} дн назад`
  return 'давно не заходил'
}

const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

export function CallPhone({ phone, market, leadId, size = 'md', channels: withChannels, dealId, className = '' }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  // Короткий добавочный (101) показываем в статусе — понятно, чья трубка
  // зазвонит; мобильный первой ногой остаётся «вам»
  const [viaExt, setViaExt] = useState('')
  const [copied, setCopied] = useState(false)
  // Есть ли прямой звонок из браузера — держим в состоянии и слушаем звонилку:
  // софтфон подключается позже первой отрисовки, и подсказка должна обновиться
  const [direct, setDirect] = useState<boolean>(() => Boolean((window as any).__gfDirectCall))
  const [info, setInfo] = useState<ChannelInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const [compose, setCompose] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [sendErr, setSendErr] = useState('')
  const [tgReady, setTgReady] = useState<boolean | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const on = (e: Event) => setDirect(Boolean((e as CustomEvent).detail))
    window.addEventListener('gf:direct-call', on)
    return () => window.removeEventListener('gf:direct-call', on)
  }, [])

  // Каналы спрашиваем только там, где их попросили показать: ответ кэширован
  // на сутки, так что открытие карточки второй раз в мост уже не ходит
  useEffect(() => {
    if (!withChannels || !phone) return
    let alive = true
    apiGet<ChannelInfo>(`/sales/channels?phone=${encodeURIComponent(phone)}`, false)
      .then(d => { if (alive) setInfo(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [withChannels, phone])

  // Свой Telegram подключён? От этого зависит, можем ли писать из системы
  useEffect(() => {
    if (!open || tgReady !== null) return
    apiGet<any>('/sales/telegram?action=status', false)
      .then(d => setTgReady(!!d.connected))
      .catch(() => setTgReady(false))
  }, [open, tgReady])

  // Прокрутка уводит карточку из-под меню — закрываем, чтобы оно не «висело»
  useEffect(() => {
    if (!open) return
    const close = () => { if (!compose) setOpen(false) }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, compose])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      if (boxRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!phone) return null
  const parsed = parsePhone(phone, market)
  const label = parsed.valid ? parsed.pretty : phone
  const e164 = parsed.valid ? parsed.e164 : '+' + phone.replace(/\D/g, '')
  const digits = e164.replace(/\D/g, '')
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
    const directCall = (window as any).__gfDirectCall as ((num: string) => Promise<void>) | null | undefined
    if (directCall) {
      try {
        await directCall(parsed.valid ? parsed.e164 : phone)
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

  const waChannel = info?.channels.find(c => c.source === 'whatsapp')
  const tgChannel = info?.channels.find(c => String(c.source).startsWith('telegram'))
  const showChips = withChannels && info && (info.hasWhatsapp !== null || info.hasTelegram !== null)

  const MENU_W = 292
  const MENU_H = 330

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault()
    const r = boxRef.current?.getBoundingClientRect()
    if (r) {
      // Снизу не помещается — открываем вверх, иначе последние пункты
      // уезжают за край экрана и до них не добраться
      const below = window.innerHeight - r.bottom
      const up = below < MENU_H && r.top > below
      setRect({
        top: up ? Math.max(8, r.top - MENU_H - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
        up,
      })
    }
    setCompose(false); setSendErr(''); setSent('')
    setOpen(o => !o)
  }

  const sendTelegram = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setSendErr('')
    try {
      await apiPost('/sales/telegram', { action: 'send', phone: e164, text, dealId })
      setSent('Отправлено — сообщение уйдёт в ленту сделки')
      setDraft(''); setCompose(false)
      setTimeout(() => { setOpen(false); setSent('') }, 1800)
    } catch (err: any) {
      setSendErr(err?.message || 'не отправилось')
    } finally { setSending(false) }
  }

  const go = (url: string, external = true) => {
    setOpen(false)
    if (external) window.open(url, '_blank', 'noopener')
    else window.location.assign(url)
  }

  const Item = ({ icon, title, sub, onClick, tone }: {
    icon: string; title: string; sub?: string; onClick: () => void; tone?: string
  }) => (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2.5">
      <span className={`w-4 text-center text-[13px] flex-none ${tone || ''}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-gray-800">{title}</span>
        {sub && <span className="block text-[10.5px] text-gray-400">{sub}</span>}
      </span>
    </button>
  )

  return (
    <span ref={boxRef} className={`inline-flex items-baseline gap-1 ${className}`}>
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

      {/* Значки каналов: показываем только проверенное, иначе элемент как раньше */}
      {showChips && info!.hasWhatsapp && (
        <span title="Номер есть в WhatsApp"
          className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 self-center">W</span>
      )}
      {showChips && info!.hasTelegram && (
        <span title={info!.tgUsername ? `Telegram · @${info!.tgUsername}` : 'Аккаунт найден в Telegram'}
          className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold bg-blue-50 text-blue-700 self-center">T</span>
      )}

      {withChannels && (
        <button type="button" onClick={toggleMenu} title="Написать или скопировать"
          className="text-gray-400 hover:text-gray-700 text-[9px] self-center px-0.5">▾</button>
      )}

      {open && rect && createPortal(
        <div ref={popRef}
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: MENU_W, zIndex: 60,
            maxHeight: `calc(100vh - ${rect.top + 16}px)`,
          }}
          className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-y-auto overscroll-contain">
          <div className="px-3 py-2 bg-gray-50/80 border-b border-gray-100">
            <div className="text-[13px] font-semibold tabular-nums text-gray-900">{label}</div>
            {/* Кто это в Telegram: имя и «был недавно» говорят больше, чем галочка */}
            {info?.hasTelegram && (info.tgName || info.tgUsername) && (
              <div className="text-[11px] text-blue-700 mt-0.5">
                {info.tgName || ''}{info.tgUsername ? ` · @${info.tgUsername}` : ''}
                {info.tgPremium ? ' · Premium' : ''}
                {seenLabel(info.tgLastSeen) ? ` · ${seenLabel(info.tgLastSeen)}` : ''}
              </div>
            )}
            {info?.channels.length ? (
              <div className="text-[10.5px] text-gray-400">
                переписка: {info.channels.map(c => `${c.source === 'whatsapp' ? 'WhatsApp' : 'Telegram'} · ${c.messages}`).join(', ')}
              </div>
            ) : <div className="text-[10.5px] text-gray-400">переписки в системе пока нет</div>}
          </div>

          {/* Поле ответа прямо в меню: писать — главное действие, и уводить
              человека на другой экран ради двух строк незачем */}
          {compose && (
            <div className="px-3 py-2.5 border-b border-gray-100 bg-blue-50/40">
              <div className="text-[10.5px] text-gray-500 mb-1">
                Telegram от вашего имени{info?.tgName ? ` · ${info.tgName}` : ''}
              </div>
              <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendTelegram() }}
                placeholder="Здравствуйте! Это…"
                className="w-full text-[12.5px] border border-gray-200 rounded-lg px-2.5 py-2 min-h-[70px] resize-y" />
              <div className="flex items-center gap-2 mt-1.5">
                <button type="button" onClick={sendTelegram} disabled={sending || !draft.trim()}
                  className="text-[12px] font-semibold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
                  {sending ? 'Отправляем…' : 'Отправить'}
                </button>
                <button type="button" onClick={() => setCompose(false)}
                  className="text-[12px] text-gray-500 px-2 py-1.5">Отмена</button>
                <span className="text-[10px] text-gray-400 ml-auto">⌘+Enter</span>
              </div>
              {sendErr && <div className="text-[11px] text-red-600 mt-1">{sendErr}</div>}
            </div>
          )}
          {sent && <div className="px-3 py-2 text-[11.5px] text-emerald-700 bg-emerald-50 border-b border-emerald-100">{sent}</div>}

          <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 px-3 pt-2 pb-0.5">
            В системе <span className="font-normal normal-case tracking-normal">— останется в карточке</span>
          </div>
          <Item icon="📞" title="Позвонить" sub={direct ? 'из браузера · запись в ленте' : 'через АТС · запись в ленте'}
            onClick={() => { setOpen(false); call({ stopPropagation() {}, preventDefault() {} } as any) }} />
          {waChannel && (
            <Item icon="✆" tone="text-emerald-600" title="Открыть переписку в WhatsApp"
              sub={`${waChannel.messages} сообщений · ответ уйдёт из системы`}
              onClick={() => go(`/chats/${waChannel.id}`, false)} />
          )}
          {info?.hasTelegram && !compose && (
            tgReady === false ? (
              <Item icon="✈" tone="text-gray-400" title="Написать в Telegram"
                sub="сначала подключите свой Telegram: Моё → Мой Telegram"
                onClick={() => go('/me', false)} />
            ) : (
              <Item icon="✈" tone="text-blue-600" title="Написать в Telegram"
                sub={info.tgUsername ? `@${info.tgUsername} · от вашего имени` : 'от вашего имени · останется в ленте'}
                onClick={() => { setCompose(true); setSendErr('') }} />
            )
          )}
          {tgChannel && (
            <Item icon="💬" tone="text-blue-600" title="Открыть переписку в Telegram"
              sub={`${tgChannel.messages} сообщений · ответ уйдёт из системы`}
              onClick={() => go(`/chats/${tgChannel.id}`, false)} />
          )}

          <div className="h-px bg-gray-100 my-1" />
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 px-3 pt-1 pb-0.5">
            Снаружи <span className="font-normal normal-case tracking-normal">— в карточку не попадёт</span>
          </div>
          <Item icon="🌐" title="Открыть WhatsApp"
            sub={info?.hasWhatsapp === false ? 'номера нет в WhatsApp' : 'wa.me'}
            onClick={() => go(`https://wa.me/${digits}`)} />
          <Item icon="🌐" title="Открыть Telegram"
            sub={info?.hasTelegram === false ? 'аккаунт не найден' : 'в приложении на этом устройстве'}
            onClick={() => go(`tg://resolve?phone=${digits}`, false)} />
          {isApple() && (
            <Item icon="🍎" title="iMessage" sub="Messages на Mac и iPhone"
              onClick={() => go(`imessage://${e164}`, false)} />
          )}
          <Item icon="⧉" title="Скопировать номер"
            onClick={() => {
              navigator.clipboard?.writeText(parsed.pretty || phone).catch(() => {})
              setOpen(false); setCopied(true); setTimeout(() => setCopied(false), 2000)
            }} />
        </div>, document.body)}

      {status === 'error' && size === 'md' && (
        <span className="text-[11px] text-red-600">{error}</span>
      )}
      {status === 'error' && size !== 'md' && (
        <span title={error} className="text-red-600">⚠︎</span>
      )}
    </span>
  )
}
