import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Mail, Calendar, Shield, Edit, Trash2, Eye, Building2, MessageSquare, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { fetchUsers, createUser, updateUser, deleteUser, type User, type UsersResponse } from '@/shared/api'

const roleConfig = {
  client: { label: 'Клиент', color: 'bg-slate-100 text-slate-700' },
  employee: { label: 'Сотрудник', color: 'bg-blue-100 text-blue-700' },
  partner: { label: 'Партнер', color: 'bg-amber-100 text-amber-700' },
}

interface UsersPageProps {
  embedded?: boolean
}

export function UsersPage({ embedded = false }: UsersPageProps) {
  const [users, setUsers] = useState<User[]>([])
  const [stats, setStats] = useState<UsersResponse['stats'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  // Form state for create/edit
  const [formData, setFormData] = useState({
    telegramId: '',
    telegramUsername: '',
    name: '',
    role: 'client' as 'client' | 'employee' | 'partner',
    department: '',
    position: '',
    notes: ''
  })

  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const params: { role?: string; search?: string; metrics?: boolean } = {}
      if (roleFilter !== 'all') params.role = roleFilter
      if (searchQuery.trim()) params.search = searchQuery.trim()
      params.metrics = true
      
      const response = await fetchUsers(params)
      setUsers(response.users)
      setStats(response.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки пользователей')
    } finally {
      setIsLoading(false)
    }
  }, [roleFilter, searchQuery])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers()
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const filteredUsers = users.filter(user => {
    if (searchQuery && roleFilter === 'all') return true // Already filtered by API
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    return matchesRole
  })

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.telegramId || !formData.name) return
    
    try {
      setIsSaving(true)
      await createUser({
        telegramId: parseInt(formData.telegramId),
        telegramUsername: formData.telegramUsername || undefined,
        name: formData.name,
      })
      setIsCreateModalOpen(false)
      resetForm()
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка создания пользователя')
    } finally {
      setIsSaving(false)
    }
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    
    try {
      setIsSaving(true)
      await updateUser({
        id: selectedUser.id,
        role: formData.role,
        department: formData.department || undefined,
        position: formData.position || undefined,
        notes: formData.notes || undefined,
      })
      setIsEditModalOpen(false)
      setSelectedUser(null)
      resetForm()
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка обновления пользователя')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return
    
    try {
      setIsSaving(true)
      await deleteUser(selectedUser.id)
      setIsDeleteDialogOpen(false)
      setSelectedUser(null)
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления пользователя')
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setFormData({
      telegramId: '',
      telegramUsername: '',
      name: '',
      role: 'client',
      department: '',
      position: '',
      notes: ''
    })
  }

  const openEditModal = (user: User) => {
    setSelectedUser(user)
    setFormData({
      telegramId: user.telegramId?.toString() || '',
      telegramUsername: user.telegramUsername || '',
      name: user.name,
      role: user.role,
      department: user.department || '',
      position: user.position || '',
      notes: user.notes || ''
    })
    setIsEditModalOpen(true)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatLastSeen = (dateStr?: string) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 1) return 'Только что'
    if (diffMins < 60) return `${diffMins} мин. назад`
    if (diffHours < 24) return `${diffHours} ч. назад`
    if (diffDays < 7) return `${diffDays} дн. назад`
    return formatDate(dateStr)
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        {!embedded ? (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Пользователи</h1>
              <p className="text-slate-500 mt-1">Управление базой клиентов и сотрудников</p>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={loadUsers}
                disabled={isLoading}
                className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button 
                onClick={() => { resetForm(); setIsCreateModalOpen(true) }}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <button 
              onClick={loadUsers}
              disabled={isLoading}
              className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={() => { resetForm(); setIsCreateModalOpen(true) }}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Всего пользователей" value={stats?.total || 0} isLoading={isLoading} />
          <StatCard label="Клиенты" value={stats?.byRole?.client || 0} color="text-slate-600" isLoading={isLoading} />
          <StatCard label="Сотрудники" value={stats?.byRole?.employee || 0} color="text-blue-600" isLoading={isLoading} />
          <StatCard label="Партнеры" value={stats?.byRole?.partner || 0} color="text-amber-600" isLoading={isLoading} />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск пользователей..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">Все роли</option>
            <option value="client">Клиенты</option>
            <option value="employee">Сотрудники</option>
            <option value="partner">Партнеры</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {isLoading && users.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Search className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">Пользователи не найдены</p>
              <p className="text-sm">Попробуйте изменить параметры поиска</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Пользователь</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Telegram</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Роль</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Каналы</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Последняя активность</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.photoUrl ? (
                          <img 
                            src={user.photoUrl} 
                            alt={user.name}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
                            {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-slate-800">{user.name}</p>
                          {user.position && (
                            <p className="text-sm text-slate-500">{user.position}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.telegramUsername ? (
                        <span className="text-sm text-blue-600">@{user.telegramUsername}</span>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${roleConfig[user.role]?.color || 'bg-slate-100 text-slate-700'}`}>
                        {roleConfig[user.role]?.label || user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {user.channels?.length || 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {formatLastSeen(user.lastSeenAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => { setSelectedUser(user); setIsViewModalOpen(true) }}
                          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Просмотр"
                        >
                          <Eye className="w-4 h-4 text-slate-500" />
                        </button>
                        <button 
                          onClick={() => openEditModal(user)}
                          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Редактировать"
                        >
                          <Edit className="w-4 h-4 text-slate-500" />
                        </button>
                        <button 
                          onClick={() => { setSelectedUser(user); setIsDeleteDialogOpen(true) }}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Информация о пользователе" size="md">
        {selectedUser && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              {selectedUser.photoUrl ? (
                <img 
                  src={selectedUser.photoUrl} 
                  alt={selectedUser.name}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-medium">
                  {selectedUser.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{selectedUser.name}</h3>
                <p className="text-slate-500">{selectedUser.position || selectedUser.department || roleConfig[selectedUser.role]?.label}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InfoItem icon={MessageSquare} label="Telegram" value={selectedUser.telegramUsername ? `@${selectedUser.telegramUsername}` : 'Не указан'} />
              <InfoItem icon={Shield} label="Роль" value={roleConfig[selectedUser.role]?.label || selectedUser.role} />
              <InfoItem icon={Building2} label="Отдел" value={selectedUser.department || 'Не указан'} />
              <InfoItem icon={Calendar} label="Добавлен" value={formatDate(selectedUser.firstSeenAt)} />
            </div>

            {selectedUser.notes && (
              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs text-slate-500 mb-2">Заметки</p>
                <p className="text-sm text-slate-700">{selectedUser.notes}</p>
              </div>
            )}

            {selectedUser.channels && selectedUser.channels.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs text-slate-500 mb-2">Каналы ({selectedUser.channels.length})</p>
                <div className="flex flex-wrap gap-2">
                  {selectedUser.channels.map((channel, idx) => (
                    <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded-full">
                      {channel.name || channel.id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedUser.calculatedMetrics && (
              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs text-slate-500 mb-2">Метрики (за 30 дней)</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className="text-xl font-bold text-slate-800">{selectedUser.calculatedMetrics.total_messages || 0}</p>
                    <p className="text-xs text-slate-500">Сообщений</p>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className="text-xl font-bold text-slate-800">{selectedUser.calculatedMetrics.responses || 0}</p>
                    <p className="text-xs text-slate-500">Ответов</p>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className="text-xl font-bold text-slate-800">
                      {selectedUser.calculatedMetrics.avg_response_time_min 
                        ? `${Math.round(selectedUser.calculatedMetrics.avg_response_time_min)} мин`
                        : '-'
                      }
                    </p>
                    <p className="text-xs text-slate-500">Ср. время ответа</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <button 
                onClick={() => { setIsViewModalOpen(false); openEditModal(selectedUser) }}
                className="flex-1 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors"
              >
                Редактировать
              </button>
              <button 
                onClick={() => setIsViewModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Добавить пользователя" size="md">
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Telegram ID *</label>
            <input
              type="number"
              value={formData.telegramId}
              onChange={(e) => setFormData(prev => ({ ...prev, telegramId: e.target.value }))}
              placeholder="Например: 123456789"
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Имя *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Имя пользователя"
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Telegram Username</label>
            <input
              type="text"
              value={formData.telegramUsername}
              onChange={(e) => setFormData(prev => ({ ...prev, telegramUsername: e.target.value }))}
              placeholder="@username"
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
              {isSaving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Редактировать пользователя" size="md">
        {selectedUser && (
          <form onSubmit={handleUpdateUser} className="space-y-4">
            <div className="flex items-center gap-4 pb-4 border-b border-slate-200">
              {selectedUser.photoUrl ? (
                <img 
                  src={selectedUser.photoUrl} 
                  alt={selectedUser.name}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
                  {selectedUser.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
              )}
              <div>
                <p className="font-medium text-slate-800">{selectedUser.name}</p>
                {selectedUser.telegramUsername && (
                  <p className="text-sm text-blue-600">@{selectedUser.telegramUsername}</p>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as 'client' | 'employee' | 'partner' }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="client">Клиент</option>
                <option value="employee">Сотрудник</option>
                <option value="partner">Партнер</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Отдел</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                  placeholder="Название отдела"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Должность</label>
                <input
                  type="text"
                  value={formData.position}
                  onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                  placeholder="Должность"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Заметки</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Дополнительная информация о пользователе"
                rows={3}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button 
                type="button" 
                onClick={() => setIsEditModalOpen(false)} 
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
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteUser}
        title="Удаление пользователя"
        message={`Вы уверены, что хотите удалить пользователя ${selectedUser?.name}? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </>
  )
}

function StatCard({ label, value, color = 'text-slate-800', isLoading = false }: { label: string; value: number; color?: string; isLoading?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      {isLoading ? (
        <div className="h-9 mt-1 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      )}
    </div>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}
