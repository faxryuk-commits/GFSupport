import { useState } from 'react'
import { GripVertical, Trash2, Plus } from 'lucide-react'
import type { OnboardingTemplate, OnboardingTemplateStage, TemplateRole } from '@/entities/onboarding'

interface TemplateEditorProps {
  template: OnboardingTemplate
  onSave: (data: Partial<OnboardingTemplate> & { stages: OnboardingTemplateStage[] }) => void
}

const inputClass =
  'rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400'

const ROLE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export function TemplateEditor({ template, onSave }: TemplateEditorProps) {
  const [name, setName] = useState(template.name)
  const [totalDays, setTotalDays] = useState(template.totalDays)
  const [roles, setRoles] = useState<TemplateRole[]>(template.roles)
  const [stages, setStages] = useState<OnboardingTemplateStage[]>(
    template.stages ?? [],
  )

  const addRole = () => {
    const id = `role_${Date.now()}`
    const color = ROLE_COLORS[roles.length % ROLE_COLORS.length]
    setRoles([...roles, { id, name: 'Новая роль', color }])
  }

  const updateRole = (idx: number, field: keyof TemplateRole, value: string) => {
    setRoles(roles.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }

  const removeRole = (idx: number) => {
    setRoles(roles.filter((_, i) => i !== idx))
  }

  const addStage = () => {
    const id = `stage_${Date.now()}`
    setStages([
      ...stages,
      {
        id,
        templateId: template.id,
        name: 'Новый этап',
        sortOrder: stages.length + 1,
        plannedDays: 3,
        defaultRole: roles[0]?.id ?? '',
        items: [],
      },
    ])
  }

  const updateStage = (
    idx: number,
    patch: Partial<OnboardingTemplateStage>,
  ) => {
    setStages(stages.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const removeStage = (idx: number) => {
    setStages(stages.filter((_, i) => i !== idx))
  }

  const addStageItem = (stageIdx: number) => {
    const stage = stages[stageIdx]
    updateStage(stageIdx, {
      items: [...stage.items, { name: 'Новый пункт', role: roles[0]?.id ?? '' }],
    })
  }

  const updateStageItem = (
    stageIdx: number,
    itemIdx: number,
    patch: Partial<{ name: string; role: string }>,
  ) => {
    const stage = stages[stageIdx]
    const items = stage.items.map((it, i) =>
      i === itemIdx ? { ...it, ...patch } : it,
    )
    updateStage(stageIdx, { items })
  }

  const removeStageItem = (stageIdx: number, itemIdx: number) => {
    const stage = stages[stageIdx]
    updateStage(stageIdx, {
      items: stage.items.filter((_, i) => i !== itemIdx),
    })
  }

  const handleSave = () => {
    onSave({ name, totalDays, roles, stages })
  }

  const getRoleName = (roleId: string) =>
    roles.find((r) => r.id === roleId)?.name ?? '—'

  const getRoleColor = (roleId: string) =>
    roles.find((r) => r.id === roleId)?.color ?? '#9ca3af'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Название шаблона
          </label>
          <input
            className={`${inputClass} w-full text-lg font-semibold`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Всего дней
          </label>
          <input
            type="number"
            min={1}
            className={`${inputClass} w-full`}
            value={totalDays}
            onChange={(e) => setTotalDays(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Roles */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          Роли в шаблоне
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {roles.map((role, idx) => (
            <div
              key={role.id}
              className="group flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5"
              style={{ backgroundColor: `${role.color}20`, color: role.color }}
            >
              <input
                className="w-24 border-none bg-transparent text-sm font-medium outline-none"
                value={role.name}
                onChange={(e) => updateRole(idx, 'name', e.target.value)}
              />
              <button
                onClick={() => removeRole(idx)}
                className="rounded-full p-0.5 opacity-0 hover:bg-white/60 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addRole}
            className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить роль
          </button>
        </div>
      </div>

      {/* Stages */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Этапы</h3>
        <div className="space-y-3">
          {stages.map((stage, sIdx) => (
            <div
              key={stage.id}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="mb-3 flex items-center gap-3">
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-300" />
                <input
                  className={`${inputClass} flex-1`}
                  value={stage.name}
                  onChange={(e) =>
                    updateStage(sIdx, { name: e.target.value })
                  }
                />
                <input
                  type="number"
                  min={1}
                  className={`${inputClass} w-20`}
                  value={stage.plannedDays}
                  onChange={(e) =>
                    updateStage(sIdx, {
                      plannedDays: Number(e.target.value),
                    })
                  }
                  title="Дней"
                />
                <select
                  className={`${inputClass} w-40`}
                  value={stage.defaultRole}
                  onChange={(e) =>
                    updateStage(sIdx, { defaultRole: e.target.value })
                  }
                >
                  <option value="">Роль</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeStage(sIdx)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Items */}
              <div className="ml-7 space-y-1.5">
                {stage.items.map((item, iIdx) => (
                  <div key={iIdx} className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-md border border-gray-100 bg-gray-50 px-2 py-1 text-sm outline-none focus:border-blue-300"
                      value={item.name}
                      onChange={(e) =>
                        updateStageItem(sIdx, iIdx, { name: e.target.value })
                      }
                    />
                    <span
                      className="rounded px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: `${getRoleColor(item.role)}20`,
                        color: getRoleColor(item.role),
                      }}
                    >
                      {getRoleName(item.role)}
                    </span>
                    <select
                      className="rounded border border-gray-100 bg-gray-50 px-1 py-0.5 text-xs outline-none"
                      value={item.role}
                      onChange={(e) =>
                        updateStageItem(sIdx, iIdx, { role: e.target.value })
                      }
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeStageItem(sIdx, iIdx)}
                      className="text-gray-300 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addStageItem(sIdx)}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                >
                  <Plus className="h-3 w-3" />
                  Добавить пункт
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addStage}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600"
        >
          <Plus className="h-4 w-4" />
          Добавить этап
        </button>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Сохранить
        </button>
      </div>
    </div>
  )
}
