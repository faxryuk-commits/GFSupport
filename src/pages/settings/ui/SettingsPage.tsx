import { useState, useEffect, useCallback } from 'react'
import { Settings, Bell, Link2, Shield, Database, Palette, Save, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import {
  GeneralSettings,
  NotificationsSettings,
  IntegrationsSettings,
  SecuritySettings,
  ApiKeysSettings,
  AppearanceSettings,
  type GeneralSettingsData,
  type ResponseSettingsData,
  type NotificationSetting,
  type Integration,
  type SecuritySettingsData,
  type ApiKey,
  type AppearanceSettingsData,
} from '@/features/settings/ui'
import {
  fetchSettings,
  updateSettings,
  testBotConnection,
  type BackendSettings,
  type EnvStatus,
} from '@/shared/api'

type SettingsTab = 'general' | 'notifications' | 'integrations' | 'security' | 'api' | 'appearance'

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'Основные', icon: Settings },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'integrations', label: 'Интеграции', icon: Link2 },
  { id: 'security', label: 'Безопасность', icon: Shield },
  { id: 'api', label: 'API ключи', icon: Database },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
]

// Initial data for local settings (not stored in backend yet)
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

  // Загрузка настроек с сервера
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetchSettings()
      const { settings, envStatus: env } = response
      
      setEnvStatus(env)
      
      // Маппинг настроек бэкенда на фронтенд
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

      // Формируем интеграции на основе envStatus
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
      
      // Формируем данные для отправки на сервер
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
      // Тест подключения Telegram бота
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

  // Состояние загрузки
  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-slate-600">Загрузка настроек...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Уведомление об ошибке */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-800 font-medium">Ошибка</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
          <button 
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600"
          >
            &times;
          </button>
        </div>
      )}

      {/* Уведомление об успешном сохранении */}
      {saveMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs">✓</span>
          </div>
          <p className="text-green-800">{saveMessage}</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Настройки</h1>
          <p className="text-slate-500 mt-0.5">Управление параметрами системы</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadSettings}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Статус переменных окружения */}
      {envStatus && (
        <div className="mb-6 p-4 bg-slate-50 rounded-xl">
          <p className="text-sm font-medium text-slate-700 mb-2">Статус переменных окружения:</p>
          <div className="flex gap-4 text-sm">
            <span className={`flex items-center gap-1.5 ${envStatus.TELEGRAM_BOT_TOKEN ? 'text-green-600' : 'text-slate-400'}`}>
              <span className={`w-2 h-2 rounded-full ${envStatus.TELEGRAM_BOT_TOKEN ? 'bg-green-500' : 'bg-slate-300'}`}></span>
              TELEGRAM_BOT_TOKEN
            </span>
            <span className={`flex items-center gap-1.5 ${envStatus.OPENAI_API_KEY ? 'text-green-600' : 'text-slate-400'}`}>
              <span className={`w-2 h-2 rounded-full ${envStatus.OPENAI_API_KEY ? 'bg-green-500' : 'bg-slate-300'}`}></span>
              OPENAI_API_KEY
            </span>
            <span className={`flex items-center gap-1.5 ${envStatus.TELEGRAM_CHAT_ID ? 'text-green-600' : 'text-slate-400'}`}>
              <span className={`w-2 h-2 rounded-full ${envStatus.TELEGRAM_CHAT_ID ? 'bg-green-500' : 'bg-slate-300'}`}></span>
              TELEGRAM_CHAT_ID
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-56 space-y-1 flex-shrink-0">
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                  activeTab === tab.id ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6">
          {activeTab === 'general' && (
            <GeneralSettings
              general={generalSettings}
              response={responseSettings}
              onGeneralChange={setGeneralSettings}
              onResponseChange={setResponseSettings}
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
  )
}
