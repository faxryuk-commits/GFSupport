// KPI нормативы для Support
export const KPI = {
  FIRST_RESPONSE_MIN: 5,        // Время первого ответа: 5 минут
  RESOLUTION_L1_MIN: 60,        // L1 решение: 1 час
  RESOLUTION_L2_MIN: 480,       // L2 решение минимум: 8 часов
  RESOLUTION_L2_MAX: 2400,      // L2 решение максимум: 40 часов
  SLA_TARGET_PERCENT: 99,       // Целевой SLA: 99%
  CORE_CATEGORIES: ['orders', 'core', 'critical', 'payment'],
}

// Геймификация - система очков
export const GAMIFICATION = {
  POINTS: {
    MESSAGE_SENT: 1,
    FAST_RESPONSE: 5,
    CASE_RESOLVED: 10,
    SLA_MET: 5,
    CLIENT_THANKS: 20,
    FIRST_OF_DAY: 3,
  },
  LEVELS: [
    { name: 'Новичок', icon: '🌱', minPoints: 0 },
    { name: 'Стажёр', icon: '📚', minPoints: 100 },
    { name: 'Агент', icon: '🎯', minPoints: 500 },
    { name: 'Старший', icon: '⭐', minPoints: 2000 },
    { name: 'Эксперт', icon: '🏆', minPoints: 5000 },
    { name: 'Мастер', icon: '👑', minPoints: 10000 },
  ],
  ACHIEVEMENTS: [
    { id: 'speedster', name: 'Скорострел', icon: '⚡', desc: '10 ответов за час' },
    { id: 'solver', name: 'Решала', icon: '🔧', desc: '5 кейсов за день' },
    { id: 'streak', name: 'Серия', icon: '🔥', desc: '7 дней без пропусков' },
    { id: 'sla_master', name: 'Мастер SLA', icon: '✅', desc: '100% SLA за неделю' },
    { id: 'night_owl', name: 'Сова', icon: '🦉', desc: 'Ответ после 22:00' },
    { id: 'early_bird', name: 'Ранняя пташка', icon: '🐦', desc: 'Ответ до 8:00' },
  ]
}

// Цвета статусов
export const STATUS_COLORS: Record<string, string> = {
  detected: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting: 'bg-yellow-100 text-yellow-700',
  blocked: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
}

export const STATUS_LABELS: Record<string, string> = {
  detected: 'Обнаружено',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  blocked: 'Заблокировано',
  resolved: 'Решено',
}

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

export const KANBAN_STATUSES = ['detected', 'in_progress', 'waiting', 'blocked', 'resolved'] as const

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'text-green-600',
  neutral: 'text-slate-600',
  negative: 'text-red-600',
  frustrated: 'text-orange-600',
}

// Функция расчёта уровня по очкам
export function getAgentLevel(points: number) {
  const levels = GAMIFICATION.LEVELS
  for (let i = levels.length - 1; i >= 0; i--) {
    if (points >= levels[i].minPoints) {
      const nextLevel = levels[i + 1]
      const progress = nextLevel 
        ? Math.round(((points - levels[i].minPoints) / (nextLevel.minPoints - levels[i].minPoints)) * 100)
        : 100
      return { ...levels[i], index: i, progress, nextLevel }
    }
  }
  return { ...levels[0], index: 0, progress: 0, nextLevel: levels[1] }
}
