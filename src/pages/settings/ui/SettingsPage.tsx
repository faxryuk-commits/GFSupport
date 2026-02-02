import { useState } from 'react'
import { Settings, Bell, Link2, Shield, Database, Palette, Save, RefreshCw } from 'lucide-react'
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

type SettingsTab = 'general' | 'notifications' | 'integrations' | 'security' | 'api' | 'appearance'

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'Основные', icon: Settings },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'integrations', label: 'Интеграции', icon: Link2 },
  { id: 'security', label: 'Безопасность', icon: Shield },
  { id: 'api', label: 'API ключи', icon: Database },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
]

// Initial data
const initialNotifications: NotificationSetting[] = [
  { id: '1', label: 'Новые сообщения', description: 'Когда клиент отправляет сообщение', email: true, push: true, inApp: true },
  { id: '2', label: 'Назначения кейсов', description: 'Когда вам назначают кейс', email: true, push: true, inApp: true },
  { id: '3', label: 'Обновления кейсов', description: 'Изменение статуса кейса', email: false, push: true, inApp: true },
  { id: '4', label: 'SLA предупреждения', description: 'Приближение дедлайна SLA', email: true, push: true, inApp: true },
  { id: '5', label: 'Упоминания', description: 'Когда вас упоминают в комментарии', email: false, push: true, inApp: true },
  { id: '6', label: 'Ежедневная сводка', description: 'Ежедневный отчёт активности', email: true, push: false, inApp: false },
]

const initialIntegrations: Integration[] = [
  { id: '1', name: 'Telegram Bot', description: 'Подключение к Telegram', icon: '📱', status: 'connected', lastSync: '2 мин назад' },
  { id: '2', name: 'Slack', description: 'Уведомления в Slack', icon: '💬', status: 'connected', lastSync: '5 мин назад' },
  { id: '3', name: 'Email (SMTP)', description: 'Отправка email через SMTP', icon: '✉️', status: 'connected', lastSync: '1 час назад' },
  { id: '4', name: 'Webhook', description: 'Отправка событий во внешние сервисы', icon: '🔗', status: 'disconnected' },
  { id: '5', name: 'Zapier', description: 'Подключение к 5000+ приложений', icon: '⚡', status: 'error', lastSync: 'Ошибка' },
]

const initialApiKeys: ApiKey[] = [
  { id: '1', name: 'Production API', key: 'sk_live_abc123...xyz789', createdAt: '15 янв 2024', lastUsed: 'Сегодня', permissions: ['read', 'write'] },
  { id: '2', name: 'Development', key: 'sk_test_def456...uvw012', createdAt: '20 янв 2024', lastUsed: 'Вчера', permissions: ['read'] },
  { id: '3', name: 'Webhook Service', key: 'sk_hook_ghi789...rst345', createdAt: '1 фев 2024', permissions: ['webhook'] },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [isSaving, setIsSaving] = useState(false)

  // Settings state
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsData>({
    companyName: 'Support System',
    botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
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
  const [integrations, setIntegrations] = useState(initialIntegrations)
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

  // Handlers
  const handleSave = async () => {
    setIsSaving(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsSaving(false)
  }

  const handleToggleNotification = (id: string, field: 'email' | 'push' | 'inApp') => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, [field]: !n[field] } : n))
  }

  const handleConnectIntegration = (integration: Integration) => {
    setIntegrations(prev => prev.map(i => i.id === integration.id ? { ...i, status: 'connected', lastSync: 'Только что' } : i))
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Настройки</h1>
          <p className="text-slate-500 mt-0.5">Управление параметрами системы</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>

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
