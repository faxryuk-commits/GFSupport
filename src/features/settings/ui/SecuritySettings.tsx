import { AlertTriangle } from 'lucide-react'
import { Toggle } from './Toggle'

export interface SecuritySettingsData {
  twoFactorEnabled: boolean
  sessionTimeout: number
  ipWhitelist: string
  passwordExpiry: number
}

interface SecuritySettingsProps {
  settings: SecuritySettingsData
  onChange: (data: SecuritySettingsData) => void
}

export function SecuritySettings({ settings, onChange }: SecuritySettingsProps) {
  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Безопасность</h2>
      
      <div className="space-y-6">
        <Toggle
          label="Двухфакторная аутентификация"
          description="Требовать код подтверждения при входе"
          checked={settings.twoFactorEnabled}
          onChange={(v) => onChange({ ...settings, twoFactorEnabled: v })}
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Тайм-аут сессии</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={settings.sessionTimeout}
              onChange={(e) => onChange({ ...settings, sessionTimeout: Number(e.target.value) })}
              className="w-32 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="text-slate-500 text-sm">минут бездействия</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Срок действия пароля</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={settings.passwordExpiry}
              onChange={(e) => onChange({ ...settings, passwordExpiry: Number(e.target.value) })}
              className="w-32 px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="text-slate-500 text-sm">дней (0 = без ограничений)</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Белый список IP</label>
          <textarea
            value={settings.ipWhitelist}
            onChange={(e) => onChange({ ...settings, ipWhitelist: e.target.value })}
            placeholder="Введите IP-адреса через запятую или по одному на строку"
            rows={3}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
          />
          <p className="text-xs text-slate-500 mt-1">Оставьте пустым для доступа с любого IP</p>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-800">Важно</h4>
              <p className="text-sm text-amber-700 mt-1">
                Изменение настроек безопасности может повлиять на доступ пользователей. 
                Убедитесь, что все изменения согласованы с командой.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
