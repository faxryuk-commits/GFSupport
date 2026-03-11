import { useState, useEffect, useCallback } from 'react'
import { saGet, saPost, saPut, saDelete } from '@/shared/services/sa-api.service'
import {
  Building2, Plus, Users, Globe, MessageSquare, Bot, Brain,
  Check, X, Trash2, ChevronDown, ChevronUp, Pencil, Save,
  Shield, Zap, Crown, Calendar, Hash, Link2
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
  ownerAgentId?: string
  trialEndsAt?: string
  createdAt: string
  updatedAt?: string
  stats?: { agents: number; channels: number; messagesLast30d: number }
}

interface EditForm {
  name: string
  plan: string
  maxAgents: number
  maxChannels: number
  maxMessagesPerMonth: number
  aiModel: string
  telegramBotToken: string
  telegramBotUsername: string
  whatsappBridgeUrl: string
  whatsappBridgeSecret: string
  openaiApiKey: string
  logoUrl: string
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

const emptyNewForm: NewOrgForm = {
  name: '', slug: '', plan: 'starter', maxAgents: 5, maxChannels: 50,
  telegramBotToken: '', openaiApiKey: '',
}

function buildEditForm(org: OrgData): EditForm {
  return {
    name: org.name,
    plan: org.plan,
    maxAgents: org.maxAgents,
    maxChannels: org.maxChannels,
    maxMessagesPerMonth: org.maxMessagesPerMonth,
    aiModel: org.aiModel || 'gpt-4o-mini',
    telegramBotToken: '',
    telegramBotUsername: org.telegramBotUsername || '',
    whatsappBridgeUrl: '',
    whatsappBridgeSecret: '',
    openaiApiKey: '',
    logoUrl: org.logoUrl || '',
  }
}

export function SAOrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgData[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState<NewOrgForm>(emptyNewForm)
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)
  const [editingOrg, setEditingOrg] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
    if (!newForm.name || !newForm.slug) return
    setSaving(true); setError('')
    try {
      await saPost('/admin/organizations', newForm)
      setShowNewForm(false)
      setNewForm(emptyNewForm)
      setSuccess('Организация создана')
      await fetchData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const startEdit = (org: OrgData) => {
    setEditingOrg(org.id)
    setEditForm(buildEditForm(org))
    setExpandedOrg(org.id)
  }

  const cancelEdit = () => {
    setEditingOrg(null)
    setEditForm(null)
  }

  const handleSaveEdit = async (orgId: string) => {
    if (!editForm) return
    setSaving(true); setError('')
    try {
      const payload: Record<string, any> = { id: orgId }

      const org = orgs.find(o => o.id === orgId)
      if (!org) return

      if (editForm.name !== org.name) payload.name = editForm.name
      if (editForm.plan !== org.plan) payload.plan = editForm.plan
      if (editForm.maxAgents !== org.maxAgents) payload.maxAgents = editForm.maxAgents
      if (editForm.maxChannels !== org.maxChannels) payload.maxChannels = editForm.maxChannels
      if (editForm.maxMessagesPerMonth !== org.maxMessagesPerMonth) payload.maxMessagesPerMonth = editForm.maxMessagesPerMonth
      if (editForm.aiModel !== (org.aiModel || 'gpt-4o-mini')) payload.aiModel = editForm.aiModel
      if (editForm.telegramBotUsername !== (org.telegramBotUsername || '')) payload.telegramBotUsername = editForm.telegramBotUsername
      if (editForm.logoUrl !== (org.logoUrl || '')) payload.logoUrl = editForm.logoUrl
      if (editForm.telegramBotToken) payload.telegramBotToken = editForm.telegramBotToken
      if (editForm.whatsappBridgeUrl) payload.whatsappBridgeUrl = editForm.whatsappBridgeUrl
      if (editForm.whatsappBridgeSecret) payload.whatsappBridgeSecret = editForm.whatsappBridgeSecret
      if (editForm.openaiApiKey) payload.openaiApiKey = editForm.openaiApiKey

      if (Object.keys(payload).length <= 1) {
        cancelEdit()
        return
      }

      await saPut('/admin/organizations', payload)
      setEditingOrg(null)
      setEditForm(null)
      setSuccess('Изменения сохранены')
      await fetchData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleToggleActive = async (org: OrgData) => {
    try {
      await saPut('/admin/organizations', { id: org.id, isActive: !org.isActive })
      setSuccess(org.isActive ? 'Организация деактивирована' : 'Организация активирована')
      await fetchData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: any) { setError(e.message) }
  }

  const handleDelete = async (orgId: string) => {
    if (!confirm('Удалить организацию? Это действие необратимо.')) return
    try {
      await saDelete(`/admin/organizations?id=${orgId}`)
      await fetchData()
    } catch (e: any) { setError(e.message) }
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
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            Новая организация
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="font-bold text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
            <CheckCircleIcon /> {success}
          </div>
        )}

        {/* New org form */}
        {showNewForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4">Создать организацию</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Название" value={newForm.name} onChange={v => setNewForm(f => ({ ...f, name: v, slug: slugify(v) }))} placeholder="Компания ООО" />
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Slug (URL)</label>
                <div className="flex items-center gap-1">
                  <input className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm" value={newForm.slug} onChange={e => setNewForm(f => ({ ...f, slug: e.target.value }))} placeholder="company" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">.gfsupport.uz</span>
                </div>
              </div>
              <SelectField label="Тариф" value={newForm.plan} onChange={v => setNewForm(f => ({ ...f, plan: v }))} options={planOptions} />
              <NumField label="Макс. агентов" value={newForm.maxAgents} onChange={v => setNewForm(f => ({ ...f, maxAgents: v }))} />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleCreate} disabled={saving || !newForm.name || !newForm.slug} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
                {saving ? 'Создание...' : 'Создать'}
              </button>
              <button onClick={() => { setShowNewForm(false); setNewForm(emptyNewForm) }} className="px-5 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Отмена</button>
            </div>
          </div>
        )}

