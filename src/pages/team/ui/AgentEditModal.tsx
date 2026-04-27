import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { updateAgent } from '@/shared/api'
import { Modal } from '@/shared/ui'
import type { Agent, AgentRole } from '@/entities/agent'

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

function buildForm(agent: Agent | null) {
  return {
    name: agent?.name || '',
    username: agent?.username || '',
    email: agent?.email || '',
    role: (agent?.role || 'agent') as AgentRole,
    password: '',
    phone: agent?.phone || '',
    permissions: ((agent as any)?.permissions || []) as string[],
  }
}

export function AgentEditModal({
  agent, onClose, onSaved,
}: {
  agent: Agent | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(buildForm(agent))
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (agent) setForm(buildForm(agent))
  }, [agent?.id])

  async function save() {
    if (!agent) return
    setSaving(true)
    try {
      await updateAgent(agent.id, {
        name: form.name, username: form.username, email: form.email,
        role: form.role, password: form.password || undefined,
        phone: form.phone, permissions: form.permissions,
      })
      onSaved()
      onClose()
    } catch {
      alert('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function togglePermission(id: string) {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(id)
        ? prev.permissions.filter(p => p !== id)
        : [...prev.permissions, id],
    }))
  }

  return (
    <Modal isOpen={!!agent} onClose={onClose} title="Редактировать сотрудника" size="md">
      {/*
        Защита от автозаполнения Chrome/Safari/1Password:
        - <form autoComplete="off"> + уникальные name="agent-edit-*"
        - autoComplete="off" / "new-password" на каждом инпуте
        - data-1p-ignore / data-lpignore — менеджеры паролей пропустят форму
        - скрытые "decoy" поля сверху: Chrome заполняет их вместо реальных
      */}
      <form
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); save() }}
        className="space-y-5"
      >
        {/* Decoy для Chrome — он автозаполняет первое подходящее поле */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }}
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Имя *</label>
          <input
            type="text"
            name="agent-edit-name"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Имя сотрудника"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Telegram username</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 border border-r-0 border-slate-300 rounded-l-lg bg-slate-50 text-slate-500">@</span>
            <input
              type="text"
              name="agent-edit-tg-username"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              value={form.username}
              onChange={e => setForm(prev => ({ ...prev, username: e.target.value.replace('@', '') }))}
              className="flex-1 px-4 py-2.5 border border-slate-300 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="username"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            name="agent-edit-email"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            value={form.email}
            onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="email@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
          <input
            type="tel"
            name="agent-edit-phone"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="+998 90 123 45 67"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
          <select
            name="agent-edit-role"
            value={form.role}
            onChange={e => setForm(prev => ({ ...prev, role: e.target.value as AgentRole }))}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Новый пароль <span className="text-slate-400 font-normal">(оставьте пустым, чтобы не менять)</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              name="agent-edit-new-password"
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              value={form.password}
              onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
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

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">Доступ к модулям</label>
          <div className="grid grid-cols-2 gap-3">
            {PERMISSION_MODULES.map(mod => (
              <label
                key={mod.id}
                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.permissions.includes(mod.id)
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.permissions.includes(mod.id)}
                  onChange={() => togglePermission(mod.id)}
                  className="w-4 h-4 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
                />
                <span className="text-sm font-medium">{mod.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
