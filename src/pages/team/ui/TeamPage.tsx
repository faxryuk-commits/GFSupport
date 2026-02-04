import { useState, useEffect } from 'react'
import { Plus, Loader2, AlertCircle, Copy, Check, Link, Mail, MessageCircle, Clock, Calendar, Eye, EyeOff } from 'lucide-react'
import { fetchAgents, updateAgent } from '@/shared/api'
import { apiPost, apiGet } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'
import type { Agent } from '@/entities/agent'

// Available permission modules
const PERMISSION_MODULES = [
  { id: 'cases', label: 'Кейсы' },
  { id: 'channels', label: 'Каналы' },
  { id: 'messages', label: 'Сообщения' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'users', label: 'Пользователи' },
  { id: 'automations', label: 'Автоматизации' },
  { id: 'settings', label: 'Настройки' },
]

const ROLE_OPTIONS = [
  { value: 'agent', label: 'Агент' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'admin', label: 'Администратор' },
]

interface Invite {
  id: string
  token: string
  url: string
  email?: string
  role: string
  expiresAt: string
  createdAt: string
  isUsed: boolean
  isExpired: boolean
}

interface DisplayAgent {
  id: string
  name: string
  role: string
  status: 'online' | 'offline'
  avatar: string
  email?: string
  username?: string
  lastSeenAt?: string
  createdAt?: string
  cases: number
  sla: number
  avgTime: string
  messagesHandled: number
  level: { name: string; icon: string; progress: number; current: number; max: number }
}

