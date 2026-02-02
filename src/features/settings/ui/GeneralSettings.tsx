import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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
    <>
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Основные настройки</h2>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Название компании</label>
            <input
              type="text"
              value={general.companyName}
              onChange={(e) => onGeneralChange({ ...general, companyName: e.target.value })}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Язык по умолчанию</label>
            <select
              value={general.defaultLanguage}
              onChange={(e) => onGeneralChange({ ...general, defaultLanguage: e.target.value })}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="en">English</option>
              <option value="ru">Русский</option>
              <option value="uz">O'zbekcha</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Токен Telegram бота</label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type={showBotToken ? 'text' : 'password'}
                value={general.botToken}
                onChange={(e) => onGeneralChange({ ...general, botToken: e.target.value })}
                className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={() => setShowBotToken(!showBotToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showBotToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <button 
              onClick={handleTestConnection}
              className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Проверить
            </button>
          </div>
        </div>

        <div className="space-y-3">
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

      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Настройки времени отклика</h2>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Время первого ответа</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={response.targetResponseTime}
                onChange={(e) => onResponseChange({ ...response, targetResponseTime: Number(e.target.value) })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-slate-500 text-sm">мин</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Время решения</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={response.targetResolutionTime}
                onChange={(e) => onResponseChange({ ...response, targetResolutionTime: Number(e.target.value) })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-slate-500 text-sm">мин</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Цель SLA</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={response.slaTarget}
                onChange={(e) => onResponseChange({ ...response, slaTarget: Number(e.target.value) })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-slate-500 text-sm">%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Рабочие часы</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={response.workingHoursStart}
                onChange={(e) => onResponseChange({ ...response, workingHoursStart: e.target.value })}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-slate-500">до</span>
              <input
                type="time"
                value={response.workingHoursEnd}
                onChange={(e) => onResponseChange({ ...response, workingHoursEnd: e.target.value })}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Рабочие дни</label>
            <div className="flex gap-1">
              {weekDays.map(day => (
                <button
                  key={day.id}
                  onClick={() => {
                    const days = response.workingDays.includes(day.id)
                      ? response.workingDays.filter(d => d !== day.id)
                      : [...response.workingDays, day.id]
                    onResponseChange({ ...response, workingDays: days })
                  }}
                  className={`w-10 h-10 text-sm font-medium rounded-lg transition-colors ${
                    response.workingDays.includes(day.id)
                      ? 'bg-blue-500 text-white'
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
    </>
  )
}
