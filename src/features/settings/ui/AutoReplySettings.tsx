import { useState, useEffect } from 'react'
import { Bot, MessageSquare, Clock, Zap, Edit3, Plus, Trash2, Save, RefreshCw } from 'lucide-react'
import { Toggle } from './Toggle'

export interface AutoReplySettingsData {
  enabled: boolean
  greetingEnabled: boolean
  gratitudeEnabled: boolean
  faqEnabled: boolean
  delaySeconds: number
}

export interface AutoReplyTemplate {
  id: string
  intent: string
  template_text: string
  tone: string
  language: string
  priority: number
  usage_count: number
  is_active: boolean
}

interface AutoReplySettingsProps {
  settings: AutoReplySettingsData
  onSettingsChange: (data: AutoReplySettingsData) => void
}

const INTENT_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  greeting: { label: 'Приветствие', description: 'Ответ на "Привет", "Здравствуйте"', icon: '👋' },
  gratitude: { label: 'Благодарность', description: 'Ответ на "Спасибо"', icon: '🙏' },
  closing: { label: 'Прощание', description: 'Ответ на "До свидания"', icon: '👋' },
  faq_pricing: { label: 'FAQ: Цены', description: 'Вопросы о тарифах и стоимости', icon: '💰' },
  faq_hours: { label: 'FAQ: Часы работы', description: 'Вопросы о графике работы', icon: '🕐' },
  faq_contacts: { label: 'FAQ: Контакты', description: 'Запросы контактной информации', icon: '📞' },
}

const TONE_OPTIONS = [
  { value: 'friendly', label: 'Дружелюбный' },
  { value: 'professional', label: 'Профессиональный' },
  { value: 'formal', label: 'Формальный' },
]

