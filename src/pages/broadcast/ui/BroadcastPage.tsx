import { useState, useEffect, useCallback } from 'react'
import { Plus, Send, Clock, Users, CheckCircle, XCircle, Eye, Trash2, Calendar, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { fetchBroadcasts, createBroadcast, cancelBroadcast, type ScheduledBroadcast } from '@/shared/api'

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
  partners: 'Партнеры',
  selected: 'Выбранные',
}

export function BroadcastPage() {
  const [broadcasts, setBroadcasts] = useState<ScheduledBroadcast[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedBroadcast, setSelectedBroadcast] = useState<ScheduledBroadcast | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [isSaving, setIsSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    messageText: '',
    filterType: 'all',
    scheduledAt: '',
  })

  const loadBroadcasts = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await fetchBroadcasts()
      setBroadcasts(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки рассылок')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBroadcasts()
  }, [loadBroadcasts])

  const filteredBroadcasts = statusFilter === 'all' 
    ? broadcasts 
    : broadcasts.filter(b => b.status === statusFilter)

  const totalSent = broadcasts.filter(b => b.status === 'sent').length
  const pendingCount = broadcasts.filter(b => b.status === 'pending').length

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.messageText.trim() || !formData.scheduledAt) return

    try {
      setIsSaving(true)
      await createBroadcast({
        messageText: formData.messageText,
        filterType: formData.filterType,
        scheduledAt: formData.scheduledAt,
      })
      setIsCreateModalOpen(false)
      setFormData({ messageText: '', filterType: 'all', scheduledAt: '' })
      await loadBroadcasts()
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
      await loadBroadcasts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отмены рассылки')
    } finally {
      setIsSaving(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
        {/* Error */}
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
            <button 
              onClick={loadBroadcasts}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Новая рассылка
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Send className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{broadcasts.length}</p>
                <p className="text-sm text-slate-500">Всего рассылок</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalSent}</p>
                <p className="text-sm text-slate-500">Отправлено</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{pendingCount}</p>
                <p className="text-sm text-slate-500">Запланировано</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">—</p>
                <p className="text-sm text-slate-500">Получателей</p>
              </div>
            </div>
          </div>
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
              {status === 'all' ? 'Все' : statusConfig[status as keyof typeof statusConfig]?.label}
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
            {filteredBroadcasts.map(broadcast => {
              const config = statusConfig[broadcast.status] || defaultStatusConfig
              const StatusIcon = config.icon
              
              return (
                <div 
                  key={broadcast.id}
                  className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {config.label}
                        </span>
                        <span className="text-sm text-slate-500">
                          {filterLabels[broadcast.filterType] || broadcast.filterType}
                        </span>
                      </div>
                      
                      <p className="text-sm text-slate-600 line-clamp-2 mb-3">{broadcast.messageText}</p>
                      
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

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-4">
                      <button 
                        onClick={() => { setSelectedBroadcast(broadcast); setIsViewModalOpen(true) }}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4 text-slate-500" />
                      </button>
                      {broadcast.status === 'pending' && (
                        <button 
                          onClick={() => { setSelectedBroadcast(broadcast); setIsDeleteDialogOpen(true) }}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новая рассылка" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Сообщение</label>
            <textarea
              placeholder="Введите текст сообщения..."
              rows={4}
              value={formData.messageText}
              onChange={(e) => setFormData(prev => ({ ...prev, messageText: e.target.value }))}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Аудитория</label>
            <select 
              value={formData.filterType}
              onChange={(e) => setFormData(prev => ({ ...prev, filterType: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">Все каналы</option>
              <option value="clients">Только клиенты</option>
              <option value="partners">Только партнеры</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Запланировать на</label>
            <input
              type="datetime-local"
              value={formData.scheduledAt}
              onChange={(e) => setFormData(prev => ({ ...prev, scheduledAt: e.target.value }))}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button 
              type="button" 
              onClick={() => setIsCreateModalOpen(false)} 
              className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100"
              disabled={isSaving}
            >
              Отмена
            </button>
            <button 
              type="submit" 
              className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
              disabled={isSaving}
            >
              {isSaving ? 'Создание...' : 'Запланировать'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Детали рассылки" size="md">
        {selectedBroadcast && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500">Статус</p>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${(statusConfig[selectedBroadcast.status] || defaultStatusConfig).color}`}>
                {(statusConfig[selectedBroadcast.status] || defaultStatusConfig).label}
              </span>
            </div>
            <div>
              <p className="text-sm text-slate-500">Сообщение</p>
              <p className="text-slate-800 whitespace-pre-wrap">{selectedBroadcast.messageText}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500">Аудитория</p>
                <p className="font-medium text-slate-800">{filterLabels[selectedBroadcast.filterType] || selectedBroadcast.filterType}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Запланировано</p>
                <p className="font-medium text-slate-800">{formatDate(selectedBroadcast.scheduledAt)}</p>
              </div>
            </div>
            {selectedBroadcast.sentAt && (
              <div>
                <p className="text-sm text-slate-500">Отправлено</p>
                <p className="font-medium text-green-600">{formatDate(selectedBroadcast.sentAt)}</p>
              </div>
            )}
            {selectedBroadcast.errorMessage && (
              <div>
                <p className="text-sm text-slate-500">Ошибка</p>
                <p className="font-medium text-red-600">{selectedBroadcast.errorMessage}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Cancel Dialog */}
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
