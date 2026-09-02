import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Публичная страница документа — то, что открывает клиент по ссылке /d/<токен>.
 *
 * Авторизации нет: знание токена и есть доступ. Поэтому здесь не должно быть
 * ничего лишнего — ни навигации по системе, ни данных других сделок.
 *
 * Страница шлёт маячок раз в 15 секунд, пока вкладка активна, и добивает
 * остаток через sendBeacon при уходе. Из этого считается время чтения: «открыл
 * и закрыл через 4 секунды» и «читал 6 минут» — разные сделки.
 */

interface DocLine {
  title: string
  qty?: number
  unit?: string
  price?: number
  total?: number
  recurring?: string
  category?: string
}

interface DocCondition {
  kind: string
  text: string
}

interface PublicDoc {
  kind: string
  number: string | null
  version: number
  title: string | null
  lines: DocLine[]
  conditions: DocCondition[]
  body: string | null
  total: number | null
  currency: string
  validTill: string | null
  requisites: Record<string, any>
  expired: boolean
  acceptedAt: string | null
  paidAt: string | null
  status: string
}

const KIND_LABEL: Record<string, string> = {
  quote: 'Коммерческое предложение',
  contract: 'Договор',
  offer: 'Оферта',
  act: 'Акт приёма-передачи',
  partner_contract: 'Партнёрский договор',
}

const HEARTBEAT_SEC = 15

