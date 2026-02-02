import { Bell, Mail, Smartphone, Check } from 'lucide-react'

export interface NotificationSetting {
  id: string
  label: string
  description: string
  email: boolean
  push: boolean
  inApp: boolean
}

interface NotificationsSettingsProps {
  notifications: NotificationSetting[]
  onToggle: (id: string, field: 'email' | 'push' | 'inApp') => void
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
        checked 
          ? 'bg-blue-500 border-blue-500 shadow-lg shadow-blue-500/25' 
          : 'border-slate-300 hover:border-slate-400 bg-white'
      }`}
    >
      {checked && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
    </button>
  )
}

export function NotificationsSettings({ notifications, onToggle }: NotificationsSettingsProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
            <Bell className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Настройки уведомлений</h3>
            <p className="text-xs text-slate-500">Выберите как получать уведомления</p>
          </div>
        </div>
      </div>
      
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 pb-4 border-b border-slate-100 mb-2">
          <div className="flex-1 text-sm font-medium text-slate-500">Событие</div>
          <div className="w-24 text-center">
            <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500">
              <Mail className="w-4 h-4" />
              <span>Email</span>
            </div>
          </div>
          <div className="w-24 text-center">
            <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500">
              <Smartphone className="w-4 h-4" />
              <span>Push</span>
            </div>
          </div>
          <div className="w-24 text-center">
            <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500">
              <Bell className="w-4 h-4" />
              <span>Приложение</span>
            </div>
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-1">
          {notifications.map(notification => (
            <div 
              key={notification.id} 
              className="flex items-center gap-4 py-4 px-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className="flex-1">
                <span className="font-medium text-slate-700">{notification.label}</span>
                <p className="text-xs text-slate-500 mt-0.5">{notification.description}</p>
              </div>
              <div className="w-24 flex justify-center">
                <Checkbox 
                  checked={notification.email} 
                  onChange={() => onToggle(notification.id, 'email')} 
                />
              </div>
              <div className="w-24 flex justify-center">
                <Checkbox 
                  checked={notification.push} 
                  onChange={() => onToggle(notification.id, 'push')} 
                />
              </div>
              <div className="w-24 flex justify-center">
                <Checkbox 
                  checked={notification.inApp} 
                  onChange={() => onToggle(notification.id, 'inApp')} 
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