function mapAgentToDisplay(agent: Agent): DisplayAgent {
  const points = agent.points || 0
  const level = Math.floor(points / 100) + 1
  const levelNames = ['Новичок', 'Начинающий', 'Опытный', 'Продвинутый', 'Эксперт', 'Мастер']
  const levelIcons = ['🌱', '📚', '🎯', '🚀', '⭐', '👑']
  const levelIndex = Math.min(level - 1, levelNames.length - 1)
  const currentLevelMin = (level - 1) * 100
  const nextLevelMax = level * 100
  const progress = ((points - currentLevelMin) / (nextLevelMax - currentLevelMin)) * 100

  const roleLabels: Record<string, string> = {
    admin: 'Администратор',
    manager: 'Менеджер',
    agent: 'Агент поддержки'
  }

  const avgResponseMin = agent.metrics?.avgFirstResponseMin || 0

  return {
    id: agent.id,
    name: agent.name,
    role: roleLabels[agent.role] || agent.role,
    status: agent.status === 'online' ? 'online' : 'offline',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${agent.email || agent.id}`,
    email: agent.email,
    username: agent.username,
    lastSeenAt: agent.lastSeenAt,
    createdAt: agent.createdAt,
    cases: agent.metrics?.resolvedConversations || 0,
    sla: agent.metrics?.satisfactionScore ? Math.round(Number(agent.metrics.satisfactionScore) * 100) : 0,
    avgTime: avgResponseMin > 0 ? `${Math.round(avgResponseMin)}м` : '—',
    messagesHandled: agent.metrics?.messagesHandled || 0,
    level: {
      name: levelNames[levelIndex],
      icon: levelIcons[levelIndex],
      progress: Math.round(progress),
      current: points,
      max: nextLevelMax
    }
  }
}

interface TeamPageProps {
  embedded?: boolean
}

export function TeamPage({ embedded = false }: TeamPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Invite modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'agent' | 'manager' | 'admin'>('agent')
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  
  // Profile modal state
  const [selectedAgent, setSelectedAgent] = useState<DisplayAgent | null>(null)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  
  // Edit modal state
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    username: '',
    email: '',
    role: 'agent',
    password: '',
    phone: '',
    permissions: [] as string[],
  })
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadAgents()
    loadInvites()
  }, [])
  
  const handleViewProfile = (agent: DisplayAgent) => {
    setSelectedAgent(agent)
    setIsProfileOpen(true)
  }

  // Open edit modal
  function openEditModal(agent: Agent) {
    setEditingAgent(agent)
    setEditForm({
      name: agent.name || '',
      username: agent.username || '',
      email: agent.email || '',
      role: agent.role || 'agent',
      password: '',
      phone: (agent as any).phone || '',
      permissions: (agent as any).permissions || [],
    })
    setShowPassword(false)
  }

  // Save agent changes
  async function saveAgent() {
    if (!editingAgent) return
    
    setSaving(true)
    try {
      await updateAgent(editingAgent.id, {
        name: editForm.name,
        username: editForm.username,
        email: editForm.email,
        role: editForm.role,
        password: editForm.password || undefined,
        phone: editForm.phone,
        permissions: editForm.permissions,
      })
      setEditingAgent(null)
      loadAgents()
    } catch (err) {
      console.error('Failed to save agent:', err)
      alert('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // Toggle permission
  function togglePermission(moduleId: string) {
    setEditForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(moduleId)
        ? prev.permissions.filter(p => p !== moduleId)
        : [...prev.permissions, moduleId]
    }))
  }

  async function loadAgents() {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchAgents()
      setAgents(data)
    } catch (err) {
      setError('Не удалось загрузить список команды')
      console.error('Failed to fetch agents:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadInvites() {
    try {
      const data = await apiGet<{ invites: Invite[] }>('/invites')
      setInvites(data.invites.filter((i: Invite) => !i.isUsed && !i.isExpired))
    } catch (err) {
      console.error('Failed to load invites:', err)
    }
  }

  async function createInvite() {
    try {
      setInviteLoading(true)
      const response = await apiPost<{ invite: Invite }>('/invites', {
        email: inviteEmail || undefined,
        role: inviteRole,
        expiresInDays: 7
      })
      setInviteUrl(response.invite.url)
      loadInvites()
    } catch (err) {
      console.error('Failed to create invite:', err)
    } finally {
      setInviteLoading(false)
    }
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteUrl)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  function openInviteModal() {
    setInviteEmail('')
    setInviteRole('agent')
    setInviteUrl('')
    setIsInviteModalOpen(true)
  }

  function closeInviteModal() {
    setIsInviteModalOpen(false)
    setInviteUrl('')
  }

  // Calculate metrics from agents data
  const displayAgents = agents.map(mapAgentToDisplay)
  const onlineCount = agents.filter(a => a.status === 'online').length
  const totalAgents = agents.length
  const totalCasesToday = displayAgents.reduce((sum, a) => sum + a.cases, 0)
  
  const avgResponseMinutes = agents.length > 0
    ? agents.reduce((sum, a) => sum + (a.metrics?.avgFirstResponseMin || 0), 0) / agents.length
    : 0
  const avgResponse = avgResponseMinutes > 0 ? `${Math.round(avgResponseMinutes)}м` : '—'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-600">Загрузка команды...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <AlertCircle className="w-12 h-12 mb-3" />
        <p className="text-lg font-medium">{error}</p>
        <button 
          onClick={loadAgents}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className={embedded ? "p-6 space-y-6" : "p-6 space-y-6"}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Команда</h1>
          <button 
            onClick={openInviteModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Пригласить
          </button>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-end">
          <button 
            onClick={openInviteModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Пригласить
          </button>
        </div>
      )}

      {/* Invite Modal */}
      <Modal isOpen={isInviteModalOpen} onClose={closeInviteModal} title="Пригласить сотрудника">
        <div className="space-y-4">
          {!inviteUrl ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email (необязательно)
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="employee@company.com"
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Если указать email, ссылка будет привязана к нему
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Роль
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'agent' | 'manager' | 'admin')}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="agent">Агент поддержки</option>
                  <option value="manager">Менеджер</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>

              <button
                onClick={createInvite}
                disabled={inviteLoading}
                className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {inviteLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Link className="w-5 h-5" />
                    Создать ссылку
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium mb-2">
                  Ссылка создана! Отправьте её сотруднику:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={copyInviteLink}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                  >
                    {inviteCopied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Копировать
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-green-600 mt-2">
                  Ссылка действительна 7 дней
                </p>
              </div>

              <button
                onClick={() => setInviteUrl('')}
                className="w-full py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Создать ещё одну ссылку
              </button>
            </div>
          )}

          {/* Active invites */}
          {invites.length > 0 && (
            <div className="pt-4 border-t border-slate-200">
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                Активные приглашения ({invites.length})
              </h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {invites.map(invite => (
                  <div key={invite.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm">
                    <div>
                      <span className="text-slate-700">{invite.email || 'Без email'}</span>
                      <span className="text-slate-400 ml-2">• {invite.role}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      до {new Date(invite.expiresAt).toLocaleDateString('ru')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard value={onlineCount} label="Онлайн сейчас" hasOnline />
        <MetricCard value={totalAgents} label="Всего агентов" />
        <MetricCard value={avgResponse} label="Сред. ответ" />
        <MetricCard value={totalCasesToday} label="Обращений" />
      </div>

      {/* Agents Grid */}
      {displayAgents.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg">Агенты не найдены</p>
          <p className="text-sm mt-1">Пригласите членов команды для начала работы</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {displayAgents.map(agent => {
            const fullAgent = agents.find(a => a.id === agent.id)
            return (
              <AgentCard 
                key={agent.id} 
                agent={agent} 
                onViewProfile={() => handleViewProfile(agent)}
                onEdit={() => fullAgent && openEditModal(fullAgent)}
              />
            )
          })}
        </div>
      )}

      {/* Agent Profile Modal */}
      <Modal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} title="Профиль сотрудника">
        {selectedAgent && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <img 
                  src={selectedAgent.avatar} 
                  alt={selectedAgent.name}
                  className="w-20 h-20 rounded-full object-cover bg-slate-100"
                />
                <span className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-white ${
                  selectedAgent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
                }`} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800">{selectedAgent.name}</h3>
                <p className="text-slate-500">{selectedAgent.role}</p>
                <span className={`inline-flex items-center gap-1 text-sm mt-1 ${
                  selectedAgent.status === 'online' ? 'text-green-600' : 'text-slate-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    selectedAgent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
                  }`} />
                  {selectedAgent.status === 'online' ? 'В сети' : 'Не в сети'}
                </span>
              </div>
            </div>

            {/* Contact Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-700">Контакты</h4>
              {selectedAgent.email && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span>{selectedAgent.email}</span>
                </div>
              )}
              {selectedAgent.username && (
                <div className="flex items-center gap-3 text-slate-600">
                  <MessageCircle className="w-4 h-4 text-slate-400" />
                  <span>@{selectedAgent.username}</span>
                </div>
              )}
              {selectedAgent.lastSeenAt && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>В системе: {new Date(selectedAgent.lastSeenAt).toLocaleString('ru')}</span>
                </div>
              )}
              {selectedAgent.createdAt && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>В команде с {new Date(selectedAgent.createdAt).toLocaleDateString('ru')}</span>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl">
              <div className="text-center">
                <span className="text-2xl font-bold text-slate-800">{selectedAgent.cases}</span>
                <p className="text-xs text-slate-500">Решено</p>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold text-slate-800">{selectedAgent.messagesHandled}</span>
                <p className="text-xs text-slate-500">Сообщений</p>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold text-slate-800">{selectedAgent.sla}%</span>
                <p className="text-xs text-slate-500">SLA</p>
              </div>
            </div>

            {/* Level */}
            <div className="p-4 bg-blue-50 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{selectedAgent.level.icon}</span>
                <span className="font-medium text-blue-800">{selectedAgent.level.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-3 bg-blue-100 rounded-full">
                  <div 
                    className="h-3 bg-blue-500 rounded-full transition-all"
                    style={{ width: `${selectedAgent.level.progress}%` }}
                  />
                </div>
                <span className="text-sm text-blue-600 font-medium">
                  {selectedAgent.level.current}/{selectedAgent.level.max} XP
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Agent Modal */}
      <Modal
        isOpen={!!editingAgent}
        onClose={() => setEditingAgent(null)}
        title="Редактировать сотрудника"
        size="md"
      >
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Имя *</label>
            <input
              type="text"
              value={editForm.name}
              onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Имя сотрудника"
            />
          </div>

          {/* Telegram Username */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Telegram username</label>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-slate-300 rounded-l-lg bg-slate-50 text-slate-500">
                @
              </span>
              <input
                type="text"
                value={editForm.username}
                onChange={e => setEditForm(prev => ({ ...prev, username: e.target.value.replace('@', '') }))}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="username"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="email@example.com"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
            <select
              value={editForm.role}
              onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Новый пароль <span className="text-slate-400 font-normal">(оставьте пустым, чтобы не менять)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={editForm.password}
                onChange={e => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Доступ к модулям</label>
            <div className="grid grid-cols-2 gap-3">
              {PERMISSION_MODULES.map(mod => (
                <label
                  key={mod.id}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    editForm.permissions.includes(mod.id)
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={editForm.permissions.includes(mod.id)}
                    onChange={() => togglePermission(mod.id)}
                    className="w-4 h-4 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium">{mod.label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">* Доступы определяются ролью сотрудника</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => setEditingAgent(null)}
              className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
            >
              Отмена
            </button>
            <button
              onClick={saveAgent}
              disabled={saving || !editForm.name.trim()}
              className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function MetricCard({ value, label, hasOnline }: { value: string | number; label: string; hasOnline?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold text-slate-800">{value}</span>
        {hasOnline && <span className="w-2 h-2 bg-green-500 rounded-full" />}
      </div>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  )
}

function AgentCard({ agent, onViewProfile, onEdit }: { agent: DisplayAgent; onViewProfile: () => void; onEdit?: () => void }) {
  return (
    <div className={`bg-white rounded-xl p-5 border-2 ${
      agent.status === 'online' ? 'border-green-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative">
          <img 
            src={agent.avatar} 
            alt={agent.name}
            className="w-16 h-16 rounded-full object-cover bg-slate-100"
          />
          <span className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
            agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
          }`} />
        </div>

        {/* Info */}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">{agent.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${
                  agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
                }`} />
                <span className="text-sm text-slate-500">
                  {agent.status === 'online' ? 'В сети' : 'Не в сети'}
                </span>
              </div>
            </div>
            <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {agent.role}
            </span>
          </div>

          {/* Stats */}
          <div className="flex gap-6 mt-4">
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.cases}</span>
              <p className="text-xs text-slate-500">обращений</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.sla}%</span>
              <p className="text-xs text-slate-500">SLA</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.avgTime}</span>
              <p className="text-xs text-slate-500">сред.</p>
            </div>
          </div>

          {/* Level */}
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span>{agent.level.icon}</span>
              <span className="text-sm font-medium text-slate-700">{agent.level.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-2 bg-slate-100 rounded-full">
                <div 
                  className="h-2 bg-blue-500 rounded-full"
                  style={{ width: `${agent.level.progress}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">
                Уровень {Math.floor(agent.level.current / 100) + 1} - {agent.level.current}/{agent.level.max} XP
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4 mt-3">
            <button 
              onClick={onViewProfile}
              className="text-blue-500 text-sm font-medium hover:underline"
            >
              Профиль
            </button>
            {onEdit && (
              <button 
                onClick={onEdit}
                className="text-slate-500 text-sm font-medium hover:underline hover:text-slate-700"
              >
                Редактировать
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
