import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MessageSquare, Building2, Mail, Lock, User, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'

type Step = 'info' | 'otp' | 'password' | 'done'

export function OrgRegisterPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('info')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [orgSlug, setOrgSlug] = useState('')

  const requestOtp = async () => {
    if (!companyName.trim() || !email.trim()) {
      setError('Заполните все поля')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/support/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'request-otp', email, companyName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setStep('otp')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const verifyAndCreate = async () => {
    if (!otp.trim()) { setError('Введите код'); return }
    if (password.length < 6) { setError('Пароль минимум 6 символов'); return }
    if (password !== confirmPassword) { setError('Пароли не совпадают'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/support/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'verify-and-create', email, code: otp, companyName, password, ownerName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }

      localStorage.setItem('support_agent_token', data.token)
      localStorage.setItem('support_agent_data', JSON.stringify(data.agent))
      localStorage.setItem('support_agent_id', data.agent.id)
      if (data.org) {
        localStorage.setItem('support_org_id', data.org.id)
        localStorage.setItem('support_org_data', JSON.stringify(data.org))
      }
      setOrgSlug(data.org?.slug || '')
      setStep('done')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#1a2b4b] to-[#0f172a] p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">GFSupport</span>
        </div>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Подключите свою<br />компанию к GFSupport
          </h1>
          <p className="text-slate-300 text-lg max-w-md">
            Единая платформа для управления клиентской поддержкой через Telegram и WhatsApp
          </p>
          <div className="space-y-3 text-slate-400">
            <Feature text="Мультиканальная поддержка" />
            <Feature text="AI-анализ и автоответы" />
            <Feature text="SLA отчётность и аналитика" />
            <Feature text="Безопасная изоляция данных" />
          </div>
        </div>

        <p className="text-slate-500 text-sm">© 2026 GFSupport. Все права защищены.</p>
      </div>

      {/* Right form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {step === 'info' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Создайте аккаунт</h2>
                <p className="text-slate-500 mt-1">Зарегистрируйте вашу компанию за 2 минуты</p>
              </div>

              {error && <ErrorMsg text={error} />}

              <div className="space-y-4">
                <InputField icon={Building2} label="Название компании" value={companyName} onChange={setCompanyName} placeholder="ООО Пример" />
                <InputField icon={User} label="Ваше имя" value={ownerName} onChange={setOwnerName} placeholder="Иван Иванов" />
                <InputField icon={Mail} label="Email" value={email} onChange={setEmail} placeholder="admin@company.com" type="email" />
              </div>

              <button
                onClick={requestOtp}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
              >
                {loading ? 'Отправка...' : <><span>Получить код</span><ArrowRight className="w-4 h-4" /></>}
              </button>

              <p className="text-center text-sm text-slate-500">
                Уже есть аккаунт? <Link to="/login" className="text-blue-600 hover:underline font-medium">Войти</Link>
              </p>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-6">
              <button onClick={() => setStep('info')} className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm">
                <ArrowLeft className="w-4 h-4" /> Назад
              </button>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Подтвердите email</h2>
                <p className="text-slate-500 mt-1">Код отправлен на <span className="font-medium text-slate-700">{email}</span></p>
              </div>

              {error && <ErrorMsg text={error} />}

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Код подтверждения</label>
                  <input
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl font-mono tracking-[0.5em] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                  />
                </div>
                <InputField icon={Lock} label="Пароль" value={password} onChange={setPassword} placeholder="Минимум 6 символов" type="password" />
                <InputField icon={Lock} label="Подтвердите пароль" value={confirmPassword} onChange={setConfirmPassword} placeholder="Повторите пароль" type="password" />
              </div>

              <button
                onClick={verifyAndCreate}
                disabled={loading || otp.length < 6}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
              >
                {loading ? 'Создание...' : <><span>Создать организацию</span><ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Готово!</h2>
                <p className="text-slate-500 mt-2">Организация <strong>{companyName}</strong> успешно создана.</p>
                {orgSlug && (
                  <p className="text-sm text-slate-400 mt-1">
                    Ваш адрес: <span className="font-mono text-blue-600">{orgSlug}.gfsupport.app</span>
                  </p>
                )}
              </div>
              <button
                onClick={() => navigate('/overview')}
                className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
              >
                Перейти в панель управления
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InputField({ icon: Icon, label, value, onChange, placeholder, type = 'text' }: {
  icon: any; label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
        <input
          type={type}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function ErrorMsg({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{text}</div>
}

export default OrgRegisterPage
