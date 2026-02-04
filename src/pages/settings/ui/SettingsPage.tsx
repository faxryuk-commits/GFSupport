import { useState, useEffect, useCallback } from 'react'
import { 
  Settings, Bell, Link2, Shield, Database, Palette, Save, RefreshCw, 
  AlertCircle, Loader2, UsersRound, Users, Zap, ChevronRight, Check,
  Building2, Globe, Bot, Clock, Volume2, UserCog
} from 'lucide-react'
import {
  GeneralSettings,
  NotificationsSettings,
  IntegrationsSettings,
  SecuritySettings,
  ApiKeysSettings,
  AppearanceSettings,
  AutoReplySettings,
  type GeneralSettingsData,
  type ResponseSettingsData,
  type NotificationSetting,
  type Integration,
  type SecuritySettingsData,
  type ApiKey,
  type AppearanceSettingsData,
  type AutoReplySettingsData,
} from '@/features/settings/ui'
import {
  fetchSettings,
  updateSettings,
  testBotConnection,
  type BackendSettings,
  type EnvStatus,
} from '@/shared/api'
import { TeamPage } from '@/pages/team/ui/TeamPage'
import { UsersPage } from '@/pages/users/ui/UsersPage'
import { AutomationsPage } from '@/pages/automations/ui/AutomationsPage'

type SettingsTab = 'general' | 'team' | 'users' | 'automations' | 'autoreply' | 'notifications' | 'integrations' | 'security' | 'api' | 'appearance'

interface TabConfig {
  id: SettingsTab
  label: string
  description: string
  icon: typeof Settings
  color: string
  bgColor: string
}

