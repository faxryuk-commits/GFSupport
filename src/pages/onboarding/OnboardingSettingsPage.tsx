import { useState, useEffect, useCallback } from 'react'
import { Bell, Shield, MessageSquare, Mail, Smartphone, ToggleLeft, ToggleRight } from 'lucide-react'
import { useToast, LoadingSpinner, Tabs, TabPanel } from '@/shared/ui'
import type { NotificationRule, SLARule } from '@/entities/onboarding'
import {
  fetchNotificationRules, updateNotificationRules,
  fetchSLARules, updateSLARules,
} from '@/shared/api/onboarding'

const CONNECTION_STATUSES = [
  { label: 'Активно', color: 'bg-green-500' },
  { label: 'На паузе', color: 'bg-amber-500' },
  { label: 'Заморожено', color: 'bg-blue-400' },
  { label: 'Отменено', color: 'bg-red-500' },
  { label: 'Запущено', color: 'bg-emerald-600' },
]

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="text-slate-500 hover:text-blue-600">
      {value
        ? <ToggleRight className="w-8 h-8 text-blue-600" />
        : <ToggleLeft className="w-8 h-8 text-slate-300" />}
    </button>
  )
}

function ChannelToggle({ icon: Icon, label, enabled, onToggle }: {
  icon: React.ElementType; label: string; enabled: boolean; onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">{label}</span>
      </div>
      <Toggle value={enabled} onChange={onToggle} />
    </div>
  )
}

function NotificationsTab({ rules, onSave }: {
  rules: NotificationRule[]
  onSave: (rules: NotificationRule[]) => void
}) {
  const [channels, setChannels] = useState({ telegram: true, email: true, push: false })
  const [localRules, setLocalRules] = useState(rules)

  useEffect(() => { setLocalRules(rules) }, [rules])

  const toggleRule = (id: string) => {
    const updated = localRules.map(r =>
      r.id === id ? { ...r, isActive: !r.isActive } : r
    )
    setLocalRules(updated)
    onSave(updated)
  }

  const eventLabels: Record<string, string> = {
    stage_completed: 'Этап завершён',
    task_overdue: 'Задача просрочена',
    ball_passed: 'Мяч передан',
    connection_created: 'Подключение создано',
    deadline_approaching: 'Приближается дедлайн',
  }

  const recipientLabels: Record<string, string> = {
    manager: 'Менеджер',
    team: 'Команда',
    admin: 'Администратор',
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Каналы уведомлений</h3>
        <div className="space-y-2">
          <ChannelToggle
            icon={MessageSquare} label="Telegram"
            enabled={channels.telegram}
            onToggle={() => setChannels(c => ({ ...c, telegram: !c.telegram }))}
          />
          <ChannelToggle
            icon={Mail} label="Email"
            enabled={channels.email}
            onToggle={() => setChannels(c => ({ ...c, email: !c.email }))}
          />
          <ChannelToggle
            icon={Smartphone} label="Push-уведомления"
            enabled={channels.push}
            onToggle={() => setChannels(c => ({ ...c, push: !c.push }))}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Правила уведомлений</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-200">
                <th className="pb-2 font-medium">Событие</th>
                <th className="pb-2 font-medium">Получатель</th>
                <th className="pb-2 font-medium">Канал</th>
                <th className="pb-2 font-medium text-right">Задержка</th>
                <th className="pb-2 font-medium text-right">Вкл</th>
              </tr>
            </thead>
            <tbody>
              {localRules.map(r => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2.5 text-slate-700">{eventLabels[r.eventType] ?? r.eventType}</td>
                  <td className="py-2.5 text-slate-600">{recipientLabels[r.recipientType] ?? r.recipientType}</td>
                  <td className="py-2.5 text-slate-600">{r.channel}</td>
                  <td className="py-2.5 text-right text-slate-600">{r.delayDays > 0 ? `${r.delayDays} дн.` : 'Сразу'}</td>
                  <td className="py-2.5 text-right">
                    <Toggle value={r.isActive} onChange={() => toggleRule(r.id)} />
                  </td>
                </tr>
              ))}
              {localRules.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-slate-400">Правил нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SLATab({ rules, onSave }: {
  rules: SLARule[]
  onSave: (rules: SLARule[]) => void
}) {
  const [localRules, setLocalRules] = useState(rules)
  useEffect(() => { setLocalRules(rules) }, [rules])

  const toggleRule = (id: string) => {
    const updated = localRules.map(r =>
      r.id === id ? { ...r, isActive: !r.isActive } : r
    )
    setLocalRules(updated)
    onSave(updated)
  }

  const actionLabels: Record<string, string> = {
    notify: 'Уведомление',
    escalate: 'Эскалация',
    freeze: 'Заморозка',
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Правила эскалации</h3>
        <div className="space-y-2">
          {localRules.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-4 rounded-lg border border-slate-200 px-4 py-3"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">
                  {r.triggerType === 'stage_overdue' ? 'Этап просрочен' : r.triggerType}
                  {' · '}
                  <span className="text-slate-500">{r.delayDays} дн.</span>
                </p>
                <p className="text-xs text-slate-500">
                  {actionLabels[r.action] ?? r.action} → {r.recipientType}
                </p>
              </div>
              <Toggle value={r.isActive} onChange={() => toggleRule(r.id)} />
            </div>
          ))}
          {localRules.length === 0 && (
            <p className="text-sm text-slate-400 py-4 text-center">Правил нет</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Статусы подключений</h3>
        <div className="flex flex-wrap gap-2">
          {CONNECTION_STATUSES.map(s => (
            <span
              key={s.label}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white ${s.color}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const SETTINGS_TABS = [
  { id: 'notifications', label: 'Уведомления', icon: <Bell className="w-4 h-4" /> },
  { id: 'sla', label: 'SLA и эскалации', icon: <Shield className="w-4 h-4" /> },
]

export function OnboardingSettingsPage() {
  const toast = useToast()

  const [activeTab, setActiveTab] = useState('notifications')
  const [notifRules, setNotifRules] = useState<NotificationRule[]>([])
  const [slaRules, setSlaRules] = useState<SLARule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchNotificationRules(),
      fetchSLARules(),
    ])
      .then(([nr, sr]) => { setNotifRules(nr); setSlaRules(sr) })
      .catch(() => toast.error('Ошибка', 'Не удалось загрузить настройки'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveNotif = useCallback(async (rules: NotificationRule[]) => {
    try {
      const saved = await updateNotificationRules(rules)
      setNotifRules(saved)
      toast.success('Настройки сохранены')
    } catch {
      toast.error('Ошибка', 'Не удалось сохранить настройки')
    }
  }, [toast])

  const handleSaveSLA = useCallback(async (rules: SLARule[]) => {
    try {
      const saved = await updateSLARules(rules)
      setSlaRules(saved)
      toast.success('Настройки SLA сохранены')
    } catch {
      toast.error('Ошибка', 'Не удалось сохранить настройки')
    }
  }, [toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Настройки подключений</h1>

      <Tabs tabs={SETTINGS_TABS} activeTab={activeTab} onChange={setActiveTab} variant="underline" />

      <div className="mt-6">
        <TabPanel tabId="notifications" activeTab={activeTab}>
          <NotificationsTab rules={notifRules} onSave={handleSaveNotif} />
        </TabPanel>
        <TabPanel tabId="sla" activeTab={activeTab}>
          <SLATab rules={slaRules} onSave={handleSaveSLA} />
        </TabPanel>
      </div>
    </div>
  )
}
