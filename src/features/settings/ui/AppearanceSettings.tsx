import { Sun, Moon, Monitor } from 'lucide-react'
import { Toggle } from './Toggle'

export interface AppearanceSettingsData {
  theme: 'light' | 'dark' | 'system'
  primaryColor: string
  sidebarCollapsed: boolean
  compactMode: boolean
}

interface AppearanceSettingsProps {
  settings: AppearanceSettingsData
  onChange: (data: AppearanceSettingsData) => void
}

const themes = [
  { id: 'light', label: 'Светлая', icon: Sun },
  { id: 'dark', label: 'Тёмная', icon: Moon },
  { id: 'system', label: 'Системная', icon: Monitor },
]

const colors = [
  { value: '#3b82f6', label: 'Синий' },
  { value: '#8b5cf6', label: 'Фиолетовый' },
  { value: '#ec4899', label: 'Розовый' },
  { value: '#10b981', label: 'Зелёный' },
  { value: '#f59e0b', label: 'Оранжевый' },
  { value: '#6366f1', label: 'Индиго' },
]

export function AppearanceSettings({ settings, onChange }: AppearanceSettingsProps) {
  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Внешний вид</h2>
      
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">Тема</label>
          <div className="flex gap-3">
            {themes.map(theme => {
              const Icon = theme.icon
              return (
                <button
                  key={theme.id}
                  onClick={() => onChange({ ...settings, theme: theme.id as any })}
                  className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                    settings.theme === theme.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Icon className={`w-6 h-6 ${settings.theme === theme.id ? 'text-blue-500' : 'text-slate-400'}`} />
                  <span className={`text-sm font-medium ${settings.theme === theme.id ? 'text-blue-600' : 'text-slate-600'}`}>
                    {theme.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">Основной цвет</label>
          <div className="flex gap-3">
            {colors.map(color => (
              <button
                key={color.value}
                onClick={() => onChange({ ...settings, primaryColor: color.value })}
                className={`w-10 h-10 rounded-xl transition-transform ${
                  settings.primaryColor === color.value ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : ''
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
              />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Toggle
            label="Свёрнутый сайдбар"
            description="Показывать только иконки в боковом меню"
            checked={settings.sidebarCollapsed}
            onChange={(v) => onChange({ ...settings, sidebarCollapsed: v })}
          />
          <Toggle
            label="Компактный режим"
            description="Уменьшить отступы и размеры элементов"
            checked={settings.compactMode}
            onChange={(v) => onChange({ ...settings, compactMode: v })}
          />
        </div>
      </div>
    </div>
  )
}
