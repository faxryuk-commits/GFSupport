import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Eye, EyeOff, ChevronRight } from 'lucide-react'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/support/agents/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Ошибка входа')
        setIsLoading(false)
        return
      }

      // Сохраняем токен и данные агента
      localStorage.setItem('support_agent_token', data.token)
      localStorage.setItem('support_agent', JSON.stringify(data.agent))
      localStorage.setItem('auth', JSON.stringify({ 
        email: data.agent.username, 
        role: data.agent.role,
        name: data.agent.name
      }))

      navigate('/overview')
    } catch (err: any) {
      setError(err.message || 'Ошибка подключения к серверу')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#1a2b4b] to-[#0f172a] p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
          <span className="text-white font-bold text-xl">SUPPORT</span>
        </div>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Система управления<br />
            поддержкой клиентов
          </h1>
          <p className="text-slate-300 text-lg max-w-md">
            Автоматизация поддержки с помощью ИИ, 
            аналитика в реальном времени и командная работа.
          </p>

          <div className="flex gap-4 pt-4">
            <div className="flex items-center gap-2 text-slate-300">
              <ChevronRight className="w-5 h-5 text-blue-400" />
              <span>ИИ-ответы</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <ChevronRight className="w-5 h-5 text-blue-400" />
              <span>Аналитика</span>
            </div>
          </div>
        </div>

        <p className="text-slate-500 text-sm">
          © 2026 Support System. Все права защищены.
        </p>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-xl text-slate-800">SUPPORT</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-2">Добро пожаловать</h2>
          <p className="text-slate-500 mb-8">Введите данные для входа в систему</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Логин</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Введите логин или email"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 text-blue-500 rounded border-slate-300" />
                <span className="text-sm text-slate-600">Запомнить меня</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <p className="text-center text-slate-500 text-sm mt-8">
            Нет доступа? <a href="#" className="text-blue-500 hover:underline">Обратитесь к администратору</a>
          </p>
        </div>
      </div>
    </div>
  )
}
