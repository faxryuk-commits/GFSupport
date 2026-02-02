export type UserRole = 'employee' | 'partner' | 'client'

export interface User {
  id: string
  telegramId: number
  name: string
  username?: string
  role: UserRole
  channelIds: string[]
  channelNames: string[]
  department?: string
  position?: string
  messagesCount: number
  lastMessageAt: string | null
  notes?: string
}

export const USER_ROLE_CONFIG: Record<UserRole, { label: string; color: string; bgColor: string }> = {
  employee: { label: 'Сотрудник', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  partner: { label: 'Партнёр', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  client: { label: 'Клиент', color: 'text-green-700', bgColor: 'bg-green-100' },
}