function money(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined) return '—'
  return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`
}

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

interface Material {
  id: string
  title: string
  description: string | null
  url: string
  kind: string
}

const MATERIAL_ICON: Record<string, string> = {
  presentation: '📊', case: '🏆', video: '🎬', doc: '📄', link: '🔗',
}

export function PublicDocPage() {
  const { token } = useParams<{ token: string }>()
  // Свои открытия статистику не портят: сейлз приходит из CRM со ?staff=1,
  // и просмотр/время чтения по такой ссылке не считаются
  const staff = new URLSearchParams(window.location.search).get('staff') === '1'
    ? '&staff=1' : ''
  const [doc, setDoc] = useState<PublicDoc | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const pending = useRef(0)

  // Принятие оферты: сначала фиксируем согласие, потом уводим на оплату.
  // Порядок важен — иначе «ушёл на Click и передумал» неотличимо от «не читал».
  const acceptOffer = async () => {
    if (!token) return
    setAccepting(true)
    try {
      const res = await fetch(`/api/support/sales/doc-public?token=${encodeURIComponent(token)}&action=accept`,
        { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Не удалось принять оферту')
      if (data.payUrl) window.location.href = data.payUrl
      else setDoc(d => d ? { ...d, acceptedAt: new Date().toISOString(), status: 'accepted' } : d)
    } catch (e: any) {
      setError(e?.message || 'Не удалось принять оферту')
    } finally {
      setAccepting(false)
    }
  }

  useEffect(() => {
    if (!token) return
    // Сброс состояния: иначе при смене ссылки на экране остаётся прошлая ошибка
    setError(null)
    setDoc(null)
    fetch(`/api/support/sales/doc-public?token=${encodeURIComponent(token)}${staff}`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Документ не найден' : 'Не удалось открыть документ')
        return r.json()
      })
      .then(d => { setDoc(d.document); setMaterials(d.materials || []) })
      .catch(e => setError(e.message))
  }, [token])

  /** Клик по материалу считаем отдельно: видно, дочитал ли клиент до него. */
  const openMaterial = (m: Material) => {
    fetch(`/api/support/sales/doc-public?token=${encodeURIComponent(token || '')}&action=material${staff}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: m.id }),
    }).catch(() => {})
  }

  // Маячок времени чтения: считаем только активную вкладку, иначе «читал 3 часа»
  // будет означать «оставил открытым и ушёл обедать»
  useEffect(() => {
    if (!token || !doc) return
    const url = `/api/support/sales/doc-public?token=${encodeURIComponent(token)}${staff}`

    const send = (seconds: number, viaBeacon = false) => {
      if (seconds <= 0) return
      const payload = JSON.stringify({ seconds })
      if (viaBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
          .catch(() => {})
      }
    }

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      pending.current += HEARTBEAT_SEC
      send(pending.current)
      pending.current = 0
    }, HEARTBEAT_SEC * 1000)

    const onHide = () => {
      if (pending.current > 0) send(pending.current, true)
      pending.current = 0
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      onHide()
    }
  }, [token, doc])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7fa] px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md text-center">
          <div className="text-3xl mb-3">🔒</div>
          <h1 className="text-lg font-semibold text-gray-900">{error}</h1>
          <p className="text-sm text-gray-500 mt-2">
            Возможно, ссылка устарела. Напишите менеджеру — он пришлёт актуальную.
          </p>
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7fa]">
        <div className="text-sm text-gray-400">Загружаем документ…</div>
      </div>
    )
  }

  const lines = Array.isArray(doc.lines) ? doc.lines : []
  // Ежемесячный платёж, разовые работы и депозит — разные деньги: смешивать их
  // в одну сумму значит показать клиенту цифру, которой он никогда не заплатит
  const sum = (fn: (l: DocLine) => boolean) =>
    lines.filter(fn).reduce((a, l) => a + Number(l.total || 0), 0)
  // Скидка применяется к платежам, но не к депозиту: депозит — предоплата,
  // которая и так расходуется в счёт оплаты
  const disc = Number((doc as any).discountPct || 0)
  const k = 1 - disc / 100
  const monthlyRaw = sum(l => l.category !== 'deposit' && l.recurring !== 'one-time')
  const onetimeRaw = sum(l => l.category !== 'deposit' && l.recurring === 'one-time')
  const monthly = Math.round(monthlyRaw * k)
  const onetime = Math.round(onetimeRaw * k)
  const deposit = sum(l => l.category === 'deposit')

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      <header className="bg-[#002A47] text-white doc-header">
        <div className="max-w-3xl mx-auto px-5 py-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px]" style={{ background: 'linear-gradient(150deg,#afdbd9,#f3e9dd)' }} />
            <div>
              <div className="font-semibold tracking-tight">Delever</div>
              <div className="text-[11px] text-[#8fb0c4]">Платформа автоматизации доставки</div>
            </div>
          </div>
          <div className="text-right text-[12px] text-[#8fb0c4]">
            {KIND_LABEL[doc.kind] || 'Документ'}
            {doc.number && <span className="text-white"> №{doc.number}</span>}
            {doc.version > 1 && <span> · редакция {doc.version}</span>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-7 doc-sheet">
        <div className="flex justify-end no-print -mt-2 mb-2">
          <button onClick={() => window.print()}
            className="text-[12.5px] px-3 py-1.5 border border-gray-300 rounded-lg bg-white hover:border-[#002A47]">
            Скачать PDF
          </button>
        </div>
        {doc.expired && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            Срок действия предложения истёк {formatDate(doc.validTill)}. Условия могли измениться —
            напишите менеджеру, он пришлёт актуальные.
          </div>
        )}

        <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">
          {doc.title || KIND_LABEL[doc.kind] || 'Документ'}
        </h1>
        {doc.validTill && !doc.expired && (
          <p className="text-[13px] text-gray-500 mt-1">
            Условия действуют до {formatDate(doc.validTill)}
          </p>
        )}

        {lines.length > 0 && (
          <section className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Состав предложения
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                    <th className="text-left font-semibold px-4 py-2">Позиция</th>
                    {/* На телефоне количество и цена уезжают под название: клиенты
                        читают КП с телефона, и четыре колонки там нечитаемы */}
                    <th className="text-right font-semibold px-4 py-2 hidden sm:table-cell">Кол-во</th>
                    <th className="text-right font-semibold px-4 py-2 hidden sm:table-cell">Цена</th>
                    <th className="text-right font-semibold px-4 py-2">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-900">
                        {l.title}
                        <span className="block sm:hidden text-[12px] text-gray-500 mt-0.5">
                          {l.qty ?? 1} {l.unit || ''} × {money(l.price, doc.currency)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 hidden sm:table-cell">
                        {l.qty ?? 1} {l.unit || ''}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 hidden sm:table-cell">
                        {money(l.price, doc.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                        {money(l.total, doc.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-1.5">
              {disc > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-emerald-700 font-medium">Скидка</span>
                  <span className="text-[13px] font-semibold text-emerald-700 tabular-nums">−{disc}%</span>
                </div>
              )}
              {monthly > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Ежемесячный платёж</span>
                  <span className="text-[18px] font-semibold text-gray-900 tabular-nums">
                    {disc > 0 && (
                      <span className="text-[12px] font-normal text-gray-400 line-through mr-2">
                        {money(monthlyRaw, doc.currency)}
                      </span>
                    )}
                    {money(monthly, doc.currency)}
                  </span>
                </div>
              )}
              {onetime > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Разовые работы</span>
                  <span className="text-[14px] font-medium text-gray-700 tabular-nums">
                    {money(onetime, doc.currency)}
                  </span>
                </div>
              )}
              {deposit > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">
                    Депозит при подключении
                    <span className="block text-[11px] text-gray-400">расходуется в счёт оплаты</span>
                  </span>
                  <span className="text-[14px] font-medium text-gray-700 tabular-nums">
                    {money(deposit, doc.currency)}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {doc.kind === 'offer' && !doc.expired && (
          <section className="mt-5 rounded-xl border border-[#002A47]/15 bg-white p-5">
            {doc.paidAt ? (
              <div className="text-[13.5px] text-emerald-700">
                Оплачено {formatDate(doc.paidAt)}. Мы начинаем подключение — менеджер свяжется в течение дня.
              </div>
            ) : (
              <>
                <div className="text-[13.5px] text-gray-800">
                  Принимая оферту, вы соглашаетесь с условиями и оплачиваете первый период.
                  Договор при этом не нужен — работа начинается сразу после оплаты.
                </div>
                {doc.acceptedAt && (
                  <div className="text-[12px] text-gray-500 mt-2">
                    Условия приняты {formatDate(doc.acceptedAt)} — осталось оплатить.
                  </div>
                )}
                <button
                  onClick={acceptOffer}
                  disabled={accepting}
                  className="no-print mt-3 inline-flex items-center gap-2 rounded-lg bg-[#002A47] px-4 py-2.5 text-[13.5px] font-medium text-white hover:brightness-125 disabled:opacity-50"
                >
                  {accepting ? 'Готовим оплату…' : 'Принять условия и оплатить'}
                </button>
              </>
            )}
          </section>
        )}

        {Array.isArray(doc.conditions) && doc.conditions.length > 0 && (
          <section className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
              Условия
            </div>
            <ul className="space-y-2.5">
              {doc.conditions.map((c, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-gray-700 leading-relaxed">
                  <span className="text-gray-300 mt-0.5">—</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Материалы: клиенту одна ссылка вместо россыпи вложений, менеджеру —
            понимание, дочитали ли до презентации */}
        {materials.length > 0 && (
          <section className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
              Материалы
            </div>
            <div className="space-y-2">
              {materials.map(m => (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => openMaterial(m)}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-200
                             hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                >
                  <span className="flex-none text-xl leading-6">{MATERIAL_ICON[m.kind] || '📄'}</span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-gray-900">{m.title}</span>
                    {m.description && (
                      <span className="block text-[12px] text-gray-500 mt-0.5">{m.description}</span>
                    )}
                  </span>
                  <span className="ml-auto flex-none text-[12px] text-blue-600 self-center">открыть →</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {doc.body && (
          <section className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-gray-800">
              {doc.body}
            </pre>
          </section>
        )}

        {doc.requisites && Object.keys(doc.requisites).length > 0 && (
          <section className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Реквизиты</div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              {Object.entries(doc.requisites)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-gray-50 pb-1">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="text-gray-900 text-right">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}

        <footer className="mt-8 text-center text-[12px] text-gray-400 pb-10">
          Вопросы по предложению — ответьте в чате, где получили ссылку.
          <br />
          delever.uz · 1000+ бизнесов в 7 странах
        </footer>
      </main>
    </div>
  )
}

export default PublicDocPage
