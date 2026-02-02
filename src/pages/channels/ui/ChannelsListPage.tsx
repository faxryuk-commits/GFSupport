import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { 
  Search, Plus, RefreshCw, MessageSquare, Activity,
  Hash, Building, ChevronDown, ExternalLink, MoreHorizontal,
  CheckCircle, XCircle, Clock, AlertTriangle, Filter, Settings, Edit3, Power
} from 'lucide-react'
import { Badge, LoadingState, EmptyState, Modal, Avatar, ConfirmDialog } from '@/shared/ui'
import { fetchChannels, updateChannel, disconnectChannel } from '@/shared/api'
import type { Channel } from '@/entities/channel'

type FilterStatus = 'all' | 'active' | 'inactive' | 'awaiting'
type SortBy = 'name' | 'messages' | 'lastActivity' | 'unread'

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

  // Модальные окна для действий
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null)
  const [renameChannel, setRenameChannel] = useState<Channel | null>(null)
  const [disconnectChannelData, setDisconnectChannelData] = useState<Channel | null>(null)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'client' | 'partner' | 'internal'>('client')
  const [actionLoading, setActionLoading] = useState(false)

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Действия над каналом
  const handleOpenSettings = (channel: Channel) => {
    setSettingsChannel(channel)
    setNewType(channel.type)
  }

  const handleOpenRename = (channel: Channel) => {
    setRenameChannel(channel)
    setNewName(channel.name || '')
  }

  const handleRename = async () => {
    if (!renameChannel || !newName.trim()) return
    setActionLoading(true)
    try {
      await updateChannel(renameChannel.id, { name: newName.trim() })
      setChannels(prev => prev.map(ch => 
        ch.id === renameChannel.id ? { ...ch, name: newName.trim() } : ch
      ))
      setRenameChannel(null)
    } catch (err) {
      console.error('Failed to rename channel:', err)
      alert('Не удалось переименовать канал')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUpdateType = async () => {
    if (!settingsChannel) return
    setActionLoading(true)
    try {
      await updateChannel(settingsChannel.id, { type: newType })
      setChannels(prev => prev.map(ch => 
        ch.id === settingsChannel.id ? { ...ch, type: newType } : ch
      ))
      setSettingsChannel(null)
    } catch (err) {
      console.error('Failed to update channel:', err)
      alert('Не удалось обновить канал')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!disconnectChannelData) return
    setActionLoading(true)
    try {
      await disconnectChannel(disconnectChannelData.id)
      setChannels(prev => prev.map(ch => 
        ch.id === disconnectChannelData.id ? { ...ch, isActive: false } : ch
      ))
      setDisconnectChannelData(null)
    } catch (err) {
      console.error('Failed to disconnect channel:', err)
      alert('Не удалось отключить канал')
    } finally {
      setActionLoading(false)
    }
  }

  // Фильтрация и сортировка
  const filteredChannels = channels
    .filter(ch => {
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
      if (filterStatus === 'active') return ch.isActive
      if (filterStatus === 'inactive') return !ch.isActive
      if (filterStatus === 'awaiting') return ch.awaitingReply
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'messages') return (b.unreadCount || 0) - (a.unreadCount || 0)
      if (sortBy === 'unread') return (b.unreadCount || 0) - (a.unreadCount || 0)
      const dateA = new Date(a.lastMessageAt || 0).getTime()
      const dateB = new Date(b.lastMessageAt || 0).getTime()
      return dateB - dateA
    })

  // Статистика
  const stats = {
    total: channels.length,
    active: channels.filter(ch => ch.isActive).length,
    inactive: channels.filter(ch => !ch.isActive).length,
    awaiting: channels.filter(ch => ch.awaitingReply).length,
    totalUnread: channels.reduce((sum, ch) => sum + (ch.unreadCount || 0), 0),
  }

  const sortLabels: Record<SortBy, string> = {
    lastActivity: 'По активности',
    name: 'По названию',
    messages: 'По сообщениям',
    unread: 'По непрочитанным',
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Телеграм каналы</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Управление подключёнными каналами и группами
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadChannels}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
              title="Обновить"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          <StatCard
            icon={<MessageSquare className="w-5 h-5" />}
            label="Всего каналов"
            value={stats.total}
            color="blue"
          />
          <StatCard
            icon={<CheckCircle className="w-5 h-5" />}
            label="Активных"
            value={stats.active}
            color="green"
          />
          <StatCard
            icon={<XCircle className="w-5 h-5" />}
            label="Неактивных"
            value={stats.inactive}
            color="slate"
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5" />}
            label="Ждут ответа"
            value={stats.awaiting}
            color="orange"
          />
          <StatCard
            icon={<Activity className="w-5 h-5" />}
            label="Непрочитано"
            value={stats.totalUnread}
            color="purple"
          />
        </div>
      </div>

      {/* Filters Bar */}
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
          {(['all', 'active', 'inactive', 'awaiting'] as FilterStatus[]).map(status => {
            const labels: Record<FilterStatus, string> = {
              all: 'Все',
              active: 'Активные',
              inactive: 'Неактивные',
              awaiting: 'Ждут ответа',
            }
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filterStatus === status 
                    ? 'bg-blue-500 text-white' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {labels[status]}
              </button>
            )
          })}
        </div>

        {/* Sort */}
        <div className="relative" ref={sortMenuRef}>
          <button 
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors"
          >
            <Filter className="w-4 h-4 text-slate-400" />
            {sortLabels[sortBy]}
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 mt-2 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
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

        <div className="text-sm text-slate-500">
          Показано: {filteredChannels.length}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filteredChannels.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<MessageSquare className="w-12 h-12 text-slate-300" />}
              title="Каналы не найдены"
              description={search ? 'Попробуйте изменить параметры поиска' : 'Добавьте первый канал'}
              action={!search ? { label: 'Добавить канал', onClick: () => setShowAddModal(true) } : undefined}
            />
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Канал
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Статус
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Непрочитано
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Последнее сообщение
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Компания
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Тип
                </th>
                <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredChannels.map(channel => (
                <ChannelRow 
                  key={channel.id} 
                  channel={channel}
                  onSettings={() => handleOpenSettings(channel)}
                  onRename={() => handleOpenRename(channel)}
                  onDisconnect={() => setDisconnectChannelData(channel)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Channel Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Подключение канала"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Чтобы подключить Telegram канал или группу, выполните следующие шаги:
          </p>
          <div className="space-y-3">
            <Step number={1} text="Найдите бота @GFSupportBot в Telegram" />
            <Step number={2} text="Добавьте бота в вашу группу или канал" />
            <Step number={3} text="Назначьте бота администратором" />
            <Step number={4} text="Канал автоматически появится в списке" />
          </div>
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-700">
                Боту необходимы права администратора для чтения сообщений и отправки ответов.
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setShowAddModal(false)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
            >
              Понятно
            </button>
          </div>
        </div>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isOpen={!!renameChannel}
        onClose={() => setRenameChannel(null)}
        title="Переименовать канал"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Новое название
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
              placeholder="Введите название..."
              autoFocus
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setRenameChannel(null)}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm"
            >
              Отмена
            </button>
            <button
              onClick={handleRename}
              disabled={!newName.trim() || actionLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {actionLoading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Settings Modal */}
      <Modal
        isOpen={!!settingsChannel}
        onClose={() => setSettingsChannel(null)}
        title="Настройки канала"
      >
        {settingsChannel && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Avatar name={settingsChannel.name || ''} src={settingsChannel.photoUrl} size="lg" />
                <div>
                  <h3 className="font-medium text-slate-800">{settingsChannel.name}</h3>
                  <p className="text-sm text-slate-500">#{settingsChannel.telegramChatId}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Тип канала
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['client', 'partner', 'internal'] as const).map(type => {
                  const labels = {
                    client: { label: 'Клиент', color: 'blue' },
                    partner: { label: 'Партнёр', color: 'amber' },
                    internal: { label: 'Внутренний', color: 'slate' },
                  }
                  const info = labels[type]
                  return (
                    <button
                      key={type}
                      onClick={() => setNewType(type)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        newType === type
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {info.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSettingsChannel(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Отмена
              </button>
              <button
                onClick={handleUpdateType}
                disabled={newType === settingsChannel.type || actionLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {actionLoading ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Disconnect Confirmation */}
      <ConfirmDialog
        isOpen={!!disconnectChannelData}
        onClose={() => setDisconnectChannelData(null)}
        onConfirm={handleDisconnect}
        title="Отключить канал?"
        message={`Вы уверены, что хотите отключить канал "${disconnectChannelData?.name}"? Бот перестанет получать сообщения из этого канала.`}
        confirmText={actionLoading ? 'Отключение...' : 'Отключить'}
        cancelText="Отмена"
        variant="danger"
        isLoading={actionLoading}
      />
    </div>
  )
}

// Stat Card Component
function StatCard({ 
  icon, label, value, color 
}: { 
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'green' | 'slate' | 'orange' | 'purple'
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    slate: 'bg-slate-100 text-slate-500',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-semibold text-slate-800">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

// Step Component
function Step({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">
        {number}
      </div>
      <p className="text-sm text-slate-700">{text}</p>
    </div>
  )
}

// Channel Row Component
interface ChannelRowProps {
  channel: Channel
  onSettings: () => void
  onRename: () => void
  onDisconnect: () => void
}

function ChannelRow({ channel, onSettings, onRename, onDisconnect }: ChannelRowProps) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const typeLabels: Record<string, { label: string; variant: 'info' | 'warning' | 'default' }> = {
    client: { label: 'Клиент', variant: 'info' },
    partner: { label: 'Партнёр', variant: 'warning' },
    internal: { label: 'Внутренний', variant: 'default' },
  }

  const typeInfo = typeLabels[channel.type] || { label: channel.type, variant: 'default' as const }

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      {/* Channel Info */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar 
            src={channel.photoUrl} 
            name={channel.name || 'Канал'} 
            size="md" 
          />
          <div className="min-w-0">
            <div className="font-medium text-slate-800 truncate max-w-[200px]">
              {channel.name || 'Без названия'}
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Hash className="w-3 h-3" />
              <span className="truncate max-w-[150px]">{channel.telegramChatId}</span>
            </div>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-4 text-center">
        <div className="flex items-center justify-center gap-2">
          {channel.isActive ? (
            <Badge variant="success" size="sm">Активен</Badge>
          ) : (
            <Badge variant="default" size="sm">Неактивен</Badge>
          )}
          {channel.awaitingReply && (
            <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" title="Ждёт ответа" />
          )}
        </div>
      </td>

      {/* Unread */}
      <td className="px-4 py-4 text-center">
        {(channel.unreadCount || 0) > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-blue-500 text-white text-xs font-medium rounded-full">
            {channel.unreadCount}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>

      {/* Last Message */}
      <td className="px-4 py-4">
        {channel.lastMessageAt ? (
          <div className="min-w-0">
            <p className="text-sm text-slate-600 truncate max-w-[200px]">
              {channel.lastMessageText || 'Нет текста'}
            </p>
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(channel.lastMessageAt)}
            </p>
          </div>
        ) : (
          <span className="text-sm text-slate-400">Нет сообщений</span>
        )}
      </td>

      {/* Company */}
      <td className="px-4 py-4">
        {channel.companyName ? (
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-600 truncate max-w-[150px]">
              {channel.companyName}
            </span>
          </div>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </td>

      {/* Type */}
      <td className="px-4 py-4 text-center">
        <Badge variant={typeInfo.variant} size="sm">
          {typeInfo.label}
        </Badge>
      </td>

      {/* Actions */}
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            to={`/chats/${channel.id}`}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Открыть чат"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                <Link
                  to={`/chats/${channel.id}`}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                  Открыть чат
                </Link>
                <button 
                  onClick={() => { setShowMenu(false); onSettings() }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  Настройки
                </button>
                <button 
                  onClick={() => { setShowMenu(false); onRename() }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <Edit3 className="w-4 h-4 text-slate-400" />
                  Переименовать
                </button>
                <div className="border-t border-slate-100" />
                <button 
                  onClick={() => { setShowMenu(false); onDisconnect() }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <Power className="w-4 h-4" />
                  Отключить
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

// Helper
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
