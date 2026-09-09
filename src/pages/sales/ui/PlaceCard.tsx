import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, apiDelete } from '@/shared/services/api.service'
import { confirmDialog } from '@/shared/ui'

/**
 * Блок «На карте»: что Google знает о заведении.
 *
 * Сейлз всё равно идёт смотреть карты перед звонком — сколько точек, живое ли
 * место, есть ли сайт. Тут это лежит в карточке и заодно подставляет число
 * точек в квалификацию, если поле пустое.
 */

export type Place = {
  place_id: string | null
  name: string | null
  address: string | null
  rating: string | number | null
  reviews: number | null
  website: string | null
  phone: string | null
  maps_url: string | null
  category: string | null
  status: string | null
  branches: number | null
  hours: string[] | null
  instagram: string | null
  telegram: string | null
  photos: Array<{ ref: string; url: string; w: number | null; h: number | null }> | null
  edited: Record<string, boolean> | null
  match_kind: 'strong' | 'weak' | null
  /** На каком основании это место сочли тем самым — и почему так решили. */
  found_via: 'manual' | 'site' | 'name' | null
  match_why: string | null
  found_query: string | null
  /** Признаки доставки — прямо из карт, и агрегаторы со ссылок на сайте. */
  delivery: boolean | null
  takeout: boolean | null
  dine_in: boolean | null
  aggregators: string[] | null
  updated_at: string | null
}

/** Поля, которые можно переписать руками: Google ошибается чаще, чем кажется. */
const EDITABLE: Array<[keyof Place, string]> = [
  ['name', 'Название'], ['address', 'Адрес'], ['phone', 'Телефон'],
  ['website', 'Сайт'], ['instagram', 'Instagram'], ['telegram', 'Telegram'],
  ['branches', 'Точек в сети'],
]

type Candidate = { id: string; name: string; address: string; rating: number | null; reviews: number | null }

/** Поле, которое карты предлагают записать в карточку. */
type Suggest = {
  field: string
  label: string
  value: string
  /** Что стоит сейчас: пусто или прежнее значение, которое будет заменено. */
  current: string | null
  /** Куда писать: карточка клиента, обращение или сделка. */
  scope: 'account' | 'lead' | 'deal'
}

const site = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

/**
 * Чип основания: по чему нашли. Карточка зовётся «Sushita.uz», а место —
 * «Tekit Sushi», и без этой подписи непонятно, откуда система взяла, что это
 * одно заведение. Оказалось — не одно.
 */
