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
  updated_at: string | null
}

/** Поля, которые можно переписать руками: Google ошибается чаще, чем кажется. */
const EDITABLE: Array<[keyof Place, string]> = [
  ['name', 'Название'], ['address', 'Адрес'], ['phone', 'Телефон'],
  ['website', 'Сайт'], ['instagram', 'Instagram'], ['telegram', 'Telegram'],
  ['branches', 'Точек в сети'],
]

type Candidate = { id: string; name: string; address: string; rating: number | null; reviews: number | null }

const site = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

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
      const r = await apiPost<{ place: Place; filled: string[]; match: string; candidates: Candidate[] }>(
        '/sales/places', { leadId, dealId, accountId, placeId })
      setPlace(r.place)
      setCands(r.candidates || [])
      setPickOpen(r.match === 'weak' && !placeId)
      if (r.filled?.length) { setNote(`Подставили в квалификацию: ${r.filled.join(', ')}`); onFilled?.() }
      if (r.match === 'weak' && !placeId) setNote('')
    } catch (e: any) {
      setErr(e?.message || 'не нашлось')
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
      {place?.match_kind === 'weak' && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11.5px] text-amber-800 flex items-center gap-2">
          <span>Название нашлось не точно — проверьте, то ли это место. В квалификацию ничего не подставили.</span>
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
