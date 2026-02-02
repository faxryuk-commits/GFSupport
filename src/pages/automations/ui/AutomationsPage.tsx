import { useState, useEffect, useCallback } from 'react'
import { Plus, Zap, Play, Pause, Trash2, Clock, MessageSquare, Users, AlertTriangle, ChevronRight, ToggleLeft, ToggleRight, Loader2, RefreshCw } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'
import { fetchAutomations, createAutomation, deleteAutomation, toggleAutomation, type Automation } from '@/shared/api'

const triggerIcons: Record<string, typeof MessageSquare> = {
  'new_message': MessageSquare,
  'message_problem_detected': AlertTriangle,
  'lead_stage_change': Users,
  'media_received': Clock,
  'escalation_detected': AlertTriangle,
}

const triggerLabels: Record<string, string> = {
  'new_message': 'Новое сообщение',
  'message_problem_detected': 'Обнаружена проблема',
  'lead_stage_change': 'Смена стадии лида',
  'media_received': 'Получен медиафайл',
  'escalation_detected': 'Эскалация',
}

const actionLabels: Record<string, string> = {
  'create_task': 'Создать задачу',
  'create_case': 'Создать кейс',
  'transcribe_and_analyze': 'Транскрибировать и анализировать',
  'escalate': 'Эскалировать',
  'notify': 'Уведомить',
}

export function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    triggerType: '',
    actionType: '',
  })

  const loadAutomations = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await fetchAutomations()
      setAutomations(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки автоматизаций')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAutomations()
  }, [loadAutomations])

  const handleToggleAutomation = async (id: string, currentState: boolean) => {
    try {
      await toggleAutomation(id, !currentState)
      setAutomations(prev => prev.map(a => 
        a.id === id ? { ...a, isActive: !currentState } : a
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка переключения')
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.triggerType || !formData.actionType) return

    try {
      setIsSaving(true)
      await createAutomation({
        name: formData.name,
        description: formData.description,
        triggerType: formData.triggerType,
        actionType: formData.actionType,
      })
      setIsCreateModalOpen(false)
      setFormData({ name: '', description: '', triggerType: '', actionType: '' })
      await loadAutomations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedAutomation) return

    try {
      setIsSaving(true)
      await deleteAutomation(selectedAutomation.id)
      setIsDeleteDialogOpen(false)
      setSelectedAutomation(null)
      await loadAutomations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    } finally {
      setIsSaving(false)
    }
  }

  const activeCount = automations.filter(a => a.isActive).length
  const totalRuns = automations.reduce((sum, a) => sum + (a.executionsCount || 0), 0)

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatLastRun = (dateStr: string | null) => {
    if (!dateStr) return 'Никогда'
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-600">Загрузка автоматизаций...</span>
      </div>
    )
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Автоматизации</h1>
            <p className="text-slate-500 mt-1">Автоматизация рутинных задач и процессов</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={loadAutomations}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Новая автоматизация
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Zap className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{automations.length}</p>
                <p className="text-sm text-slate-500">Всего</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Play className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{activeCount}</p>
                <p className="text-sm text-slate-500">Активных</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <Pause className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{automations.length - activeCount}</p>
                <p className="text-sm text-slate-500">Приостановлено</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{totalRuns.toLocaleString()}</p>
                <p className="text-sm text-slate-500">Выполнений</p>
              </div>
            </div>
          </div>
        </div>

        {/* Automations List */}
        {automations.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Zap className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Нет автоматизаций</p>
            <p className="text-sm mt-1">Создайте первую автоматизацию для начала</p>
          </div>
        ) : (
          <div className="space-y-4">
            {automations.map(automation => {
              const TriggerIcon = triggerIcons[automation.triggerType] || Zap
              
              return (
                <div 
                  key={automation.id}
                  className={`bg-white rounded-xl p-5 border-2 transition-colors ${
                    automation.isActive ? 'border-green-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        automation.isActive ? 'bg-green-100' : 'bg-slate-100'
                      }`}>
                        <TriggerIcon className={`w-6 h-6 ${
                          automation.isActive ? 'text-green-600' : 'text-slate-400'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-slate-800">{automation.name}</h3>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            automation.isActive 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {automation.isActive ? 'Активна' : 'Приостановлена'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">{automation.description || 'Без описания'}</p>
                        
                        {/* Workflow */}
                        <div className="flex items-center gap-3 mt-3 text-sm">
                          <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
                            Когда: {triggerLabels[automation.triggerType] || automation.triggerType}
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                          <span className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg">
                            Тогда: {actionLabels[automation.actionType] || automation.actionType}
                          </span>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                          <span>{automation.executionsCount || 0} выполнений</span>
                          <span>Посл. запуск: {formatLastRun(automation.lastExecutedAt)}</span>
                          <span>Создано: {formatDate(automation.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleAutomation(automation.id, automation.isActive)}
                        className={`p-2 rounded-lg transition-colors ${
                          automation.isActive 
                            ? 'text-green-600 hover:bg-green-50' 
                            : 'text-slate-400 hover:bg-slate-100'
                        }`}
                      >
                        {automation.isActive 
                          ? <ToggleRight className="w-6 h-6" />
                          : <ToggleLeft className="w-6 h-6" />
                        }
                      </button>
                      <button 
                        onClick={() => { setSelectedAutomation(automation); setIsDeleteDialogOpen(true) }}
                        className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новая автоматизация" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input
              type="text"
              placeholder="Например: Автоназначение VIP"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
            <textarea
              placeholder="Опишите что делает эта автоматизация..."
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Триггер (Когда)</label>
              <select 
                value={formData.triggerType}
                onChange={(e) => setFormData(prev => ({ ...prev, triggerType: e.target.value }))}
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Выберите триггер...</option>
                <option value="new_message">Новое сообщение</option>
                <option value="message_problem_detected">Обнаружена проблема</option>
                <option value="lead_stage_change">Смена стадии лида</option>
                <option value="media_received">Получен медиафайл</option>
                <option value="escalation_detected">Эскалация</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Действие (Тогда)</label>
              <select 
                value={formData.actionType}
                onChange={(e) => setFormData(prev => ({ ...prev, actionType: e.target.value }))}
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Выберите действие...</option>
                <option value="create_task">Создать задачу</option>
                <option value="create_case">Создать кейс</option>
                <option value="transcribe_and_analyze">Транскрибировать</option>
                <option value="escalate">Эскалировать</option>
                <option value="notify">Уведомить</option>
              </select>
            </div>
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
              {isSaving ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Удалить автоматизацию"
        message={`Вы уверены, что хотите удалить "${selectedAutomation?.name}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </>
  )
}
