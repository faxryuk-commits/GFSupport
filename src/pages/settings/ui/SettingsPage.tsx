import { useState } from 'react'
import { 
  Settings, Users, Zap, Brain, Bell, Link2, Eye, EyeOff, Shield, 
  Globe, Palette, Database, Mail, Save, RefreshCw, Trash2, Plus,
  Check, X, Copy, ExternalLink, HelpCircle, AlertTriangle
} from 'lucide-react'
import { Modal, ConfirmDialog, Badge, Tabs, TabPanel, Avatar } from '@/shared/ui'

type SettingsTab = 'general' | 'notifications' | 'integrations' | 'security' | 'api' | 'appearance'

interface Integration {
  id: string
  name: string
  description: string
  icon: string
  status: 'connected' | 'disconnected' | 'error'
  lastSync?: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  createdAt: string
  lastUsed?: string
  permissions: string[]
}

interface NotificationSetting {
  id: string
  label: string
  description: string
  email: boolean
  push: boolean
  inApp: boolean
}

// Config
const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api', label: 'API Keys', icon: Database },
  { id: 'appearance', label: 'Appearance', icon: Palette },
]

// Mock data
const mockIntegrations: Integration[] = [
  { id: '1', name: 'Telegram Bot', description: 'Connect with Telegram for messaging', icon: '📱', status: 'connected', lastSync: '2 min ago' },
  { id: '2', name: 'Slack', description: 'Send notifications to Slack channels', icon: '💬', status: 'connected', lastSync: '5 min ago' },
  { id: '3', name: 'Email (SMTP)', description: 'Send emails via custom SMTP', icon: '✉️', status: 'connected', lastSync: '1 hour ago' },
  { id: '4', name: 'Webhook', description: 'Send events to external services', icon: '🔗', status: 'disconnected' },
  { id: '5', name: 'Zapier', description: 'Connect with 5000+ apps', icon: '⚡', status: 'error', lastSync: 'Failed' },
]

const mockApiKeys: ApiKey[] = [
  { id: '1', name: 'Production API', key: 'sk_live_abc123...xyz789', createdAt: 'Jan 15, 2024', lastUsed: 'Today', permissions: ['read', 'write'] },
  { id: '2', name: 'Development', key: 'sk_test_def456...uvw012', createdAt: 'Jan 20, 2024', lastUsed: 'Yesterday', permissions: ['read'] },
  { id: '3', name: 'Webhook Service', key: 'sk_hook_ghi789...rst345', createdAt: 'Feb 1, 2024', permissions: ['webhook'] },
]

