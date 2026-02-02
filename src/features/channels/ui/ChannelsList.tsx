import { useState, useMemo } from 'react'
import { Search, Filter, RefreshCw } from 'lucide-react'
import { ChannelCard, type Channel, type ChannelFilters } from '@/entities/channel'

interface ChannelsListProps {
  channels: Channel[]
  selectedId?: string
  onSelect: (channel: Channel) => void
  onRefresh?: () => void
  loading?: boolean
}

export function ChannelsList({ 
  channels, 
  selectedId, 
  onSelect, 
  onRefresh,
  loading 
}: ChannelsListProps) {
  const [filters, setFilters] = useState<ChannelFilters>({
    search: '',
    type: 'all',
    status: 'all',
    sortBy: 'lastMessage',
  })

  const filteredChannels = useMemo(() => {
    let result = [...channels]

    // Search
    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter(c => 
        c.name.toLowerCase().includes(search) ||
        c.companyName.toLowerCase().includes(search)
      )
    }

    // Type filter
    if (filters.type !== 'all') {
      result = result.filter(c => c.type === filters.type)
    }

    // Status filter
    if (filters.status === 'awaiting') {
      result = result.filter(c => c.awaitingReply)
    } else if (filters.status === 'active') {
      result = result.filter(c => c.isActive)
    }

    // Sort
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'unread':
          return b.unreadCount - a.unreadCount
        case 'name':
          return a.name.localeCompare(b.name)
        case 'lastMessage':
        default:
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
          return bTime - aTime
      }
    })

    return result
  }, [channels, filters])

  const awaitingCount = channels.filter(c => c.awaitingReply).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">
            Каналы
            {awaitingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full">
                {awaitingCount} ждут
              </span>
            )}
          </h2>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск каналов..."
            value={filters.search}
            onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3">
          <select
            value={filters.type}
            onChange={(e) => setFilters(f => ({ ...f, type: e.target.value as any }))}
            className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg"
          >
            <option value="all">Все типы</option>
            <option value="client">Клиенты</option>
            <option value="partner">Партнёры</option>
            <option value="internal">Внутренние</option>
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters(f => ({ ...f, status: e.target.value as any }))}
            className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg"
          >
            <option value="all">Все</option>
            <option value="awaiting">Ждут ответа</option>
            <option value="active">Активные</option>
          </select>

          <select
            value={filters.sortBy}
            onChange={(e) => setFilters(f => ({ ...f, sortBy: e.target.value as any }))}
            className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg"
          >
            <option value="lastMessage">По дате</option>
            <option value="unread">По непрочитанным</option>
            <option value="name">По имени</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredChannels.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            Каналы не найдены
          </div>
        ) : (
          <div className="space-y-1">
            {filteredChannels.map(channel => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                isSelected={channel.id === selectedId}
                onClick={() => onSelect(channel)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
