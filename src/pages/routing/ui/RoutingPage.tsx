import { Waypoints } from 'lucide-react'

/**
 * Маршрутизация — экран из редизайна (SLA-матрица, skill-based routing,
 * живые очереди, лестница эскалации). Заглушка; полная реализация — шаг 4.
 */
export function RoutingPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
          <Waypoints className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Маршрутизация</h1>
      </div>
      <p className="text-sm text-slate-500">
        SLA-матрица по приоритетам, skill-based правила, живые очереди и лестница
        эскалации (L1 → L2 → L3). Экран в разработке — реализуется на шаге 4 редизайна.
      </p>
    </div>
  )
}

export default RoutingPage
