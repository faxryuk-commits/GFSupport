/**
 * AutomationsTab Component
 * Self-contained component for managing automation rules
 * Handles its own API calls for CRUD operations
 */

import { useState, useEffect, useCallback } from 'react'
import { Zap, Activity, Plus, X, RefreshCw } from 'lucide-react'
import type { Automation, ConfirmDialogState } from './types'

interface AutomationsTabProps {
  setConfirmDialog: (state: ConfirmDialogState) => void
}

interface NewAutomation {
  name: string
  description: string
  triggerType: string
  actionType: string
  triggerConfig: Record<string, any>
  actionConfig: Record<string, any>
  priority: number
}

const TRIGGER_LABELS: Record<string, string> = {
  'message_received': 'Новое сообщение',
  'message_problem_detected': 'Проблема в сообщении',
  'media_received': 'Получено медиа',
  'escalation_detected': 'Эскалация',
  'lead_stage_change': 'Смена стадии лида',
  'case_status_change': 'Смена статуса кейса'
}

const ACTION_LABELS: Record<string, string> = {
  'create_case': 'Создать кейс',
  'create_task': 'Создать задачу',
  'send_notification': 'Уведомление',
  'escalate': 'Эскалация',
  'assign_manager': 'Назначить менеджера',
  'transcribe_and_analyze': 'Транскрибировать'
}

export function AutomationsTab({ setConfirmDialog }: AutomationsTabProps) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newAutomation, setNewAutomation] = useState<NewAutomation>({
    name: '',
    description: '',
    triggerType: 'message_problem_detected',
    actionType: 'create_case',
    triggerConfig: {},
    actionConfig: {},
    priority: 0
  })

  // Get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('support_agent_token') || ''
    return {
      'Content-Type': 'application/json',
      'Authorization': token.startsWith('Bearer') ? token : `Bearer ${token}`
    }
  }, [])

  // Load automations
  const loadAutomations = useCallback(async () => {
    try {
      const res = await fetch('/api/support/automations', {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        setAutomations(data.automations || [])
      }
    } catch (e) {
      console.error('Failed to load automations:', e)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useEffect(() => {
    loadAutomations()
  }, [loadAutomations])

  // Toggle automation
  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/support/automations', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ id, isActive })
      })
      setAutomations(prev => prev.map(a => 
        a.id === id ? { ...a, isActive } : a
      ))
    } catch (e) {
      console.error('Failed to toggle automation:', e)
    }
  }

  // Delete automation
  const handleDelete = (auto: Automation) => {
    setConfirmDialog({
      show: true,
      title: 'Удаление автоматизации',
      message: `Удалить автоматизацию "${auto.name}"?`,
      danger: true,
      onConfirm: async () => {
        try {
          await fetch(`/api/support/automations?id=${auto.id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
          })
          setAutomations(prev => prev.filter(a => a.id !== auto.id))
        } catch (e) {
          console.error('Failed to delete automation:', e)
        }
      }
    })
  }

  // Create automation
  const handleCreate = async () => {
    if (!newAutomation.name.trim()) {
      alert('Введите название')
      return
    }
    
    setCreating(true)
    try {
      const res = await fetch('/api/support/automations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(newAutomation)
      })
      
      if (res.ok) {
        const data = await res.json()
        setAutomations(prev => [...prev, {
          id: data.automationId,
          ...newAutomation,
          isActive: true,
          executionsCount: 0
        } as Automation])
        setShowModal(false)
        setNewAutomation({
          name: '',
          description: '',
          triggerType: 'message_problem_detected',
          actionType: 'create_case',
          triggerConfig: {},
          actionConfig: {},
          priority: 0
        })
      } else {
        alert('Ошибка создания автоматизации')
      }
    } catch (e) {
      console.error('Failed to create automation:', e)
      alert('Ошибка создания автоматизации')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-slate-800">Автоматизации</h3>
          <p className="text-sm text-slate-500">Правила автоматической обработки событий</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAutomations}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            title="Обновить"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
          >
            <Plus className="w-4 h-4" />
            Новое правило
          </button>
        </div>
      </div>

      {/* Empty state */}
      {automations.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-12 text-center">
          <Zap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-800">Нет автоматизаций</h3>
          <p className="text-slate-500 mt-1">Создайте правила для автоматической обработки событий</p>
          <button 
            onClick={() => setShowModal(true)}
            className="mt-4 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
          >
            Создать первую автоматизацию
          </button>
        </div>
      ) : (
        /* Automations list */
        <div className="space-y-4">
          {automations.map(auto => (
            <div key={auto.id} className="bg-white rounded-xl p-5 border border-slate-200 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${auto.isActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                    <Zap className={`w-5 h-5 ${auto.isActive ? 'text-green-600' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <h4 className="font-medium text-slate-800">{auto.name}</h4>
                    <p className="text-sm text-slate-500 mt-1">{auto.description || 'Без описания'}</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        Триггер: {TRIGGER_LABELS[auto.triggerType] || auto.triggerType || 'Не указан'}
                      </span>
                      <span>→</span>
                      <span>Действие: {ACTION_LABELS[auto.actionType] || auto.actionType || 'Не указано'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-medium text-slate-700">{auto.executionsCount || 0}</div>
                    <div className="text-xs text-slate-400">выполнений</div>
                  </div>
                  <button 
                    onClick={() => handleToggle(auto.id, !auto.isActive)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${auto.isActive ? 'bg-green-500' : 'bg-slate-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${auto.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(auto)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Новая автоматизация</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
                <input
                  type="text"
                  value={newAutomation.name}
                  onChange={e => setNewAutomation({ ...newAutomation, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  placeholder="Например: Проблема → Кейс"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
                <textarea
                  value={newAutomation.description}
                  onChange={e => setNewAutomation({ ...newAutomation, description: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  rows={2}
                  placeholder="Что делает эта автоматизация"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Триггер (когда срабатывает)</label>
                <select
                  value={newAutomation.triggerType}
                  onChange={e => setNewAutomation({ ...newAutomation, triggerType: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                >
                  <option value="message_received">Получено сообщение</option>
                  <option value="message_problem_detected">Обнаружена проблема в сообщении</option>
                  <option value="media_received">Получено медиа (голосовое/видео)</option>
                  <option value="escalation_detected">Обнаружена эскалация</option>
                  <option value="lead_stage_change">Смена стадии лида</option>
                  <option value="case_status_change">Смена статуса кейса</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Действие (что делать)</label>
                <select
                  value={newAutomation.actionType}
                  onChange={e => setNewAutomation({ ...newAutomation, actionType: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                >
                  <option value="create_case">Создать кейс поддержки</option>
                  <option value="create_task">Создать задачу</option>
                  <option value="send_notification">Отправить уведомление</option>
                  <option value="escalate">Эскалировать</option>
                  <option value="assign_manager">Назначить менеджера</option>
                  <option value="transcribe_and_analyze">Транскрибировать и анализировать</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Приоритет (выше = раньше)</label>
                <input
                  type="number"
                  value={newAutomation.priority}
                  onChange={e => setNewAutomation({ ...newAutomation, priority: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  min="0"
                  max="100"
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
              >
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AutomationsTab
