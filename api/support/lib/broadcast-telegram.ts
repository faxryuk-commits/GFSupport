import type { ErrorCode } from './broadcast-schema.js'

export interface TgSendOutcome {
  ok: boolean
  status: 'delivered' | 'failed' | 'queued'
  errorCode: ErrorCode | null
  errorMessage: string | null
  retryAfterSec: number | null
  telegramMessageId: number | null
  rawDescription: string | null
}

export interface SendInput {
  chatId: number | string
  text: string
  mediaUrl?: string | null
  mediaType?: string | null
  parseMode?: 'HTML' | 'Markdown'
  botToken: string
}

const TG_API = 'https://api.telegram.org'
const CAPTION_LIMIT = 1024 // Telegram caption limit

function pickEndpoint(mediaType?: string | null): { path: string; field: string } {
  switch ((mediaType || '').toLowerCase()) {
    case 'photo':    return { path: 'sendPhoto', field: 'photo' }
    case 'video':    return { path: 'sendVideo', field: 'video' }
    case 'audio':    return { path: 'sendAudio', field: 'audio' }
    case 'document': return { path: 'sendDocument', field: 'document' }
    default:         return { path: 'sendDocument', field: 'document' }
  }
}

async function callTelegram(botToken: string, path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TG_API}/bot${botToken}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({ ok: false, description: 'invalid_json' }))
}

/**
 * Отправляет сообщение в Telegram с поддержкой медиа.
 * Никогда не throw'ит — все ошибки превращает в структурированный outcome.
 */
export async function sendBroadcastMessage(input: SendInput): Promise<TgSendOutcome> {
  const { chatId, text, mediaUrl, mediaType, botToken } = input
  const parseMode = input.parseMode || 'HTML'

  try {
    let result: any
    if (!mediaUrl) {
      result = await callTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: false,
      })
    } else {
      const { path, field } = pickEndpoint(mediaType)
      const caption = text.length <= CAPTION_LIMIT ? text : text.slice(0, CAPTION_LIMIT - 3) + '...'
      result = await callTelegram(botToken, path, {
        chat_id: chatId,
        [field]: mediaUrl,
        caption,
        parse_mode: parseMode,
      })
      // Длинный текст: отправляем второе сообщение с продолжением
      if (result?.ok && text.length > CAPTION_LIMIT) {
        await callTelegram(botToken, 'sendMessage', {
          chat_id: chatId,
          text: text.slice(CAPTION_LIMIT - 3),
          parse_mode: parseMode,
          disable_web_page_preview: false,
        }).catch(() => {})
      }
    }

    return classifyOutcome(result)
  } catch (e: any) {
    return {
      ok: false,
      status: 'queued',
      errorCode: 'transient',
      errorMessage: e?.message?.slice(0, 500) || 'network error',
      retryAfterSec: 30,
      telegramMessageId: null,
      rawDescription: null,
    }
  }
}

/**
 * Превращает ответ Telegram API в структурированный outcome с маппингом ошибок.
 */
export function classifyOutcome(result: any): TgSendOutcome {
  if (result?.ok) {
    return {
      ok: true,
      status: 'delivered',
      errorCode: null,
      errorMessage: null,
      retryAfterSec: null,
      telegramMessageId: result.result?.message_id ?? null,
      rawDescription: null,
    }
  }

  const desc = String(result?.description || '').toLowerCase()
  const code = Number(result?.error_code) || 0

  // 429 — rate limit, повторим позже
  if (code === 429 && result?.parameters?.retry_after) {
    return failed429(result.parameters.retry_after, result?.description)
  }

  // Терминальные — никогда не ретраим
  if (desc.includes('blocked by the user'))
    return terminal('user_blocked', result?.description)
  if (desc.includes('bot was kicked') || desc.includes('bot is not a member'))
    return terminal('bot_kicked', result?.description)
  if (desc.includes('chat not found'))
    return terminal('chat_not_found', result?.description)
  if (desc.includes('group chat was upgraded'))
    return terminal('chat_upgraded', result?.description)
  if (desc.includes('chat is deactivated') || desc.includes('group is deactivated'))
    return terminal('chat_dead', result?.description)
  if (desc.includes('user is deactivated'))
    return terminal('user_dead', result?.description)

  if (code === 400) return terminal('bad_request', result?.description)

  return {
    ok: false,
    status: 'queued',
    errorCode: 'transient',
    errorMessage: (result?.description || 'unknown').slice(0, 500),
    retryAfterSec: 30,
    telegramMessageId: null,
    rawDescription: result?.description ?? null,
  }
}

function terminal(errorCode: ErrorCode, description: string | undefined): TgSendOutcome {
  return {
    ok: false,
    status: 'failed',
    errorCode,
    errorMessage: (description || errorCode).slice(0, 500),
    retryAfterSec: null,
    telegramMessageId: null,
    rawDescription: description ?? null,
  }
}

function failed429(retryAfter: number, description: string | undefined): TgSendOutcome {
  return {
    ok: false,
    status: 'queued',
    errorCode: 'rate_limit',
    errorMessage: (description || `rate limit, retry after ${retryAfter}s`).slice(0, 500),
    retryAfterSec: Math.max(1, Math.min(retryAfter, 600)),
    telegramMessageId: null,
    rawDescription: description ?? null,
  }
}

/**
 * Человекочитаемые описания ошибок для UI.
 */
export const ERROR_LABELS: Record<ErrorCode, string> = {
  user_blocked: 'Пользователь заблокировал бота',
  bot_kicked: 'Бот удалён из чата',
  chat_not_found: 'Чат не найден',
  chat_upgraded: 'Чат был обновлён до супергруппы',
  chat_dead: 'Чат деактивирован',
  user_dead: 'Аккаунт удалён',
  bad_request: 'Некорректный запрос (проверьте текст и медиа)',
  rate_limit: 'Лимит Telegram (повторим автоматически)',
  transient: 'Временная ошибка (повторим)',
  transient_exhausted: 'Не удалось доставить после нескольких попыток',
  no_token: 'Не настроен Telegram bot token',
  unknown: 'Неизвестная ошибка',
}
