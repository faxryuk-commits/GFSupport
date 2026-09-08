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
  tgPhoto: string | null
  history?: Array<{ text: string; out: boolean; at: string; who: string | null; dealId: string | null }>
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

/** Настоящие логотипы: эмодзи «✆» и «✈» читались как случайные символы. */
const TgIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.78-.417-1.209.258-1.909.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.481-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.14.119.098.152.228.166.331.014.101.03.324.017.498z"/>
  </svg>
)
const WaIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>
  </svg>
)
const ExternalIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

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
  const [photoOpen, setPhotoOpen] = useState(false)
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

  // Превью фото закрывается Esc — привычка из любой галереи
  useEffect(() => {
    if (!photoOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhotoOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [photoOpen])

  // Прокрутка уводит карточку из-под меню — закрываем, чтобы оно не «висело»
  useEffect(() => {
    if (!open) return
    const close = () => { if (!compose && !photoOpen) setOpen(false) }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, compose, photoOpen])

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
    icon: React.ReactNode; title: string; sub?: string; onClick: () => void; tone?: string
  }) => (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2.5">
      <span className={`w-4 flex-none flex items-center justify-center ${tone || ''}`}>{icon}</span>
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
          className="inline-flex items-center justify-center w-[15px] h-[15px] text-emerald-600 self-center">
          <WaIcon className="w-[13px] h-[13px]" />
        </span>
      )}
      {showChips && info!.hasTelegram && (
        <span title={info!.tgName
          ? `${info!.tgName}${info!.tgUsername ? ` · @${info!.tgUsername}` : ''}`
          : 'Аккаунт найден в Telegram'}
          className="inline-flex items-center justify-center w-[15px] h-[15px] text-[#229ED9] self-center">
          <TgIcon className="w-[13px] h-[13px]" />
        </span>
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
          <div className="px-3 py-2 bg-gray-50/80 border-b border-gray-100 flex items-start gap-2.5">
            {/* Аватар из Telegram: у заведений это обычно логотип, и карточка
                узнаётся с одного взгляда */}
            {info?.tgPhoto && (
              <button type="button" title="Открыть фото"
                onClick={e => { e.stopPropagation(); setPhotoOpen(true) }}
                className="flex-none mt-0.5 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 relative group">
                <img src={info.tgPhoto} alt="" width={34} height={34}
                  className="w-[34px] h-[34px] object-cover block" />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors
                                 flex items-center justify-center text-white text-[11px] opacity-0 group-hover:opacity-100">⤢</span>
              </button>
            )}
            <div className="min-w-0">
            <div className="text-[13px] font-semibold tabular-nums text-gray-900">{label}</div>
            {/* Кто это в Telegram: имя и «был недавно» говорят больше, чем галочка */}
            {info?.hasTelegram && (info.tgName || info.tgUsername) && (
              <div className="text-[11px] text-blue-700 mt-0.5 truncate">
                {info.tgName || ''}{info.tgUsername ? ` · @${info.tgUsername}` : ''}
                {info.tgPremium ? ' · Premium' : ''}
                {seenLabel(info.tgLastSeen) ? ` · ${seenLabel(info.tgLastSeen)}` : ''}
              </div>
            )}
            {info?.channels.length ? (
              <div className="text-[10.5px] text-gray-400">
                переписка: {info.channels.map(c => `${c.source === 'whatsapp' ? 'WhatsApp' : 'Telegram'} · ${c.messages}`).join(', ')}
              </div>
            ) : !info?.history?.length
              ? <div className="text-[10.5px] text-gray-400">переписки в системе пока нет</div>
              : null}
            </div>
          </div>

          {/* Последние сообщения: контекст важнее, чем ещё один переход */}
          {!compose && !!info?.history?.length && (
            <div className="border-b border-gray-100 max-h-[132px] overflow-y-auto">
              {info.history.slice(0, 4).map((h, i) => (
                <div key={i} className={`px-3 py-1.5 text-[11.5px] flex gap-2 ${h.out ? '' : 'bg-blue-50/40'}`}>
                  <span className={`flex-none mt-px ${h.out ? 'text-gray-400' : 'text-blue-600'}`}>
                    {h.out ? '→' : '←'}
                  </span>
                  <span className="min-w-0">
                    <span className="text-gray-700">{h.text}</span>
                    <span className="text-gray-400 ml-1.5 whitespace-nowrap">
                      {new Date(h.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

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
          <Item icon={<span className="text-[13px]">📞</span>} title="Позвонить" sub={direct ? 'из браузера · запись в ленте' : 'через АТС · запись в ленте'}
            onClick={() => { setOpen(false); call({ stopPropagation() {}, preventDefault() {} } as any) }} />
          {waChannel && (
            <Item icon={<WaIcon className="w-4 h-4" />} tone="text-emerald-600" title="Открыть переписку в WhatsApp"
              sub={`${waChannel.messages} сообщений · ответ уйдёт из системы`}
              onClick={() => go(`/chats/${waChannel.id}`, false)} />
          )}
          {info?.hasTelegram && !compose && (
            tgReady === false ? (
              <Item icon={<TgIcon className="w-4 h-4" />} tone="text-gray-400" title="Написать в Telegram"
                sub="сначала подключите свой Telegram: Моё → Мой Telegram"
                onClick={() => go('/me', false)} />
            ) : (
              <Item icon={<TgIcon className="w-4 h-4" />} tone="text-blue-600" title="Написать в Telegram"
                sub={info.tgUsername ? `@${info.tgUsername} · от вашего имени` : 'от вашего имени · останется в ленте'}
                onClick={() => { setCompose(true); setSendErr('') }} />
            )
          )}
          {tgChannel && (
            <Item icon={<TgIcon className="w-4 h-4" />} tone="text-blue-600" title="Открыть переписку в Telegram"
              sub={`${tgChannel.messages} сообщений · ответ уйдёт из системы`}
              onClick={() => go(`/chats/${tgChannel.id}`, false)} />
          )}

          <div className="h-px bg-gray-100 my-1" />
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 px-3 pt-1 pb-0.5">
            Снаружи <span className="font-normal normal-case tracking-normal">— в карточку не попадёт</span>
          </div>
          <Item icon={<WaIcon className="w-4 h-4 opacity-60" />} title="Открыть WhatsApp"
            sub={info?.hasWhatsapp === false ? 'номера нет в WhatsApp' : 'wa.me'}
            onClick={() => go(`https://wa.me/${digits}`)} />
          <Item icon={<TgIcon className="w-4 h-4 opacity-60" />} title="Открыть Telegram"
            sub={info?.hasTelegram === false ? 'аккаунт не найден' : 'в приложении на этом устройстве'}
            onClick={() => go(`tg://resolve?phone=${digits}`, false)} />
          {isApple() && (
            <Item icon={<span className="text-[12px]">💬</span>} title="iMessage" sub="Messages на Mac и iPhone"
              onClick={() => go(`imessage://${e164}`, false)} />
          )}
          <Item icon={<ExternalIcon className="w-3.5 h-3.5 opacity-50" />} title="Скопировать номер"
            onClick={() => {
              navigator.clipboard?.writeText(parsed.pretty || phone).catch(() => {})
              setOpen(false); setCopied(true); setTimeout(() => setCopied(false), 2000)
            }} />
        </div>, document.body)}

      {/* Превью фото: в карточке аватар мелкий, а логотип заведения хочется
          рассмотреть — открываем во весь экран, закрытие кликом или Esc */}
      {photoOpen && info?.tgPhoto && createPortal(
        <div
          onClick={() => setPhotoOpen(false)}
          className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-6 cursor-zoom-out">
          <div className="max-w-[92vw] max-h-[88vh] flex flex-col items-center gap-2.5"
            onClick={e => e.stopPropagation()}>
            <img src={info.tgPhoto} alt={info.tgName || label}
              className="max-w-full max-h-[78vh] rounded-xl shadow-2xl object-contain bg-white" />
            <div className="text-center text-white/90">
              <div className="text-[13.5px] font-semibold">{info.tgName || label}</div>
              <div className="text-[11.5px] text-white/60">
                {info.tgUsername ? `@${info.tgUsername} · ` : ''}{label}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a href={info.tgPhoto} download={`${(info.tgName || label).replace(/[^\w\dа-яА-Я -]/g, '')}.jpg`}
                onClick={e => e.stopPropagation()}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
                Скачать
              </a>
              <button type="button" onClick={() => setPhotoOpen(false)}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
                Закрыть
              </button>
            </div>
          </div>
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
