/**
 * AgentBinding Component
 * UI for managing telegram_id bindings for support agents
 * 
 * Features:
 * - View agents/managers without telegram_id
 * - Manually bind telegram_id or username
 * - View currently bound agents
 * - Remove bindings
 */

import { useState, useEffect, useCallback } from 'react'
import { 
  Link2, Unlink, Search, RefreshCw, CheckCircle, 
  AlertCircle, User, Users, Shield, ChevronDown, ChevronUp,
  Copy, Check, X
} from 'lucide-react'

interface Agent {
  id: string
  name: string
  username: string | null
  email: string | null
  role: string
  status: string
  telegramId: string | null
  createdAt: string
}

interface Manager {
  id: string
  name: string
  telegramUsername: string | null
  role: string
  telegramId: string | null
}

interface BindingStats {
  totalAgents: number
  boundAgents: number
  unboundAgents: number
  totalManagers: number
  boundManagers: number
  unboundManagers: number
}

interface BindingData {
  agents: {
    unbound: Agent[]
    bound: Agent[]
  }
  managers: {
    unbound: Manager[]
    bound: Manager[]
  }
  stats: BindingStats
}

interface ConfirmDialogState {
  isOpen: boolean
  title: string
  message: string
  onConfirm: () => void
}

export function AgentBinding() {
  const [data, setData] = useState<BindingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Bind form state
  const [bindingAgentId, setBindingAgentId] = useState<string | null>(null)
  const [bindingManagerId, setBindingManagerId] = useState<string | null>(null)
  const [telegramIdInput, setTelegramIdInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [bindLoading, setBindLoading] = useState(false)
  const [bindSuccess, setBindSuccess] = useState<string | null>(null)
  
  // Search
  const [searchQuery, setSearchQuery] = useState('')
  
  // Sections expanded
  const [showUnboundAgents, setShowUnboundAgents] = useState(true)
  const [showBoundAgents, setShowBoundAgents] = useState(false)
  const [showUnboundManagers, setShowUnboundManagers] = useState(true)
  const [showBoundManagers, setShowBoundManagers] = useState(false)
  
  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  })

  // Get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('support_agent_token') || ''
    return {
      'Content-Type': 'application/json',
      'Authorization': token.startsWith('Bearer') ? token : `Bearer ${token}`
    }
  }, [])

  // Fetch binding data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/support/agents/bind', {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const err = await res.json()
        setError(err.error || 'Ошибка загрузки данных')
      }
    } catch (e) {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Bind telegram_id
  const handleBind = async (agentId: string | null, managerId: string | null) => {
    if (!telegramIdInput && !usernameInput) {
      setError('Укажите Telegram ID или Username')
      return
    }

    setBindLoading(true)
    setError(null)
    setBindSuccess(null)

    try {
      const res = await fetch('/api/support/agents/bind', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          agentId,
          managerId,
          telegramId: telegramIdInput || undefined,
          telegramUsername: usernameInput || undefined
        })
      })

      const result = await res.json()

      if (res.ok && result.success) {
        setBindSuccess('Привязка успешно создана')
        setBindingAgentId(null)
        setBindingManagerId(null)
        setTelegramIdInput('')
        setUsernameInput('')
        fetchData()
        setTimeout(() => setBindSuccess(null), 3000)
      } else {
        setError(result.error || 'Ошибка привязки')
      }
    } catch (e) {
      setError('Ошибка сети')
    } finally {
      setBindLoading(false)
    }
  }

  // Remove binding
  const handleUnbind = async (agentId: string | null, managerId: string | null, field: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Удалить привязку?',
      message: `Вы уверены, что хотите удалить привязку ${field === 'telegram_id' ? 'Telegram ID' : 'Username'}?`,
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false })
        
        try {
          const params = new URLSearchParams()
          if (agentId) params.set('agentId', agentId)
          if (managerId) params.set('managerId', managerId)
          params.set('field', field)

          const res = await fetch(`/api/support/agents/bind?${params}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
          })

          if (res.ok) {
            fetchData()
          } else {
            const result = await res.json()
            setError(result.error || 'Ошибка удаления')
          }
        } catch (e) {
          setError('Ошибка сети')
        }
      }
    })
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Filter by search
  const filterBySearch = <T extends { name: string; telegramId?: string | null }>(items: T[]): T[] => {
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter(item => 
      item.name.toLowerCase().includes(q) ||
      (item.telegramId && item.telegramId.includes(q))
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Привязка Telegram</h2>
          <p className="text-sm text-slate-500 mt-1">
            Привяжите Telegram ID сотрудников для автоматического определения ответов
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-emerald-50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-600 mb-1">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Привязано</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700">
              {data.stats.boundAgents + data.stats.boundManagers}
            </p>
          </div>
          <div className="bg-orange-50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-orange-600 mb-1">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Не привязано</span>
            </div>
            <p className="text-2xl font-bold text-orange-700">
              {data.stats.unboundAgents + data.stats.unboundManagers}
            </p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">Агенты</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">{data.stats.totalAgents}</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-purple-600 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">Менеджеры</span>
            </div>
            <p className="text-2xl font-bold text-purple-700">{data.stats.totalManagers}</p>
          </div>
        </div>
      )}

      {/* Success message */}
      {bindSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {bindSuccess}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          placeholder="Поиск по имени или Telegram ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Unbound Agents */}
      {data?.agents.unbound && data.agents.unbound.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowUnboundAgents(!showUnboundAgents)}
            className="w-full px-4 py-3 flex items-center justify-between bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              <span className="font-medium text-slate-800">
                Агенты без привязки ({data.agents.unbound.length})
              </span>
            </div>
            {showUnboundAgents ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          
          {showUnboundAgents && (
            <div className="divide-y divide-slate-100">
              {filterBySearch(data.agents.unbound).map(agent => (
                <div key={agent.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{agent.name}</p>
                      <p className="text-sm text-slate-500">
                        {agent.email || agent.username || 'Без контактов'}
                      </p>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                        agent.role === 'lead' ? 'bg-purple-100 text-purple-700' :
                        agent.role === 'senior' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {agent.role}
                      </span>
                    </div>
                    
                    {bindingAgentId === agent.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Telegram ID"
                          value={telegramIdInput}
                          onChange={(e) => setTelegramIdInput(e.target.value)}
                          className="w-32 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="@username"
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          className="w-32 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          onClick={() => handleBind(agent.id, null)}
                          disabled={bindLoading}
                          className="p-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setBindingAgentId(null)
                            setTelegramIdInput('')
                            setUsernameInput('')
                          }}
                          className="p-1.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setBindingAgentId(agent.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors"
                      >
                        <Link2 className="w-4 h-4" />
                        Привязать
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bound Agents */}
      {data?.agents.bound && data.agents.bound.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowBoundAgents(!showBoundAgents)}
            className="w-full px-4 py-3 flex items-center justify-between bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <span className="font-medium text-slate-800">
                Привязанные агенты ({data.agents.bound.length})
              </span>
            </div>
            {showBoundAgents ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          
          {showBoundAgents && (
            <div className="divide-y divide-slate-100">
              {filterBySearch(data.agents.bound).map(agent => (
                <div key={agent.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{agent.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {agent.telegramId && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          ID: {agent.telegramId}
                          <button
                            onClick={() => copyToClipboard(agent.telegramId!)}
                            className="hover:text-blue-900"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                      {agent.username && (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                          @{agent.username}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnbind(agent.id, null, 'telegram_id')}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Удалить привязку"
                  >
                    <Unlink className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unbound Managers */}
      {data?.managers.unbound && data.managers.unbound.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowUnboundManagers(!showUnboundManagers)}
            className="w-full px-4 py-3 flex items-center justify-between bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              <span className="font-medium text-slate-800">
                Менеджеры без привязки ({data.managers.unbound.length})
              </span>
            </div>
            {showUnboundManagers ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          
          {showUnboundManagers && (
            <div className="divide-y divide-slate-100">
              {filterBySearch(data.managers.unbound).map(manager => (
                <div key={manager.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{manager.name}</p>
                      <p className="text-sm text-slate-500">
                        {manager.telegramUsername ? `@${manager.telegramUsername}` : 'Без username'}
                      </p>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                        manager.role === 'support' ? 'bg-emerald-100 text-emerald-700' :
                        manager.role === 'cs' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {manager.role}
                      </span>
                    </div>
                    
                    {bindingManagerId === manager.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Telegram ID"
                          value={telegramIdInput}
                          onChange={(e) => setTelegramIdInput(e.target.value)}
                          className="w-32 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          onClick={() => handleBind(null, manager.id)}
                          disabled={bindLoading}
                          className="p-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setBindingManagerId(null)
                            setTelegramIdInput('')
                          }}
                          className="p-1.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setBindingManagerId(manager.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors"
                      >
                        <Link2 className="w-4 h-4" />
                        Привязать
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bound Managers */}
      {data?.managers.bound && data.managers.bound.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowBoundManagers(!showBoundManagers)}
            className="w-full px-4 py-3 flex items-center justify-between bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <span className="font-medium text-slate-800">
                Привязанные менеджеры ({data.managers.bound.length})
              </span>
            </div>
            {showBoundManagers ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          
          {showBoundManagers && (
            <div className="divide-y divide-slate-100">
              {filterBySearch(data.managers.bound).map(manager => (
                <div key={manager.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{manager.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {manager.telegramId && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          ID: {manager.telegramId}
                          <button
                            onClick={() => copyToClipboard(manager.telegramId!)}
                            className="hover:text-blue-900"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                      {manager.telegramUsername && (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                          @{manager.telegramUsername}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnbind(null, manager.id, 'telegram_id')}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Удалить привязку"
                  >
                    <Unlink className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {data && 
        data.agents.unbound.length === 0 && 
        data.agents.bound.length === 0 && 
        data.managers.unbound.length === 0 && 
        data.managers.bound.length === 0 && (
        <div className="text-center py-12">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">Нет сотрудников для отображения</p>
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h4 className="font-medium text-blue-800 mb-2">Как это работает?</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>Автоматическая привязка:</strong> Когда сотрудник отвечает из Telegram, его ID автоматически привязывается</li>
          <li>• <strong>Ручная привязка:</strong> Укажите Telegram ID или @username для привязки вручную</li>
          <li>• <strong>Определение ответов:</strong> После привязки все ответы из Telegram автоматически определяются как ответы сотрудника</li>
          <li>• <strong>Автопрочтение:</strong> При ответе сотрудника все непрочитанные сообщения автоматически помечаются прочитанными</li>
        </ul>
      </div>

      {/* Confirm Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{confirmDialog.title}</h3>
            <p className="text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentBinding
