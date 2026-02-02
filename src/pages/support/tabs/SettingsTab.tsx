import { useState } from 'react'
import { 
  RefreshCw, Save, Bot, Key, Bell, TestTube, Users, Clock,
  MessageSquare, Edit2, Trash2, Plus, X, Zap, Activity,
  Copy, Check, Link2, UserPlus
} from 'lucide-react'
import type { 
  Settings, AIPatterns, SupportAgent, TeamMetrics, Automation, 
  ConfirmDialogState 
} from './types'
import { AgentBinding } from './AgentBinding'
import { AutomationsTab } from './AutomationsTab'

interface Conversation {
  id: string
  channelName: string
  startedAt: string
  firstResponseTimeMin: number | null
  resolutionTimeMin: number | null
  status: string
  agentName: string | null
}

interface SettingsTabProps {
  settings: Settings | null
  aiPatterns: AIPatterns | null
  automations: Automation[]
  agents: SupportAgent[]
  teamMetrics: TeamMetrics | null
  conversations: Conversation[]
  agentActivity: any[]
  activityPeriod: 'day' | 'week' | 'month'
  envStatus: { TELEGRAM_BOT_TOKEN: boolean; OPENAI_API_KEY: boolean }
  loading: boolean
  saving: boolean
  onSettingsChange: (settings: Settings) => void
  onPatternsChange: (patterns: AIPatterns) => void
  onSaveSettings: () => void
  onSavePatterns: () => void
  onTestBot: () => Promise<{ success: boolean; bot?: { username: string }; error?: string }>
  onActivityPeriodChange: (period: 'day' | 'week' | 'month') => void
  onEditAgent: (agent: SupportAgent) => void
  onDeleteAgent: (agentId: string) => void
  onToggleAutomation: (id: string, isActive: boolean) => void
  onDeleteAutomation: (id: string) => void
  onCreateAutomation: () => void
  onCreateInvite?: () => Promise<{ url: string } | null>
  setConfirmDialog: (state: ConfirmDialogState) => void
  loadData: () => void
}

export function SettingsTab({
  settings,
  aiPatterns,
  automations,
  agents,
  teamMetrics,
  conversations,
  agentActivity,
  activityPeriod,
  envStatus,
  loading,
  saving,
  onSettingsChange,
  onPatternsChange,
  onSaveSettings,
  onSavePatterns,
  onTestBot,
  onActivityPeriodChange,
  onEditAgent,
  onDeleteAgent,
  onToggleAutomation,
  onDeleteAutomation,
  onCreateAutomation,
  onCreateInvite,
  setConfirmDialog,
  loadData,
}: SettingsTabProps) {
  const [settingsTab, setSettingsTab] = useState<'general' | 'patterns' | 'scoring' | 'team' | 'automations'>('general')
  const [botTestResult, setBotTestResult] = useState<{ success: boolean; bot?: { username: string }; error?: string } | null>(null)
  
  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [showTelegramBinding, setShowTelegramBinding] = useState(false)

  const handleCreateInvite = async () => {
    if (!onCreateInvite) return
    const result = await onCreateInvite()
    if (result?.url) {
      setInviteUrl(result.url)
      setInviteCopied(false)
      setShowInviteModal(true)
    }
  }

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(inviteUrl)
    setInviteCopied(true)
  }

  const handleTestBot = async () => {
    const result = await onTestBot()
    setBotTestResult(result)
  }

  const handleDeleteAgent = (agent: SupportAgent) => {
    setConfirmDialog({
      show: true,
      title: 'Удаление сотрудника',
      message: `Удалить сотрудника ${agent.name}?`,
      danger: true,
      onConfirm: () => onDeleteAgent(agent.id)
    })
  }

  const handleDeleteAutomation = (auto: Automation) => {
    setConfirmDialog({
      show: true,
      title: 'Удаление автоматизации',
      message: 'Вы уверены, что хотите удалить эту автоматизацию?',
      danger: true,
      onConfirm: () => onDeleteAutomation(auto.id)
    })
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-medium text-slate-800">Настройки Support</h2>
          <p className="text-sm text-slate-500">Конфигурация бота, AI и автоматизаций</p>
        </div>
        <button
          onClick={onSaveSettings}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue disabled:opacity-50"
        >
          <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
          Сохранить
        </button>
      </div>

      {/* Settings Sub-tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-200 overflow-x-auto">
        {[
          { id: 'general', label: 'Основные' },
          { id: 'automations', label: 'Автоматизации' },
          { id: 'patterns', label: 'AI Паттерны' },
          { id: 'scoring', label: 'Скоринг' },
          { id: 'team', label: 'Команда' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              settingsTab === tab.id 
                ? 'border-brand-blue text-brand-blue' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* GENERAL SETTINGS */}
      {settingsTab === 'general' && (
        <div className="space-y-6">
          {/* Bot Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-500" />
              Telegram Bot
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bot Token</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settings.telegram_bot_token}
                    onChange={e => onSettingsChange({ ...settings, telegram_bot_token: e.target.value })}
                    placeholder="Оставьте пустым для использования env"
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  />
                  <button
                    onClick={handleTestBot}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                  >
                    <TestTube className="w-4 h-4" />
                    Тест
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Env статус: {envStatus.TELEGRAM_BOT_TOKEN ? '✅ настроен' : '❌ не настроен'}
                </p>
                {botTestResult && (
                  <div className={`mt-2 p-3 rounded-lg text-sm ${botTestResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {botTestResult.success 
                      ? `✅ Бот подключен: @${botTestResult.bot?.username}` 
                      : `❌ Ошибка: ${botTestResult.error}`
                    }
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chat ID для уведомлений</label>
                <input
                  type="text"
                  value={settings.notify_chat_id}
                  onChange={e => onSettingsChange({ ...settings, notify_chat_id: e.target.value })}
                  placeholder="ID чата или группы"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
            </div>
          </div>

          {/* AI Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-500" />
              AI / OpenAI
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">AI Model</label>
                <select
                  value={settings.ai_model}
                  onChange={e => onSettingsChange({ ...settings, ai_model: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (быстрый, дешёвый)</option>
                  <option value="gpt-4o">GPT-4o (умный)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>
              </div>
              
              <p className="text-xs text-slate-500">
                OpenAI API Key: {envStatus.OPENAI_API_KEY ? '✅ настроен в env' : '❌ не настроен'}
              </p>
            </div>
          </div>

          {/* Automation Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-orange-500" />
              Автоматизация
            </h3>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.auto_create_cases}
                  onChange={e => onSettingsChange({ ...settings, auto_create_cases: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">Автоматически создавать кейсы при обнаружении проблем</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.auto_transcribe_voice}
                  onChange={e => onSettingsChange({ ...settings, auto_transcribe_voice: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">Автоматически транскрибировать голосовые сообщения</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.notify_on_problem}
                  onChange={e => onSettingsChange({ ...settings, notify_on_problem: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">Отправлять уведомления при обнаружении проблем</span>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Минимальный urgency для создания кейса (0-5)
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={settings.min_urgency_for_case}
                  onChange={e => onSettingsChange({ ...settings, min_urgency_for_case: parseInt(e.target.value) || 0 })}
                  className="w-24 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AUTOMATIONS TAB - Self-contained component */}
      {settingsTab === 'automations' && (
        <AutomationsTab setConfirmDialog={setConfirmDialog} />
      )}

      {/* AI PATTERNS TAB */}
      {settingsTab === 'patterns' && aiPatterns && (
        <div className="space-y-6">
          {/* Uzbek Keywords */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-xl">🇺🇿</span>
              Узбекские ключевые слова
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Слова на узбекском языке для определения категорий и проблем
            </p>
            
            <div className="space-y-4">
              {aiPatterns?.uzbek_keywords && Object.entries(aiPatterns.uzbek_keywords).map(([category, words]: [string, any]) => (
                <div key={category}>
                  <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">{category}</label>
                  <input
                    type="text"
                    value={Array.isArray(words) ? words.join(', ') : ''}
                    onChange={e => {
                      const newWords = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                      onPatternsChange({
                        ...aiPatterns,
                        uzbek_keywords: {
                          ...aiPatterns.uzbek_keywords,
                          [category]: newWords
                        }
                      })
                    }}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 text-sm"
                    placeholder="слово1, слово2, слово3"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Russian Problem Words */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-xl">🇷🇺</span>
              Русские слова-проблемы
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Слова указывающие на проблему
              </label>
              <textarea
                value={aiPatterns?.russian_problem_words?.join(', ') || ''}
                onChange={e => {
                  const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                  onPatternsChange({ ...aiPatterns, russian_problem_words: words })
                }}
                rows={3}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 text-sm"
                placeholder="не работает, ошибка, проблема, баг..."
              />
            </div>
          </div>

          {/* Save Patterns Button */}
          <button
            onClick={onSavePatterns}
            disabled={saving}
            className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 font-medium"
          >
            Сохранить паттерны
          </button>
        </div>
      )}

      {/* SCORING TAB */}
      {settingsTab === 'scoring' && aiPatterns && (
        <div className="space-y-6">
          {/* Urgency Rules */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-xl">🎯</span>
              Правила Urgency скоринга
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Автоматическое повышение urgency на основе условий
            </p>
            
            <div className="space-y-3">
              {aiPatterns?.urgency_rules?.map((rule: any, idx: number) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium text-sm text-slate-700">{rule.description}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {rule.mrr_threshold && `MRR >= $${rule.mrr_threshold}`}
                      {rule.hours && `Время: ${rule.hours} часов`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">+</span>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={rule.score}
                      onChange={e => {
                        const newRules = [...(aiPatterns.urgency_rules || [])]
                        newRules[idx] = { ...rule, score: parseInt(e.target.value) || 0 }
                        onPatternsChange({ ...aiPatterns, urgency_rules: newRules })
                      }}
                      className="w-16 px-2 py-1 border border-slate-200 rounded text-center text-sm"
                    />
                    <span className="text-sm text-slate-500">к urgency</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Commitment Detection */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-xl">🤝</span>
              Обнаружение обещаний
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Размытые обещания (опасные!)
                </label>
                <textarea
                  value={aiPatterns?.commitment_patterns?.vague?.join(', ') || ''}
                  onChange={e => {
                    const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                    onPatternsChange({
                      ...aiPatterns,
                      commitment_patterns: {
                        ...aiPatterns?.commitment_patterns,
                        vague: words
                      }
                    })
                  }}
                  rows={2}
                  className="w-full px-4 py-2 border border-orange-200 bg-orange-50 rounded-lg text-sm"
                  placeholder="посмотрим, разберёмся, решим..."
                />
                <p className="text-xs text-orange-600 mt-1">
                  Эти слова создают напоминание через 4 часа
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Слова обратного звонка
                </label>
                <input
                  type="text"
                  value={aiPatterns?.commitment_patterns?.callback?.join(', ') || ''}
                  onChange={e => {
                    const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                    onPatternsChange({
                      ...aiPatterns,
                      commitment_patterns: {
                        ...aiPatterns?.commitment_patterns,
                        callback: words
                      }
                    })
                  }}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                  placeholder="перезвоню, напишу, свяжусь..."
                />
              </div>
            </div>
          </div>

          {/* Save Scoring Button */}
          <button
            onClick={onSavePatterns}
            disabled={saving}
            className="w-full py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 disabled:opacity-50 font-medium"
          >
            Сохранить скоринг
          </button>
        </div>
      )}

      {/* TEAM TAB */}
      {settingsTab === 'team' && (
        <div className="space-y-6">
          {/* Team Metrics Overview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
              <div className="text-2xl font-bold text-green-600">{agents.filter(a => a.status === 'online').length}</div>
              <div className="text-xs text-slate-500 mt-1">Онлайн</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
              <div className="text-2xl font-bold text-slate-700">{agents.length}</div>
              <div className="text-xs text-slate-500 mt-1">Всего сотрудников</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
              <div className="text-2xl font-bold text-blue-600">{teamMetrics?.avgFirstResponseMin ? `${Math.round(teamMetrics.avgFirstResponseMin)}м` : '—'}</div>
              <div className="text-xs text-slate-500 mt-1">Ср. первый ответ</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
              <div className="text-2xl font-bold text-purple-600">{teamMetrics?.avgResolutionMin ? `${Math.round(teamMetrics.avgResolutionMin)}м` : '—'}</div>
              <div className="text-xs text-slate-500 mt-1">Ср. время решения</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
              <div className="text-2xl font-bold text-emerald-600">{teamMetrics?.resolvedToday || 0}</div>
              <div className="text-xs text-slate-500 mt-1">Решено сегодня</div>
            </div>
          </div>

          {/* Team Members */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Сотрудники поддержки
              </h3>
              <div className="flex items-center gap-2">
                {onCreateInvite && (
                  <button
                    onClick={handleCreateInvite}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                    title="Создать ссылку-приглашение для нового сотрудника"
                  >
                    <UserPlus className="w-4 h-4" />
                    Пригласить
                  </button>
                )}
                <button
                  onClick={() => onEditAgent({ id: '', name: '', username: '', email: '', telegramId: '', role: 'agent', status: 'offline', assignedChannels: 0, activeChats: 0, metrics: { totalConversations: 0, resolvedConversations: 0, avgFirstResponseMin: 0, avgResolutionMin: 0, satisfactionScore: 0, messagesHandled: 0, escalations: 0 } })}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-blue text-white rounded-lg hover:bg-blue-600"
                  title="Добавить сотрудника вручную"
                >
                  <Plus className="w-4 h-4" />
                  Добавить
                </button>
              </div>
            </div>

            {agents.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500">Нет сотрудников</p>
                <p className="text-sm text-slate-400">Добавьте первого сотрудника</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {agents.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between py-4 hover:bg-slate-50 transition-colors -mx-2 px-2 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium text-lg ${
                        agent.status === 'online' ? 'bg-green-500' : agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-400'
                      }`}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-slate-800">{agent.name}</div>
                        <div className="text-sm text-slate-500">
                          {agent.username && `@${agent.username}`}
                          {agent.email && ` • ${agent.email}`}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            agent.status === 'online' ? 'bg-green-100 text-green-700' : 
                            agent.status === 'away' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              agent.status === 'online' ? 'bg-green-500' : 
                              agent.status === 'away' ? 'bg-yellow-500' : 'bg-slate-400'
                            }`} />
                            {agent.status === 'online' ? 'Онлайн' : agent.status === 'away' ? 'Отошёл' : 'Офлайн'}
                          </span>
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                            {agent.role === 'manager' ? 'Менеджер' : agent.role === 'lead' ? 'Тимлид' : agent.role === 'senior' ? 'Старший' : 'Агент'}
                          </span>
                          {agent.telegramId && (
                            <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded-full text-xs font-medium">
                              TG: {agent.telegramId}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-lg font-semibold text-slate-800">{agent.metrics?.messagesHandled || 0}</div>
                        <div className="text-xs text-slate-500">Сообщений</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-green-600">{agent.metrics?.resolvedConversations || 0}</div>
                        <div className="text-xs text-slate-500">Решено</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onEditAgent(agent)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Редактировать"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Telegram Binding Section */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button
              onClick={() => setShowTelegramBinding(!showTelegramBinding)}
              className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Link2 className="w-5 h-5 text-cyan-500" />
                <div className="text-left">
                  <h3 className="font-medium text-slate-800">Привязка Telegram</h3>
                  <p className="text-sm text-slate-500">Автоматическое определение ответов сотрудников</p>
                </div>
              </div>
              <div className={`transform transition-transform ${showTelegramBinding ? 'rotate-180' : ''}`}>
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {showTelegramBinding && (
              <div className="p-4 border-t border-slate-200">
                <AgentBinding />
              </div>
            )}
          </div>

          {/* Work Time Tracking */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-slate-800 flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-500" />
                Учёт рабочего времени
              </h3>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['day', 'week', 'month'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => onActivityPeriodChange(p)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      activityPeriod === p 
                        ? 'bg-white text-slate-800 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {p === 'day' ? 'День' : p === 'week' ? 'Неделя' : 'Месяц'}
                  </button>
                ))}
              </div>
            </div>

            {agentActivity.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">
                Нет данных о рабочем времени
              </p>
            ) : (
              <div className="space-y-4">
                {agentActivity.map((agent: any) => (
                  <div key={agent.agentId} className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-medium text-sm">
                          {agent.agentName?.charAt(0) || '?'}
                        </div>
                        <span className="font-medium text-slate-800">{agent.agentName}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        agent.summary?.efficiency >= 70 ? 'bg-green-100 text-green-700' :
                        agent.summary?.efficiency >= 40 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        Эффективность: {agent.summary?.efficiency || 0}%
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div className="text-center p-2 bg-slate-50 rounded-lg">
                        <div className="text-lg font-bold text-slate-800">{agent.summary?.totalWorkFormatted || '0ч'}</div>
                        <div className="text-[10px] text-slate-500">Рабочее время</div>
                      </div>
                      <div className="text-center p-2 bg-purple-50 rounded-lg">
                        <div className="text-lg font-bold text-purple-600">{agent.summary?.effectiveFormatted || '0ч'}</div>
                        <div className="text-[10px] text-slate-500">Эффективное</div>
                      </div>
                      <div className="text-center p-2 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">{agent.activity?.messagesSent || 0}</div>
                        <div className="text-[10px] text-slate-500">Сообщений</div>
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">{agent.summary?.daysWorked || 0}</div>
                        <div className="text-[10px] text-slate-500">Дней</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Conversations */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-500" />
              Недавние разговоры
            </h3>
            
            {conversations.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">
                Нет данных о разговорах
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium text-slate-500">Канал</th>
                      <th className="text-left py-2 font-medium text-slate-500">Начало</th>
                      <th className="text-left py-2 font-medium text-slate-500">Первый ответ</th>
                      <th className="text-left py-2 font-medium text-slate-500">Статус</th>
                      <th className="text-left py-2 font-medium text-slate-500">Агент</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversations.slice(0, 10).map(conv => (
                      <tr key={conv.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2 font-medium">{conv.channelName}</td>
                        <td className="py-2 text-slate-600">
                          {new Date(conv.startedAt).toLocaleString('ru')}
                        </td>
                        <td className="py-2">
                          {conv.firstResponseTimeMin !== null ? (
                            <span className={`font-medium ${conv.firstResponseTimeMin <= 5 ? 'text-green-600' : conv.firstResponseTimeMin <= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {conv.firstResponseTimeMin}м
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            conv.status === 'resolved' ? 'bg-green-100 text-green-700' :
                            conv.status === 'active' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {conv.status}
                          </span>
                        </td>
                        <td className="py-2 text-slate-600">{conv.agentName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Ссылка-приглашение</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-sm text-slate-500 mb-4">
              Отправьте эту ссылку новому сотруднику для регистрации. Ссылка действует 7 дней.
            </p>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteUrl}
                readOnly
                className="flex-1 px-4 py-2 bg-slate-100 rounded-lg text-sm"
              />
              <button
                onClick={copyInviteUrl}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  inviteCopied ? 'bg-green-100 text-green-700' : 'bg-brand-blue text-white hover:bg-brand-darkBlue'
                }`}
              >
                {inviteCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {inviteCopied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default SettingsTab