const tabs: TabConfig[] = [
  { id: 'general', label: 'Основные', description: 'Общие настройки системы', icon: Settings, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  { id: 'team', label: 'Команда', description: 'Управление сотрудниками', icon: UsersRound, color: 'text-violet-600', bgColor: 'bg-violet-100' },
  { id: 'users', label: 'Клиенты', description: 'База клиентов и партнёров', icon: Users, color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  { id: 'automations', label: 'Автоматизации', description: 'Правила и триггеры', icon: Zap, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  { id: 'autoreply', label: 'AI Автоответы', description: 'Приветствия, FAQ, шаблоны', icon: Bot, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  { id: 'notifications', label: 'Уведомления', description: 'Настройка оповещений', icon: Bell, color: 'text-rose-600', bgColor: 'bg-rose-100' },
  { id: 'integrations', label: 'Интеграции', description: 'Telegram, AI, Whisper', icon: Link2, color: 'text-cyan-600', bgColor: 'bg-cyan-100' },
  { id: 'security', label: 'Безопасность', description: 'Защита и доступы', icon: Shield, color: 'text-orange-600', bgColor: 'bg-orange-100' },
  { id: 'api', label: 'API ключи', description: 'Интеграция с внешними системами', icon: Database, color: 'text-indigo-600', bgColor: 'bg-indigo-100' },
  { id: 'appearance', label: 'Внешний вид', description: 'Тема и персонализация', icon: Palette, color: 'text-pink-600', bgColor: 'bg-pink-100' },
]

// Initial data for local settings
const initialNotifications: NotificationSetting[] = [
  { id: '1', label: 'Новые сообщения', description: 'Когда клиент отправляет сообщение', email: true, push: true, inApp: true },
  { id: '2', label: 'Назначения кейсов', description: 'Когда вам назначают кейс', email: true, push: true, inApp: true },
  { id: '3', label: 'Обновления кейсов', description: 'Изменение статуса кейса', email: false, push: true, inApp: true },
  { id: '4', label: 'SLA предупреждения', description: 'Приближение дедлайна SLA', email: true, push: true, inApp: true },
  { id: '5', label: 'Упоминания', description: 'Когда вас упоминают в комментарии', email: false, push: true, inApp: true },
  { id: '6', label: 'Ежедневная сводка', description: 'Ежедневный отчёт активности', email: true, push: false, inApp: false },
]

const initialApiKeys: ApiKey[] = []

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)

  // Settings state
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsData>({
    companyName: 'Support System',
    botToken: '',
    defaultLanguage: 'ru',
    timezone: 'UTC+5',
    autoCreateCases: true,
    soundNotifications: true,
    autoAssignment: true,
  })

  const [responseSettings, setResponseSettings] = useState<ResponseSettingsData>({
    targetResponseTime: 5,
    targetResolutionTime: 60,
    slaTarget: 99,
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  })

  const [notifications, setNotifications] = useState(initialNotifications)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState(false)

  const [securitySettings, setSecuritySettings] = useState<SecuritySettingsData>({
    twoFactorEnabled: true,
    sessionTimeout: 30,
    ipWhitelist: '',
    passwordExpiry: 90,
  })

  const [apiKeys, setApiKeys] = useState(initialApiKeys)

  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettingsData>({
    theme: 'light',
    primaryColor: '#3b82f6',
    sidebarCollapsed: false,
    compactMode: false,
  })

  const [autoReplySettings, setAutoReplySettings] = useState<AutoReplySettingsData>({
    enabled: true,
    greetingEnabled: true,
    gratitudeEnabled: true,
    faqEnabled: true,
    delaySeconds: 1,
  })

  // Загрузка настроек с сервера
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetchSettings()
      const { settings, envStatus: env } = response
      
      setEnvStatus(env)
      
      setGeneralSettings(prev => ({
        ...prev,
        botToken: settings.telegram_bot_token || '',
        autoCreateCases: settings.auto_create_cases,
      }))
      
      setResponseSettings(prev => ({
        ...prev,
        workingHoursStart: `${String(settings.working_hours_start).padStart(2, '0')}:00`,
        workingHoursEnd: `${String(settings.working_hours_end).padStart(2, '0')}:00`,
      }))

      const telegramConnected = env.TELEGRAM_BOT_TOKEN || !!settings.telegram_bot_token
      const openaiConnected = env.OPENAI_API_KEY || !!settings.openai_api_key
      
      setIntegrations([
        { 
          id: '1', 
          name: 'Telegram Bot', 
          description: settings.telegram_bot_username ? `@${settings.telegram_bot_username}` : 'Подключение к Telegram', 
          icon: '📱', 
          status: telegramConnected ? 'connected' : 'disconnected',
          lastSync: telegramConnected ? 'Подключено' : undefined
        },
        { 
          id: '2', 
          name: 'OpenAI API', 
          description: `Модель: ${settings.ai_model}`, 
          icon: '🤖', 
          status: openaiConnected ? 'connected' : 'disconnected',
          lastSync: openaiConnected ? 'Активно' : undefined
        },
        { 
          id: '3', 
          name: 'Whisper (Транскрибация)', 
          description: `Язык: ${settings.whisper_language === 'ru' ? 'Русский' : settings.whisper_language}`, 
          icon: '🎤', 
          status: settings.auto_transcribe_voice ? 'connected' : 'disconnected',
          lastSync: settings.auto_transcribe_voice ? 'Включено' : undefined
        },
        { 
          id: '4', 
          name: 'Уведомления в Telegram', 
          description: settings.notify_chat_id ? `Chat ID: ${settings.notify_chat_id}` : 'Не настроено', 
          icon: '🔔', 
          status: settings.notify_on_problem && settings.notify_chat_id ? 'connected' : 'disconnected',
          lastSync: settings.notify_on_problem ? 'Активно' : undefined
        },
      ])
      
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err)
      setError(err instanceof Error ? err.message : 'Не удалось загрузить настройки')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Сохранение настроек
  const handleSave = async () => {
    try {
      setIsSaving(true)
      setError(null)
      setSaveMessage(null)
      
      const settingsToSave: Partial<BackendSettings> = {
        auto_create_cases: generalSettings.autoCreateCases,
        working_hours_start: parseInt(responseSettings.workingHoursStart.split(':')[0]),
        working_hours_end: parseInt(responseSettings.workingHoursEnd.split(':')[0]),
      }
      
      const response = await updateSettings(settingsToSave)
      
      if (response.success) {
        setSaveMessage(`Сохранено: ${response.updated.length} настроек`)
        setTimeout(() => setSaveMessage(null), 3000)
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err)
      setError(err instanceof Error ? err.message : 'Не удалось сохранить настройки')
    } finally {
      setIsSaving(false)
    }
  }

  // Тест подключения бота
  const handleTestBot = async () => {
    try {
      const response = await testBotConnection()
      if (response.success && response.bot) {
        setSaveMessage(`Бот подключен: @${response.bot.username}`)
        setTimeout(() => setSaveMessage(null), 5000)
      } else {
        setError(response.error || 'Не удалось подключиться к боту')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка тестирования бота')
    }
  }

  const handleToggleNotification = (id: string, field: 'email' | 'push' | 'inApp') => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, [field]: !n[field] } : n))
  }

  const handleConnectIntegration = async (integration: Integration) => {
    if (integration.id === '1') {
      await handleTestBot()
    }
    setIsIntegrationModalOpen(false)
  }

  const handleDisconnectIntegration = (id: string) => {
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, status: 'disconnected', lastSync: undefined } : i))
  }

  const handleDeleteApiKey = (id: string) => {
    setApiKeys(prev => prev.filter(k => k.id !== id))
  }

  const handleAddApiKey = (name: string, permissions: string[]) => {
    const newKey: ApiKey = {
      id: Date.now().toString(),
      name,
      key: `sk_${Math.random().toString(36).slice(2, 10)}...${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toLocaleDateString('ru-RU'),
      permissions,
    }
    setApiKeys(prev => [...prev, newKey])
  }

  const activeTabConfig = tabs.find(t => t.id === activeTab)

  // Состояние загрузки
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-8">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
            <p className="text-slate-600 font-medium">Загрузка настроек...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Settings className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Настройки</h1>
                <p className="text-slate-500 text-sm">Управление параметрами системы</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadSettings}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50 shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Обновить
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/25"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="max-w-7xl mx-auto px-8 pt-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div className="flex-1">
              <p className="text-red-800 font-medium">Ошибка</p>
              <p className="text-red-600 text-sm mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xl leading-none">&times;</button>
          </div>
        )}

        {saveMessage && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Check className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-emerald-800 font-medium">{saveMessage}</p>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-6">
        <div className="flex gap-8">
          {/* Sidebar */}
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Разделы настроек</p>
              </div>
              <div className="p-2">
                {tabs.map(tab => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all mb-1 group ${
                        isActive 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100' 
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                        isActive ? tab.bgColor : 'bg-slate-100 group-hover:bg-slate-200'
                      }`}>
                        <Icon className={`w-5 h-5 ${isActive ? tab.color : 'text-slate-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`block font-medium truncate ${isActive ? 'text-slate-800' : 'text-slate-600'}`}>
                          {tab.label}
                        </span>
                        <span className="block text-xs text-slate-400 truncate">{tab.description}</span>
                      </div>
                      <ChevronRight className={`w-4 h-4 transition-all ${
                        isActive ? 'text-blue-500 translate-x-0' : 'text-slate-300 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                      }`} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Environment Status */}
            {envStatus && (
              <div className="mt-4 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Переменные окружения</p>
                <div className="space-y-2">
                  {[
                    { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram', value: envStatus.TELEGRAM_BOT_TOKEN },
                    { key: 'OPENAI_API_KEY', label: 'OpenAI', value: envStatus.OPENAI_API_KEY },
                    { key: 'TELEGRAM_CHAT_ID', label: 'Chat ID', value: envStatus.TELEGRAM_CHAT_ID },
                  ].map(item => (
                    <div key={item.key} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${item.value ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={`text-sm ${item.value ? 'text-slate-700' : 'text-slate-400'}`}>
                        {item.label}
                      </span>
                      {item.value && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Content Header */}
            {activeTabConfig && !['team', 'users', 'automations'].includes(activeTab) && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeTabConfig.bgColor}`}>
                    <activeTabConfig.icon className={`w-5 h-5 ${activeTabConfig.color}`} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{activeTabConfig.label}</h2>
                    <p className="text-sm text-slate-500">{activeTabConfig.description}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Content Body */}
            <div className="space-y-6">
              {activeTab === 'general' && (
                <GeneralSettings
                  general={generalSettings}
                  response={responseSettings}
                  onGeneralChange={setGeneralSettings}
                  onResponseChange={setResponseSettings}
                />
              )}

              {activeTab === 'team' && (
                <div className="-mt-6">
                  <TeamPage embedded />
                </div>
              )}

              {activeTab === 'users' && (
                <div className="-mt-6">
                  <UsersPage embedded />
                </div>
              )}

              {activeTab === 'automations' && (
                <div className="-mt-6">
                  <AutomationsPage embedded />
                </div>
              )}

              {activeTab === 'autoreply' && (
                <AutoReplySettings
                  settings={autoReplySettings}
                  onSettingsChange={setAutoReplySettings}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationsSettings
                  notifications={notifications}
                  onToggle={handleToggleNotification}
                />
              )}

              {activeTab === 'integrations' && (
                <IntegrationsSettings
                  integrations={integrations}
                  selectedIntegration={selectedIntegration}
                  isModalOpen={isIntegrationModalOpen}
                  onOpenModal={(i) => { setSelectedIntegration(i); setIsIntegrationModalOpen(true) }}
                  onCloseModal={() => setIsIntegrationModalOpen(false)}
                  onConnect={handleConnectIntegration}
                  onDisconnect={handleDisconnectIntegration}
                />
              )}

              {activeTab === 'security' && (
                <SecuritySettings
                  settings={securitySettings}
                  onChange={setSecuritySettings}
                />
              )}

              {activeTab === 'api' && (
                <ApiKeysSettings
                  apiKeys={apiKeys}
                  onDelete={handleDeleteApiKey}
                  onAdd={handleAddApiKey}
                />
              )}

              {activeTab === 'appearance' && (
                <AppearanceSettings
                  settings={appearanceSettings}
                  onChange={setAppearanceSettings}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
