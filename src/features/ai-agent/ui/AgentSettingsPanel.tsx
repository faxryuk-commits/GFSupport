import { useState, useEffect } from 'react'
import { Settings, Save, Eye, EyeOff, Loader2 } from 'lucide-react'
import { fetchAgentSettings, updateAgentSettings, type AgentSettings } from '@/shared/api'

const MODELS = [
  { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B (рекомендуем)' },
  { id: 'Qwen/Qwen2.5-7B-Instruct-Turbo', label: 'Qwen 2.5 7B (быстрый)' },
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B' },
  { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral 8x22B' },
]

const MODES = [
  { id: 'autonomous', label: 'Автономный', desc: 'Агент отвечает сам, если уверен' },
  { id: 'assist', label: 'Помощник', desc: 'Только логирует решения, не отвечает' },
  { id: 'night_only', label: 'Ночной', desc: 'Автономный только вне рабочих часов' },
]

export function AgentSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetchAgentSettings()
      .then(s => setSettings(s))
      .catch(() => setSettings({
        enabled: false, mode: 'assist', autoReply: false,
        minConfidence: 0.8, workStart: 9, workEnd: 22,
        timezone: 'Asia/Tashkent', excludeChannels: [],
        model: MODELS[0].id, hasApiKey: false,
      }))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setMsg('')
    try {
      await updateAgentSettings({ ...settings, togetherApiKey: apiKey || undefined })
      setMsg('Сохранено')
      setApiKey('')
      onSaved?.()
      const fresh = await fetchAgentSettings()
      setSettings(fresh)
    } catch {
      setMsg('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) return <div className="p-6 text-center text-slate-400">Загрузка настроек...</div>

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-slate-900">Настройки AI Агента</h2>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-800">Включить AI Агент</p>
          <p className="text-sm text-slate-500">Агент будет анализировать входящие сообщения</p>
        </div>
        <button
          onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
          className={`relative w-12 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setSettings({ ...settings, mode: m.id as AgentSettings['mode'] })}
            className={`p-3 rounded-lg border-2 text-left transition-colors ${
              settings.mode === m.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <p className="font-medium text-slate-800 text-sm">{m.label}</p>
            <p className="text-xs text-slate-500 mt-1">{m.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Модель</label>
          <select
            value={settings.model}
            onChange={e => setSettings({ ...settings, model: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">
            Мин. уверенность для авто-ответа
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range" min="0.5" max="1" step="0.05"
              value={settings.minConfidence}
              onChange={e => setSettings({ ...settings, minConfidence: parseFloat(e.target.value) })}
              className="flex-1"
            />
            <span className="text-sm font-mono text-slate-600 w-12 text-right">
              {(settings.minConfidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Рабочие часы (начало)</label>
          <input
            type="number" min="0" max="23"
            value={settings.workStart}
            onChange={e => setSettings({ ...settings, workStart: parseInt(e.target.value) || 9 })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Рабочие часы (конец)</label>
          <input
            type="number" min="0" max="23"
            value={settings.workEnd}
            onChange={e => setSettings({ ...settings, workEnd: parseInt(e.target.value) || 22 })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1">
          Together API Key
          {settings.hasApiKey && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">настроен</span>
          )}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={settings.hasApiKey ? '••••••• (оставьте пустым чтобы не менять)' : 'Введите Together API Key'}
            className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Получите ключ на <a href="https://api.together.xyz" target="_blank" className="text-blue-500 hover:underline">together.xyz</a>
        </p>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Сохранить
        </button>
        {msg && <span className={`text-sm ${msg === 'Сохранено' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
      </div>
    </div>
  )
}
