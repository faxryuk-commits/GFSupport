import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Toggle } from './Toggle'

// Переключатель боевого режима SLA-стража (LIVE/SHADOW) через /api/support/settings.
export function SlaGuardSettings() {
  const [live, setLive] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/support/settings')
      .then((r) => r.json())
      .then((d) => setLive(d?.settings?.sla_guard_live === true || d?.settings?.sla_guard_live === 'true'))
      .catch(() => setLive(false))
  }, [])

  const toggle = async (v: boolean) => {
    setLive(v)
    setSaving(true)
    try {
      const token = localStorage.getItem('support_agent_token') || ''
      await fetch('/api/support/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` },
        body: JSON.stringify({ settings: { sla_guard_live: v } }),
      })
    } catch {
      setLive(!v) // откат при ошибке
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e8edf3]/60 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">SLA-страж</h3>
            <p className="text-xs text-slate-500">Следит за зависшими чатами и шлёт алерт агенту/лиду</p>
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className={`p-4 rounded-xl border ${live ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
          <Toggle
            label={live ? 'Боевой режим (LIVE) — алерты включены' : 'Тихий режим (SHADOW) — только наблюдение'}
            description={
              live
                ? 'Страж реально шлёт уведомления (in-app + Telegram) агенту/лиду при превышении SLA.'
                : 'Страж всё считает и пишет в Журнал ИИ, но НИКОМУ не шлёт. Безопасно для наблюдения.'
            }
            checked={!!live}
            onChange={toggle}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {saving ? 'Сохраняю…' : live
            ? '⚠️ Включено: при следующем цикле (раз в 5 мин) лид получит реальные уведомления по зависшим чатам.'
            : 'Рекомендуется понаблюдать в Журнале ИИ, прежде чем включать боевой режим.'}
        </p>
      </div>
    </div>
  )
}
