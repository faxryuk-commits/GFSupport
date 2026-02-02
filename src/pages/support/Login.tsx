import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, User, Lock, AlertCircle, Headphones, Eye, EyeOff } from 'lucide-react'
import { Logo } from '@/components/Logo'

export function SupportLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const navigate = useNavigate()
  const location = useLocation()

  // Проверяем токен синхронно - избегаем цикла редиректов
  const existingToken = typeof window !== 'undefined' ? localStorage.getItem('support_agent_token') : null
  
  // Редирект если уже авторизован - только один раз
  useEffect(() => {
    if (existingToken) {
      const from = (location.state as any)?.from?.pathname || '/support'
      navigate(from, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/support/agents/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка входа')
      }

      // Сохраняем токен и данные агента
      localStorage.setItem('support_agent_token', data.token)
      localStorage.setItem('support_agent_id', data.agent.id)
      localStorage.setItem('support_agent_data', JSON.stringify(data.agent))

      // Редирект
      const from = (location.state as any)?.from?.pathname || '/support'
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  // Если токен есть - показываем загрузку (редирект в процессе)
  if (existingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Headphones className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <Logo height={28} />
              </div>
              <span className="text-sm font-medium text-emerald-600">Support</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            Customer Support
          </h1>
          <p className="text-slate-500 mt-1">
            Мониторинг и поддержка клиентов
          </p>
        </div>

        {/* Login form */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 bg-red-50 text-red-600 text-sm p-4 rounded-lg">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Имя пользователя
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500
                    transition-colors"
                  placeholder="@username или имя"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 border border-slate-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500
                    transition-colors"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white font-medium py-3 rounded-lg
                hover:bg-emerald-700 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Вход...
                </>
              ) : (
                'Войти в Support'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-sm text-slate-400">или</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Telegram login placeholder */}
          <div className="text-center">
            <p className="text-sm text-slate-500 mb-3">
              Войти через Telegram
            </p>
            <div className="flex justify-center">
              <div className="px-6 py-3 bg-[#0088cc] text-white rounded-lg font-medium text-sm opacity-50 cursor-not-allowed">
                📱 Telegram Login (скоро)
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Используйте Telegram username и пароль из профиля
        </p>
      </div>
    </div>
  )
}
