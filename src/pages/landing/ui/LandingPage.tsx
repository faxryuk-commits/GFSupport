import { Link } from 'react-router-dom'
import {
  MessageSquare, Shield, BarChart3, Zap, Bot, Users, Globe,
  CheckCircle2, ArrowRight, Send, Phone, Brain, Clock, Target
} from 'lucide-react'

const features = [
  { icon: MessageSquare, title: 'Мультиканальный чат', desc: 'Telegram и WhatsApp в одном окне. Все обращения клиентов в одной панели.' },
  { icon: Bot, title: 'AI-автоответы', desc: 'Умные ответы на частые вопросы. GPT-4 анализирует контекст и помогает агентам.' },
  { icon: BarChart3, title: 'SLA отчётность', desc: 'Время ответа, качество обслуживания, загрузка агентов — всё в реальном времени.' },
  { icon: Shield, title: 'Изоляция данных', desc: 'Каждая компания — отдельное пространство. Полная безопасность и конфиденциальность.' },
  { icon: Users, title: 'Командная работа', desc: 'Распределение обращений, эскалация, обязательства — прозрачный процесс для всей команды.' },
  { icon: Zap, title: 'Автоматизация', desc: 'Авто-создание кейсов, транскрибация голосовых, умная маршрутизация.' },
]

const plans = [
  {
    name: 'Starter',
    price: 'Бесплатно',
    priceNote: 'навсегда',
    highlight: false,
    features: [
      '2 агента',
      '3 канала',
      '1 000 сообщений/мес',
      'Telegram интеграция',
      'Управление кейсами',
      'Базовая аналитика',
    ],
    cta: 'Начать бесплатно',
  },
  {
    name: 'Business',
    price: '$29',
    priceNote: '/мес',
    highlight: true,
    features: [
      '10 агентов',
      '20 каналов',
      '20 000 сообщений/мес',
      'Telegram + WhatsApp',
      'SLA отчёты',
      'База знаний',
      'AI автоответы',
      'Рассылки',
      'Обязательства',
    ],
    cta: 'Попробовать',
  },
  {
    name: 'Enterprise',
    price: '$199',
    priceNote: '/мес',
    highlight: false,
    features: [
      'Безлимит агентов',
      'Безлимит каналов',
      'Безлимит сообщений',
      'Всё из Business',
      'AI обучение',
      'Приоритетная поддержка',
      'Кастомные интеграции',
      'Выделенный менеджер',
    ],
    cta: 'Связаться',
  },
]

const steps = [
  { icon: Send, title: 'Регистрация', desc: 'Напишите /start нашему боту и создайте аккаунт за 2 минуты' },
  { icon: Globe, title: 'Подключите каналы', desc: 'Добавьте Telegram бота и WhatsApp в настройках' },
  { icon: Target, title: 'Работайте', desc: 'Принимайте обращения, отслеживайте SLA и растите' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">GFSupport</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium px-4 py-2">
              Войти
            </Link>
            <Link to="/signup" className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors">
              Начать бесплатно
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Zap className="w-4 h-4" />
            Платформа поддержки нового поколения
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
            Поддержка клиентов<br />
            <span className="text-blue-600">без хаоса</span>
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
            Объедините Telegram и WhatsApp в единую панель. AI помогает отвечать быстрее, SLA-отчёты держат команду в тонусе.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3.5 rounded-xl hover:bg-blue-700 font-semibold text-lg transition-colors shadow-lg shadow-blue-600/25"
            >
              Начать бесплатно <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-sm text-gray-400 mt-4">Без карты. Бесплатный план навсегда.</p>
        </div>
      </section>

      {/* Integrations strip */}
      <section className="py-12 border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-center gap-12 flex-wrap">
          <div className="flex items-center gap-3 text-gray-400">
            <Send className="w-7 h-7" />
            <span className="font-semibold text-lg">Telegram</span>
          </div>
          <div className="flex items-center gap-3 text-gray-400">
            <Phone className="w-7 h-7" />
            <span className="font-semibold text-lg">WhatsApp</span>
          </div>
          <div className="flex items-center gap-3 text-gray-400">
            <Brain className="w-7 h-7" />
            <span className="font-semibold text-lg">OpenAI GPT-4</span>
          </div>
          <div className="flex items-center gap-3 text-gray-400">
            <Clock className="w-7 h-7" />
            <span className="font-semibold text-lg">Whisper AI</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Всё для эффективной поддержки</h2>
            <p className="text-lg text-gray-500 max-w-xl mx-auto">Инструменты, которые помогают вашей команде работать быстрее и качественнее</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="p-6 rounded-2xl border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all group">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
                  <f.icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Начните за 3 шага</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
                  {i + 1}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-gray-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Тарифы</h2>
            <p className="text-lg text-gray-500">Начните бесплатно, масштабируйтесь по мере роста</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={`rounded-2xl p-8 flex flex-col ${
                  plan.highlight
                    ? 'bg-blue-600 text-white shadow-2xl shadow-blue-600/30 scale-105 relative'
                    : 'bg-white border border-gray-200'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full">
                    ПОПУЛЯРНЫЙ
                  </div>
                )}
                <h3 className={`text-xl font-bold mb-1 ${plan.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {plan.name}
                </h3>
                <div className="mb-6">
                  <span className={`text-4xl font-bold ${plan.highlight ? 'text-white' : 'text-gray-900'}`}>
                    {plan.price}
                  </span>
                  <span className={`text-sm ml-1 ${plan.highlight ? 'text-blue-200' : 'text-gray-400'}`}>
                    {plan.priceNote}
                  </span>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <CheckCircle2 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${plan.highlight ? 'text-blue-200' : 'text-blue-500'}`} />
                      <span className={`text-sm ${plan.highlight ? 'text-blue-50' : 'text-gray-600'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={`block text-center py-3 rounded-xl font-semibold transition-colors ${
                    plan.highlight
                      ? 'bg-white text-blue-600 hover:bg-blue-50'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-blue-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Готовы улучшить поддержку?
          </h2>
          <p className="text-xl text-blue-200 mb-8">
            Присоединяйтесь к компаниям, которые уже используют GFSupport
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-3.5 rounded-xl font-semibold text-lg hover:bg-blue-50 transition-colors"
          >
            Создать аккаунт <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-gray-100">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">GFSupport</span>
          </div>
          <p className="text-sm text-gray-400">&copy; 2026 GFSupport. Все права защищены.</p>
        </div>
      </footer>
    </div>
  )
}
