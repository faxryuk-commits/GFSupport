/**
 * Модули системы и доступ к ним по ролям.
 *
 * Единица доступа — модуль, а не страница: сейлз не видит поддержку,
 * поддержка не видит продажи. Дефолт вычисляется из роли и отдела —
 * ноль ручной настройки; исключения добавляются галочками в карточке
 * сотрудника и хранятся в permissions как `mod:<ключ>`. Это UI-слой
 * для доверенной команды; жёсткие проверки на API — отдельным шагом.
 */

export type ModuleKey = 'sales' | 'support' | 'onboarding' | 'analytics' | 'broadcast' | 'settings'

export const ALL_MODULES: ModuleKey[] = ['sales', 'support', 'onboarding', 'analytics', 'broadcast', 'settings']

export const MODULE_LABELS: Record<ModuleKey, string> = {
  sales: 'Продажи',
  support: 'Поддержка',
  onboarding: 'Подключение',
  analytics: 'Аналитика и Обзор',
  broadcast: 'Рассылки',
  settings: 'Настройки',
}

/** Какому модулю принадлежит путь; не перечисленные пути — общие («Моё»). */
const PATH_MODULE: Array<[string, ModuleKey]> = [
  ['/sales', 'sales'],
  ['/chats', 'support'], ['/cases', 'support'], ['/channels', 'support'],
  ['/onboarding', 'onboarding'],
  ['/overview', 'analytics'], ['/analytics', 'analytics'],
  ['/benchmarks', 'analytics'], ['/insights-chat', 'analytics'],
  ['/broadcast', 'broadcast'],
  ['/settings', 'settings'],
]

export function moduleOfPath(path: string): ModuleKey | null {
  for (const [p, m] of PATH_MODULE) {
    if (path === p || path.startsWith(p + '/')) return m
  }
  return null
}

/**
 * Модули, доступные сотруднику. Роль и отдел складываются (у человека
 * с ролью поддержки в отделе продаж откроются оба мира — редкий, но
 * честный случай), галочки `mod:*` добавляют сверху.
 */
export function modulesFor(
  role?: string | null, department?: string | null, permissions?: string[] | null,
): Set<ModuleKey> {
  const r = String(role || '').toLowerCase()
  const d = String(department || '').toLowerCase()
  const perms = Array.isArray(permissions) ? permissions : []
  if (r === 'admin' || r === 'org_admin'
    || perms.includes('superadmin') || perms.includes('global_admin')) {
    return new Set(ALL_MODULES)
  }
  const out = new Set<ModuleKey>()
  if (r === 'manager') for (const m of ALL_MODULES) { if (m !== 'settings') out.add(m) }
  if (r === 'cco') { out.add('sales'); out.add('onboarding'); out.add('analytics') }
  if (r === 'team_lead') { out.add('support'); out.add('onboarding'); out.add('analytics') }
  if (['kam', 'sales', 'sale', 'sdr'].includes(r)) { out.add('sales'); out.add('onboarding') }
  // Подключение — прежде всего мир поддержки: внедрением занимается она,
  // продажи только передают туда выигранные сделки
  if (['support', 'support_agent', 'agent'].includes(r)) { out.add('support'); out.add('onboarding') }
  if (d === 'sales' || d === 'sale') { out.add('sales'); out.add('onboarding') }
  if (d === 'support') { out.add('support'); out.add('onboarding') }
  for (const p of perms) {
    if (p.startsWith('mod:') && (ALL_MODULES as string[]).includes(p.slice(4))) {
      out.add(p.slice(4) as ModuleKey)
    }
  }
  return out
}

export function pathAllowedFor(path: string, mods: Set<ModuleKey>): boolean {
  const m = moduleOfPath(path)
  return !m || mods.has(m)
}
