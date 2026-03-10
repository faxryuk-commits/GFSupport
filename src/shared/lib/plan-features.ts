export type PlanType = 'starter' | 'business' | 'enterprise'

export interface PlanConfig {
  name: string
  price: number
  maxAgents: number
  maxChannels: number
  maxMessagesPerMonth: number
  features: string[]
  navPaths: string[]
}

const PLANS: Record<PlanType, PlanConfig> = {
  starter: {
    name: 'Starter',
    price: 0,
    maxAgents: 2,
    maxChannels: 3,
    maxMessagesPerMonth: 1000,
    features: ['chats', 'channels', 'cases', 'settings'],
    navPaths: ['/overview', '/chats', '/channels', '/cases', '/settings'],
  },
  business: {
    name: 'Business',
    price: 29,
    maxAgents: 10,
    maxChannels: 20,
    maxMessagesPerMonth: 20000,
    features: ['chats', 'channels', 'cases', 'commitments', 'sla-report', 'knowledge', 'docs', 'broadcast', 'whatsapp', 'ai-replies', 'settings'],
    navPaths: ['/overview', '/chats', '/channels', '/cases', '/commitments', '/sla-report', '/knowledge', '/docs', '/broadcast', '/settings'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    maxAgents: -1,
    maxChannels: -1,
    maxMessagesPerMonth: -1,
    features: ['chats', 'channels', 'cases', 'commitments', 'sla-report', 'knowledge', 'docs', 'broadcast', 'whatsapp', 'ai-replies', 'ai-learning', 'settings'],
    navPaths: ['/overview', '/chats', '/channels', '/cases', '/commitments', '/sla-report', '/knowledge', '/learning/problems', '/docs', '/broadcast', '/settings'],
  },
}

export function getPlanConfig(plan?: string): PlanConfig {
  const key = (plan || 'starter').toLowerCase() as PlanType
  return PLANS[key] || PLANS.starter
}

export function isPathAllowed(path: string, plan?: string): boolean {
  const config = getPlanConfig(plan)
  return config.navPaths.some(p => path === p || path.startsWith(p + '/'))
}

export function hasFeature(feature: string, plan?: string): boolean {
  const config = getPlanConfig(plan)
  return config.features.includes(feature)
}

export { PLANS }
