import { SalesActivity } from './SalesActivity'
import { PageShell } from './kit'
import { RegionBadge, useRegion } from './region'

/**
 * Активность отдела — своим пунктом меню.
 *
 * Лента существовала и раньше, но жила третьей вкладкой в отчётах, и её не
 * находили. Вопрос «чем занималась команда» задаётся каждый день, а не когда
 * открывают отчёты; отсюда — свой адрес и место в сайдбаре.
 */
export function SalesActivityPage() {
  const region = useRegion('activity')
  return (
    <PageShell header={
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[19px] font-semibold text-gray-900 tracking-tight">Активность</h1>
          <p className="text-[12.5px] text-gray-500">
            звонки, этапы, задачи, заметки и лиды — по людям и по времени
          </p>
        </div>
        <RegionBadge scope="activity" />
      </div>
    }>
      <SalesActivity region={region} />
    </PageShell>
  )
}

export default SalesActivityPage
