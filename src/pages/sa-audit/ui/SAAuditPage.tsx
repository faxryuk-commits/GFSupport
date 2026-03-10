import { useState, useEffect, useCallback } from 'react'
import { saGet } from '@/shared/services/sa-api.service'
import { ScrollText, Filter, ChevronLeft, ChevronRight } from 'lucide-react'

interface AuditLog {
  id: number
  orgId: string
  agentId: string
  agentName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, any> | null
  ip: string | null
  createdAt: string
}

export function SAAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const limit = 50

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (actionFilter) params.set('action', actionFilter)
      if (orgFilter) params.set('orgId', orgFilter)
      const data = await saGet<{ logs: AuditLog[] }>(`/admin/audit?${params}`)
      setLogs(data.logs || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [offset, actionFilter, orgFilter])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const actionColor = (action: string) => {
    if (action.includes('login')) return 'bg-blue-100 text-blue-700'
    if (action.includes('create')) return 'bg-green-100 text-green-700'
    if (action.includes('update')) return 'bg-amber-100 text-amber-700'
    if (action.includes('delete') || action.includes('deactivate')) return 'bg-red-100 text-red-700'
    return 'bg-slate-100 text-slate-600'
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Аудит логи</h1>
          <p className="text-sm text-slate-500 mt-1">Журнал действий на платформе</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <input
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-40"
              placeholder="Действие..."
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setOffset(0) }}
            />
          </div>
          <input
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-40"
            placeholder="org_id..."
            value={orgFilter}
            onChange={e => { setOrgFilter(e.target.value); setOffset(0) }}
          />
          {(actionFilter || orgFilter) && (
            <button
              onClick={() => { setActionFilter(''); setOrgFilter(''); setOffset(0) }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Сбросить
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Нет записей</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs">
                    <th className="px-4 py-3 text-left font-medium">Время</th>
                    <th className="px-4 py-3 text-left font-medium">Действие</th>
                    <th className="px-4 py-3 text-left font-medium">Организация</th>
                    <th className="px-4 py-3 text-left font-medium">Агент</th>
                    <th className="px-4 py-3 text-left font-medium">IP</th>
                    <th className="px-4 py-3 text-left font-medium">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-600">{log.orgId}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{log.agentName || log.agentId}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{log.ip || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                        {log.details ? JSON.stringify(log.details).slice(0, 80) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-600 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" /> Назад
            </button>
            <span className="text-xs text-slate-400">
              {offset + 1} — {offset + logs.length}
            </span>
            <button
              disabled={logs.length < limit}
              onClick={() => setOffset(offset + limit)}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-600 disabled:opacity-30"
            >
              Далее <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SAAuditPage
