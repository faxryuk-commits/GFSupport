import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Filter, Plus } from 'lucide-react'
import { useToast } from '@/shared/ui'
import { LoadingSpinner } from '@/shared/ui'
import { EmptyState } from '@/shared/ui'
import { ConnectionCard } from '@/entities/onboarding'
import type { OnboardingConnection } from '@/entities/onboarding'
import { FilterBar } from '@/features/onboarding/ui/FilterBar'
import { ConnectionStats } from '@/features/onboarding/ui/ConnectionStats'
import { fetchConnections } from '@/shared/api/onboarding'
import { fetchAgents } from '@/shared/api/agents'

interface Filters {
  status: string
  stage: string
  assignedTo: string
  ball: string
}

const EMPTY_FILTERS: Filters = { status: '', stage: '', assignedTo: '', ball: '' }

export function OnboardingListPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [connections, setConnections] = useState<OnboardingConnection[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const loadData = useCallback(async (f?: Filters, q?: string) => {
    try {
      setLoading(true)
      const currentFilters = f ?? filters
      const currentSearch = q ?? search
      const params: Record<string, string> = {}
      if (currentFilters.status) params.status = currentFilters.status
      if (currentFilters.stage) params.stage = currentFilters.stage
      if (currentFilters.assignedTo) params.assignedTo = currentFilters.assignedTo
      if (currentFilters.ball) params.ball = currentFilters.ball
      if (currentSearch) params.search = currentSearch

      const res = await fetchConnections(params)
      setConnections(res.connections ?? [])
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить подключения')
    } finally {
      setLoading(false)
    }
  }, [filters, search, toast])

  useEffect(() => {
    loadData()
    fetchAgents()
      .then(list => setAgents(list.map(a => ({ id: a.id, name: a.name }))))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => loadData(), 30_000)
    return () => clearInterval(id)
  }, [loadData])

  const handleFilterChange = useCallback((next: Filters) => {
    setFilters(next)
    loadData(next)
  }, [loadData])

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
    loadData(undefined, value)
  }, [loadData])

  const stats = useMemo(() => {
    let active = 0, paused = 0, frozen = 0, overdue = 0
    for (const c of connections) {
      if (c.status === 'active') active++
      if (c.status === 'paused') paused++
      if (c.status === 'frozen') frozen++
      if (c.isOverdue) overdue++
    }
    return { active, paused, frozen, overdue }
  }, [connections])

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-800">Подключения</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="pl-10 pr-4 py-2 w-64 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`p-2 rounded-lg border transition-colors ${
              showFilters ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/onboarding/new')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Новое подключение
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-4 flex-shrink-0">
          <FilterBar filters={filters} onChange={handleFilterChange} agents={agents} />
        </div>
      )}

      <div className="mb-4 flex-shrink-0">
        <ConnectionStats stats={stats} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && connections.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : connections.length === 0 ? (
          <EmptyState
            title="Нет подключений"
            description="Создайте первое подключение, чтобы начать работу"
            action={{
              label: 'Новое подключение',
              onClick: () => navigate('/onboarding/new'),
            }}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {connections.map(conn => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                onClick={() => navigate(`/onboarding/${conn.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
