import { useState, useEffect, useCallback } from 'react'
import { saGet, saPost, saPut, saDelete } from '@/shared/services/sa-api.service'
import {
  Building2, Plus, Users, Globe, MessageSquare, Bot, Brain,
  Check, X, Trash2, ChevronDown, ChevronUp
} from 'lucide-react'

interface OrgData {
  id: string
  name: string
  slug: string
  plan: string
  logoUrl?: string
  isActive: boolean
  maxAgents: number
  maxChannels: number
  maxMessagesPerMonth: number
  hasTelegram: boolean
  telegramBotUsername?: string
  hasWhatsApp: boolean
  hasOpenAI: boolean
  aiModel?: string
  createdAt: string
  stats?: { agents: number; channels: number; messagesLast30d: number }
}

interface NewOrgForm {
  name: string
  slug: string
  plan: string
  maxAgents: number
  maxChannels: number
  telegramBotToken: string
  openaiApiKey: string
}

const emptyForm: NewOrgForm = {
  name: '', slug: '', plan: 'starter', maxAgents: 5, maxChannels: 50,
  telegramBotToken: '', openaiApiKey: '',
}

export function SAOrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewOrgForm>(emptyForm)
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const data = await saGet<{ organizations: OrgData[] }>('/admin/organizations')
      setOrgs(data.organizations || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleCreate = async () => {
    if (!form.name || !form.slug) return
    setSaving(true)
    setError('')
    try {
      await saPost('/admin/organizations', form)
      setShowForm(false)
      setForm(emptyForm)
      await fetchData()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (org: OrgData) => {
    try {
      await saPut('/admin/organizations', { id: org.id, isActive: !org.isActive })
      await fetchData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDelete = async (orgId: string) => {
    if (!confirm('Деактивировать организацию?')) return
    try {
      await saDelete(`/admin/organizations?id=${orgId}`)
      await fetchData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const slugify = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Организации</h1>
            <p className="text-sm text-slate-500 mt-1">Управление клиентскими аккаунтами</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            Новая организация
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">&times;</button>
          </div>
        )}

        {showForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4">Создать организацию</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Название</label>
                <input
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
                  placeholder="Компания ООО"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Slug (URL)</label>
                <div className="flex items-center gap-1">
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="company"
                  />
                  <span className="text-xs text-slate-400 whitespace-nowrap">.gfsupport.uz</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Тариф</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none"
                  value={form.plan}
                  onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                >
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Макс. агентов</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none"
                  value={form.maxAgents}
                  onChange={e => setForm(f => ({ ...f, maxAgents: +e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Telegram Bot Token</label>
                <input
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                  value={form.telegramBotToken}
                  onChange={e => setForm(f => ({ ...f, telegramBotToken: e.target.value }))}
                  placeholder="123456:ABC-DEF..."
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">OpenAI API Key</label>
                <input
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                  value={form.openaiApiKey}
                  onChange={e => setForm(f => ({ ...f, openaiApiKey: e.target.value }))}
                  placeholder="sk-..."
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleCreate}
                disabled={saving || !form.name || !form.slug}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Создание...' : 'Создать'}
              </button>
              <button
                onClick={() => { setShowForm(false); setForm(emptyForm) }}
                className="px-5 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {orgs.map(org => (
            <div
              key={org.id}
              className={`bg-white rounded-2xl border ${org.isActive ? 'border-slate-200' : 'border-red-200 bg-red-50/30'} shadow-sm overflow-hidden`}
            >
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                onClick={() => setExpandedOrg(expandedOrg === org.id ? null : org.id)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${org.isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 truncate">{org.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-mono">{org.slug}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        org.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                        org.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{org.plan}</span>
                      {!org.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Неактивна</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{org.stats?.agents || 0}</span>
                      <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{org.stats?.channels || 0}</span>
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{(org.stats?.messagesLast30d || 0).toLocaleString()}</span>
                      {org.hasTelegram && <Bot className="w-3 h-3 text-blue-500" />}
                      {org.hasWhatsApp && <MessageSquare className="w-3 h-3 text-green-500" />}
                      {org.hasOpenAI && <Brain className="w-3 h-3 text-purple-500" />}
                    </div>
                  </div>
                </div>
                {expandedOrg === org.id ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </div>

              {expandedOrg === org.id && (
                <div className="px-5 pb-4 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <MiniStat label="Макс. агентов" value={org.maxAgents} />
                    <MiniStat label="Макс. каналов" value={org.maxChannels} />
                    <MiniStat label="Макс. сообщ./мес" value={org.maxMessagesPerMonth.toLocaleString()} />
                    <MiniStat label="AI Модель" value={org.aiModel || 'gpt-4o-mini'} />
                  </div>
                  {org.telegramBotUsername && (
                    <p className="text-sm text-slate-600 mb-3">
                      Telegram: <span className="font-mono text-blue-600">@{org.telegramBotUsername}</span>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleToggleActive(org) }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                        org.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {org.isActive ? <><X className="w-3.5 h-3.5" />Деактивировать</> : <><Check className="w-3.5 h-3.5" />Активировать</>}
                    </button>
                    {org.id !== 'org_delever' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(org.id) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />Удалить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {orgs.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>Нет организаций</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

export default SAOrganizationsPage
