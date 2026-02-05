import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  Plus, Send, Clock, Users, CheckCircle, XCircle, Eye, Trash2, Calendar, 
  Loader2, RefreshCw, AlertCircle, Search, Paperclip, X, Megaphone, 
  Newspaper, Bell, Bot, User, MessageSquare, BarChart3
} from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { fetchBroadcasts, createBroadcast, cancelBroadcast, type ScheduledBroadcast, fetchChannels, fetchAgents } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Agent } from '@/entities/agent'

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Ожидает', color: 'bg-blue-100 text-blue-700', icon: Clock },
  sending: { label: 'Отправляется', color: 'bg-amber-100 text-amber-700', icon: Loader2 },
  sent: { label: 'Отправлено', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  cancelled: { label: 'Отменено', color: 'bg-slate-100 text-slate-600', icon: XCircle },
  failed: { label: 'Ошибка', color: 'bg-red-100 text-red-700', icon: XCircle },
}

const defaultStatusConfig = { label: 'Неизвестно', color: 'bg-slate-100 text-slate-600', icon: AlertCircle }

const filterLabels: Record<string, string> = {
  all: 'Все каналы',
  clients: 'Клиенты',
  partners: 'Партнёры',
  selected: 'Выбранные',
}

const notificationTypes = [
  { id: 'announcement', label: 'Объявление', icon: Megaphone, color: 'text-blue-600' },
  { id: 'news', label: 'Новости', icon: Newspaper, color: 'text-green-600' },
  { id: 'update', label: 'Обновление', icon: RefreshCw, color: 'text-purple-600' },
  { id: 'alert', label: 'Важное', icon: Bell, color: 'text-red-600' },
]

interface FormData {
  messageText: string
  notificationType: string
  filterType: string
  selectedChannels: string[]
  scheduledAt: string
  senderType: 'ai' | 'agent'
  senderId: string
  mediaUrl: string
}

