/**
 * Семантический слой аналитики — общие типы.
 *
 * Архитектурное правило: ни один endpoint не пишет SQL для KPI напрямую.
 * Endpoint собирает набор MetricDescriptor'ов и вызывает metrics.compute(...).
 * Это единственный путь, обеспечивающий, что «среднее время первого ответа»
 * считается одной формулой во всех виджетах.
 *
 * См. delever_context.md в memory: «клиент» в этих типах = покупатель Delever,
 * org_id = Delever-org.
 */

/** Уровень в дереве метрик. Каждый уровень UP объясняет «зачем» для уровня ниже. */
export type MetricLevel =
  | 'outcome' // L0 — бизнес-исход (LTV, MRR, churn компании Delever). Часто proxy.
  | 'driver' // L1 — что определяет outcome (активность клиентов, объёмы, repeat-rate).
  | 'indicator' // L2 — что предсказывает driver (sentiment, churn-сигналы, FCR, escalation rate).
  | 'activity' // L3 — что делают агенты (FRT, SLA%, resolution time).

/** Единица измерения — используется фронтом для подписи и форматирования. */
export type MetricUnit =
  | 'minutes'
  | 'hours'
  | 'seconds'
  | 'percent' // значение в шкале 0..100
  | 'ratio' // значение в шкале 0..1
  | 'count'
  | 'currency'

/** Желательное направление метрики: чем больше — лучше или чем меньше — лучше. */
export type MetricDirection = 'higher_better' | 'lower_better'

/** Уровни бенчмарка. См. benchmark_targets.tier. */
export type Tier = 'bronze' | 'silver' | 'gold'

/** Источник целевого значения. */
export type BenchmarkSource = 'percentile_internal' | 'manual' | 'industry_default'

/**
 * Статус значения относительно бенчмарка — 4 зоны:
 *   gold        — value достигло целевого уровня Gold (отлично)
 *   silver      — value между Silver и Gold (хорошо)
 *   bronze      — value между Bronze и Silver (минимально приемлемо)
 *   below_bronze — value хуже Bronze (требует внимания)
 *   unknown     — нет бенчмарков или нет значения
 *
 * Раньше было 3 зоны (good/borderline/bad), и любое значение хуже Silver
 * показывалось как «ниже Bronze», даже если value фактически в Bronze-зоне.
 * Это вводило в заблуждение: FRT 16 мин при bronze=20/silver=14/gold=10
 * показывался «ниже Bronze», хотя 16 ≤ 20 = реально в Bronze.
 */
export type MetricStatus = 'gold' | 'silver' | 'bronze' | 'below_bronze' | 'unknown'

/** Скоуп — на каком срезе считаем (для бенчмарков и для агрегации). */
export interface MetricScope {
  orgId: string
  /** Если задан — считаем для конкретного агента. */
  agentId?: string | null
  /** Фильтр по рынку. */
  market?: string | null
  /** Фильтр по каналу (telegram/whatsapp/...). */
  source?: string | null
  /** Фильтр по одной роли — используется для скоупа бенчмарка (benchmark_targets.scope_role). */
  role?: string | null
  /**
   * Фильтр по набору ролей сотрудника при ВЫЧИСЛЕНИИ метрики.
   * В отличие от `role` (это про скоуп бенчмарка), `roles` ограничивает,
   * чьи ответы считаются «ответом команды».
   *
   * Пример: для FRT по команде поддержки передаём
   *   roles=['support','support_agent','agent','team_lead']
   * → ответы CEO/PM/Dev на клиентское сообщение НЕ засчитываются как
   *   ответ агента; если только они ответили — сессия идёт в «нет ответа».
   *
   * null или пустой массив = без фильтра (любая роль из support_agents).
   * Все сравнения case-insensitive (LOWER в SQL).
   */
  roles?: string[] | null
}

/** Период расчёта — нормализованный (см. periodEngine). */
export interface ResolvedPeriod {
  /** Inclusive начало. Tashkent-aware. */
  from: Date
  /** Inclusive конец. */
  to: Date
  /** Гранулярность для отображения и для подбора бенчмарка. */
  granularity: 'daily' | 'weekly' | 'monthly'
  /** Человекочитаемая метка («Сегодня», «За 7 дней», «Май 2026»). */
  label: string
}

/** Описание метрики — то, что фронт может прочитать, чтобы знать единицы и подписи. */
export interface MetricDescriptor {
  key: string
  level: MetricLevel
  unit: MetricUnit
  direction: MetricDirection
  /** Короткое название для подписи карточки. */
  labelRu: string
  /** Развёрнутое описание формулы и нюансов — для tooltip. */
  formulaRu: string
  /** Поддерживает ли метрика разрез по агенту. */
  perAgent: boolean
}

/** Бенчмарк-таргет — одна строка из benchmark_targets, нормализованная для UI. */
export interface BenchmarkTarget {
  tier: Tier
  value: number
  source: BenchmarkSource
  sampleSize: number | null
  computedAt: string | null
}

/** Полный набор бенчмарков для одной метрики в одном scope. */
export interface BenchmarkSet {
  bronze: BenchmarkTarget | null
  silver: BenchmarkTarget | null
  gold: BenchmarkTarget | null
}

/** Результат расчёта одной метрики. Это контракт фронта с бэком. */
export interface MetricResult {
  key: string
  /** Текущее значение. null = недостаточно данных (не «0», не «—»). */
  value: number | null
  /** Сколько наблюдений участвовало в расчёте. */
  sampleSize: number
  /** Бенчмарки для этого scope (могут быть пустыми). */
  benchmarks: BenchmarkSet
  /** Статус — вычисляется тут же на бэке, чтобы фронт не разъезжался. */
  status: MetricStatus
  /** Период, для которого посчитано. */
  period: ResolvedPeriod
  /**
   * Доп. контекст для метрик времени первого ответа (FRT). Опциональны —
   * старые потребители их игнорируют. Нужны, чтобы не прятать хвост:
   * «среднее» на скошенном распределении вводит в заблуждение.
   */
  /** Медиана времени первого ответа (минуты) — типичный опыт клиента. */
  medianValue?: number | null
  /** p90 времени первого ответа (минуты) — насколько плох хвост. */
  p90Value?: number | null
  /** Всего сессий (новых запросов), включая оставшиеся без ответа в окне. */
  totalSessions?: number
  /** Доля сессий, отвеченных в окне, 0..100. (100 − это) = без ответа/просрочено. */
  answeredRate?: number | null
}