export function AutoReplySettings({ settings, onSettingsChange }: AutoReplySettingsProps) {
  const [templates, setTemplates] = useState<AutoReplyTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTemplate, setEditingTemplate] = useState<AutoReplyTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  // Fetch templates on mount
  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/support/auto-reply?action=templates')
      const data = await response.json()
      setTemplates(data.templates || [])
    } catch (e) {
      console.error('Failed to fetch templates:', e)
    } finally {
      setLoading(false)
    }
  }

  const saveTemplate = async (template: AutoReplyTemplate) => {
    setSaving(true)
    try {
      const response = await fetch('/api/support/auto-reply/templates', {
        method: template.id.startsWith('new_') ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      })
      if (response.ok) {
        await fetchTemplates()
        setEditingTemplate(null)
      }
    } catch (e) {
      console.error('Failed to save template:', e)
    } finally {
      setSaving(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Удалить этот шаблон?')) return
    try {
      await fetch(`/api/support/auto-reply/templates?id=${id}`, { method: 'DELETE' })
      await fetchTemplates()
    } catch (e) {
      console.error('Failed to delete template:', e)
    }
  }

  const addNewTemplate = () => {
    setEditingTemplate({
      id: `new_${Date.now()}`,
      intent: 'greeting',
      template_text: '',
      tone: 'friendly',
      language: 'ru',
      priority: 0,
      usage_count: 0,
      is_active: true,
    })
  }

  return (
    <div className="space-y-6">
      {/* Основные настройки автоответов */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
              <Bot className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">AI Автоответы</h3>
              <p className="text-xs text-slate-500">Автоматические ответы на простые сообщения</p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {/* Master toggle */}
          <div className="mb-6 p-4 bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl border border-violet-100">
            <Toggle
              label="Включить автоответы"
              description="Автоматически отвечать на простые сообщения (приветствия, благодарности, FAQ)"
              checked={settings.enabled}
              onChange={(v) => onSettingsChange({ ...settings, enabled: v })}
            />
          </div>

          {settings.enabled && (
            <>
              {/* Category toggles */}
              <div className="space-y-1 p-4 bg-slate-50 rounded-xl mb-6">
                <Toggle
                  label="Приветствия"
                  description="Отвечать на 'Привет', 'Здравствуйте', 'Добрый день'"
                  checked={settings.greetingEnabled}
                  onChange={(v) => onSettingsChange({ ...settings, greetingEnabled: v })}
                />
                <Toggle
                  label="Благодарности"
                  description="Отвечать на 'Спасибо', 'Благодарю'"
                  checked={settings.gratitudeEnabled}
                  onChange={(v) => onSettingsChange({ ...settings, gratitudeEnabled: v })}
                />
                <Toggle
                  label="FAQ вопросы"
                  description="Отвечать на типовые вопросы (цены, график, контакты)"
                  checked={settings.faqEnabled}
                  onChange={(v) => onSettingsChange({ ...settings, faqEnabled: v })}
                />
              </div>

              {/* Delay setting */}
              <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700">Задержка перед ответом</label>
                  <p className="text-xs text-slate-500">Чтобы ответ выглядел естественнее</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={settings.delaySeconds}
                    onChange={(e) => onSettingsChange({ ...settings, delaySeconds: Number(e.target.value) })}
                    className="w-20 px-3 py-2 bg-white border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300"
                  />
                  <span className="text-sm text-slate-500">сек</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Шаблоны ответов */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Шаблоны ответов</h3>
              <p className="text-xs text-slate-500">Настройте текст автоответов</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchTemplates}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              title="Обновить"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={addNewTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        </div>
        
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Нет шаблонов</p>
              <button onClick={addNewTemplate} className="mt-2 text-blue-500 hover:underline text-sm">
                Создать первый шаблон
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => {
                const intentInfo = INTENT_LABELS[template.intent] || { 
                  label: template.intent, 
                  description: '', 
                  icon: '💬' 
                }
                
                return (
                  <div
                    key={template.id}
                    className={`p-4 rounded-xl border transition-all ${
                      template.is_active 
                        ? 'bg-white border-slate-200 hover:border-slate-300' 
                        : 'bg-slate-50 border-slate-100 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="text-2xl">{intentInfo.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-800">{intentInfo.label}</span>
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            template.tone === 'friendly' ? 'bg-green-100 text-green-700' :
                            template.tone === 'professional' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {TONE_OPTIONS.find(t => t.value === template.tone)?.label || template.tone}
                          </span>
                          {template.usage_count > 0 && (
                            <span className="text-xs text-slate-400">
                              Использован {template.usage_count}×
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 break-words">{template.template_text}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingTemplate(template)}
                          className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          title="Редактировать"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteTemplate(template.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
              <h3 className="font-semibold text-slate-800">
                {editingTemplate.id.startsWith('new_') ? 'Новый шаблон' : 'Редактировать шаблон'}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Тип сообщения</label>
                <select
                  value={editingTemplate.intent}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, intent: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 focus:bg-white transition-all"
                >
                  {Object.entries(INTENT_LABELS).map(([key, info]) => (
                    <option key={key} value={key}>{info.icon} {info.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Текст ответа</label>
                <textarea
                  value={editingTemplate.template_text}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, template_text: e.target.value })}
                  rows={4}
                  placeholder="Используйте {client_name} для имени клиента"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 focus:bg-white transition-all resize-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Переменные: {'{client_name}'} — имя клиента, {'{name}'} — имя или "клиент"
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Тон</label>
                  <select
                    value={editingTemplate.tone}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, tone: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 focus:bg-white transition-all"
                  >
                    {TONE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Приоритет</label>
                  <input
                    type="number"
                    value={editingTemplate.priority}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, priority: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
                <input
                  type="checkbox"
                  id="template-active"
                  checked={editingTemplate.is_active}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-violet-500 focus:ring-violet-500"
                />
                <label htmlFor="template-active" className="text-sm text-slate-700">
                  Шаблон активен
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setEditingTemplate(null)}
                className="px-5 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl transition-all font-medium"
              >
                Отмена
              </button>
              <button
                onClick={() => saveTemplate(editingTemplate)}
                disabled={saving || !editingTemplate.template_text.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-xl hover:bg-violet-600 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
