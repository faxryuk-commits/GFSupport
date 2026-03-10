import { useState, useEffect } from 'react'
import { saGet } from '@/shared/services/sa-api.service'
import { Building2, Users, Globe, MessageSquare, FolderOpen, TrendingUp } from 'lucide-react'

interface GlobalStats {
  organizations: { total: number; active: number }
  agents: number
  channels: number
  messages: { today: number; last30d: number }
  openCases: number
}

interface OrgStat {
  id: string
  name: string
  slug: string
  plan: string
  isActive: boolean
  agents: number
  channels: number
  msgsToday: number
  msgs30d: number
  openCases: number
}

interface DailyTrend {
  day: string
  messages: number
}

export function SADashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [perOrg, setPerOrg] = useState<OrgStat[]>([])
  const [trend, setTrend] = useState<DailyTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    saGet<{ global: GlobalStats; perOrg: OrgStat[]; dailyTrend: DailyTrend[] }>('/admin/stats')
      .then(data => {
        setStats(data.global)
        setPerOrg(data.perOrg || [])
        setTrend(data.dailyTrend || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const maxMsg = Math.max(...trend.map(t => t.messages), 1)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Дашборд платформы</h1>
          <p className="text-sm text-slate-500 mt-1">Общая статистика GFSupport</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card icon={Building2} label="Организации" value={`${stats.organizations.active} / ${stats.organizations.total}`} color="bg-blue-50 text-blue-600" />
            <Card icon={Users} label="Агенты" value={stats.agents} color="bg-indigo-50 text-indigo-600" />
            <Card icon={Globe} label="Каналы" value={stats.channels} color="bg-purple-50 text-purple-600" />
            <Card icon={MessageSquare} label="Сообщения сегодня" value={stats.messages.today.toLocaleString()} color="bg-green-50 text-green-600" />
            <Card icon={FolderOpen} label="Открытые кейсы" value={stats.openCases} color="bg-amber-50 text-amber-600" />
          </div>
        )}

        {trend.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900">Сообщения за 14 дней</h2>
            </div>
            <div className="flex items-end gap-1 h-32">
              {trend.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-indigo-500 rounded-t hover:bg-indigo-600 transition-colors min-h-[2px]"
                    style={{ height: `${(d.messages / maxMsg) * 100}%` }}
                    title={`${d.day}: ${d.messages}`}
                  />
                  <span className="text-[9px] text-slate-400">{d.day?.slice(5, 10)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {perOrg.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">По организациям</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs">
                    <th className="px-6 py-3 text-left font-medium">Организация</th>
                    <th className="px-4 py-3 text-center font-medium">Тариф</th>
                    <th className="px-4 py-3 text-center font-medium">Агенты</th>
                    <th className="px-4 py-3 text-center font-medium">Каналы</th>
                    <th className="px-4 py-3 text-center font-medium">Сегодня</th>
                    <th className="px-4 py-3 text-center font-medium">30 дней</th>
                    <th className="px-4 py-3 text-center font-medium">Кейсы</th>
                    <th className="px-4 py-3 text-center font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {perOrg.map(org => (
                    <tr key={org.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3">
                        <div className="font-medium text-slate-900">{org.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{org.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          org.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                          org.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{org.plan}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700">{org.agents}</td>
                      <td className="px-4 py-3 text-center text-slate-700">{org.channels}</td>
                      <td className="px-4 py-3 text-center text-slate-700">{org.msgsToday}</td>
                      <td className="px-4 py-3 text-center text-slate-700">{org.msgs30d.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-slate-700">{org.openCases}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${org.isActive ? 'bg-green-500' : 'bg-red-400'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

export default SADashboardPage