const mockNotificationSettings: NotificationSetting[] = [
  { id: '1', label: 'New Messages', description: 'When a customer sends a new message', email: true, push: true, inApp: true },
  { id: '2', label: 'Case Assignments', description: 'When a case is assigned to you', email: true, push: true, inApp: true },
  { id: '3', label: 'Case Updates', description: 'When a case status changes', email: false, push: true, inApp: true },
  { id: '4', label: 'SLA Warnings', description: 'When SLA deadline is approaching', email: true, push: true, inApp: true },
  { id: '5', label: 'Team Mentions', description: 'When someone mentions you', email: false, push: true, inApp: true },
  { id: '6', label: 'Daily Summary', description: 'Daily report of activity', email: true, push: false, inApp: false },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [isSaving, setIsSaving] = useState(false)
  const [showBotToken, setShowBotToken] = useState(false)
  const [integrations, setIntegrations] = useState(mockIntegrations)
  const [apiKeys, setApiKeys] = useState(mockApiKeys)
  const [notifications, setNotifications] = useState(mockNotificationSettings)
  
  // General settings
  const [generalSettings, setGeneralSettings] = useState({
    companyName: 'Support System',
    botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    defaultLanguage: 'en',
    timezone: 'UTC+5',
    autoCreateCases: true,
    soundNotifications: true,
    autoAssignment: true,
  })

  // Response settings
  const [responseSettings, setResponseSettings] = useState({
    targetResponseTime: 5,
    targetResolutionTime: 60,
    slaTarget: 99,
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  })

  // Security settings
  const [securitySettings, setSecuritySettings] = useState({
    twoFactorEnabled: true,
    sessionTimeout: 30,
    ipWhitelist: '',
    passwordExpiry: 90,
  })

  // Appearance settings
  const [appearanceSettings, setAppearanceSettings] = useState({
    theme: 'light',
    primaryColor: '#3b82f6',
    sidebarCollapsed: false,
    compactMode: false,
  })

  // Modals
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [isDeleteKeyDialogOpen, setIsDeleteKeyDialogOpen] = useState(false)
  const [selectedApiKey, setSelectedApiKey] = useState<ApiKey | null>(null)

  const handleSave = async () => {
    setIsSaving(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsSaving(false)
    // Show toast success
  }

  const handleTestConnection = async () => {
    // Simulate test
    await new Promise(resolve => setTimeout(resolve, 1500))
    alert('Connection successful!')
  }

  const handleToggleNotification = (id: string, field: 'email' | 'push' | 'inApp') => {
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, [field]: !n[field] } : n
    ))
  }

  const handleDeleteApiKey = () => {
    if (selectedApiKey) {
      setApiKeys(prev => prev.filter(k => k.id !== selectedApiKey.id))
      setIsDeleteKeyDialogOpen(false)
      setSelectedApiKey(null)
    }
  }

  const handleConnectIntegration = (integration: Integration) => {
    setIntegrations(prev => prev.map(i => 
      i.id === integration.id ? { ...i, status: 'connected', lastSync: 'Just now' } : i
    ))
    setIsIntegrationModalOpen(false)
  }

  const handleDisconnectIntegration = (id: string) => {
    setIntegrations(prev => prev.map(i => 
      i.id === id ? { ...i, status: 'disconnected', lastSync: undefined } : i
    ))
  }

  const statusColors = {
    connected: 'bg-green-100 text-green-700',
    disconnected: 'bg-slate-100 text-slate-600',
    error: 'bg-red-100 text-red-700',
  }

  return (
    <>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
            <p className="text-slate-500 mt-0.5">Manage your workspace preferences</p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-56 space-y-1">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-slate-600 hover:bg-slate-50'
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
            {/* General */}
            {activeTab === 'general' && (
              <>
                <div className="bg-white rounded-xl p-6 border border-slate-200">
                  <h2 className="text-lg font-semibold text-slate-800 mb-4">General Settings</h2>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                      <input
                        type="text"
                        value={generalSettings.companyName}
                        onChange={(e) => setGeneralSettings(s => ({ ...s, companyName: e.target.value }))}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Default Language</label>
                      <select
                        value={generalSettings.defaultLanguage}
                        onChange={(e) => setGeneralSettings(s => ({ ...s, defaultLanguage: e.target.value }))}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="en">English</option>
                        <option value="ru">Russian</option>
                        <option value="uz">Uzbek</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Telegram Bot Token</label>
                    <div className="flex gap-3">
                      <div className="flex-1 relative">
                        <input
                          type={showBotToken ? 'text' : 'password'}
                          value={generalSettings.botToken}
                          onChange={(e) => setGeneralSettings(s => ({ ...s, botToken: e.target.value }))}
                          className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBotToken(!showBotToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showBotToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                      <button 
                        onClick={handleTestConnection}
                        className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                      >
                        Test Connection
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Toggle
                      label="Auto-create cases from messages"
                      description="Automatically create support cases when customers send messages"
                      checked={generalSettings.autoCreateCases}
                      onChange={(v) => setGeneralSettings(s => ({ ...s, autoCreateCases: v }))}
                    />
                    <Toggle
                      label="Sound notifications"
                      description="Play sound when new messages arrive"
                      checked={generalSettings.soundNotifications}
                      onChange={(v) => setGeneralSettings(s => ({ ...s, soundNotifications: v }))}
                    />
                    <Toggle
                      label="Auto-assignment"
                      description="Automatically assign new cases to available agents"
                      checked={generalSettings.autoAssignment}
                      onChange={(v) => setGeneralSettings(s => ({ ...s, autoAssignment: v }))}
                    />
                  </div>
                </div>

                <div className="bg-white rounded-xl p-6 border border-slate-200">
                  <h2 className="text-lg font-semibold text-slate-800 mb-4">Response Settings</h2>
                  
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Target Response Time</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={responseSettings.targetResponseTime}
                          onChange={(e) => setResponseSettings(s => ({ ...s, targetResponseTime: Number(e.target.value) }))}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500 text-sm">min</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Target Resolution Time</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={responseSettings.targetResolutionTime}
                          onChange={(e) => setResponseSettings(s => ({ ...s, targetResolutionTime: Number(e.target.value) }))}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500 text-sm">min</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">SLA Target</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={responseSettings.slaTarget}
                          onChange={(e) => setResponseSettings(s => ({ ...s, slaTarget: Number(e.target.value) }))}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500 text-sm">%</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Working Hours</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={responseSettings.workingHoursStart}
                          onChange={(e) => setResponseSettings(s => ({ ...s, workingHoursStart: e.target.value }))}
                          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500">to</span>
                        <input
                          type="time"
                          value={responseSettings.workingHoursEnd}
                          onChange={(e) => setResponseSettings(s => ({ ...s, workingHoursEnd: e.target.value }))}
                          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
                      <select
                        value={generalSettings.timezone}
                        onChange={(e) => setGeneralSettings(s => ({ ...s, timezone: e.target.value }))}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="UTC+5">Tashkent (UTC+5)</option>
                        <option value="UTC+3">Moscow (UTC+3)</option>
                        <option value="UTC+0">London (UTC+0)</option>
                        <option value="UTC-5">New York (UTC-5)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Notifications */}
            {activeTab === 'notifications' && (
              <div className="bg-white rounded-xl p-6 border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Notification Preferences</h2>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 font-medium text-slate-600">Notification</th>
                        <th className="text-center py-3 font-medium text-slate-600 w-24">Email</th>
                        <th className="text-center py-3 font-medium text-slate-600 w-24">Push</th>
                        <th className="text-center py-3 font-medium text-slate-600 w-24">In-App</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notifications.map(notif => (
                        <tr key={notif.id} className="border-b border-slate-100">
                          <td className="py-4">
                            <div>
                              <p className="font-medium text-slate-800">{notif.label}</p>
                              <p className="text-sm text-slate-500">{notif.description}</p>
                            </div>
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={notif.email}
                              onChange={() => handleToggleNotification(notif.id, 'email')}
                              className="w-5 h-5 text-blue-500 rounded border-slate-300"
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={notif.push}
                              onChange={() => handleToggleNotification(notif.id, 'push')}
                              className="w-5 h-5 text-blue-500 rounded border-slate-300"
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={notif.inApp}
                              onChange={() => handleToggleNotification(notif.id, 'inApp')}
                              className="w-5 h-5 text-blue-500 rounded border-slate-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Integrations */}
            {activeTab === 'integrations' && (
              <div className="bg-white rounded-xl p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-800">Integrations</h2>
                  <button className="flex items-center gap-2 px-4 py-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                    <Plus className="w-4 h-4" />
                    Add Integration
                  </button>
                </div>

                <div className="space-y-3">
                  {integrations.map(integration => (
                    <div key={integration.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                      <span className="text-2xl">{integration.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-800">{integration.name}</h3>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[integration.status]}`}>
                            {integration.status}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">{integration.description}</p>
                        {integration.lastSync && (
                          <p className="text-xs text-slate-400 mt-1">Last sync: {integration.lastSync}</p>
                        )}
                      </div>
                      {integration.status === 'connected' ? (
                        <div className="flex items-center gap-2">
                          <button className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                            Configure
                          </button>
                          <button 
                            onClick={() => handleDisconnectIntegration(integration.id)}
                            className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => { setSelectedIntegration(integration); setIsIntegrationModalOpen(true) }}
                          className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Security */}
            {activeTab === 'security' && (
              <div className="bg-white rounded-xl p-6 border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Security Settings</h2>
                
                <div className="space-y-4">
                  <Toggle
                    label="Two-Factor Authentication"
                    description="Require 2FA for all team members"
                    checked={securitySettings.twoFactorEnabled}
                    onChange={(v) => setSecuritySettings(s => ({ ...s, twoFactorEnabled: v }))}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Session Timeout</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={securitySettings.sessionTimeout}
                          onChange={(e) => setSecuritySettings(s => ({ ...s, sessionTimeout: Number(e.target.value) }))}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500 text-sm">min</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Password Expiry</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={securitySettings.passwordExpiry}
                          onChange={(e) => setSecuritySettings(s => ({ ...s, passwordExpiry: Number(e.target.value) }))}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="text-slate-500 text-sm">days</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IP Whitelist</label>
                    <textarea
                      value={securitySettings.ipWhitelist}
                      onChange={(e) => setSecuritySettings(s => ({ ...s, ipWhitelist: e.target.value }))}
                      placeholder="Enter IP addresses, one per line (leave empty to allow all)"
                      rows={3}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                    />
                    <p className="text-xs text-slate-500 mt-1">Leave empty to allow access from any IP</p>
                  </div>
                </div>
              </div>
            )}

            {/* API Keys */}
            {activeTab === 'api' && (
              <div className="bg-white rounded-xl p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-800">API Keys</h2>
                  <button 
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
                  >
                    <Plus className="w-4 h-4" />
                    Create Key
                  </button>
                </div>

                <div className="space-y-3">
                  {apiKeys.map(key => (
                    <div key={key.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-xl">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Database className="w-5 h-5 text-slate-500" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-slate-800">{key.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">{key.key}</code>
                          <button className="p-1 hover:bg-slate-100 rounded">
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                          <span>Created: {key.createdAt}</span>
                          {key.lastUsed && <span>Last used: {key.lastUsed}</span>}
                          <span>Permissions: {key.permissions.join(', ')}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => { setSelectedApiKey(key); setIsDeleteKeyDialogOpen(true) }}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Appearance */}
            {activeTab === 'appearance' && (
              <div className="bg-white rounded-xl p-6 border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Appearance</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Theme</label>
                    <div className="flex gap-3">
                      {['light', 'dark', 'system'].map(theme => (
                        <button
                          key={theme}
                          onClick={() => setAppearanceSettings(s => ({ ...s, theme }))}
                          className={`flex-1 px-4 py-3 rounded-xl border-2 transition-colors ${
                            appearanceSettings.theme === theme
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="capitalize font-medium text-slate-700">{theme}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Primary Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={appearanceSettings.primaryColor}
                        onChange={(e) => setAppearanceSettings(s => ({ ...s, primaryColor: e.target.value }))}
                        className="w-12 h-12 rounded-lg border border-slate-200 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={appearanceSettings.primaryColor}
                        onChange={(e) => setAppearanceSettings(s => ({ ...s, primaryColor: e.target.value }))}
                        className="w-32 px-4 py-2.5 border border-slate-200 rounded-lg font-mono text-sm"
                      />
                    </div>
                  </div>

                  <Toggle
                    label="Compact Mode"
                    description="Use smaller spacing and fonts throughout the app"
                    checked={appearanceSettings.compactMode}
                    onChange={(v) => setAppearanceSettings(s => ({ ...s, compactMode: v }))}
                  />

                  <Toggle
                    label="Collapsed Sidebar"
                    description="Start with sidebar collapsed by default"
                    checked={appearanceSettings.sidebarCollapsed}
                    onChange={(v) => setAppearanceSettings(s => ({ ...s, sidebarCollapsed: v }))}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      <Modal isOpen={isApiKeyModalOpen} onClose={() => setIsApiKeyModalOpen(false)} title="Create API Key" size="md">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setIsApiKeyModalOpen(false) }}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Key Name</label>
            <input
              type="text"
              placeholder="e.g., Production API"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Permissions</label>
            <div className="space-y-2">
              {['read', 'write', 'webhook', 'admin'].map(perm => (
                <label key={perm} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 text-blue-500 rounded" />
                  <span className="text-sm text-slate-700 capitalize">{perm}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setIsApiKeyModalOpen(false)} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Create Key</button>
          </div>
        </form>
      </Modal>

      {/* Integration Modal */}
      <Modal isOpen={isIntegrationModalOpen} onClose={() => setIsIntegrationModalOpen(false)} title={`Connect ${selectedIntegration?.name}`} size="md">
        {selectedIntegration && (
          <div className="space-y-4">
            <p className="text-slate-600">{selectedIntegration.description}</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Key / Token</label>
              <input
                type="password"
                placeholder="Enter your API key"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setIsIntegrationModalOpen(false)} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={() => handleConnectIntegration(selectedIntegration)} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Connect</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete API Key Dialog */}
      <ConfirmDialog
        isOpen={isDeleteKeyDialogOpen}
        onClose={() => setIsDeleteKeyDialogOpen(false)}
        onConfirm={handleDeleteApiKey}
        title="Delete API Key"
        message={`Are you sure you want to delete "${selectedApiKey?.name}"? This action cannot be undone and any applications using this key will stop working.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}

// Toggle Component
function Toggle({ label, description, checked, onChange }: { 
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void 
}) {
  return (
    <label className="flex items-start gap-4 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-11 h-6 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
      <div className="flex-1">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
    </label>
  )
}
