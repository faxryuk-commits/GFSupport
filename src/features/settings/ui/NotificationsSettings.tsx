import { Bell, Mail, Smartphone } from 'lucide-react'

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

export function NotificationsSettings({ notifications, onToggle }: NotificationsSettingsProps) {
  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Настройки уведомлений</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 text-sm font-medium text-slate-500">Событие</th>
              <th className="text-center py-3 text-sm font-medium text-slate-500 w-24">
                <div className="flex items-center justify-center gap-1">
                  <Mail className="w-4 h-4" />
                  Email
                </div>
              </th>
              <th className="text-center py-3 text-sm font-medium text-slate-500 w-24">
                <div className="flex items-center justify-center gap-1">
                  <Smartphone className="w-4 h-4" />
                  Push
                </div>
              </th>
              <th className="text-center py-3 text-sm font-medium text-slate-500 w-24">
                <div className="flex items-center justify-center gap-1">
                  <Bell className="w-4 h-4" />
                  В приложении
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {notifications.map(notification => (
              <tr key={notification.id} className="border-b border-slate-100 last:border-0">
                <td className="py-4">
                  <span className="font-medium text-slate-700">{notification.label}</span>
                  <p className="text-xs text-slate-500 mt-0.5">{notification.description}</p>
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={notification.email}
                    onChange={() => onToggle(notification.id, 'email')}
                    className="w-5 h-5 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={notification.push}
                    onChange={() => onToggle(notification.id, 'push')}
                    className="w-5 h-5 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={notification.inApp}
                    onChange={() => onToggle(notification.id, 'inApp')}
                    className="w-5 h-5 text-blue-500 rounded border-slate-300 focus:ring-blue-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
