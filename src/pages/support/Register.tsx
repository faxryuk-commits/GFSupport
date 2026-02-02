import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Headphones, User, Mail, Phone, MessageCircle, Briefcase, Building, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export function SupportRegister() {
  const navigate = useNavigate()
  const { token } = useParams<{ token: string }>()
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  
  const [invite, setInvite] = useState<{
    valid: boolean
    invite?: {
      id?: string
      email?: string
      role?: string
      expiresAt?: string
    }
  } | null>(null)
  
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    telegram: '',
    position: '',
    department: '',
    password: '',
    passwordConfirm: ''
  })

  // Проверяем токен при загрузке
  useEffect(() => {
    if (!token) {
      setError('Ссылка приглашения недействительна')
      setLoading(false)
      return
    }

    async function checkInvite() {
      try {
        const res = await fetch(`/api/support/invites?token=${token}`)
        const data = await res.json()
        
        if (data.valid) {
          setInvite(data)
          if (data.invite?.email) {
            setForm(prev => ({ ...prev, email: data.invite.email }))
          }
        } else {
          setError(data.error || 'Приглашение недействительно')
        }
      } catch (e) {
        setError('Ошибка проверки приглашения')
      } finally {
        setLoading(false)
      }
    }

    checkInvite()
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Валидация
    if (!form.name.trim()) {
      setError('Укажите ваше имя')
      return
    }
    if (form.password.length < 6) {
      setError('Пароль должен быть минимум 6 символов')
      return
    }
    if (form.password !== form.passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch('/api/support/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: form.name,
          email: form.email,
          phone: form.phone,
          telegram: form.telegram,
          position: form.position,
          department: form.department,
          password: form.password
        })
      })

      const data = await res.json()

      if (data.success) {
        setSuccess(true)
        // Сохраняем токен и данные агента
        if (data.token && data.agent) {
          localStorage.setItem('support_agent_token', `Bearer ${data.token}`)
          localStorage.setItem('support_agent_id', data.agent.id)
          localStorage.setItem('support_agent_data', JSON.stringify(data.agent))
        }
        // Через 2 секунды редирект
        setTimeout(() => {
          navigate('/support')
        }, 2000)
      } else {
        setError(data.error || 'Ошибка регистрации')
      }
    } catch (e) {
      setError('Ошибка соединения с сервером')
    } finally {
      setSubmitting(false)
    }
  }

  // Показываем загрузку
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Проверка приглашения...</p>
        </div>
      </div>
    )
  }

  // Ошибка токена
  if (error && !invite) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Ссылка недействительна</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <p className="text-sm text-slate-500">
            Свяжитесь с администратором для получения нового приглашения
          </p>
        </div>
      </div>
    )
  }

  // Успешная регистрация
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Добро пожаловать!</h1>
          <p className="text-slate-600 mb-4">Регистрация успешно завершена</p>
          <p className="text-sm text-slate-500">Перенаправление в панель управления...</p>
        </div>
      </div>
    )
  }

  // Форма регистрации
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Headphones className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Регистрация в Delever Support</h1>
          <p className="text-slate-500 mt-2">Заполните информацию о себе для создания аккаунта</p>
          {invite?.invite?.role && (
            <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
              Роль: {invite.invite.role === 'agent' ? 'Агент' : invite.invite.role === 'senior' ? 'Старший агент' : invite.invite.role === 'lead' ? 'Тимлид' : 'Менеджер'}
            </span>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ФИО */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              ФИО <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Иван Иванов"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                required
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="ivan@example.com"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Телефон и Telegram */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+998 90 123 45 67"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Telegram</label>
              <div className="relative">
                <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.telegram}
                  onChange={e => setForm({ ...form, telegram: e.target.value })}
                  placeholder="@username"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Должность и Отдел */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Должность</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.position}
                  onChange={e => setForm({ ...form, position: e.target.value })}
                  placeholder="Специалист поддержки"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Отдел</label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.department}
                  onChange={e => setForm({ ...form, department: e.target.value })}
                  placeholder="Служба поддержки"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Пароль */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Пароль <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Минимум 6 символов"
                className="w-full pl-10 pr-12 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                required
                minLength={6}
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

          {/* Подтверждение пароля */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Подтвердите пароль <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.passwordConfirm}
                onChange={e => setForm({ ...form, passwordConfirm: e.target.value })}
                placeholder="Повторите пароль"
                className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                  form.passwordConfirm && form.password !== form.passwordConfirm 
                    ? 'border-red-300 focus:border-red-500' 
                    : 'border-slate-200 focus:border-blue-500'
                }`}
                required
              />
            </div>
            {form.passwordConfirm && form.password !== form.passwordConfirm && (
              <p className="text-sm text-red-500 mt-1">Пароли не совпадают</p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || form.password !== form.passwordConfirm}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Регистрация...
              </>
            ) : (
              'Зарегистрироваться'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-sm text-slate-500 mt-6">
          Уже есть аккаунт?{' '}
          <a href="/support/login" className="text-blue-600 hover:text-blue-700">
            Войти
          </a>
        </p>
      </div>
    </div>
  )
}

export default SupportRegister
