import { useState } from 'react'
import { Eye, EyeOff, Building2, Globe, Bot, Clock, Volume2, UserCog, Calendar, Target } from 'lucide-react'
import { Toggle } from './Toggle'

export interface GeneralSettingsData {
  companyName: string
  botToken: string
  defaultLanguage: string
  timezone: string
  autoCreateCases: boolean
  soundNotifications: boolean
  autoAssignment: boolean
}

export interface ResponseSettingsData {
  targetResponseTime: number
  targetResolutionTime: number
  slaTarget: number
  workingHoursStart: string
  workingHoursEnd: string
  workingDays: string[]
}

interface GeneralSettingsProps {
  general: GeneralSettingsData
  response: ResponseSettingsData
  onGeneralChange: (data: GeneralSettingsData) => void
  onResponseChange: (data: ResponseSettingsData) => void
}

const weekDays = [
  { id: 'mon', label: 'Пн' },
  { id: 'tue', label: 'Вт' },
  { id: 'wed', label: 'Ср' },
  { id: 'thu', label: 'Чт' },
  { id: 'fri', label: 'Пт' },
  { id: 'sat', label: 'Сб' },
  { id: 'sun', label: 'Вс' },
]

export function GeneralSettings({ general, response, onGeneralChange, onResponseChange }: GeneralSettingsProps) {
  const [showBotToken, setShowBotToken] = useState(false)

  const handleTestConnection = async () => {
    await new Promise(resolve => setTimeout(resolve, 1500))
    alert('Соединение успешно!')
  }

  return (
    <div className="space-y-6">
      {/* Основные настройки */}
      <div className="bg-white rounded-2xl border border-[#e8edf3]/60 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Основные настройки</h3>
              <p className="text-xs text-slate-500">Базовые параметры системы</p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-2 gap-5 mb-6">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Building2 className="w-4 h-4 text-slate-400" />
                Название компании
              </label>
              <input
                type="text"
                value={general.companyName}
                onChange={(e) => onGeneralChange({ ...general, companyName: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                placeholder="Delever Support"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Globe className="w-4 h-4 text-slate-400" />
                Язык по умолчанию
              </label>
              <select
                value={general.defaultLanguage}
                onChange={(e) => onGeneralChange({ ...general, defaultLanguage: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all appearance-none cursor-pointer"
              >
                <option value="en">🇬🇧 English</option>
                <option value="ru">🇷🇺 Русский</option>
                <option value="uz">🇺🇿 O'zbekcha</option>
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
              <Bot className="w-4 h-4 text-slate-400" />
              Токен Telegram бота
            </label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type={showBotToken ? 'text' : 'password'}
                  value={general.botToken}
                  onChange={(e) => onGeneralChange({ ...general, botToken: e.target.value })}
                  className="w-full px-4 py-3 pr-12 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all font-mono text-sm"
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                />
                <button
                  type="button"
                  onClick={() => setShowBotToken(!showBotToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                >
                  {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button 
                onClick={handleTestConnection}
                className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all font-medium"
              >
                Проверить
              </button>
            </div>
          </div>

          <div className="space-y-1 p-4 bg-slate-50 rounded-xl">
            <Toggle
              label="Авто-создание кейсов"
              description="Автоматически создавать кейсы из сообщений"
              checked={general.autoCreateCases}
              onChange={(v) => onGeneralChange({ ...general, autoCreateCases: v })}
            />
            <Toggle
              label="Звуковые уведомления"
              description="Воспроизводить звук при новых сообщениях"
              checked={general.soundNotifications}
              onChange={(v) => onGeneralChange({ ...general, soundNotifications: v })}
            />
            <Toggle
              label="Авто-назначение"
              description="Автоматически назначать кейсы свободным агентам"
              checked={general.autoAssignment}
              onChange={(v) => onGeneralChange({ ...general, autoAssignment: v })}
            />
          </div>
        </div>
      </div>

      {/* Настройки времени отклика */}
      <div className="bg-white rounded-2xl border border-[#e8edf3]/60 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Настройки SLA</h3>
              <p className="text-xs text-slate-500">Время отклика и решения</p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-3 gap-5 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Время первого ответа</label>
              <div className="relative">
                <input
                  type="number"
                  value={response.targetResponseTime}
                  onChange={(e) => onResponseChange({ ...response, targetResponseTime: Number(e.target.value) })}
                  className="w-full px-4 py-3 pr-14 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">мин</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Время решения</label>
              <div className="relative">
                <input
                  type="number"
                  value={response.targetResolutionTime}
                  onChange={(e) => onResponseChange({ ...response, targetResolutionTime: Number(e.target.value) })}
                  className="w-full px-4 py-3 pr-14 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">мин</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Цель SLA</label>
              <div className="relative">
                <input
                  type="number"
                  value={response.slaTarget}
                  onChange={(e) => onResponseChange({ ...response, slaTarget: Number(e.target.value) })}
                  className="w-full px-4 py-3 pr-10 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Рабочие часы
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={response.workingHoursStart}
                  onChange={(e) => onResponseChange({ ...response, workingHoursStart: e.target.value })}
                  className="flex-1 px-4 py-3 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                />
                <span className="text-slate-400 font-medium">—</span>
                <input
                  type="time"
                  value={response.workingHoursEnd}
                  onChange={(e) => onResponseChange({ ...response, workingHoursEnd: e.target.value })}
                  className="flex-1 px-4 py-3 bg-slate-50 border border-[#e8edf3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all"
                />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Рабочие дни
              </label>
              <div className="flex gap-2">
                {weekDays.map(day => (
                  <button
                    key={day.id}
                    onClick={() => {
                      const days = response.workingDays.includes(day.id)
                        ? response.workingDays.filter(d => d !== day.id)
                        : [...response.workingDays, day.id]
                      onResponseChange({ ...response, workingDays: days })
                    }}
                    className={`w-11 h-11 text-sm font-medium rounded-xl transition-all ${
                      response.workingDays.includes(day.id)
                        ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
