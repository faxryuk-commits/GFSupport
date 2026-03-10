import { getSQL } from './db.js'

interface QuotaCheck {
  allowed: boolean
  current: number
  limit: number
  message?: string
}

export async function checkAgentQuota(orgId: string): Promise<QuotaCheck> {
  const sql = getSQL()
  const [org] = await sql`SELECT max_agents FROM support_organizations WHERE id = ${orgId}`
  if (!org) return { allowed: true, current: 0, limit: 999 }

  const [count] = await sql`SELECT COUNT(*)::int as c FROM support_agents WHERE org_id = ${orgId}`
  const current = count?.c || 0
  const limit = org.max_agents || 5

  return {
    allowed: current < limit,
    current,
    limit,
    message: current >= limit ? `Лимит агентов: ${limit}. Текущих: ${current}. Обновите тариф.` : undefined,
  }
}

export async function checkChannelQuota(orgId: string): Promise<QuotaCheck> {
  const sql = getSQL()
  const [org] = await sql`SELECT max_channels FROM support_organizations WHERE id = ${orgId}`
  if (!org) return { allowed: true, current: 0, limit: 999 }

  const [count] = await sql`SELECT COUNT(*)::int as c FROM support_channels WHERE org_id = ${orgId}`
  const current = count?.c || 0
  const limit = org.max_channels || 50

  return {
    allowed: current < limit,
    current,
    limit,
    message: current >= limit ? `Лимит каналов: ${limit}. Текущих: ${current}. Обновите тариф.` : undefined,
  }
}

export async function checkMessageQuota(orgId: string): Promise<QuotaCheck> {
  const sql = getSQL()
  const [org] = await sql`SELECT max_messages_per_month FROM support_organizations WHERE id = ${orgId}`
  if (!org) return { allowed: true, current: 0, limit: 999999 }

  const [count] = await sql`
    SELECT COUNT(*)::int as c FROM support_messages 
    WHERE org_id = ${orgId} AND created_at > DATE_TRUNC('month', NOW())
  `
  const current = count?.c || 0
  const limit = org.max_messages_per_month || 10000

  return {
    allowed: current < limit,
    current,
    limit,
    message: current >= limit ? `Лимит сообщений/месяц: ${limit}. Отправлено: ${current}. Обновите тариф.` : undefined,
  }
}
