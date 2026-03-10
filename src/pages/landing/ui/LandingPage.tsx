import { Link } from 'react-router-dom'
import {
  MessageSquare, Shield, BarChart3, Zap, Users, Eye, Brain,
  CheckCircle2, ArrowRight, Send, AlertTriangle, Clock, Target,
  TrendingUp, Headphones, FileSearch, Lock, Layers, Lightbulb
} from 'lucide-react'

const painPoints = [
  {
    pain: 'Менеджер забыл ответить клиенту — вы узнали через неделю',
    solution: 'AI фиксирует каждое сообщение и сигнализирует, если ответа нет',
  },
  {
    pain: 'Клиент пишет в 3 чата — никто не берёт ответственность',
    solution: 'Система сама создаёт кейс и назначает ответственного',
  },
  {
    pain: '«Мы общались в чате» — а что решили, никто не знает',
    solution: 'AI вытягивает суть из переписки: проблема, решение, обязательства',
  },
  {
    pain: 'Голосовые на 5 минут — слушать некогда',
    solution: 'Автоматическая транскрибация + AI-резюме за 3 секунды',
  },
]

const features = [
  {
    icon: Eye,
    title: 'Видеть всё, не читая каждый чат',
    desc: 'AI читает переписки за вас и показывает: кто затягивает, где проблема, что обещали клиенту.',
  },
  {
    icon: Target,
    title: 'Контроль без микроменеджмента',
    desc: 'Не надо заглядывать через плечо. Дашборд покажет кто работает, кто буксует, где горит.',
  },
  {
    icon: Brain,
    title: 'AI — ваши глаза и уши',
    desc: 'GPT-4 анализирует контекст, определяет тональность, подсказывает ответы и выявляет паттерны.',
  },
  {
    icon: Clock,
    title: 'SLA без ручного контроля',
    desc: 'Задайте правила один раз. Система сама следит за временем ответа и эскалирует просрочки.',
  },
  {
    icon: Users,
    title: 'Команда в одном окне',
    desc: 'Telegram-группы с клиентами, внутренние чаты — всё в одной панели с историей и аналитикой.',
  },
  {
    icon: Shield,
    title: 'Данные остаются вашими',
    desc: 'Изолированное пространство для каждой компании. Никто не видит чужих клиентов.',
  },
]

const whoIsItFor = [
  {
    icon: Headphones,
    title: 'Сервис и поддержка',
    desc: 'Не теряйте обращения. Видьте время ответа. Держите SLA.',
  },
  {
    icon: TrendingUp,
    title: 'Продажи',
    desc: 'Контролируйте как менеджеры ведут клиентов. Без чтения каждого сообщения.',
  },
  {
    icon: Layers,
    title: 'Операционка',
    desc: 'Склад, логистика, закупки — любая коммуникация в группах под контролем.',
  },
  {
    icon: FileSearch,
    title: 'Руководство',
    desc: 'Еженедельный отчёт за 30 секунд: кто работает, где просрочки, что решили.',
  },
]

const steps = [
  { num: '1', title: 'Получите код', desc: 'Напишите /start нашему боту в Telegram — он выдаст код' },
  { num: '2', title: 'Создайте пространство', desc: 'Введите код, назовите компанию. Система покажет демо-данные' },
  { num: '3', title: 'Подключите группы', desc: 'Добавьте бота в Telegram-группы с клиентами — он начнёт слушать' },
]

