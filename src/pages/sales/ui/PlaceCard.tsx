import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/shared/services/api.service'

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
  match_kind: 'strong' | 'weak' | null
  updated_at: string | null
}

type Candidate = { id: string; name: string; address: string; rating: number | null; reviews: number | null }

const site = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

const Row = ({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) => (
  <div className="flex items-center gap-3 h-8 px-4 border-b border-gray-50 last:border-0" title={title}>
    <span className="text-[11.5px] text-gray-400 w-[116px] flex-none">{label}</span>
    <span className="text-[12.5px] text-gray-900 font-medium truncate">{children}</span>
  </div>
)

export function PlaceCard({ leadId, accountId, fallback, onFilled }: {
  leadId?: string
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
        '/sales/places', { leadId, accountId, placeId })
      setPlace(r.place)
      setCands(r.candidates || [])
      setPickOpen(r.match === 'weak' && !placeId)
      if (r.filled?.length) { setNote(`Подставили в квалификацию: ${r.filled.join(', ')}`); onFilled?.() }
      if (r.match === 'weak' && !placeId) setNote('')
    } catch (e: any) {
      setErr(e?.message || 'не нашлось')
    } finally { setBusy(false) }
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
        <button onClick={() => find()} disabled={busy}
          className="ml-auto text-[11.5px] font-semibold text-blue-600 hover:underline disabled:opacity-40">
          {busy ? 'ищу…' : place ? 'обновить' : 'найти на картах'}
        </button>
      </header>
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
      <div className="grid sm:grid-cols-2">
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
      {place?.hours && place.hours.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-50 text-[11.5px] text-gray-500">
          {place.hours.join(' · ')}
        </div>
      )}
    </section>
  )
}
