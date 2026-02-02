import { apiGet, apiPut, apiPost } from '../services/api.service'

// Типы для настроек с бэкенда
export interface BackendSettings {
  telegram_bot_token: string
  telegram_bot_username: string
  openai_api_key: string
  auto_create_cases: boolean
  min_urgency_for_case: number
  auto_transcribe_voice: boolean
  auto_transcribe_video: boolean
  notify_on_problem: boolean
  notify_chat_id: string
  working_hours_start: number
  working_hours_end: number
  escalation_hours: number
  ai_model: string
  whisper_language: string
}

export interface EnvStatus {
  TELEGRAM_BOT_TOKEN: boolean
  OPENAI_API_KEY: boolean
  TELEGRAM_CHAT_ID: boolean
}

export interface SettingsResponse {
  settings: BackendSettings
  envStatus: EnvStatus
  defaults: string[]
}

export interface UpdateSettingsResponse {
  success: boolean
  updated: string[]
  message: string
}

export interface ResetSettingsResponse {
  success: boolean
  message: string
}

export interface TestBotResponse {
  success: boolean
  bot?: {
    id: number
    username: string
    firstName: string
  }
  error?: string
}

// Получить все настройки
export async function fetchSettings(): Promise<SettingsResponse> {
  return apiGet<SettingsResponse>('/settings', false)
}

// Обновить настройки
export async function updateSettings(settings: Partial<BackendSettings>): Promise<UpdateSettingsResponse> {
  return apiPut<UpdateSettingsResponse>('/settings', { settings })
}

// Сбросить настройки к значениям по умолчанию
export async function resetSettings(): Promise<ResetSettingsResponse> {
  return apiPost<ResetSettingsResponse>('/settings', { action: 'reset' })
}

// Тестировать подключение Telegram бота
export async function testBotConnection(): Promise<TestBotResponse> {
  return apiPost<TestBotResponse>('/settings', { action: 'test_bot' })
}
