import { useState, useEffect } from 'react'
import { Loader2, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { Modal } from '@/shared/ui'
import { apiGet, apiPost, apiPut } from '@/shared/services/api.service'

interface SettingsResponse {
  settings: {
    openai_api_key: string
    ai_model: string
  }
  envStatus: {
    OPENAI_API_KEY: boolean
  }
}

const MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Быстрая, экономичная' },
  { id: 'gpt-4o', name: 'GPT-4o', desc: 'Мощная, дороже' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'Предыдущее поколение' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', desc: 'Самая быстрая' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export function OpenAISettingsModal({ isOpen, onClose, onSaved }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [hasEnvKey, setHasEnvKey] = useState(false)
  const [currentMasked, setCurrentMasked] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTestResult(null)
    setLoading(true)
    apiGet<SettingsResponse>('/settings', false)
      .then(data => {
        setCurrentMasked(data.settings.openai_api_key || '')
        setModel(data.settings.ai_model || 'gpt-4o-mini')
        setHasEnvKey(data.envStatus.OPENAI_API_KEY)
        setApiKey('')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isOpen])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      if (apiKey.trim()) {
        await apiPut('/settings', { settings: { openai_api_key: apiKey.trim() } })
      }
      const res = await apiPost<{ success?: boolean; error?: string; model?: string }>('/settings', { action: 'test_openai' })
      if (res.success) {
        setTestResult({ ok: true, msg: `Ключ действителен. Модель: ${res.model}` })
      } else {
        setTestResult({ ok: false, msg: res.error || 'Неизвестная ошибка' })
      }
    } catch (e: any) {
      const msg = e?.message || 'Ошибка соединения'
      setTestResult({ ok: false, msg })
    }
    setTesting(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const settings: Record<string, string> = { ai_model: model }
      if (apiKey.trim()) settings.openai_api_key = apiKey.trim()
      await apiPut('/settings', { settings })
      onSaved?.()
      onClose()
    } catch {}
    setSaving(false)
  }

  const keySource = currentMasked.startsWith('sk-') ? 'Сохранён в базе' : hasEnvKey ? 'Из переменной окружения' : 'Не задан'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки OpenAI" size="md">
      <div className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API ключ</label>
              <p className="text-xs text-slate-400 mb-2">
                Текущий: <span className="font-mono">{currentMasked || 'не задан'}</span>
                {' '}({keySource})
              </p>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">Оставьте пустым, чтобы использовать текущий ключ</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Модель</label>
              <div className="grid grid-cols-2 gap-2">
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setModel(m.id)}
                    className={`flex flex-col items-start px-3 py-2.5 rounded-lg text-sm transition-all ${
                      model === m.id
                        ? 'bg-blue-500 text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className={`text-xs ${model === m.id ? 'text-blue-100' : 'text-slate-400'}`}>{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {testResult && (
              <div className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm ${
                testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {testResult.ok
                  ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                }
                <span>{testResult.msg}</span>
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <button
            onClick={handleTest}
            disabled={loading || testing}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Проверить ключ
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-5 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
