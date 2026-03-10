import { useState, useEffect } from 'react'
import { saGet, saPut } from '@/shared/services/sa-api.service'
import { Bot, Save, RefreshCw, CheckCircle2, ExternalLink } from 'lucide-react'

interface PlatformSettings {
  platform_bot_token?: string
  platform_bot_username?: string
}

export default function SASettingsPage() {
  const [botToken, setBotToken] = useState('')
  const [botUsername, setBotUsername] = useState('')
  const [maskedToken, setMaskedToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const data = await saGet<{ settings: PlatformSettings }>('/admin/platform-settings')
      setMaskedToken(data.settings.platform_bot_token || '')
      setBotUsername(data.settings.platform_bot_username || '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saPut('/admin/platform-settings', {
        ...(botToken && { botToken }),
        ...(botUsername && { botUsername }),
      })
      setSaved(true)
      setBotToken('')
      await loadSettings()
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Настройки платформы</h1>
      <p className="text-gray-500 mb-8">Конфигурация платформенного Telegram бота для регистрации и рассылок</p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <Bot className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Telegram Platform Bot</h2>
            <p className="text-sm text-gray-500">Бот для OTP-регистрации и уведомлений</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Bot Token</label>
            {maskedToken && (
              <p className="text-xs text-gray-400 mb-1">Текущий: {maskedToken}</p>
            )}
            <input
              type="password"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              placeholder="Вставьте новый токен от @BotFather"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Bot Username</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
              <input
                type="text"
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                value={botUsername}
                onChange={e => setBotUsername(e.target.value.replace(/^@/, ''))}
                placeholder="gfsupport_bot"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || (!botToken && !botUsername)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Сохранение...' : saved ? 'Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div className="mt-6 bg-gray-50 rounded-2xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Как настроить бота</h3>
        <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
          <li>
            Создайте бота через{' '}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">
              @BotFather <ExternalLink className="w-3 h-3" />
            </a>
          </li>
          <li>Скопируйте токен и username бота сюда</li>
          <li>Webhook установится автоматически при сохранении</li>
          <li>Пользователи должны нажать /start в боте перед регистрацией</li>
        </ol>
      </div>
    </div>
  )
}
