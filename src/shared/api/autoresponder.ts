import { apiGet, apiPost } from '../services/api.service'

export interface AutoresponderRule {
  id: string
  name: string
  isActive: boolean
  trigger: {
    type: 'keyword' | 'category' | 'sentiment' | 'time'
    keywords?: string[]
    category?: string
    sentiment?: string
    afterHours?: boolean
  }
  response: {
    text: string
    delay?: number  // задержка перед ответом в секундах
  }
  conditions?: {
    channelTypes?: ('client' | 'partner' | 'internal')[]
    excludeChannels?: string[]
    maxPerDay?: number
  }
  stats: {
    triggered: number
    sent: number
    lastTriggered?: string
  }
  createdAt: string
  updatedAt: string
}

export interface AutoresponderCheckResult {
  checked: number
  responded: number
  skipped: number
  errors: number
  details: Array<{
    channelId: string
    channelName: string
    responded: boolean
    reason?: string
  }>
}

/**
 * Получить список правил автоответчика
 */
export async function fetchAutoresponderRules(): Promise<AutoresponderRule[]> {
  return apiGet<{ rules: AutoresponderRule[] }>('/autoresponder/check?action=list')
    .then(r => r.rules || [])
}

/**
 * Проверить и отправить автоответы
 */
export async function checkAutoresponder(): Promise<AutoresponderCheckResult> {
  return apiPost('/autoresponder/check', {})
}

/**
 * Отправить автоответ на конкретное сообщение
 */
export async function sendAutoresponse(
  channelId: string,
  messageId: string,
  responseText?: string
): Promise<{ success: boolean; messageId?: string }> {
  return apiPost('/autoresponder/respond', { channelId, messageId, responseText })
}
