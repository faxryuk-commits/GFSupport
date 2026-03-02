import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, FileText } from 'lucide-react'
import { useToast, LoadingSpinner, EmptyState, ConfirmDialog } from '@/shared/ui'
import type { OnboardingTemplate } from '@/entities/onboarding'
import {
  fetchTemplates, fetchTemplate, createTemplate,
  updateTemplate, deleteTemplate,
} from '@/shared/api/onboarding'

function TemplateEditor({ template, onSave, saving }: {
  template: OnboardingTemplate
  onSave: (data: Partial<OnboardingTemplate>) => void
  saving: boolean
}) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [totalDays, setTotalDays] = useState(template.totalDays)

  useEffect(() => {
    setName(template.name)
    setDescription(template.description)
    setTotalDays(template.totalDays)
  }, [template])

  const handleSave = () => {
    onSave({ name, description, totalDays })
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Название</label>
        <input
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Описание</label>
        <textarea
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 min-h-[80px]"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Общий срок (дней)</label>
        <input
          type="number"
          className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          value={totalDays}
          onChange={e => setTotalDays(Number(e.target.value))}
        />
      </div>

      {template.stages && template.stages.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Этапы ({template.stages.length})
          </h4>
          <div className="space-y-2">
            {template.stages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-medium">
                  {i + 1}
                </span>
                <span className="flex-1 font-medium text-slate-700">{s.name}</span>
                <span className="text-slate-500">{s.plannedDays} дн.</span>
                <span className="text-slate-400">{s.defaultRole}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {template.roles && template.roles.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Роли</h4>
          <div className="flex flex-wrap gap-2">
            {template.roles.map(r => (
              <span
                key={r.id}
                className="px-3 py-1 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: r.color }}
              >
                {r.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          Сохранить
        </button>
      </div>
    </div>
  )
}

export function TemplatesPage() {
  const toast = useToast()

  const [templates, setTemplates] = useState<OnboardingTemplate[]>([])
  const [selected, setSelected] = useState<OnboardingTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    try {
      setLoading(true)
      const list = await fetchTemplates()
      setTemplates(list)
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить шаблоны')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadList() }, [loadList])

  const handleSelect = useCallback(async (id: string) => {
    try {
      const full = await fetchTemplate(id)
      setSelected(full)
    } catch {
      toast.error('Ошибка', 'Не удалось загрузить шаблон')
    }
  }, [toast])

  const handleSave = useCallback(async (data: Partial<OnboardingTemplate>) => {
    try {
      setSaving(true)
      if (selected?.id) {
        await updateTemplate(selected.id, data)
        toast.success('Шаблон сохранён')
      }
      loadList()
      if (selected?.id) handleSelect(selected.id)
    } catch {
      toast.error('Ошибка', 'Не удалось сохранить шаблон')
    } finally {
      setSaving(false)
    }
  }, [selected, loadList, handleSelect, toast])

  const handleCreate = useCallback(async () => {
    try {
      setSaving(true)
      const created = await createTemplate({
        name: 'Новый шаблон',
        description: '',
        totalDays: 30,
        roles: [],
        isActive: true,
      })
      await loadList()
      setSelected(created)
      toast.success('Шаблон создан')
    } catch {
      toast.error('Ошибка', 'Не удалось создать шаблон')
    } finally {
      setSaving(false)
    }
  }, [loadList, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteTemplate(deleteTarget)
      toast.success('Шаблон удалён')
      if (selected?.id === deleteTarget) setSelected(null)
      setDeleteTarget(null)
      loadList()
    } catch {
      toast.error('Ошибка', 'Не удалось удалить шаблон')
    }
  }, [deleteTarget, selected, loadList, toast])

  if (loading && templates.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="h-full flex p-6 gap-6 overflow-hidden">
      <div className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-slate-800">Шаблоны</h1>
          <button
            onClick={handleCreate}
            className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {templates.map(t => (
            <div
              key={t.id}
              onClick={() => handleSelect(t.id)}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                selected?.id === t.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium truncate">{t.name}</span>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setDeleteTarget(t.id) }}
                className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="rounded-xl border border-slate-200 p-6">
            <TemplateEditor
              template={selected}
              onSave={handleSave}
              saving={saving}
            />
          </div>
        ) : (
          <EmptyState
            title="Выберите шаблон"
            description="Выберите шаблон из списка или создайте новый"
          />
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Удалить шаблон"
        message="Вы уверены, что хотите удалить этот шаблон? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  )
}