const plans = [
  {
    name: 'Starter',
    price: 'Бесплатно',
    priceNote: 'навсегда',
    highlight: false,
    features: [
      '2 сотрудника',
      '3 группы/канала',
      '1 000 сообщений/мес',
      'Telegram интеграция',
      'AI-резюме переписок',
      'Базовый дашборд',
    ],
    cta: 'Начать бесплатно',
  },
  {
    name: 'Business',
    price: '$29',
    priceNote: '/мес',
    highlight: true,
    features: [
      '10 сотрудников',
      '20 групп/каналов',
      '20 000 сообщений/мес',
      'Telegram + WhatsApp',
      'SLA-контроль',
      'AI-анализ тональности',
      'Обязательства и дедлайны',
      'Рассылки клиентам',
      'Аналитика по команде',
    ],
    cta: 'Попробовать',
  },
  {
    name: 'Enterprise',
    price: '$199',
    priceNote: '/мес',
    highlight: false,
    features: [
      'Безлимит сотрудников',
      'Безлимит групп',
      'Безлимит сообщений',
      'Всё из Business',
      'AI-обучение на ваших данных',
      'Выгрузка отчётов',
      'Приоритетная поддержка',
      'Выделенный менеджер',
    ],
    cta: 'Связаться',
  },
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
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#problems" className="hover:text-gray-900 transition-colors">Проблемы</a>
            <a href="#features" className="hover:text-gray-900 transition-colors">Возможности</a>
            <a href="#for-whom" className="hover:text-gray-900 transition-colors">Для кого</a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">Тарифы</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium px-4 py-2">
              Войти
            </Link>
            <Link to="/signup" className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors">
              Попробовать
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Lightbulb className="w-4 h-4" />
            Не CRM. Не тикет-система. Контроль коммуникаций.
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
            Знайте, что происходит<br />
            <span className="text-blue-600">в каждом чате вашей команды</span>
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            AI читает переписки с клиентами за вас. Вы видите: кто тянет с ответом, где назревает проблема, что пообещали клиенту — и всё это без чтения сотен сообщений.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3.5 rounded-xl hover:bg-blue-700 font-semibold text-lg transition-colors shadow-lg shadow-blue-600/25"
            >
              Попробовать бесплатно <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#problems"
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 px-6 py-3.5 font-medium transition-colors"
            >
              Узнать подробнее
            </a>
          </div>
          <p className="text-sm text-gray-400 mt-4">Бесплатный план навсегда. Настройка за 5 минут.</p>
        </div>
      </section>

      {/* Social proof strip */}
      <section className="py-8 border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-center gap-10 flex-wrap text-sm text-gray-400">
          <span className="flex items-center gap-2"><Send className="w-5 h-5" /> Telegram</span>
          <span className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> WhatsApp</span>
          <span className="flex items-center gap-2"><Brain className="w-5 h-5" /> GPT-4 анализ</span>
          <span className="flex items-center gap-2"><Headphones className="w-5 h-5" /> Whisper транскрибация</span>
        </div>
      </section>

      {/* Pain points */}
      <section id="problems" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Знакомо?</h2>
            <p className="text-lg text-gray-500 max-w-xl mx-auto">Типичные проблемы бизнеса, где коммуникация с клиентами идёт через мессенджеры</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {painPoints.map((p, i) => (
              <div key={i} className="rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow">
                <div className="bg-red-50 px-6 py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-800 font-medium text-sm leading-relaxed">{p.pain}</p>
                </div>
                <div className="bg-green-50 px-6 py-4 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <p className="text-green-800 text-sm leading-relaxed">{p.solution}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Как это работает</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">Бот сидит в ваших Telegram-группах с клиентами. AI анализирует всё. Вы видите картину целиком.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all group">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
                  <f.icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 leading-relaxed text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For whom */}
      <section id="for-whom" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Для кого это</h2>
            <p className="text-lg text-gray-500 max-w-xl mx-auto">Любой бизнес, где команда общается с клиентами в мессенджерах</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whoIsItFor.map((w, i) => (
              <div key={i} className="text-center p-6 rounded-2xl border border-gray-100 hover:border-blue-100 hover:bg-blue-50/30 transition-all">
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <w.icon className="w-7 h-7 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{w.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-gradient-to-r from-slate-50 to-blue-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Запуск за 5 минут</h2>
            <p className="text-lg text-gray-500">Никакой настройки серверов. Никаких интеграторов.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold shadow-lg shadow-blue-600/20">
                  {s.num}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-xl hover:bg-blue-700 font-semibold transition-colors shadow-lg shadow-blue-600/20"
            >
              Начать сейчас <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Без нас vs С нами</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-red-50/50 border border-red-100 rounded-2xl p-8">
              <h3 className="text-lg font-bold text-red-800 mb-6 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Сейчас у вас
              </h3>
              <ul className="space-y-4">
                {[
                  'Переписки разбросаны по чатам',
                  'Непонятно, ответили клиенту или нет',
                  'Голосовые никто не слушает',
                  'Обещания забываются',
                  'Аналитика = «мне кажется, всё ок»',
                  'Контроль = читать каждый чат',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-red-700">
                    <span className="w-5 h-5 bg-red-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-red-600">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-green-50/50 border border-green-100 rounded-2xl p-8">
              <h3 className="text-lg font-bold text-green-800 mb-6 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> С GFSupport
              </h3>
              <ul className="space-y-4">
                {[
                  'Все коммуникации в одной панели',
                  'SLA-таймер на каждое обращение',
                  'Голосовые → текст + резюме за 3 сек',
                  'Обязательства фиксируются и отслеживаются',
                  'Дашборд с цифрами в реальном времени',
                  'AI контролирует — вы принимаете решения',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-green-700">
                    <span className="w-5 h-5 bg-green-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-green-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Тарифы</h2>
            <p className="text-lg text-gray-500">Начните бесплатно. Масштабируйтесь когда будете готовы.</p>
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

      {/* Final CTA */}
      <section className="py-24 px-6 bg-gradient-to-br from-[#1a2b4b] to-[#0f172a]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Перестаньте гадать.<br />Начните видеть.
          </h2>
          <p className="text-xl text-slate-300 mb-8 leading-relaxed">
            Подключите GFSupport и за 5 минут узнайте, что на самом деле происходит в переписках вашей команды.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3.5 rounded-xl font-semibold text-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/30"
          >
            Попробовать бесплатно <ArrowRight className="w-5 h-5" />
          </Link>
          <p className="text-sm text-slate-500 mt-4">Бесплатный план. Без карты. Настройка за 5 минут.</p>
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
