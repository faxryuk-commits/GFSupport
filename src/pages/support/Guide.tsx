import { useState } from 'react'
import { 
  Book, ChevronDown, ChevronRight, MessageSquare, AlertCircle, Users, 
  BarChart3, Send, Settings, Zap, Clock, Target, Trophy, Star,
  CheckCircle, XCircle, Calendar, Bell, Search, FileText, ArrowLeft,
  Layers, Database, Bot, Brain, Shield, TrendingUp, Award, Flame
} from 'lucide-react'

interface Section {
  id: string
  title: string
  icon: React.ReactNode
  content: React.ReactNode
}

export default function SupportGuide() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['intro']))
  const [searchQuery, setSearchQuery] = useState('')

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const sections: Section[] = [
    {
      id: 'intro',
      title: 'Что это такое',
      icon: <Book className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            <strong>Delever Support Dashboard</strong> — это единая платформа для управления технической поддержкой 
            клиентов через Telegram. Система объединяет все каналы коммуникации в одном интерфейсе, 
            автоматизирует рутинные задачи с помощью AI и предоставляет полную аналитику по работе команды.
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { icon: <MessageSquare className="w-5 h-5" />, title: 'Единый интерфейс', desc: 'Все Telegram группы в одном месте' },
              { icon: <Brain className="w-5 h-5" />, title: 'AI-ассистент', desc: 'Анализ сообщений и рекомендации' },
              { icon: <BarChart3 className="w-5 h-5" />, title: 'Аналитика', desc: 'KPI, SLA, метрики в реальном времени' },
              { icon: <Layers className="w-5 h-5" />, title: 'Канбан-доска', desc: 'Управление тикетами и задачами' },
              { icon: <Send className="w-5 h-5" />, title: 'Рассылки', desc: 'Массовые сообщения с планировщиком' },
              { icon: <Trophy className="w-5 h-5" />, title: 'Геймификация', desc: 'Очки, уровни, лидерборд' },
            ].map((item, i) => (
              <div key={i} className="p-3 bg-slate-50 rounded-lg">
                <div className="text-blue-600 mb-2">{item.icon}</div>
                <div className="font-medium text-sm text-slate-800">{item.title}</div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-blue-50 rounded-xl">
            <h4 className="font-semibold text-blue-800 mb-2">Информация о проекте</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Создатель:</span> <strong>Фахриддин Юсупов</strong></div>
              <div><span className="text-slate-500">Версия:</span> <strong>2.0</strong></div>
              <div><span className="text-slate-500">Период разработки:</span> <strong>Январь 2026</strong></div>
              <div><span className="text-slate-500">Технологии:</span> <strong>React, TypeScript, AI</strong></div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'channels',
      title: 'Каналы',
      icon: <MessageSquare className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Управление подключёнными Telegram группами и чатами. Все каналы отображаются с индикаторами 
            статуса и временем ожидания ответа.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Индикаторы статуса</h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span><strong>Зелёный</strong> — ответ дан, всё в порядке</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span><strong>Жёлтый</strong> — ожидает ответа менее 5 минут</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span><strong>Красный</strong> — ожидает ответа более 5 минут (нарушение SLA)</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Функции</h4>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Список всех подключённых групп с статистикой</li>
              <li>Контекстное меню (правый клик) — предпросмотр, пометка непрочитанным</li>
              <li>Фото профиля групп и пользователей</li>
              <li>Время последней активности</li>
            </ul>
          </div>

          <a href="/support#channels" className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm">
            Перейти к каналам →
          </a>
        </div>
      )
    },
    {
      id: 'messages',
      title: 'Сообщения',
      icon: <MessageSquare className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Единый поток всех сообщений из подключённых каналов с AI-подсказками и возможностью 
            быстрого ответа.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">AI-ассистент</h4>
            <p className="text-sm text-slate-600">
              AI анализирует последние <strong>30 сообщений</strong> в чате и предоставляет:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>📝 Краткое резюме — суть обсуждения</li>
              <li>🎯 Рекомендация — что ответить клиенту</li>
              <li>⚡ Срочность — приоритет сообщения</li>
              <li>😊 Настроение — тональность клиента</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Действия</h4>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Быстрый ответ прямо из интерфейса</li>
              <li>Двойной клик — ответ с цитатой</li>
              <li>Просмотр медиа-файлов (фото, видео, документы)</li>
              <li>Создание тикета из сообщения</li>
            </ul>
          </div>

          <a href="/support#messages" className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm">
            Перейти к сообщениям →
          </a>
        </div>
      )
    },
    {
      id: 'cases',
      title: 'Кейсы (Тикеты)',
      icon: <AlertCircle className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Канбан-доска для управления задачами и проблемами с нумерацией тикетов и историей изменений.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Статусы кейсов</h4>
            <div className="flex flex-wrap gap-2">
              {[
                { status: 'new', label: 'Новый', color: 'bg-blue-100 text-blue-700' },
                { status: 'in_progress', label: 'В работе', color: 'bg-yellow-100 text-yellow-700' },
                { status: 'waiting', label: 'Ожидает', color: 'bg-orange-100 text-orange-700' },
                { status: 'resolved', label: 'Решён', color: 'bg-green-100 text-green-700' },
                { status: 'closed', label: 'Закрыт', color: 'bg-slate-100 text-slate-700' },
              ].map(s => (
                <span key={s.status} className={`px-2 py-1 rounded text-xs font-medium ${s.color}`}>
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Функции</h4>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Drag & Drop между колонками</li>
              <li>Уникальный номер тикета (#001, #002...)</li>
              <li>Приоритеты: критический, высокий, средний, низкий</li>
              <li>Назначение ответственного сотрудника</li>
              <li>Полная история изменений (таймлайн)</li>
            </ul>
          </div>

          <a href="/support#cases" className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm">
            Перейти к кейсам →
          </a>
        </div>
      )
    },
    {
      id: 'agents',
      title: 'Сотрудники',
      icon: <Users className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Управление командой технической поддержки с метриками эффективности и статусами онлайн.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Расчёт эффективности</h4>
            <div className="p-3 bg-slate-50 rounded-lg text-sm font-mono">
              <div className="text-green-600">+ 1 балл за обработанное сообщение</div>
              <div className="text-green-600">+ 3 балла за решённый кейс</div>
              <div className="text-green-600">+ 2 балла за быстрый ответ (&lt; 5 мин)</div>
              <div className="text-red-600">- 5 баллов за просроченное обещание</div>
              <div className="text-red-600">- 3 балла за просроченный кейс</div>
              <div className="mt-2 pt-2 border-t text-slate-600">Эффективность = (Баллы / 80) × 100%</div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Цветовая шкала</h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-green-600">100%+</span> — Отлично
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-yellow-600">70-99%</span> — Хорошо
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-orange-600">50-69%</span> — Нужно улучшить
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-red-600">&lt; 50%</span> — Критично
              </div>
            </div>
          </div>

          <a href="/support#agents" className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm">
            Перейти к сотрудникам →
          </a>
        </div>
      )
    },
    {
      id: 'analytics',
      title: 'Аналитика',
      icon: <BarChart3 className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Статистика и отчёты по работе системы с KPI метриками и матрицей сотрудников.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">KPI нормативы</h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { metric: 'Время первого ответа', value: '≤ 5 минут' },
                { metric: 'Время решения L1', value: '≤ 1 час' },
                { metric: 'Время решения L2', value: '8-40 часов' },
                { metric: 'SLA выполнение', value: '≥ 99%' },
              ].map((kpi, i) => (
                <div key={i} className="p-2 bg-slate-50 rounded text-sm">
                  <div className="text-slate-500">{kpi.metric}</div>
                  <div className="font-semibold text-slate-800">{kpi.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Разделы</h4>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Обзор — ключевые показатели за период</li>
              <li>Каналы — топ активных, проблемные, здоровье</li>
              <li>Сотрудники — матрица эффективности</li>
              <li>Тренды — графики активности</li>
            </ul>
          </div>

          <a href="/support#analytics" className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm">
            Перейти к аналитике →
          </a>
        </div>
      )
    },
    {
      id: 'broadcasts',
      title: 'Массовые рассылки',
      icon: <Send className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Отправка сообщений во все или выбранные каналы с возможностью планирования и отмены.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Типы рассылок</h4>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-blue-50 rounded text-sm">📢 Объявление</span>
              <span className="px-2 py-1 bg-green-50 rounded text-sm">🔄 Обновление</span>
              <span className="px-2 py-1 bg-red-50 rounded text-sm">⚠️ Срочное</span>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Планировщик</h4>
            <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1">
              <li>Выберите "Запланировать" вместо "Сейчас"</li>
              <li>Укажите дату и время отправки</li>
              <li>Система автоматически отправит в указанное время</li>
              <li>Запланированные видны в Календаре событий</li>
            </ol>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Функции</h4>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              <li>Фильтр каналов: все, активные, выборочно</li>
              <li>Прогресс отправки в реальном времени</li>
              <li>Удаление отправленной рассылки</li>
              <li>История и статистика</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'gamification',
      title: 'Геймификация',
      icon: <Trophy className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Система мотивации сотрудников с очками, уровнями, достижениями и еженедельным лидербордом.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Уровни</h4>
            <div className="space-y-1">
              {[
                { level: 1, name: 'Новичок', points: '0-99', icon: '🌱' },
                { level: 2, name: 'Стажёр', points: '100-299', icon: '📚' },
                { level: 3, name: 'Специалист', points: '300-599', icon: '⭐' },
                { level: 4, name: 'Эксперт', points: '600-999', icon: '🏆' },
                { level: 5, name: 'Мастер', points: '1000+', icon: '👑' },
              ].map(l => (
                <div key={l.level} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-center">{l.icon}</span>
                  <span className="font-medium w-24">{l.name}</span>
                  <span className="text-slate-500">{l.points} очков</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Достижения</h4>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: '🏃', name: 'Спринтер', desc: '10 ответов за час' },
                { icon: '🎯', name: 'Снайпер', desc: '100% SLA за неделю' },
                { icon: '💪', name: 'Марафонец', desc: '8 часов онлайн' },
                { icon: '🌟', name: 'Звезда', desc: '5 благодарностей' },
                { icon: '🔥', name: 'Серия', desc: '7 дней без просрочек' },
              ].map(a => (
                <div key={a.name} className="p-2 bg-yellow-50 rounded-lg text-center" title={a.desc}>
                  <div className="text-xl">{a.icon}</div>
                  <div className="text-xs font-medium text-slate-700">{a.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'calendar',
      title: 'Календарь событий',
      icon: <Calendar className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600">
            Единый календарь обещаний и запланированных рассылок с напоминаниями и статусами.
          </p>
          
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Обещания</h4>
            <p className="text-sm text-slate-600">
              AI автоматически находит в сообщениях сотрудников обещания ("сделаю завтра", "перезвоню через час") 
              и создаёт напоминания с дедлайнами.
            </p>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">Активно</span>
                <span>Обещание в процессе выполнения</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">Просрочено</span>
                <span>Дедлайн прошёл</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Выполнено</span>
                <span>Обещание исполнено</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-800">Запланированные рассылки</h4>
            <p className="text-sm text-slate-600">
              Все запланированные массовые рассылки отображаются в календаре с указанием времени отправки.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'faq',
      title: 'FAQ',
      icon: <FileText className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          {[
            {
              q: 'Как подключить новый канал?',
              a: 'Добавьте бота @delever_support_bot в Telegram группу, назначьте администратором и напишите любое сообщение. Канал автоматически появится в Dashboard.'
            },
            {
              q: 'Как создать тикет из сообщения?',
              a: 'Найдите сообщение в разделе Сообщения, нажмите кнопку "Создать кейс" (иконка тикета), заполните приоритет и описание.'
            },
            {
              q: 'Как работает AI-помощник?',
              a: 'AI анализирует последние 30 сообщений в диалоге, понимает контекст и предлагает краткое резюме, рекомендуемый ответ и ссылки на документацию.'
            },
            {
              q: 'Как запланировать рассылку?',
              a: 'Откройте модалку рассылки, напишите текст, выберите "Запланировать" вместо "Сейчас", укажите дату и время.'
            },
            {
              q: 'Как удалить отправленную рассылку?',
              a: 'В истории рассылок нажмите кнопку "Отменить" (красный X). Сообщения будут удалены из всех групп.'
            },
          ].map((faq, i) => (
            <div key={i} className="p-3 bg-slate-50 rounded-lg">
              <div className="font-medium text-slate-800 mb-1">{faq.q}</div>
              <div className="text-sm text-slate-600">{faq.a}</div>
            </div>
          ))}
        </div>
      )
    },
  ]

  const filteredSections = searchQuery 
    ? sections.filter(s => 
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(s.content).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sections

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <a 
              href="/support" 
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              title="Назад к Dashboard"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </a>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Book className="w-6 h-6 text-blue-600" />
                Руководство пользователя
              </h1>
              <p className="text-sm text-slate-500">Delever Support Dashboard v2.0</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск по руководству..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Quick Links */}
      <div className="max-w-4xl mx-auto px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-slate-500">Быстрые ссылки:</span>
          {[
            { href: '/support#channels', label: 'Каналы' },
            { href: '/support#messages', label: 'Сообщения' },
            { href: '/support#cases', label: 'Кейсы' },
            { href: '/support#agents', label: 'Сотрудники' },
            { href: '/support#analytics', label: 'Аналитика' },
            { href: '/support#settings', label: 'Настройки' },
          ].map(link => (
            <a 
              key={link.href}
              href={link.href}
              className="px-2 py-1 bg-blue-50 text-blue-600 text-sm rounded hover:bg-blue-100 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 pb-12">
        <div className="space-y-3">
          {filteredSections.map(section => (
            <div key={section.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full px-4 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
              >
                <div className="text-blue-600">{section.icon}</div>
                <span className="flex-1 text-left font-semibold text-slate-800">{section.title}</span>
                {expandedSections.has(section.id) ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
              </button>
              {expandedSections.has(section.id) && (
                <div className="px-4 pb-4 border-t border-slate-100">
                  <div className="pt-4">{section.content}</div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 p-6 bg-white rounded-xl border border-slate-200 text-center">
          <div className="text-slate-500 text-sm mb-2">Создатель: <strong>Фахриддин Юсупов</strong></div>
          <div className="text-slate-400 text-xs">Delever.io • Январь 2026</div>
        </div>
      </div>
    </div>
  )
}
