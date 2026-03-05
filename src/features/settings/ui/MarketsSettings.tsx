import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Globe, Users, Hash, X, Search, Check } from 'lucide-react'
import { apiGet, apiPost, apiPut, apiDelete } from '@/shared/services/api.service'

interface Market {
  id: string
  name: string
  code: string
  country: string | null
  timezone: string
  isActive: boolean
  channelsCount: number
  agentsCount: number
}

interface Agent {
  id: string
  name: string
  username?: string
  position?: string
  status?: string
}

interface Channel {
  id: string
  name: string
  source: string
  type: string
  isActive: boolean
}

export function MarketsSettings() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', code: '', country: '', timezone: 'Asia/Tashkent' })

  const [selectedMarket, setSelectedMarket] = useState<string | null>(null)
  const [marketAgents, setMarketAgents] = useState<Agent[]>([])
  const [allAgents, setAllAgents] = useState<Agent[]>([])
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [agentSearch, setAgentSearch] = useState('')
  const [showChannelPicker, setShowChannelPicker] = useState(false)
  const [unassignedChannels, setUnassignedChannels] = useState<Channel[]>([])

  const fetchMarkets = useCallback(async () => {
    try {
      const data = await apiGet<{ markets: Market[]; unassignedChannels: number }>('/markets', false)
      setMarkets(data.markets || [])
      setUnassigned(data.unassignedChannels || 0)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMarkets() }, [fetchMarkets])

  const fetchMarketAgents = useCallback(async (marketId: string) => {
    try {
      const data = await apiGet<{ agents: Agent[] }>(`/markets?action=agents&marketId=${marketId}`, false)
      setMarketAgents(data.agents || [])
    } catch { setMarketAgents([]) }
  }, [])

  const fetchAllAgents = useCallback(async () => {
    try {
      const data = await apiGet<{ agents: Agent[] }>('/agents', false)
      setAllAgents(data.agents || [])
    } catch { setAllAgents([]) }
  }, [])

  const fetchUnassignedChannels = useCallback(async () => {
    try {
      const data = await apiGet<{ channels: { id: string; name: string; source: string; type: string; isActive: boolean; marketId: string | null }[] }>('/channels?limit=500', false)
      setUnassignedChannels((data.channels || []).filter(c => !c.marketId))
    } catch { setUnassignedChannels([]) }
  }, [])

  useEffect(() => {
    if (selectedMarket) {
      fetchMarketAgents(selectedMarket)
      fetchAllAgents()
    }
  }, [selectedMarket, fetchMarketAgents, fetchAllAgents])

  const handleSave = async () => {
    if (!form.name || !form.code) return
    try {
      if (editingId) {
        await apiPut('/markets', { id: editingId, ...form })
      } else {
        await apiPost('/markets', form)
      }
      setShowForm(false)
      setEditingId(null)
      setForm({ name: '', code: '', country: '', timezone: 'Asia/Tashkent' })
      fetchMarkets()
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить рынок? Все привязки каналов и агентов будут сброшены.')) return
    try {
      await apiDelete(`/markets?id=${id}`)
      if (selectedMarket === id) setSelectedMarket(null)
      fetchMarkets()
    } catch { /* ignore */ }
  }

  const handleAssignAgent = async (agentId: string) => {
    if (!selectedMarket) return
    await apiPost('/markets?action=assign-agents', { marketId: selectedMarket, agentIds: [agentId] })
    fetchMarketAgents(selectedMarket)
    fetchMarkets()
  }

  const handleRemoveAgent = async (agentId: string) => {
    if (!selectedMarket) return
    await apiPost('/markets?action=remove-agent', { marketId: selectedMarket, agentId })
    fetchMarketAgents(selectedMarket)
    fetchMarkets()
  }

  const handleAssignChannels = async (channelIds: string[]) => {
    if (!selectedMarket || !channelIds.length) return
    await apiPost('/markets?action=assign-channels', { marketId: selectedMarket, channelIds })
    fetchMarkets()
    fetchUnassignedChannels()
    setShowChannelPicker(false)
  }

  const edit = (m: Market) => {
    setForm({ name: m.name, code: m.code, country: m.country || '', timezone: m.timezone })
    setEditingId(m.id)
    setShowForm(true)
  }

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-500">Загрузка...</div>

  const availableAgents = allAgents.filter(a =>
    !marketAgents.some(ma => ma.id === a.id) &&
    (agentSearch ? a.name.toLowerCase().includes(agentSearch.toLowerCase()) : true)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Рынки</h3>
          <p className="text-sm text-slate-500">Управление рынками, привязка сотрудников и каналов</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', code: '', country: '', timezone: 'Asia/Tashkent' }) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Plus className="w-4 h-4" /> Добавить рынок
        </button>
      </div>

      {unassigned > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          {unassigned} каналов не привязаны к рынку. Выберите рынок и привяжите каналы.
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h4 className="font-medium text-slate-900">{editingId ? 'Редактировать рынок' : 'Новый рынок'}</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Узбекистан" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Код (2-3 символа)</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toLowerCase().slice(0, 5) }))}
                placeholder="uz" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Страна</label>
              <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                placeholder="Uzbekistan" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Часовой пояс</label>
              <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="Asia/Tashkent">Asia/Tashkent (UTC+5)</option>
                <option value="Asia/Almaty">Asia/Almaty (UTC+6)</option>
                <option value="Asia/Tbilisi">Asia/Tbilisi (UTC+4)</option>
                <option value="Asia/Baku">Asia/Baku (UTC+4)</option>
                <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">Сохранить</button>
            <button onClick={() => { setShowForm(false); setEditingId(null) }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Отмена</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {markets.map(m => (
          <div key={m.id} onClick={() => setSelectedMarket(m.id)}
            className={`bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md ${
              selectedMarket === m.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
            }`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-500" />
                <div>
                  <h4 className="font-medium text-slate-900">{m.name}</h4>
                  <span className="text-xs text-slate-500 font-mono">{m.code.toUpperCase()}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); edit(m) }}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg text-xs">
                  Ред.
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-slate-600">
              <span className="flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> {m.channelsCount} каналов</span>
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {m.agentsCount} сотр.</span>
            </div>
            {m.country && <p className="text-xs text-slate-400 mt-2">{m.country} · {m.timezone}</p>}
          </div>
        ))}
      </div>

      {selectedMarket && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-slate-900">
              Сотрудники рынка: {markets.find(m => m.id === selectedMarket)?.name}
            </h4>
            <div className="flex gap-2">
              <button onClick={() => { setShowAgentPicker(true); fetchAllAgents() }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-sm">
                <Plus className="w-3.5 h-3.5" /> Добавить
              </button>
              <button onClick={() => { setShowChannelPicker(true); fetchUnassignedChannels() }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 text-sm">
                <Hash className="w-3.5 h-3.5" /> Привязать каналы
              </button>
            </div>
          </div>

          {marketAgents.length === 0 ? (
            <p className="text-sm text-slate-500">Нет назначенных сотрудников</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {marketAgents.map(a => (
                <div key={a.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="text-sm font-medium text-slate-900">{a.name}</span>
                    {a.username && <span className="text-xs text-slate-400 ml-2">@{a.username}</span>}
                    {a.position && <span className="text-xs text-slate-500 ml-2">{a.position}</span>}
                  </div>
                  <button onClick={() => handleRemoveAgent(a.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showAgentPicker && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={agentSearch} onChange={e => setAgentSearch(e.target.value)}
                  placeholder="Поиск сотрудников..." className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableAgents.slice(0, 20).map(a => (
                  <button key={a.id} onClick={() => handleAssignAgent(a.id)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-white rounded-lg text-sm text-left">
                    <span>{a.name} {a.username ? `(@${a.username})` : ''}</span>
                    <Check className="w-4 h-4 text-green-500 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
                {availableAgents.length === 0 && <p className="text-xs text-slate-500 p-2">Все сотрудники уже назначены</p>}
              </div>
              <button onClick={() => { setShowAgentPicker(false); setAgentSearch('') }}
                className="text-xs text-slate-500 hover:text-slate-700">Закрыть</button>
            </div>
          )}

          {showChannelPicker && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <p className="text-sm font-medium text-slate-700">Непривязанные каналы ({unassignedChannels.length})</p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {unassignedChannels.slice(0, 30).map(ch => (
                  <button key={ch.id} onClick={() => handleAssignChannels([ch.id])}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-white rounded-lg text-sm text-left">
                    <span>{ch.name} <span className="text-xs text-slate-400">({ch.source})</span></span>
                    <Plus className="w-3.5 h-3.5 text-green-500" />
                  </button>
                ))}
                {unassignedChannels.length === 0 && <p className="text-xs text-slate-500 p-2">Все каналы привязаны</p>}
              </div>
              {unassignedChannels.length > 0 && (
                <button onClick={() => handleAssignChannels(unassignedChannels.map(c => c.id))}
                  className="text-xs text-blue-600 hover:text-blue-700">Привязать все ({unassignedChannels.length})</button>
              )}
              <button onClick={() => setShowChannelPicker(false)}
                className="text-xs text-slate-500 hover:text-slate-700 ml-3">Закрыть</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
