import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { 
  Search, Plus, RefreshCw, MessageSquare,
  Clock, XCircle, ExternalLink, MoreHorizontal,
  Hash, Building, ChevronDown
} from 'lucide-react'
import { Badge, LoadingState, EmptyState, Modal } from '@/shared/ui'
import { fetchChannels } from '@/shared/api'
import type { Channel } from '@/entities/channel'

type FilterStatus = 'all' | 'active' | 'inactive'
type SortBy = 'name' | 'messages' | 'lastActivity'

export function ChannelsListPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [sortBy, setSortBy] = useState<SortBy>('lastActivity')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchChannels()
      setChannels(data)
    } catch (err) {
      console.error('Failed to load channels:', err)
      setError('Не удалось загрузить каналы')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Закрытие меню сортировки при клике вне
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Фильтрация и сортировка
  const filteredChannels = channels
    .filter(ch => {
      // Поиск
      if (search) {
        const s = search.toLowerCase()
        return (
          ch.name?.toLowerCase().includes(s) ||
          String(ch.telegramChatId || '').includes(s) ||
          ch.companyName?.toLowerCase().includes(s)
        )
      }
      return true
    })
    .filter(ch => {
      // Статус
      if (filterStatus === 'active') return ch.isActive
      if (filterStatus === 'inactive') return !ch.isActive
      return true
    })
    .sort((a, b) => {
      // Сортировка
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '')
      }
      if (sortBy === 'messages') {
        return (b.unreadCount || 0) - (a.unreadCount || 0)
      }
      // lastActivity
      const dateA = new Date(a.lastMessageAt || 0).getTime()
      const dateB = new Date(b.lastMessageAt || 0).getTime()
      return dateB - dateA
    })

  const activeCount = channels.filter(ch => ch.isActive).length
  const inactiveCount = channels.filter(ch => !ch.isActive).length

  const sortLabels: Record<SortBy, string> = {
    lastActivity: 'По активности',
    name: 'По названию',
    messages: 'По сообщениям',
  }

  if (loading) {
    return <LoadingState text="Загрузка каналов..." />
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<XCircle className="w-12 h-12 text-red-500" />}
          title="Ошибка загрузки"
          description={error}
          action={{ label: 'Повторить', onClick: loadChannels }}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Телеграм каналы ({channels.length})
          </h1>
          <p className="text-slate-500 mt-0.5">
            {activeCount} активных, {inactiveCount} неактивных
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadChannels}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            title="Обновить"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить канал
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, ID или компании..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filterStatus === 'all' 
                ? 'bg-white text-slate-800 shadow-sm' 
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filterStatus === 'active' 
                ? 'bg-white text-green-600 shadow-sm' 
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Активные ({activeCount})
          </button>
          <button
            onClick={() => setFilterStatus('inactive')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filterStatus === 'inactive' 
                ? 'bg-white text-slate-600 shadow-sm' 
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Неактивные ({inactiveCount})
          </button>
        </div>

        {/* Sort */}
        <div className="relative" ref={sortMenuRef}>
          <button 
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors"
          >
            {sortLabels[sortBy]}
            <ChevronDown className={`w-4 h-4 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 mt-2 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
              {(Object.keys(sortLabels) as SortBy[]).map(key => (
                <button
                  key={key}
                  onClick={() => { setSortBy(key); setShowSortMenu(false) }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                    sortBy === key ? 'bg-blue-50 text-blue-600' : ''
                  }`}
                >
                  {sortLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Channels Grid */}
      {filteredChannels.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="w-12 h-12 text-slate-300" />}
          title="Каналы не найдены"
          description={search ? 'Попробуйте изменить параметры поиска' : 'Добавьте первый канал'}
          action={!search ? { label: 'Добавить канал', onClick: () => setShowAddModal(true) } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredChannels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}

      {/* Add Channel Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Добавить канал"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Чтобы добавить канал, добавьте бота в вашу Telegram группу или канал.
          </p>
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-700">
              1. Найдите бота @YourBotName в Telegram<br />
              2. Добавьте его в вашу группу как администратора<br />
              3. Канал автоматически появится в списке
            </p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddModal(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Понятно
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Channel Card Component
function ChannelCard({ channel }: { channel: Channel }) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const lastMessageTime = channel.lastMessageAt 
    ? formatRelativeTime(channel.lastMessageAt)
    : 'нет сообщений'

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const typeLabels: Record<string, string> = {
    client: 'Клиент',
    partner: 'Партнёр',
    internal: 'Внутренний',
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all">
      {/* Header */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              channel.isActive ? 'bg-green-100' : 'bg-slate-100'
            }`}>
              <MessageSquare className={`w-5 h-5 ${
                channel.isActive ? 'text-green-600' : 'text-slate-400'
              }`} />
            </div>
            <div>
              <h3 className="font-medium text-slate-800 truncate max-w-[180px]">
                {channel.name || 'Без названия'}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Hash className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{channel.telegramChatId || 'ID не указан'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {channel.isActive ? (
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full" title="Активен" />
            ) : (
              <span className="w-2.5 h-2.5 bg-slate-300 rounded-full" title="Неактивен" />
            )}
            <div className="relative" ref={menuRef}>
              <button 
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 hover:bg-slate-100 rounded transition-colors"
              >
                <MoreHorizontal className="w-4 h-4 text-slate-400" />
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                  <Link
                    to={`/chats/${channel.id}`}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Открыть чат
                  </Link>
                  <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                    Настройки
                  </button>
                  <button className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    Отключить
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center border-b border-slate-100">
        <div>
          <p className="text-lg font-semibold text-slate-800">{channel.unreadCount || 0}</p>
          <p className="text-xs text-slate-500">Непрочитано</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-800">{channel.membersCount || 0}</p>
          <p className="text-xs text-slate-500">Участников</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-800">{channel.openCasesCount || 0}</p>
          <p className="text-xs text-slate-500">Кейсов</p>
        </div>
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        {/* Last message */}
        {channel.lastMessageText && (
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-slate-600 truncate">{channel.lastMessageText}</p>
              <p className="text-xs text-slate-400">{lastMessageTime}</p>
            </div>
          </div>
        )}

        {/* Company */}
        {channel.companyName && (
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-600 truncate">{channel.companyName}</span>
          </div>
        )}

        {/* Type */}
        <div className="flex items-center gap-2">
          <Badge 
            variant={channel.type === 'client' ? 'info' : channel.type === 'partner' ? 'warning' : 'default'} 
            size="sm"
          >
            {typeLabels[channel.type] || channel.type}
          </Badge>
          {channel.awaitingReply && (
            <Badge variant="danger" size="sm">Ждёт ответа</Badge>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-slate-50 rounded-b-xl">
        <Link
          to={`/chats/${channel.id}`}
          className="flex items-center justify-center gap-2 w-full py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Перейти к чату
        </Link>
      </div>
    </div>
  )
}

// Helper function
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`
  
  return date.toLocaleDateString('ru-RU')
}
