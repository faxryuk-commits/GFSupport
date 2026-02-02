import { useState } from 'react'
import { MessageSquare, RefreshCw } from 'lucide-react'
import type { SupportUser, UsersStats, UserMetrics } from './types'

interface UsersTabProps {
  chatUsers: SupportUser[]
  usersStats: UsersStats
  loading: boolean
  onUpdateUserRole: (userId: string, role: 'employee' | 'partner' | 'client') => void
  onUpdateUserDetails: (userId: string, details: { department?: string; position?: string; notes?: string }) => void
  onLoadUserMetrics: (telegramId: number) => Promise<UserMetrics | null>
}

export function UsersTab({
  chatUsers,
  usersStats,
  loading,
  onUpdateUserRole,
  onUpdateUserDetails,
  onLoadUserMetrics,
}: UsersTabProps) {
  const [usersFilter, setUsersFilter] = useState<'all' | 'employee' | 'partner' | 'client'>('all')
  const [selectedUser, setSelectedUser] = useState<SupportUser | null>(null)
  const [userMetrics, setUserMetrics] = useState<UserMetrics | null>(null)
  const [loadingUserMetrics, setLoadingUserMetrics] = useState(false)

  const handleSelectUser = async (user: SupportUser) => {
    setSelectedUser(user)
    if (user.role === 'employee') {
      setLoadingUserMetrics(true)
      const metrics = await onLoadUserMetrics(user.telegramId)
      setUserMetrics(metrics)
      setLoadingUserMetrics(false)
    } else {
      setUserMetrics(null)
    }
  }

  const handleLoadMetrics = async (user: SupportUser) => {
    setSelectedUser(user)
    setLoadingUserMetrics(true)
    const metrics = await onLoadUserMetrics(user.telegramId)
    setUserMetrics(metrics)
    setLoadingUserMetrics(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Left: Users List */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-medium text-slate-800">Пользователи</h2>
            <p className="text-sm text-slate-500">
              Все участники чатов • {usersStats.total} всего • {usersStats.byRole?.employee || 0} сотрудников
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          {(['all', 'employee', 'partner', 'client'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setUsersFilter(filter)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                usersFilter === filter
                  ? 'bg-brand-blue text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter === 'all' ? 'Все' : 
               filter === 'employee' ? `Сотрудники (${usersStats.byRole?.employee || 0})` :
               filter === 'partner' ? `Партнёры (${usersStats.byRole?.partner || 0})` :
               `Клиенты (${usersStats.byRole?.client || 0})`}
            </button>
          ))}
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Пользователь</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Роль</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Каналы</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Последняя активность</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {chatUsers
                .filter(u => usersFilter === 'all' || u.role === usersFilter)
                .map(user => (
                  <tr 
                    key={user.id} 
                    className={`hover:bg-slate-50 cursor-pointer ${selectedUser?.id === user.id ? 'bg-blue-50' : ''}`}
                    onClick={() => handleSelectUser(user)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.photoUrl ? (
                          <img src={user.photoUrl} alt="" className="w-8 h-8 rounded-full" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-sm font-medium">
                            {user.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-slate-800">{user.name}</div>
                          {user.telegramUsername && (
                            <div className="text-xs text-slate-500">@{user.telegramUsername}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => onUpdateUserRole(user.id, e.target.value as any)}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer ${
                          user.role === 'employee' ? 'bg-green-100 text-green-700' :
                          user.role === 'partner' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <option value="client">Клиент</option>
                        <option value="employee">Сотрудник</option>
                        <option value="partner">Партнёр</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.channels.slice(0, 2).map((ch, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {ch.name?.slice(0, 15) || 'Канал'}
                          </span>
                        ))}
                        {user.channels.length > 2 && (
                          <span className="text-xs text-slate-400">+{user.channels.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(user.lastSeenAt).toLocaleDateString('ru')}
                    </td>
                    <td className="px-4 py-3">
                      {user.role === 'employee' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleLoadMetrics(user)
                          }}
                          className="text-xs text-brand-blue hover:underline"
                        >
                          Метрики
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          
          {chatUsers.filter(u => usersFilter === 'all' || u.role === usersFilter).length === 0 && (
            <div className="text-center py-12 text-slate-500">
              Пользователи не найдены
            </div>
          )}
        </div>
      </div>

      {/* Right: User Details / Metrics */}
      {selectedUser && (
        <div className="w-80 shrink-0">
          <div className="bg-white rounded-xl shadow-sm p-4 sticky top-4">
            <div className="flex items-center gap-3 mb-4">
              {selectedUser.photoUrl ? (
                <img src={selectedUser.photoUrl} alt="" className="w-12 h-12 rounded-full" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-lg font-medium">
                  {selectedUser.name.charAt(0)}
                </div>
              )}
              <div>
                <div className="font-medium text-slate-800">{selectedUser.name}</div>
                {selectedUser.telegramUsername && (
                  <div className="text-sm text-slate-500">@{selectedUser.telegramUsername}</div>
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${
                  selectedUser.role === 'employee' ? 'bg-green-100 text-green-700' :
                  selectedUser.role === 'partner' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {selectedUser.role === 'employee' ? 'Сотрудник' :
                   selectedUser.role === 'partner' ? 'Партнёр' : 'Клиент'}
                </span>
              </div>
            </div>

            {/* Department & Position */}
            {selectedUser.role === 'employee' && (
              <div className="mb-4 space-y-2">
                <input
                  type="text"
                  placeholder="Отдел"
                  defaultValue={selectedUser.department || ''}
                  onBlur={(e) => onUpdateUserDetails(selectedUser.id, { department: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Должность"
                  defaultValue={selectedUser.position || ''}
                  onBlur={(e) => onUpdateUserDetails(selectedUser.id, { position: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
            )}

            {/* Channels */}
            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-2">Каналы ({selectedUser.channels.length})</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {selectedUser.channels.map((ch, i) => (
                  <div key={i} className="text-sm text-slate-700 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3 text-slate-400" />
                    {ch.name || 'Канал'}
                  </div>
                ))}
              </div>
            </div>

            {/* Employee Metrics */}
            {selectedUser.role === 'employee' && (
              <>
                {loadingUserMetrics ? (
                  <div className="flex justify-center py-4">
                    <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : userMetrics ? (
                  <div className="space-y-3">
                    <div className="text-xs text-slate-500 font-medium mb-2">Метрики за 30 дней</div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 rounded-lg p-2">
                        <div className="text-lg font-semibold text-slate-800">
                          {userMetrics.responseTime?.avgMinutes || 0}м
                        </div>
                        <div className="text-xs text-slate-500">Ср. ответ</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2">
                        <div className="text-lg font-semibold text-slate-800">
                          {userMetrics.responseTime?.totalResponses || 0}
                        </div>
                        <div className="text-xs text-slate-500">Ответов</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2">
                        <div className="text-lg font-semibold text-slate-800">
                          {userMetrics.resolutions?.resolutionRate || 0}%
                        </div>
                        <div className="text-xs text-slate-500">Решено</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2">
                        <div className="text-lg font-semibold text-slate-800">
                          {userMetrics.messageStats?.channels_active || 0}
                        </div>
                        <div className="text-xs text-slate-500">Каналов</div>
                      </div>
                    </div>

                    {/* Client Sentiment */}
                    {userMetrics.clientSentiment && Object.keys(userMetrics.clientSentiment).length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-500 mb-1">Sentiment клиентов</div>
                        <div className="flex gap-1">
                          {Object.entries(userMetrics.clientSentiment).map(([sentiment, count]) => (
                            <span key={sentiment} className={`text-xs px-2 py-0.5 rounded ${
                              sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                              sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {sentiment}: {count as number}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 text-center py-4">
                    Нажмите "Метрики" для загрузки
                  </div>
                )}
              </>
            )}

            {/* Notes */}
            <div className="mt-4">
              <textarea
                placeholder="Заметки..."
                defaultValue={selectedUser.notes || ''}
                onBlur={(e) => onUpdateUserDetails(selectedUser.id, { notes: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg resize-none h-20"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UsersTab
