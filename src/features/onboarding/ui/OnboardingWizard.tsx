import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, ClipboardList, Hash, BarChart3,
  Settings, ArrowRight, ArrowLeft, Sparkles, X, Shield, Zap
} from 'lucide-react'

const ONBOARDING_DONE_KEY = 'onboarding_completed'

interface Step {
  id: string
  title: string
  subtitle: string
  icon: typeof Sparkles
  content: React.ReactNode
}

export function OnboardingWizard() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_DONE_KEY)
    if (!done) setVisible(true)
  }, [])

  const goToSettings = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true')
    setVisible(false)
    navigate('/settings')
  }

  const justExplore = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  const steps: Step[] = [
    {
      id: 'welcome',
      title: 'Добро пожаловать в GFSupport!',
      subtitle: 'Давайте познакомимся с системой',
      icon: Sparkles,
      content: (
        <div className="space-y-4">
          <p className="text-gray-600 leading-relaxed">
            <strong>GFSupport</strong> — платформа для управления клиентской коммуникацией. Все переписки из мессенджеров собираются в единой панели.
          </p>
          <div className="bg-blue-50 rounded-xl p-4">
            <h4 className="font-semibold text-blue-900 text-sm mb-2">Что умеет система:</h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '💬', text: 'Единый чат из всех групп' },
                { icon: '🤖', text: 'AI-анализ сообщений' },
                { icon: '📋', text: 'Авто-создание кейсов' },
                { icon: '📊', text: 'Аналитика и SLA' },
                { icon: '👥', text: 'Управление командой' },
                { icon: '⚡', text: 'Автоматизации' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-blue-800">
                  <span>{f.icon}</span> {f.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'overview-chats',
      title: 'Обзор и Чаты',
      subtitle: 'Главные рабочие инструменты',
      icon: LayoutDashboard,
      content: (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <LayoutDashboard className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Обзор (Дашборд)</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Стартовая страница. Показывает активные кейсы, время ответа, SLA, нагрузку команды и AI-рекомендации. Все метрики обновляются автоматически.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Чаты</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Все сообщения из подключённых групп в одном окне. Выбирайте чат слева, отвечайте справа. Есть фильтры, поиск, AI-контекст и возможность закреплять важные чаты.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'cases-channels',
      title: 'Кейсы и Каналы',
      subtitle: 'Отслеживание проблем и источников',
      icon: ClipboardList,
      content: (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
              <ClipboardList className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Кейсы</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                AI автоматически находит проблемы в сообщениях клиентов и создаёт кейсы. Канбан-доска со статусами: Обнаружен → В работе → Решён. Назначайте кейсы на агентов, отслеживайте прогресс.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
              <Hash className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Каналы</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Список всех подключённых групп. Каждая Telegram-группа с ботом = один канал. Здесь видно статус (активный/неактивный), SLA-категорию и статистику.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'analytics-settings',
      title: 'Аналитика и Настройки',
      subtitle: 'Контроль и конфигурация',
      icon: BarChart3,
      content: (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Аналитика</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Детальная статистика: количество сообщений, кейсов, среднее время ответа, SLA-показатели, нагрузка по агентам и категориям проблем.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Настройки</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Подключение интеграций (Telegram-бот, AI), управление командой и ролями, SLA-параметры, автоответы, уведомления и внешний вид. <strong>Именно сюда нужно идти первым делом.</strong>
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'start',
      title: 'Готовы начать?',
      subtitle: 'Выберите следующий шаг',
      icon: Zap,
      content: (
        <div className="space-y-4">
          <p className="text-gray-600 text-sm leading-relaxed">
            Чтобы система заработала, нужно подключить хотя бы одну интеграцию. Рекомендуем начать с настроек:
          </p>
          <div className="space-y-3">
            <button
              onClick={goToSettings}
              className="w-full flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-blue-900 text-sm">Перейти в настройки</p>
                <p className="text-xs text-blue-700">Подключить бота, настроить команду, SLA</p>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-500" />
            </button>
            <button
              onClick={justExplore}
              className="w-full flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0">
                <LayoutDashboard className="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">Посмотреть систему</p>
                <p className="text-xs text-gray-500">Изучу интерфейс сам, настрою позже</p>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center">
            Справка (?) доступна в каждом разделе
          </p>
        </div>
      ),
    },
  ]

  const step = steps[current]
  const Icon = step.icon
  const isLast = current === steps.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white relative">
          <button onClick={justExplore} className="absolute top-4 right-4 text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-blue-200 text-xs">Шаг {current + 1} из {steps.length}</p>
              <h2 className="text-lg font-bold leading-tight">{step.title}</h2>
              <p className="text-blue-200 text-xs">{step.subtitle}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= current ? 'bg-white' : 'bg-white/20'}`} />
            ))}
          </div>
        </div>

        <div className="p-6 max-h-[380px] overflow-y-auto">
          {step.content}
        </div>

        {!isLast && (
          <div className="px-6 pb-5 flex items-center justify-between">
            {current > 0 ? (
              <button onClick={() => setCurrent(current - 1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-4 h-4" /> Назад
              </button>
            ) : (
              <button onClick={justExplore} className="text-sm text-gray-400 hover:text-gray-600">
                Пропустить
              </button>
            )}
            <button
              onClick={() => setCurrent(current + 1)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Далее
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function useOnboardingComplete() {
  return !!localStorage.getItem(ONBOARDING_DONE_KEY)
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_DONE_KEY)
}
