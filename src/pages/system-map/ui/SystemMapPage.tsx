import { Map } from 'lucide-react'

/**
 * Карта системы — экран из редизайна (модули, статусы, потоки данных).
 * Заглушка; полная реализация — шаг 4.
 */
export function SystemMapPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <Map className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Карта системы</h1>
      </div>
      <p className="text-sm text-slate-500">
        Обзор модулей системы, их статусы и потоки данных (ingest → анализ →
        агент/страж → витрины). Экран в разработке — реализуется на шаге 4 редизайна.
      </p>
    </div>
  )
}

export default SystemMapPage