export function BroadcastPage() {
  const [broadcasts, setBroadcasts] = useState<ScheduledBroadcast[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedBroadcast, setSelectedBroadcast] = useState<ScheduledBroadcast | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [isSaving, setIsSaving] = useState(false)
  const [channelSearch, setChannelSearch] = useState('')

  const [formData, setFormData] = useState<FormData>({
    messageText: '',
    notificationType: 'announcement',
    filterType: 'all',
    selectedChannels: [],
    scheduledAt: '',
    senderType: 'ai',
    senderId: '',
    mediaUrl: '',
  })

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const [broadcastsData, channelsData, agentsData] = await Promise.all([
        fetchBroadcasts(),
        fetchChannels(),
        fetchAgents()
      ])
      setBroadcasts(broadcastsData)
      setChannels(channelsData)
      setAgents(agentsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredBroadcasts = statusFilter === 'all' 
    ? broadcasts 
    : broadcasts.filter(b => b.status === statusFilter)

  const totalSent = broadcasts.filter(b => b.status === 'sent').length
  const pendingCount = broadcasts.filter(b => b.status === 'pending').length
  const totalRecipients = broadcasts.reduce((acc, b) => acc + (b.recipientsCount || 0), 0)

  // Фильтрация каналов для выбора
  const filteredChannels = useMemo(() => {
    let result = channels
    if (channelSearch) {
      const search = channelSearch.toLowerCase()
      result = result.filter(ch => ch.name?.toLowerCase().includes(search))
    }
    return result.slice(0, 50) // Лимит для производительности
  }, [channels, channelSearch])

  // Каналы по категориям
  const channelsByCategory = useMemo(() => ({
    clients: channels.filter(ch => ch.type === 'client'),
    partners: channels.filter(ch => ch.type === 'partner'),
  }), [channels])

  const resetForm = () => {
    setFormData({
      messageText: '',
      notificationType: 'announcement',
      filterType: 'all',
      selectedChannels: [],
      scheduledAt: '',
      senderType: 'ai',
      senderId: '',
      mediaUrl: '',
    })
    setChannelSearch('')
  }

  const handleCreate = async (sendNow: boolean) => {
    if (!formData.messageText.trim()) return
    if (!sendNow && !formData.scheduledAt) {
      setError('Выберите дату и время для отправки')
      return
    }

    try {
      setIsSaving(true)
      const selectedAgent = agents.find(a => a.id === formData.senderId)
      
      await createBroadcast({
        messageText: formData.messageText,
        notificationType: formData.notificationType,
        filterType: formData.filterType,
        selectedChannels: formData.filterType === 'selected' ? formData.selectedChannels : undefined,
        scheduledAt: sendNow ? undefined : formData.scheduledAt,
        sendNow,
        senderType: formData.senderType,
        senderId: formData.senderType === 'agent' ? formData.senderId : undefined,
        senderName: formData.senderType === 'agent' ? selectedAgent?.name : 'AI Помощник',
        mediaUrl: formData.mediaUrl || undefined,
      })
      setIsCreateModalOpen(false)
      resetForm()
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка создания рассылки')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!selectedBroadcast) return
    try {
      setIsSaving(true)
      await cancelBroadcast(selectedBroadcast.id)
      setIsDeleteDialogOpen(false)
      setSelectedBroadcast(null)
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отмены рассылки')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleChannel = (channelId: string) => {
    setFormData(prev => ({
      ...prev,
      selectedChannels: prev.selectedChannels.includes(channelId)
        ? prev.selectedChannels.filter(id => id !== channelId)
        : [...prev.selectedChannels, channelId]
    }))
  }

  const selectAllByCategory = (category: 'clients' | 'partners') => {
    const categoryChannels = channelsByCategory[category]
    setFormData(prev => ({
      ...prev,
      selectedChannels: [...new Set([...prev.selectedChannels, ...categoryChannels.map(ch => ch.id)])]
    }))
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-600">Загрузка рассылок...</span>
      </div>
    )
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Рассылки</h1>
            <p className="text-slate-500 mt-1">Массовая отправка сообщений клиентам</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              <Plus className="w-4 h-4" />
              Новая рассылка
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Send} color="blue" value={broadcasts.length} label="Всего рассылок" />
          <StatCard icon={CheckCircle} color="green" value={totalSent} label="Отправлено" />
          <StatCard icon={Clock} color="amber" value={pendingCount} label="Запланировано" />
          <StatCard icon={Users} color="purple" value={totalRecipients} label="Получателей" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {['all', 'pending', 'sent', 'cancelled', 'failed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              {status === 'all' ? 'Все' : statusConfig[status]?.label}
            </button>
          ))}
        </div>

        {/* Broadcasts List */}
        {filteredBroadcasts.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Send className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Нет рассылок</p>
            <p className="text-sm mt-1">Создайте первую рассылку</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBroadcasts.map(broadcast => (
              <BroadcastCard 
                key={broadcast.id}
                broadcast={broadcast}
                onView={() => { setSelectedBroadcast(broadcast); setIsViewModalOpen(true) }}
                onCancel={() => { setSelectedBroadcast(broadcast); setIsDeleteDialogOpen(true) }}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => { setIsCreateModalOpen(false); resetForm() }} title="Новая рассылка" size="xl">
        <div className="space-y-5">
          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Сообщение</label>
            <textarea
              placeholder="Введите текст сообщения..."
              rows={4}
              value={formData.messageText}
              onChange={(e) => setFormData(prev => ({ ...prev, messageText: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>

          {/* Media */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Вложение (URL)</label>
            <div className="relative">
              <Paperclip className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="url"
                placeholder="https://example.com/image.jpg"
                value={formData.mediaUrl}
                onChange={(e) => setFormData(prev => ({ ...prev, mediaUrl: e.target.value }))}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* Notification Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Тип уведомления</label>
            <div className="flex gap-2">
              {notificationTypes.map(type => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, notificationType: type.id }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    formData.notificationType === type.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <type.icon className={`w-4 h-4 ${type.color}`} />
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Аудитория</label>
            <div className="flex gap-2 mb-3">
              {(['all', 'clients', 'partners', 'selected'] as const).map(filter => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, filterType: filter, selectedChannels: [] }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    formData.filterType === filter
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {filterLabels[filter]}
                  {filter !== 'all' && filter !== 'selected' && (
                    <span className="ml-1 text-xs opacity-60">({channelsByCategory[filter]?.length || 0})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Channel Selection */}
            {formData.filterType === 'selected' && (
              <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Поиск каналов..."
                      value={channelSearch}
                      onChange={(e) => setChannelSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => selectAllByCategory('clients')}
                    className="px-3 py-2 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                  >
                    + Клиенты
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAllByCategory('partners')}
                    className="px-3 py-2 text-xs bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100"
                  >
                    + Партнёры
                  </button>
                </div>

                {formData.selectedChannels.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.selectedChannels.map(id => {
                      const ch = channels.find(c => c.id === id)
                      return ch ? (
                        <span key={id} className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                          {ch.name}
                          <button type="button" onClick={() => toggleChannel(id)}>
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}

                <div className="max-h-40 overflow-y-auto space-y-1">
                  {filteredChannels.map(channel => (
                    <label
                      key={channel.id}
                      className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.selectedChannels.includes(channel.id)}
                        onChange={() => toggleChannel(channel.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm">{channel.name}</span>
                      <span className="text-xs text-slate-400 ml-auto">{channel.type}</span>
                    </label>
                  ))}
                </div>
                
                <p className="text-xs text-slate-500">
                  Выбрано: {formData.selectedChannels.length} канал(ов)
                </p>
              </div>
            )}
          </div>

          {/* Sender */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Отправитель</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, senderType: 'ai', senderId: '' }))}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
                  formData.senderType === 'ai'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Bot className="w-4 h-4" />
                AI Помощник
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, senderType: 'agent' }))}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
                  formData.senderType === 'agent'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <User className="w-4 h-4" />
                Сотрудник
              </button>
            </div>
            
            {formData.senderType === 'agent' && (
              <select
                value={formData.senderId}
                onChange={(e) => setFormData(prev => ({ ...prev, senderId: e.target.value }))}
                className="mt-2 w-full px-4 py-2.5 border border-slate-200 rounded-lg"
              >
                <option value="">Выберите сотрудника</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Запланировать на</label>
            <input
              type="datetime-local"
              value={formData.scheduledAt}
              onChange={(e) => setFormData(prev => ({ ...prev, scheduledAt: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button 
              type="button" 
              onClick={() => { setIsCreateModalOpen(false); resetForm() }}
              className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100"
              disabled={isSaving}
            >
              Отмена
            </button>
            <button 
              type="button"
              onClick={() => handleCreate(true)}
              className="px-6 py-2.5 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
              disabled={isSaving || !formData.messageText.trim()}
            >
              <Send className="w-4 h-4" />
              {isSaving ? 'Отправка...' : 'Отправить сейчас'}
            </button>
            <button 
              type="button"
              onClick={() => handleCreate(false)}
              className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
              disabled={isSaving || !formData.messageText.trim() || !formData.scheduledAt}
            >
              <Calendar className="w-4 h-4" />
              {isSaving ? 'Создание...' : 'Запланировать'}
            </button>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Детали рассылки" size="lg">
        {selectedBroadcast && <BroadcastDetails broadcast={selectedBroadcast} formatDate={formatDate} />}
      </Modal>

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleCancel}
        title="Отменить рассылку"
        message="Вы уверены, что хотите отменить эту запланированную рассылку?"
        confirmText="Отменить"
        variant="danger"
      />
    </>
  )
}

// Sub-components
function StatCard({ icon: Icon, color, value, label }: { icon: typeof Send; color: string; value: number; label: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    purple: 'bg-purple-100 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-800">{value}</p>
          <p className="text-sm text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function BroadcastCard({ broadcast, onView, onCancel, formatDate }: {
  broadcast: ScheduledBroadcast
  onView: () => void
  onCancel: () => void
  formatDate: (date: string | null) => string
}) {
  const config = statusConfig[broadcast.status] || defaultStatusConfig
  const StatusIcon = config.icon

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
              <StatusIcon className={`w-3.5 h-3.5 ${broadcast.status === 'sending' ? 'animate-spin' : ''}`} />
              {config.label}
            </span>
            <span className="text-sm text-slate-500">{filterLabels[broadcast.filterType] || broadcast.filterType}</span>
            {broadcast.senderName && (
              <span className="text-sm text-slate-400">от {broadcast.senderName}</span>
            )}
          </div>
          
          <p className="text-sm text-slate-600 line-clamp-2 mb-3">{broadcast.messageText}</p>
          
          {/* Analytics Row */}
          <div className="flex items-center gap-4 text-sm mb-2">
            <div className="flex items-center gap-1.5 text-slate-500">
              <Users className="w-4 h-4" />
              <span>{broadcast.recipientsCount || 0} получ.</span>
            </div>
            {broadcast.status === 'sent' && (
              <>
                <div className="flex items-center gap-1.5 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>{broadcast.deliveredCount || 0} доставл.</span>
                </div>
                <div className="flex items-center gap-1.5 text-blue-600">
                  <Eye className="w-4 h-4" />
                  <span>{broadcast.viewedCount || 0} просм.</span>
                </div>
                <div className="flex items-center gap-1.5 text-purple-600">
                  <MessageSquare className="w-4 h-4" />
                  <span>{broadcast.reactionCount || 0} реакц.</span>
                </div>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-6 text-sm text-slate-500">
            {broadcast.status === 'pending' && broadcast.scheduledAt && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                <span>Запланировано: {formatDate(broadcast.scheduledAt)}</span>
              </div>
            )}
            {broadcast.sentAt && (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" />
                <span>Отправлено: {formatDate(broadcast.sentAt)}</span>
              </div>
            )}
            <span>Создано: {formatDate(broadcast.createdAt)}</span>
          </div>

          {broadcast.errorMessage && (
            <p className="text-sm text-red-600 mt-2">{broadcast.errorMessage}</p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button onClick={onView} className="p-2 hover:bg-slate-100 rounded-lg">
            <BarChart3 className="w-4 h-4 text-slate-500" />
          </button>
          {broadcast.status === 'pending' && (
            <button onClick={onCancel} className="p-2 hover:bg-red-50 rounded-lg">
              <Trash2 className="w-4 h-4 text-red-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BroadcastDetails({ broadcast, formatDate }: { broadcast: ScheduledBroadcast; formatDate: (date: string | null) => string }) {
  const config = statusConfig[broadcast.status] || defaultStatusConfig
  
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full ${config.color}`}>
          {config.label}
        </span>
        {broadcast.senderName && (
          <span className="text-sm text-slate-500">Отправитель: {broadcast.senderName}</span>
        )}
      </div>

      <div>
        <p className="text-sm text-slate-500 mb-1">Сообщение</p>
        <p className="text-slate-800 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg">{broadcast.messageText}</p>
      </div>

      {broadcast.mediaUrl && (
        <div>
          <p className="text-sm text-slate-500 mb-1">Вложение</p>
          <a href={broadcast.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm">
            {broadcast.mediaUrl}
          </a>
        </div>
      )}

      {/* Analytics */}
      <div className="bg-slate-50 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-700 mb-3">Статистика</p>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-800">{broadcast.recipientsCount || 0}</p>
            <p className="text-xs text-slate-500">Получателей</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{broadcast.deliveredCount || 0}</p>
            <p className="text-xs text-slate-500">Доставлено</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{broadcast.viewedCount || 0}</p>
            <p className="text-xs text-slate-500">Просмотрено</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">{broadcast.reactionCount || 0}</p>
            <p className="text-xs text-slate-500">Реакций</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-slate-500">Аудитория</p>
          <p className="font-medium text-slate-800">{filterLabels[broadcast.filterType] || broadcast.filterType}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Тип</p>
          <p className="font-medium text-slate-800 capitalize">{broadcast.notificationType || 'Объявление'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-slate-500">Создано</p>
          <p className="font-medium text-slate-800">{formatDate(broadcast.createdAt)}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">{broadcast.sentAt ? 'Отправлено' : 'Запланировано'}</p>
          <p className="font-medium text-slate-800">{formatDate(broadcast.sentAt || broadcast.scheduledAt)}</p>
        </div>
      </div>

      {broadcast.errorMessage && (
        <div className="bg-red-50 p-3 rounded-lg">
          <p className="text-sm text-red-600">{broadcast.errorMessage}</p>
        </div>
      )}
    </div>
  )
}
