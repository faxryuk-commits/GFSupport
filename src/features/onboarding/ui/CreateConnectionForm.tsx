import { useState, useMemo } from 'react'
import type { OnboardingTemplate, CreateConnectionData, TeamAssignment } from '@/entities/onboarding'

interface CreateConnectionFormProps {
  templates: OnboardingTemplate[]
  agents: Array<{ id: string; name: string }>
  onSubmit: (data: CreateConnectionData) => void
  onCancel: () => void
}

const inputClass =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400'
const labelClass = 'mb-1 block text-sm font-medium text-gray-700'

export function CreateConnectionForm({
  templates,
  agents,
  onSubmit,
  onCancel,
}: CreateConnectionFormProps) {
  const [clientName, setClientName] = useState('')
  const [clientContact, setClientContact] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [team, setTeam] = useState<TeamAssignment>({})
  const [deadline, setDeadline] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  )

  const handleTemplateChange = (id: string) => {
    setTemplateId(id)
    setTeam({})
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      const date = new Date()
      date.setDate(date.getDate() + tpl.totalDays)
      setDeadline(date.toISOString().slice(0, 10))
    } else {
      setDeadline('')
    }
  }

  const handleTeamChange = (roleId: string, agentId: string) => {
    setTeam((prev) => ({ ...prev, [roleId]: agentId }))
  }

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!clientName.trim()) next.clientName = 'Обязательное поле'
    if (!templateId) next.templateId = 'Выберите шаблон'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    onSubmit({
      clientName: clientName.trim(),
      clientContact: clientContact.trim() || undefined,
      clientPhone: clientPhone.trim() || undefined,
      templateId,
      team: Object.keys(team).length > 0 ? team : undefined,
      plannedDeadline: deadline || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-xl space-y-5">
      <div>
        <label className={labelClass}>
          Клиент <span className="text-red-500">*</span>
        </label>
        <input
          className={inputClass}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Название компании"
        />
        {errors.clientName && (
          <p className="mt-1 text-xs text-red-500">{errors.clientName}</p>
        )}
      </div>

      <div>
        <label className={labelClass}>Контактное лицо</label>
        <input
          className={inputClass}
          value={clientContact}
          onChange={(e) => setClientContact(e.target.value)}
          placeholder="Иван Иванов"
        />
      </div>

      <div>
        <label className={labelClass}>Телефон</label>
        <input
          className={inputClass}
          value={clientPhone}
          onChange={(e) => setClientPhone(e.target.value)}
          placeholder="+7 (999) 123-45-67"
        />
      </div>

      <div>
        <label className={labelClass}>
          Шаблон <span className="text-red-500">*</span>
        </label>
        <select
          className={inputClass}
          value={templateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
        >
          <option value="">Выберите шаблон</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.totalDays} дн.)
            </option>
          ))}
        </select>
        {errors.templateId && (
          <p className="mt-1 text-xs text-red-500">{errors.templateId}</p>
        )}
      </div>

      {selectedTemplate && selectedTemplate.roles.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">
            Назначьте команду
          </p>
          <div className="space-y-3">
            {selectedTemplate.roles.map((role) => (
              <div key={role.id} className="flex items-center gap-3">
                <span
                  className="w-32 truncate text-sm font-medium"
                  style={{ color: role.color }}
                >
                  {role.name}
                </span>
                <select
                  className={inputClass}
                  value={team[role.id] ?? ''}
                  onChange={(e) => handleTeamChange(role.id, e.target.value)}
                >
                  <option value="">Не назначен</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>Плановый дедлайн</label>
        <input
          type="date"
          className={inputClass}
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Отмена
        </button>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Создать подключение
        </button>
      </div>
    </form>
  )
}
