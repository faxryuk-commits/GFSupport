import { useState } from 'react'
import { ChevronDown, Database } from 'lucide-react'
import type { InsightsToolCall } from '../model/types'

const TOOL_LABELS: Record<string, string> = {
  get_dashboard_metrics: 'KPI дашборда',
  get_sla_report: 'SLA-отчёт и лидерборд',
  get_agent_360: '360°-профиль сотрудника',
  find_channels: 'Поиск каналов',
  find_cases: 'Поиск кейсов',
  get_category_flow: 'Воронка по категориям',
}

export function ToolCallCard({ call }: { call: InsightsToolCall }) {
  const [open, setOpen] = useState(false)
  const label = TOOL_LABELS[call.name] || call.name
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 rounded-lg transition-colors"
      >
        <Database className="w-3.5 h-3.5 text-slate-500" />
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-400">· {call.durationMs}мс</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Параметры</div>
            <pre className="bg-white border border-slate-200 rounded-md p-2 text-[11px] text-slate-700 overflow-x-auto">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Сырой результат</div>
            <pre className="bg-white border border-slate-200 rounded-md p-2 text-[11px] text-slate-700 overflow-x-auto max-h-72">
              {JSON.stringify(call.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
