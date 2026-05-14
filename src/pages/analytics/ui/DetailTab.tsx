import { Link } from 'react-router-dom'
import { ExternalLink, FileSpreadsheet, Users } from 'lucide-react'

interface DetailTabProps {
  period: '7d' | '30d' | '90d'
}

export function DetailTab({ period }: DetailTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Detail</strong> — построчные данные для экспорта: per-agent таблицы, нарушения SLA,
        открытые кейсы, выгрузки в xlsx. На сейчас это ещё старая страница SLA-отчёта — переезжает
        в этот таб следующим спринтом.
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-blue-500 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">SLA-отчёт за период</h3>
              <p className="text-xs text-slate-500 mt-1">
                Per-agent breakdown, нарушения SLA, expertise по категориям, weekly heatmap. Все
                цифры — на полной выборке (фикс 34acbfa от {' '}
                <code className="bg-slate-100 px-1 rounded">LIMIT 500</code>).
              </p>
            </div>
          </div>
          <Link
            to={`/sla-report?period=${period}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
          >
            Открыть
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-violet-500 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Per-agent FRT через метрики</h3>
              <p className="text-xs text-slate-500 mt-1">
                Каждый агент с бенчмарком, статусом, перцентилем. В разработке —{' '}
                <Link to="/benchmarks" className="underline text-blue-600 hover:text-blue-700">
                  пока сюда
                </Link>{' '}
                для управления целями.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
