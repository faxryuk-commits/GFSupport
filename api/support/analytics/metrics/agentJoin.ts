/**
 * Расширенный JOIN сообщения → агента — единый источник правды.
 *
 * История: коммит 3634fbe чинил JOIN, ловивший только Telegram. После него та же
 * самая ошибка нашлась ещё в 5 местах (web-агенты теряются, потому что у них
 * sender_id вида 'agent_xxx', а не Telegram-id). Здесь — один helper, который
 * собирает SQL fragment с правильным матчингом по всем возможным ключам.
 *
 * Использовать ТОЛЬКО через этот файл. Если где-то в analytics/agents видите
 * `JOIN support_agents ... ON LOWER(sender_name)...` — это баг.
 */

import type { ResolvedPeriod } from './types.js'

/**
 * Возвращает SQL-фрагмент для расширенного матчинга сообщения m к support_agents a.
 *
 * @param mAlias  Алиас таблицы support_messages в основном запросе. По умолчанию 'm'.
 * @param aAlias  Алиас support_agents. По умолчанию 'a'.
 * @returns       SQL-условие для ON ... — без префикса 'ON'.
 *
 * @example
 *   `LEFT JOIN support_agents a ON ${agentMatchOn()} AND a.org_id = ${orgId}`
 */
export function agentMatchOn(mAlias = 'm', aAlias = 'a'): string {
  const m = mAlias
  const a = aAlias
  return `(
    ${a}.telegram_id::text = ${m}.sender_id::text
    OR ${a}.id::text = ${m}.sender_id::text
    OR (${m}.sender_username IS NOT NULL AND LOWER(${a}.username) = LOWER(${m}.sender_username))
    OR (${m}.sender_name IS NOT NULL AND LOWER(${a}.name) = LOWER(${m}.sender_name))
  )`
}

/**
 * Фрагмент для исключения broadcast / системных рассылок из выборки «не-клиентских»
 * сообщений. В большинстве KPI broadcast не считается ответом агента — он
 * рассылается автоматически и не должен заходить в FRT, distribution и т.п.
 */
export function excludeBroadcast(mAlias = 'm'): string {
  return `COALESCE(${mAlias}.sender_role, '') <> 'broadcast'`
}

/**
 * Стандартные параметры для запросов «сообщения за период с фильтрами».
 * Один источник правды для market/source-фильтров — чтобы их случайно
 * не забыли в каком-то из 7 запросов SLA-отчёта.
 */
export interface MessageQueryFilters {
  orgId: string
  market: string | null
  source: string | null
  period: ResolvedPeriod
}

/**
 * Фрагмент WHERE для сообщений + JOIN-фрагмент для support_channels.
 *
 * Возвращает части, которые нужно вставить в запрос вручную. Это компромисс:
 * tagged template (neon) не позволяет вернуть готовый Promise — нужно собирать
 * запрос на месте. Этот helper хотя бы гарантирует, что фильтры применяются
 * консистентно везде.
 *
 * @example
 *   const f = buildMessageFilters({ orgId, market, source, period })
 *   const rows = await sql`
 *     SELECT ...
 *     FROM support_messages m
 *     JOIN support_channels c ON c.id = m.channel_id
 *     WHERE m.org_id = ${f.orgId}
 *       AND m.created_at >= ${f.fromISO}::timestamptz
 *       AND m.created_at <= ${f.toISO}::timestamptz
 *       AND (${f.market}::text IS NULL OR c.market_id = ${f.market})
 *       AND (${f.source}::text = 'all' OR COALESCE(c.source, 'telegram') = ${f.source})
 *   `
 *
 * Намеренно НЕ передаём fragment'ы как SQL — neon-tagged-template их экранирует
 * как параметры. Возвращаем сырые значения, чтобы вызывающая сторона подставляла
 * в `${...}` интерполяции.
 */
export function buildMessageFilters(filters: MessageQueryFilters): {
  orgId: string
  fromISO: string
  toISO: string
  market: string | null
  /** Нормализованный source: 'all' если не задан, иначе значение. */
  source: string
} {
  return {
    orgId: filters.orgId,
    fromISO: filters.period.from.toISOString(),
    toISO: filters.period.to.toISOString(),
    market: filters.market,
    source: filters.source && filters.source !== 'all' ? filters.source : 'all',
  }
}