        {/* Org list */}
        <div className="space-y-3">
          {orgs.map(org => {
            const isEditing = editingOrg === org.id
            const isExpanded = expandedOrg === org.id

            return (
              <div key={org.id} className={`bg-white rounded-2xl border ${org.isActive ? 'border-slate-200' : 'border-red-200 bg-red-50/30'} shadow-sm overflow-hidden`}>
                {/* Header row */}
                <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors" onClick={() => { if (!isEditing) setExpandedOrg(isExpanded ? null : org.id) }}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${org.isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 truncate">{org.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-mono">{org.slug}</span>
                        <PlanBadge plan={org.plan} />
                        {!org.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Неактивна</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{org.stats?.agents || 0}</span>
                        <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{org.stats?.channels || 0}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{(org.stats?.messagesLast30d || 0).toLocaleString()}</span>
                        {org.hasTelegram && <span title="Telegram"><Bot className="w-3 h-3 text-blue-500" /></span>}
                        {org.hasWhatsApp && <span title="WhatsApp"><MessageSquare className="w-3 h-3 text-green-500" /></span>}
                        {org.hasOpenAI && <span title="OpenAI"><Brain className="w-3 h-3 text-purple-500" /></span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isEditing && (
                      <button onClick={e => { e.stopPropagation(); startEdit(org) }} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Редактировать">
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </div>
                </div>

                {/* Expanded: View or Edit */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                    {isEditing && editForm ? (
                      <EditPanel
                        org={org}
                        form={editForm}
                        setForm={setEditForm}
                        saving={saving}
                        onSave={() => handleSaveEdit(org.id)}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <ViewPanel
                        org={org}
                        onEdit={() => startEdit(org)}
                        onToggleActive={() => handleToggleActive(org)}
                        onDelete={() => handleDelete(org.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}

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

function ViewPanel({ org, onEdit, onToggleActive, onDelete }: { org: OrgData; onEdit: () => void; onToggleActive: () => void; onDelete: () => void }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label="Макс. агентов" value={org.maxAgents} />
        <MiniStat label="Макс. каналов" value={org.maxChannels} />
        <MiniStat label="Макс. сообщ./мес" value={org.maxMessagesPerMonth.toLocaleString()} />
        <MiniStat label="AI Модель" value={org.aiModel || 'gpt-4o-mini'} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <IntegrationBadge label="Telegram" active={org.hasTelegram} detail={org.telegramBotUsername ? `@${org.telegramBotUsername}` : undefined} />
        <IntegrationBadge label="WhatsApp" active={org.hasWhatsApp} />
        <IntegrationBadge label="OpenAI" active={org.hasOpenAI} />
        <MiniStat label="Создана" value={org.createdAt ? new Date(org.createdAt).toLocaleDateString('ru') : '—'} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-indigo-600 hover:bg-indigo-50">
          <Pencil className="w-3.5 h-3.5" /> Редактировать
        </button>
        <button onClick={onToggleActive} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${org.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
          {org.isActive ? <><X className="w-3.5 h-3.5" /> Деактивировать</> : <><Check className="w-3.5 h-3.5" /> Активировать</>}
        </button>
        {org.id !== 'org_delever' && (
          <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100">
            <Trash2 className="w-3.5 h-3.5" /> Удалить
          </button>
        )}
      </div>
    </>
  )
}

function EditPanel({ org, form, setForm, saving, onSave, onCancel }: {
  org: OrgData; form: EditForm; setForm: (f: EditForm) => void; saving: boolean; onSave: () => void; onCancel: () => void
}) {
  const upd = (patch: Partial<EditForm>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-6">
      {/* Basic */}
      <Section title="Основные" icon={<Building2 className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Название компании" value={form.name} onChange={v => upd({ name: v })} />
          <SelectField label="Тариф" value={form.plan} onChange={v => upd({ plan: v })} options={planOptions} />
          <Field label="Лого (URL)" value={form.logoUrl} onChange={v => upd({ logoUrl: v })} placeholder="https://..." />
        </div>
      </Section>

      {/* Limits */}
      <Section title="Лимиты" icon={<Shield className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumField label="Макс. агентов" value={form.maxAgents} onChange={v => upd({ maxAgents: v })} />
          <NumField label="Макс. каналов" value={form.maxChannels} onChange={v => upd({ maxChannels: v })} />
          <NumField label="Макс. сообщений/мес" value={form.maxMessagesPerMonth} onChange={v => upd({ maxMessagesPerMonth: v })} />
        </div>
      </Section>

      {/* AI */}
      <Section title="AI" icon={<Brain className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField label="AI Модель" value={form.aiModel} onChange={v => upd({ aiModel: v })} options={aiModelOptions} />
          <SecretField label="OpenAI API Key" value={form.openaiApiKey} onChange={v => upd({ openaiApiKey: v })} isSet={org.hasOpenAI} placeholder="sk-..." />
        </div>
      </Section>

      {/* Telegram */}
      <Section title="Telegram" icon={<Bot className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SecretField label="Bot Token" value={form.telegramBotToken} onChange={v => upd({ telegramBotToken: v })} isSet={org.hasTelegram} placeholder="123456:ABC-DEF..." />
          <Field label="Bot Username" value={form.telegramBotUsername} onChange={v => upd({ telegramBotUsername: v })} placeholder="my_bot" />
        </div>
      </Section>

      {/* WhatsApp */}
      <Section title="WhatsApp" icon={<MessageSquare className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SecretField label="Bridge URL" value={form.whatsappBridgeUrl} onChange={v => upd({ whatsappBridgeUrl: v })} isSet={org.hasWhatsApp} placeholder="https://..." />
          <SecretField label="Bridge Secret" value={form.whatsappBridgeSecret} onChange={v => upd({ whatsappBridgeSecret: v })} isSet={org.hasWhatsApp} placeholder="secret..." />
        </div>
      </Section>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-slate-100">
        <button onClick={onSave} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors">
          <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить изменения'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">Отмена</button>
      </div>
    </div>
  )
}

/* --- Reusable pieces --- */

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">{icon} {title}</h4>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">{label}</label>
      <input className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">{label}</label>
      <input type="number" className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm" value={value} onChange={e => onChange(+e.target.value)} />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">{label}</label>
      <select className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm bg-white" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function SecretField({ label, value, onChange, isSet, placeholder }: { label: string; value: string; onChange: (v: string) => void; isSet: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">
        {label}
        {isSet && <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">настроен</span>}
      </label>
      <input
        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm font-mono"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={isSet ? '••••••• (оставьте пустым чтобы не менять)' : placeholder}
      />
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

function IntegrationBadge({ label, active, detail }: { label: string; active: boolean; detail?: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${active ? 'bg-green-50' : 'bg-slate-50'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${active ? 'text-green-700' : 'text-slate-400'}`}>
        {active ? (detail || 'Подключён') : 'Не настроен'}
      </p>
    </div>
  )
}

function PlanBadge({ plan }: { plan: string }) {
  const styles = plan === 'enterprise'
    ? 'bg-purple-100 text-purple-700'
    : plan === 'pro' || plan === 'business'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-slate-100 text-slate-600'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles}`}>{plan}</span>
}

function CheckCircleIcon() {
  return <Check className="w-4 h-4 inline-block mr-1" />
}

const planOptions = [
  { value: 'starter', label: 'Starter' },
  { value: 'business', label: 'Business' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

const aiModelOptions = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
]

export default SAOrganizationsPage