const BASIS: Record<string, { text: string; cls: string }> = {
  manual: { text: 'выбрал сейлз', cls: 'text-gray-600 bg-gray-100 border-gray-200' },
  site: { text: 'нашли по сайту', cls: 'text-blue-700 bg-blue-50 border-blue-100' },
  name: { text: 'по названию', cls: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
}

const Row = ({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) => (
  <div className="flex items-center gap-3 h-8 px-4 border-b border-gray-50 last:border-0" title={title}>
    <span className="text-[11.5px] text-gray-400 w-[116px] flex-none">{label}</span>
    <span className="text-[12.5px] text-gray-900 font-medium truncate">{children}</span>
  </div>
)

export function PlaceCard({ leadId, dealId, accountId, fallback, onFilled }: {
  leadId?: string
  /** Сделка: место храним у клиента, но пустые поля закрываем в сделке. */
  dealId?: string
  accountId?: string | null
  /** Что уже было в тексте заявки — показываем, пока не сходили на карты. */
  fallback?: { rating: string | null; reviews: string | null; address: string | null
    website: string | null; mapsUrl: string | null } | null
  onFilled?: () => void
}) {
  const [place, setPlace] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  // Что карты предлагают подставить. Раньше это делалось само, и неверная
  // находка затирала данные, уточнённые у клиента голосом. Теперь решает человек
  const [suggest, setSuggest] = useState<Suggest[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  // Кандидаты показываем, когда автоматика не уверена или сейлз сам попросил:
  // «Диор Саидкилов» легко становится бутиком Dior, и это должен решать человек
  const [cands, setCands] = useState<Candidate[]>([])
  const [pickOpen, setPickOpen] = useState(false)
  // Правка и просмотр снимка живут в самой карточке: уходить ради этого
  // на другой экран незачем
  const [edit, setEdit] = useState<Record<string, string> | null>(null)
  const [shot, setShot] = useState<string | null>(null)

  const q = leadId ? `leadId=${leadId}` : accountId ? `accountId=${accountId}` : ''

  const load = useCallback(() => {
    if (!q) return
    apiGet<{ place: Place | null }>(`/sales/places?${q}`, false)
      .then(r => setPlace(r.place || null))
      .catch(() => {})
  }, [q])
  useEffect(() => { load() }, [load])

  const find = async (placeId?: string) => {
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await apiPost<{
        place: Place; suggest: Suggest[]; match: string; candidates: Candidate[]
      }>('/sales/places', { leadId, dealId, accountId, placeId })
      setPlace(r.place)
      setCands(r.candidates || [])
      setPickOpen(r.match === 'weak' && !placeId)
      // Отмечаем заранее только то, где поле пустое: заполненное руками
      // человек отметит сам, если согласен заменить
      const list = r.suggest || []
      setSuggest(list)
      setChosen(new Set(list.filter(x => !x.current).map(x => `${x.scope}:${x.field}`)))
      if (r.match === 'weak' && !placeId) setNote('')
    } catch (e: any) {
      setErr(e?.message || 'не нашлось')
    } finally { setBusy(false) }
  }

  /** Подставить отмеченное. Пишем по разделам: клиент, обращение, сделка. */
  const applySuggested = async () => {
    const picked = suggest.filter(x => chosen.has(`${x.scope}:${x.field}`))
    if (!picked.length) return
    setBusy(true); setErr(''); setNote('')
    try {
      const byScope: Record<string, Record<string, string>> = {}
      for (const x of picked) {
        byScope[x.scope] = byScope[x.scope] || {}
        byScope[x.scope][x.field] = x.value
      }
      const idOf = (scope: string) => scope === 'account' ? accountId : scope === 'lead' ? leadId : dealId
      for (const [scope, fields] of Object.entries(byScope)) {
        const id = idOf(scope)
        if (!id) continue
        await apiPost('/sales/places', { action: 'apply', scope, id, fields })
      }
      setNote(`Подставили: ${picked.map(x => x.label.toLowerCase()).join(', ')}`)
      setSuggest([]); setChosen(new Set())
      onFilled?.()
    } catch (e: any) {
      setErr(e?.message || 'не подставилось')
    } finally { setBusy(false) }
  }

  const saveEdit = async () => {
    if (!edit) return
    setBusy(true); setErr('')
    try {
      const r = await apiPost<{ place: Place }>('/sales/places', {
        action: 'edit', leadId, accountId, fields: edit,
      })
      setPlace(r.place); setEdit(null); setNote('Правка сохранена — обновление с карт её не сотрёт')
    } catch (e: any) {
      setErr(e?.message || 'не сохранилось')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!await confirmDialog('Удалить данные с карт из карточки? Найти заново можно в любой момент.')) return
    setBusy(true); setErr('')
    try {
      await apiDelete(`/sales/places?${q}`)
      setPlace(null); setCands([]); setNote(''); setEdit(null)
    } catch (e: any) {
      setErr(e?.message || 'не удалилось')
    } finally { setBusy(false) }
  }

  // Ссылка на снимок протухла — просим сервер собрать её заново
  const refreshPhotos = () => {
    apiGet<{ photos: Place['photos'] }>(`/sales/places?${q}&action=photos`, false)
      .then(r => setPlace(pl => (pl ? { ...pl, photos: r.photos || null } : pl)))
      .catch(() => {})
  }

  if (!place && !fallback) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <header className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-gray-900">На карте</h3>
          <button onClick={() => find()} disabled={busy}
            className="ml-auto text-[11.5px] font-semibold text-blue-600 hover:underline disabled:opacity-40">
            {busy ? 'ищу…' : 'найти на картах'}
          </button>
        </header>
        <div className="px-4 py-2.5 text-[12px] text-gray-500">
          {err || 'Рейтинг, число точек, сайт и телефон — из Google Карт по названию и городу.'}
        </div>
      </section>
    )
  }

  const rating = place?.rating ?? fallback?.rating ?? null
  const reviews = place?.reviews ?? (fallback?.reviews ? Number(fallback.reviews) : null)
  const address = place?.address || fallback?.address || null
  const website = place?.website || fallback?.website || null
  const mapsUrl = place?.maps_url || fallback?.mapsUrl || null
  const closed = place?.status && place.status !== 'OPERATIONAL'

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2"
        title={place ? 'Данные Google Карт' : 'Данные Google Карт из импорта базы'}>
        <h3 className="text-[13px] font-semibold text-gray-900">На карте</h3>
        {rating && (
          <span className="text-[10.5px] font-medium text-gray-500 bg-white border border-gray-200 rounded-md px-1.5 py-px tabular-nums">
            {rating} · {reviews || 0} отз.
          </span>
        )}
        {closed && (
          <span className="text-[10.5px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-md px-1.5 py-px">
            закрыто
          </span>
        )}
        {place?.match_kind === 'weak' ? (
          <span title={place.match_why || ''}
            className="text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-1.5 py-px">
            совпало слабо
          </span>
        ) : place?.found_via && BASIS[place.found_via] ? (
          <span title={place.match_why || ''}
            className={`text-[10.5px] font-semibold border rounded-md px-1.5 py-px ${BASIS[place.found_via].cls}`}>
            {BASIS[place.found_via].text}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2.5">
          {place && !edit && (
            <button onClick={() => setEdit(Object.fromEntries(
              EDITABLE.map(([k]) => [k, place[k] == null ? '' : String(place[k])]),
            ))} className="text-[11.5px] font-semibold text-gray-500 hover:text-blue-600">
              править
            </button>
          )}
          {place && (
            <button onClick={remove} disabled={busy}
              className="text-[11.5px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-40">
              удалить
            </button>
          )}
          <button onClick={() => find()} disabled={busy}
            className="text-[11.5px] font-semibold text-blue-600 hover:underline disabled:opacity-40">
            {busy ? 'ищу…' : place ? 'обновить' : 'найти на картах'}
          </button>
        </div>
      </header>
      {/* Название заведения: карточка называется по клиенту, а на картах место
          может зваться иначе — «Ресторан Саме Бобо» против «Same bobo» */}
      {place?.name && !edit && (
        <div className="px-4 pt-2.5 pb-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-[14.5px] font-semibold text-gray-900">{place.name}</span>
          {place.category && <span className="text-[11.5px] text-gray-500">{place.category}</span>}
          {place.edited && Object.keys(place.edited).length > 0 && (
            <span className="text-[10.5px] text-gray-400">· правлено руками</span>
          )}
        </div>
      )}
      {/* Почему система решила, что это то самое место: что искали и что
          совпало. Без этой строки сейлз не может проверить находку, не
          повторяя поиск руками */}
      {place?.match_why && !edit && (
        <div className="px-4 pb-2 -mt-1 text-[11px] text-gray-500">{place.match_why}</div>
      )}
      {place?.match_kind === 'weak' && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11.5px] text-amber-800 flex items-center gap-2">
          <span>Похоже, это не то заведение — проверьте. В квалификацию ничего не подставили.</span>
          {cands.length > 1 && (
            <button onClick={() => setPickOpen(o => !o)} className="ml-auto font-semibold hover:underline">
              {pickOpen ? 'скрыть' : 'выбрать другое'}
            </button>
          )}
        </div>
      )}
      {pickOpen && cands.length > 0 && (
        <div className="border-b border-gray-100 divide-y divide-gray-50">
          {cands.map(c => (
            <button key={c.id} onClick={() => { setPickOpen(false); find(c.id) }}
              className="w-full text-left px-4 py-1.5 hover:bg-blue-50">
              <div className="text-[12.5px] text-gray-900 font-medium">
                {c.name}
                {c.rating != null && <span className="text-gray-400 font-normal"> · {c.rating} ({c.reviews || 0})</span>}
              </div>
              <div className="text-[11px] text-gray-500 truncate">{c.address}</div>
            </button>
          ))}
        </div>
      )}
      {(note || err) && (
        <div className={`px-4 py-1.5 text-[11.5px] ${err ? 'text-red-600' : 'text-emerald-700'}`}>{err || note}</div>
      )}
      {suggest.length > 0 && !edit && (
        <div className="px-4 py-2.5 border-b border-gray-100 bg-blue-50/40">
          <div className="text-[11.5px] font-semibold text-gray-700 mb-1.5">
            Можно подставить в карточку
            <span className="font-normal text-gray-500"> — отметьте, что записать</span>
          </div>
          <div className="space-y-1">
            {suggest.map(x => {
              const key = `${x.scope}:${x.field}`
              const where = x.scope === 'account' ? 'клиент' : x.scope === 'lead' ? 'обращение' : 'сделка'
              return (
                <label key={key} className="flex items-start gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chosen.has(key)}
                    onChange={e => setChosen(prev => {
                      const nx = new Set(prev)
                      if (e.target.checked) nx.add(key); else nx.delete(key)
                      return nx
                    })}
                    className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="text-gray-500">{x.label} · {where}: </span>
                    <span className="font-medium text-gray-900">{x.value}</span>
                    {x.current && (
                      <span className="text-amber-700"> — заменит «{x.current}»</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={applySuggested} disabled={busy || chosen.size === 0}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'записываю…' : `Подставить (${chosen.size})`}
            </button>
            <button onClick={() => { setSuggest([]); setChosen(new Set()) }}
              className="text-[11.5px] text-gray-500 hover:text-gray-700">
              не сейчас
            </button>
          </div>
        </div>
      )}
      {edit && (
        <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
          {EDITABLE.map(([k, label]) => (
            <div key={String(k)} className="flex items-center gap-3">
              <span className="text-[11.5px] text-gray-400 w-[116px] flex-none">{label}</span>
              <input
                value={edit[String(k)] ?? ''}
                onChange={e => setEdit(v => ({ ...(v || {}), [String(k)]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEdit(null) }}
                className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1 text-[12.5px]" />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={saveEdit} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'сохраняю…' : 'Сохранить'}
            </button>
            <button onClick={() => setEdit(null)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600">
              Отмена
            </button>
            <span className="text-[10.5px] text-gray-400">правленое поле обновление с карт не тронет</span>
          </div>
        </div>
      )}
      {!!place?.photos?.length && !edit && (
        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
          {place.photos.map(ph => (
            <button key={ph.ref} onClick={() => setShot(ph.url)}
              className="flex-none w-[74px] h-[56px] rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400">
              <img src={ph.url} alt="" loading="lazy" onError={refreshPhotos}
                className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className={`grid sm:grid-cols-2 ${edit ? 'hidden' : ''}`}>
        {rating && (
          <Row label="Рейтинг">{rating}<span className="text-gray-400 font-normal"> · {reviews || 0} отзывов</span></Row>
        )}
        {!!place?.branches && place.branches > 1 && (
          <Row label="Точек в сети">
            {place.branches >= 20 ? '20+' : place.branches}
            <span className="text-gray-400 font-normal">
              {place.branches >= 20 ? ' — Google отдаёт не больше 20 за раз' : ' по поиску бренда в регионе'}
            </span>
          </Row>
        )}
        {place?.category && <Row label="Тип">{place.category}</Row>}
        {place?.delivery != null && (
          <Row label="Доставка" title="Как заведение отдаёт заказы — по данным Google Карт">
            {place.delivery ? 'есть' : 'нет'}
            <span className="text-gray-400 font-normal">
              {place.takeout ? ' · навынос' : ''}{place.dine_in ? ' · в зале' : ''}
            </span>
          </Row>
        )}
        {!!place?.aggregators?.length && (
          <Row label="Агрегаторы" title="Ссылки найдены на сайте заведения">
            {place.aggregators.join(', ')}
          </Row>
        )}
        {address && <Row label="Адрес" title={address}>{address}</Row>}
        {place?.phone && <Row label="Телефон с карт">{place.phone}</Row>}
        {website && (
          <Row label="Сайт">
            <a href={website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{site(website)}</a>
          </Row>
        )}
        {place?.instagram && (
          <Row label="Instagram">
            <a href={`https://instagram.com/${place.instagram}`} target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline">@{place.instagram}</a>
          </Row>
        )}
        {place?.telegram && (
          <Row label="Telegram">
            <a href={`https://t.me/${place.telegram}`} target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline">@{place.telegram}</a>
          </Row>
        )}
        {mapsUrl && (
          <Row label="Google Maps">
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">открыть на карте</a>
          </Row>
        )}
      </div>
      {shot && (
        <div onClick={() => setShot(null)}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 cursor-zoom-out">
          <img src={shot} alt="" className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
      {place?.hours && place.hours.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-50 text-[11.5px] text-gray-500">
          {place.hours.join(' · ')}
        </div>
      )}
    </section>
  )
}
